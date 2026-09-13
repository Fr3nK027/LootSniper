"""Local LootSniper dashboard and validated, durable API. Standard library only."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse, urlunparse
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError, URLError
import argparse
import hashlib
import json
import mimetypes
import os
import re
import secrets
import threading
import time
from radar_discord import DiscordService
from radar_lifecycle import DashboardLifetime

ROOT = Path(__file__).resolve().parent
SEARCHES_FILE = ROOT / "radar-searches.json"
IMPORTS_FILE = ROOT / "radar-imports.json"
PLATFORMS = {"VINTED": "vinted.it", "EBAY": "ebay.it", "SUBITO": "subito.it"}
ALLOWED_HOSTS = {host for domain in PLATFORMS.values() for host in (domain, "www." + domain)}
STATIC_FILES = {"radar usato 3 market.html", "app.js", "styles.css", "radar-core.js", "radar-runtime.js", "browser-bridge/listings.js", "experience.css", "radar-guide.js", "theme.js", "assets/lootsniper.svg", "assets/lootsniper.ico"}
WORKSPACE_ID = hashlib.sha256(str(ROOT).casefold().encode()).hexdigest()[:16]
PORT = 8765
VERSION = "6.4"
MAX_BODY = 2 * 1024 * 1024
MAX_HTML = 10 * 1024 * 1024
browser_items_lock = threading.Lock()
searches_lock = threading.Lock()
fetch_slots = threading.BoundedSemaphore(3)


def validate_url(value, platform=None):
    if not isinstance(value, str) or len(value) > 8192:
        raise ValueError("URL non valido")
    parsed = urlparse(value.strip())
    hosts = {PLATFORMS[platform], "www." + PLATFORMS[platform]} if platform else ALLOWED_HOSTS
    if (parsed.scheme != "https" or parsed.hostname not in hosts or parsed.username
            or parsed.password or parsed.port not in (None, 443)):
        raise ValueError("Usa un link HTTPS del marketplace selezionato")
    return parsed


def canonical_url(value, platform):
    parsed = validate_url(value, platform)
    path = parsed.path.rstrip("/")
    if platform == "EBAY":
        match = re.search(r"/itm/(?:[^/]+/)?(\d+)", path)
        if match:
            path = "/itm/" + match[1]
    elif platform == "VINTED":
        match = re.match(r"/items/(\d+)", path)
        if match:
            path = "/items/" + match[1]
    return urlunparse(("https", "www." + PLATFORMS[platform], path, "", "", ""))


def read_list(path):
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(data, list):
        raise ValueError(f"Archivio {path.name} non valido; il file è stato conservato")
    return data


def atomic_write(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def reset_session_data():
    """Start every application run without searches or imported listings."""
    with searches_lock:
        atomic_write(SEARCHES_FILE, [])
    with browser_items_lock:
        atomic_write(IMPORTS_FILE, [])


def revision(searches):
    return hashlib.sha256(json.dumps(searches, sort_keys=True).encode()).hexdigest()


def clean_searches(searches):
    if not isinstance(searches, list) or len(searches) > 200:
        raise ValueError("Sono consentite al massimo 200 ricerche")
    clean, names = [], set()
    for item in searches:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str):
            raise ValueError("Ricerca non valida")
        name = item["name"].strip()
        if not name or len(name) > 80 or name.casefold() in names:
            raise ValueError("I nomi delle ricerche devono essere unici, da 1 a 80 caratteri")
        entry = {"name": name, "updatedAt": str(item.get("updatedAt", ""))[:40]}
        for platform in PLATFORMS:
            value = item.get(platform.lower(), "")
            if not isinstance(value, str):
                raise ValueError("Link ricerca non valido")
            if value.strip():
                validate_url(value, platform)
            entry[platform.lower()] = value.strip()
        if not any(entry[key.lower()] for key in PLATFORMS):
            raise ValueError("Ogni ricerca deve contenere almeno un link")
        clean.append(entry)
        names.add(name.casefold())
    return clean


def has_next_page(html, target):
    parsed = validate_url(target)
    parameter = "_pgn" if "ebay" in parsed.hostname else "o" if "subito" in parsed.hostname else "page"
    try:
        current = max(1, int(parse_qs(parsed.query).get(parameter, ["1"])[0]))
    except ValueError:
        current = 1
    return bool(re.search(rf"(?:[?&]|&amp;){parameter}={current + 1}(?:[&#\"'\s<>]|$)", html, re.I))


class SafeRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(format % args)

    def allowed_request(self):
        port = self.server.server_address[1]
        if self.headers.get("Host", "").lower() not in {f"127.0.0.1:{port}", f"localhost:{port}"}:
            return False
        origin = self.headers.get("Origin")
        return (not origin or origin in {"null", f"http://127.0.0.1:{port}", f"http://localhost:{port}"}
                or origin.startswith("chrome-extension://"))

    def guard(self):
        if not self.allowed_request():
            self.send_json(403, {"error": "Origine non autorizzata"})
            return False
        return True

    def dashboard_request(self):
        port = self.server.server_address[1]
        return self.headers.get('Origin') in (None, f'http://127.0.0.1:{port}', f'http://localhost:{port}')

    def do_GET(self):
        if not self.guard():
            return
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/status":
                self.send_json(200, {"online": True, "port": self.server.server_address[1], "version": VERSION,
                                     "workspace": WORKSPACE_ID,
                                     "session": getattr(self.server, "session_id", "test-session")})
            elif parsed.path == '/api/discord':
                if not self.dashboard_request():
                    self.send_json(403, {'error': 'Usa la dashboard locale per Discord'})
                    return
                self.send_json(200, self.server.discord.status())
            elif parsed.path == "/api/searches":
                with searches_lock:
                    searches = read_list(SEARCHES_FILE)
                self.send_json(200, {"searches": searches, "revision": revision(searches)})
            elif parsed.path == "/api/fetch":
                self.fetch_marketplace(parse_qs(parsed.query).get("url", [""])[0])
            elif parsed.path == "/api/import/latest":
                try:
                    after = max(0, int(parse_qs(parsed.query).get("after", ["0"])[0]))
                except ValueError:
                    self.send_json(400, {"error": "Cursore importazione non valido"})
                    return
                with browser_items_lock:
                    items = read_list(IMPORTS_FILE)
                cursor = max((item.get("updatedAt", 0) for item in items), default=0)
                self.send_json(200, {"items": [item for item in items if item.get("updatedAt", 0) > after], "cursor": cursor})
            else:
                self.serve_file(parsed.path)
        except (OSError, ValueError) as error:
            self.send_json(500, {"error": str(error)})

    def do_OPTIONS(self):
        if self.guard():
            self.send_response(204)
            self.send_cors_headers()
            self.end_headers()

    def read_json(self):
        if self.headers.get_content_type() != "application/json":
            raise ValueError("Invia un corpo application/json")
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length <= MAX_BODY:
            raise ValueError("Corpo richiesta vuoto o superiore a 2 MB")
        self.connection.settimeout(10)
        data = json.loads(self.rfile.read(length).decode("utf-8"), parse_constant=lambda _: None)
        if not isinstance(data, dict):
            raise ValueError("Il corpo deve essere un oggetto JSON")
        return data

    def do_POST(self):
        if not self.guard():
            return
        path = urlparse(self.path).path
        if path not in {"/api/searches", "/api/import", '/api/discord', '/api/discord/test', '/api/discord/notify', '/api/heartbeat', '/api/shutdown'}:
            self.send_json(404, {"error": "Endpoint non trovato"})
            return
        try:
            payload = self.read_json()
            if path.startswith('/api/discord') or path in {'/api/heartbeat', '/api/shutdown'}:
                if not self.dashboard_request():
                    self.send_json(403, {'error': 'Comando disponibile solo dalla dashboard locale'})
                    return
                if path == '/api/heartbeat':
                    self.server.lifetime.update(payload.get('client'), payload.get('closing') is True)
                    self.send_json(200, {'ok': True, 'autoStop': self.server.lifetime.auto_stop})
                elif path == '/api/shutdown':
                    self.send_json(200, {'ok': True})
                    threading.Thread(target=self.server.shutdown, daemon=True).start()
                elif path == '/api/discord':
                    self.send_json(200, self.server.discord.configure(payload))
                else:
                    self.send_json(200, self.server.discord.enqueue(payload.get('item'), test=path.endswith('/test')))
                return
            if path == "/api/searches":
                clean = clean_searches(payload.get("searches"))
                with searches_lock:
                    existing = read_list(SEARCHES_FILE)
                    if payload.get("revision") != revision(existing):
                        self.send_json(409, {"error": "Ricerche modificate altrove. Ricarica prima di salvare.",
                                             "searches": existing, "revision": revision(existing)})
                        return
                    atomic_write(SEARCHES_FILE, clean)
                self.send_json(200, {"saved": len(clean), "revision": revision(clean)})
            else:
                self.import_items(payload)
        except (ValueError, TypeError, UnicodeError) as error:
            self.send_json(400, {"error": str(error)})
        except OSError:
            self.send_json(500, {"error": "Salvataggio non riuscito. Controlla spazio e permessi della cartella."})

    def import_items(self, payload):
        platform, items = payload.get("platform"), payload.get("items")
        if not isinstance(platform, str) or platform not in PLATFORMS or not isinstance(items, list) or len(items) > 500:
            raise ValueError("Importazione non valida: massimo 500 annunci")
        clean = {}
        for item in items:
            if not isinstance(item, dict):
                raise ValueError("Annuncio non valido")
            title = item.get("title")
            if not isinstance(title, str) or not title.strip():
                continue
            url = canonical_url(item.get("url", ""), platform)
            price = item.get("price")
            if not isinstance(price, (str, int, float)) or isinstance(price, bool):
                continue
            image = str(item.get("image", ""))[:4096]
            if urlparse(image).scheme != "https":
                image = ""
            clean[url] = {"platform": platform, "title": title.strip()[:500], "price": str(price)[:100],
                          "details": str(item.get("details", ""))[:6000], "url": url, "image": image}
        with browser_items_lock:
            existing = {item["url"]: item for item in read_list(IMPORTS_FILE)}
            imported = updated = 0
            update_time = max(time.time_ns() // 1_000_000, max((item.get("updatedAt", 0) for item in existing.values()), default=0) + 1)
            for url, item in clean.items():
                old = existing.get(url)
                if old and all(old.get(key) == value for key, value in item.items()):
                    continue
                imported += int(old is None)
                updated += int(old is not None)
                item["updatedAt"] = update_time
                existing.pop(url, None)
                existing[url] = item
            if imported or updated:
                atomic_write(IMPORTS_FILE, list(existing.values())[-5000:])
        self.send_json(200, {"imported": imported, "updated": updated, "received": len(items)})

    def fetch_marketplace(self, target):
        try:
            parsed = validate_url(target)
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
            return
        if not fetch_slots.acquire(blocking=False):
            self.send_json(429, {"error": "Troppe letture in corso. Riprova tra poco."})
            return
        try:
            request = Request(target, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml", "Accept-Language": "it-IT,it;q=0.9",
                "Accept-Encoding": "identity", "Referer": f"https://{parsed.hostname}/"})
            with build_opener(SafeRedirect()).open(request, timeout=20) as response:
                if response.headers.get_content_type() not in {"text/html", "application/xhtml+xml"}:
                    raise ValueError("Il marketplace non ha restituito una pagina HTML")
                body = response.read(MAX_HTML + 1)
                if len(body) > MAX_HTML:
                    raise ValueError("Pagina troppo grande")
                html = body.decode(response.headers.get_content_charset() or "utf-8", errors="replace")
            self.send_json(200, {"html": html, "hasNext": has_next_page(html, target)})
        except HTTPError as error:
            self.send_json(502, {"error": f"Il marketplace risponde HTTP {error.code}. Apri la ricerca nel browser e usa l’estensione."})
            error.close()
        except (URLError, TimeoutError, OSError, ValueError) as error:
            self.send_json(502, {"error": f"Lettura non riuscita: {error}"})
        finally:
            fetch_slots.release()

    def send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_cors_headers()
        try:
            self.end_headers()
            self.wfile.write(body)
        except ConnectionError:
            pass

    def send_cors_headers(self):
        origin = self.headers.get("Origin")
        if origin and self.allowed_request():
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def serve_file(self, path):
        relative = "radar usato 3 market.html" if path in ("/", "") else unquote(path.lstrip("/"))
        if relative not in STATIC_FILES:
            self.send_error(404)
            return
        body = (ROOT / relative).read_bytes()
        self.send_response(200)
        mime = mimetypes.guess_type(relative)[0] or "application/octet-stream"
        self.send_header("Content-Type", mime + "; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        try:
            self.end_headers()
            self.wfile.write(body)
        except ConnectionError:
            pass


class RadarServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, handler=Handler, auto_stop=False, data_root=ROOT):
        super().__init__(address, handler)
        self.session_id = secrets.token_urlsafe(18)
        self.lifetime = DashboardLifetime(auto_stop)
        self.discord = DiscordService(data_root, atomic_write, canonical_url)

    def service_actions(self):
        if self.lifetime.should_stop():
            # shutdown() must run outside the serve_forever thread.
            self.lifetime.auto_stop = False
            threading.Thread(target=self.shutdown, daemon=True).start()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument('--auto-stop', action='store_true', help='Arresta il server quando vengono chiuse tutte le dashboard')
    args = parser.parse_args()
    print(f"LootSniper locale: http://127.0.0.1:{args.port}")
    try:
        with RadarServer(("127.0.0.1", args.port), auto_stop=args.auto_stop) as httpd:
            reset_session_data()
            httpd.discord.start()
            try:
                httpd.serve_forever()
            finally:
                httpd.discord.close()
    except KeyboardInterrupt:
        print("LootSniper arrestato.")
    except OSError as error:
        print(f"Impossibile avviare il server: {error}")
        raise SystemExit(1)

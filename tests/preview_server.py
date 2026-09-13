"""Isolated UI test server: synthetic listings, no marketplace requests or user data."""
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

FIXTURES = [
    {"platform": "EBAY", "title": "Laptop RTX 4070 · esempio di test", "price": "900,00 EUR",
     "details": "32 GB RAM 1 TB SSD", "url": "https://www.ebay.it/itm/123456789", "image": "", "updatedAt": 1789152000000},
    {"platform": "VINTED", "title": "Notebook RTX 4060 · esempio di test", "price": "550 EUR",
     "details": "16 GB RAM 512 GB SSD", "url": "https://www.vinted.it/items/987654321", "image": "", "updatedAt": 1789152000000},
    {"platform": "SUBITO", "title": "NAS Synology DS224+ · esempio generico", "price": "280,00 €",
     "details": "NAS 2 vani senza dischi", "url": "https://www.subito.it/informatica/nas-123456.htm", "image": "", "updatedAt": 1789152000000}
]
class PreviewHandler(server.Handler):
    def serve_file(self, path):
        if path == '/tests/listings.html':
            body = (Path(__file__).parent / 'listings.html').read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().serve_file(path)

    def fetch_marketplace(self, target):
        time.sleep(1)
        platform = "VINTED" if "vinted" in target else "EBAY" if "ebay" in target else "SUBITO"
        if platform == "VINTED":
            self.send_json(502, {"error": "Errore simulato del marketplace per verificare il recupero."})
            return
        item = FIXTURES[0]
        html = '<article class="s-item"><a href="' + item["url"] + '"><h3>Laptop RTX 4070 · pagina simulata</h3></a><span class="s-item__price">890,00 EUR</span><p>32 GB RAM 1 TB SSD</p></article>'
        self.send_json(200, {"html": html, "hasNext": True})

if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="radar-ui-") as directory:
        server.SEARCHES_FILE = Path(directory) / "searches.json"
        server.IMPORTS_FILE = Path(directory) / "imports.json"
        server.atomic_write(server.IMPORTS_FILE, [{**item, "updatedAt": int(time.time() * 1000)} for item in FIXTURES])
        server.atomic_write(server.SEARCHES_FILE, [{"name": "Esempio isolato", "ebay": "https://www.ebay.it/sch/i.html?_nkw=laptop", "vinted": "", "subito": ""}])
        print("Test UI isolato: http://127.0.0.1:8766", flush=True)
        server.RadarServer(("127.0.0.1", 8766), PreviewHandler, data_root=directory).serve_forever()

"""Opt-in Discord notifications; private durable queue, no third-party packages."""
import json
import math
import re
import threading
import time
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError, URLError


def webhook_url(value):
    if not isinstance(value, str):
        raise ValueError('Webhook Discord non valido')
    value = value.strip()
    parsed = urlparse(value)
    if (parsed.scheme != 'https' or parsed.netloc != 'discord.com' or parsed.query or parsed.fragment
            or not re.fullmatch(r'/api/webhooks/\d{5,25}/[A-Za-z0-9_-]{20,200}', parsed.path)):
        raise ValueError('Incolla il webhook HTTPS discord.com di un canale testuale')
    return value


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class DiscordService:
    def __init__(self, root, atomic_write, canonical_url):
        self.path = Path(root) / 'radar-discord.json'
        self.write = atomic_write
        self.canonical = canonical_url
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.thread = None
        self.busy = False
        self.state = {'enabled': False, 'url': '', 'minMargin': 0, 'sent': [], 'pending': [], 'message': 'Notifiche disattivate'}
        self.load_error = False
        if self.path.exists():
            try:
                data = json.loads(self.path.read_text(encoding='utf-8-sig'))
                if not isinstance(data, dict) or not isinstance(data.get('pending'), list) or not isinstance(data.get('sent'), list):
                    raise ValueError()
                if not isinstance(data.get('enabled'), bool) or len(data['pending']) > 200 or not all(isinstance(value, str) for value in data['sent']):
                    raise ValueError()
                for row in data['pending']:
                    if (not isinstance(row, dict) or not isinstance(row.get('key'), str) or not isinstance(row.get('body'), dict)
                            or not isinstance(row.get('attempts'), int) or not isinstance(row.get('after'), (int, float))):
                        raise ValueError()
                if data.get('url'):
                    webhook_url(data['url'])
                self.state.update(data)
            except (ValueError, OSError, TypeError):
                self.load_error = True
                self.state['message'] = 'Configurazione Discord danneggiata: file conservato, notifiche disattivate'

    def save(self):
        if self.load_error:
            raise ValueError('Ripristina una copia valida di radar-discord.json prima di salvare')
        self.write(self.path, self.state)

    def status(self):
        with self.lock:
            return {'enabled': bool(self.state['enabled']), 'configured': bool(self.state['url']),
                    'minMargin': self.state['minMargin'], 'pending': len(self.state['pending']),
                    'message': self.state['message']}

    def configure(self, payload):
        with self.lock:
            if self.load_error:
                raise ValueError('Ripristina una copia valida di radar-discord.json prima di salvare')
            enabled = payload.get('enabled', False)
            margin = payload.get('minMargin', 0)
            if not isinstance(enabled, bool) or isinstance(margin, bool) or not isinstance(margin, (int, float)) or not math.isfinite(margin) or not 0 <= margin <= 100000:
                raise ValueError('Impostazioni Discord non valide')
            url = self.state['url']
            if payload.get('clear') is True:
                url, enabled = '', False
            elif payload.get('url'):
                url = webhook_url(payload['url'])
            if enabled and not url:
                raise ValueError('Inserisci un webhook prima di attivare le notifiche')
            if not enabled or url != self.state['url']:
                self.state['pending'] = []
            self.state.update(enabled=enabled, url=url, minMargin=margin,
                              message='Notifiche attive per le nuove bombe' if enabled else 'Notifiche disattivate')
            self.save()
            return self.status()

    def enqueue(self, item=None, test=False):
        with self.lock:
            if self.load_error:
                return {'queued': False}
            if not self.state['url'] or (not test and not self.state['enabled']):
                return {'queued': False}
            if len(self.state['pending']) >= 200:
                raise ValueError('Coda Discord piena; attendi gli invii in corso')
            if test:
                key = 'test-' + str(time.time_ns())
                body = {'content': '✅ LootSniper collegato. Le nuove bombe compariranno in questo canale.', 'allowed_mentions': {'parse': []}}
            else:
                if not isinstance(item, dict) or item.get('platform') not in {'EBAY', 'VINTED', 'SUBITO'}:
                    raise ValueError('Annuncio Discord non valido')
                key = self.canonical(item.get('url'), item['platform'])
                if not isinstance(item.get('title'), str) or not item['title'].strip():
                    raise ValueError('Titolo annuncio non valido')
                price, estimate = item.get('price'), item.get('estimate')
                if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not 0 < v <= 100000 for v in (price, estimate)):
                    raise ValueError('Prezzi annuncio non validi')
                if item.get('isDeal') is not True or price > estimate * .92 or estimate - price < self.state['minMargin']:
                    return {'queued': False}
                score, confidence = item.get('score', 0), item.get('confidence', 0)
                if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 100 for value in (score, confidence)):
                    raise ValueError('Classificazione annuncio non valida')
                condition = item.get('condition', 'Da verificare')
                if not isinstance(condition, str):
                    raise ValueError('Condizioni annuncio non valide')
                if key in self.state['sent'] or any(row['key'] == key for row in self.state['pending']):
                    return {'queued': False, 'duplicate': True}
                euro = lambda value: f'{value:.2f} €'
                body = {'username': 'LootSniper', 'allowed_mentions': {'parse': []}, 'embeds': [{
                    'title': '💣 ' + item['title'][:240], 'url': key, 'color': 4449478,
                    'fields': [{'name': 'Prezzo', 'value': euro(price), 'inline': True},
                               {'name': 'Stima indicativa', 'value': euro(estimate), 'inline': True},
                               {'name': 'Differenza stimata', 'value': euro(estimate-price), 'inline': True},
                               {'name': 'Punteggio bomba', 'value': f'{score:.0f}/100', 'inline': True},
                               {'name': 'Affidabilità dati', 'value': f'{confidence:.0f}/100', 'inline': True},
                               {'name': 'Condizioni dichiarate', 'value': condition[:120], 'inline': True},
                               {'name': 'Marketplace', 'value': item['platform']}],
                    'footer': {'text': 'Verifica venditore, condizioni, spedizione e commissioni. La stima non è una quotazione aggiornata.'}}]}
            self.state['pending'].append({'key': key, 'body': body, 'attempts': 0, 'after': 0})
            self.state['message'] = 'Notifica in coda'
            self.save()
            return {'queued': True}

    def deliver_one(self):
        with self.lock:
            if not self.state['pending'] or not self.state['url'] or self.busy:
                return
            row = self.state['pending'][0]
            if row['after'] > time.time():
                return
            url = self.state['url']
            self.busy = True
        sent, retry, message = False, None, 'Invio Discord non riuscito'
        try:
            request = Request(webhook_url(url) + '?wait=true', data=json.dumps(row['body']).encode('utf-8'),
                              headers={'Content-Type': 'application/json', 'User-Agent': 'LootSniper/5.0'}, method='POST')
            with build_opener(NoRedirect()).open(request, timeout=8) as response:
                response.read(65536)
                sent = 200 <= response.status < 300
            message = 'Ultima notifica inviata a Discord'
        except HTTPError as error:
            if error.code == 429:
                try:
                    data = json.loads(error.read(4096))
                    if not isinstance(data, dict):
                        raise ValueError()
                    retry = max(1, float(data.get('retry_after', 60)))
                    if not math.isfinite(retry):
                        retry = 60
                except (ValueError, TypeError):
                    retry = 60
                message = 'Limite Discord raggiunto; invio rinviato automaticamente'
            else:
                message = f'Discord risponde HTTP {error.code}; controlla il webhook'
                if error.code >= 500 and row['attempts'] < 2:
                    retry = 30 * (row['attempts'] + 1)
            error.close()
        except (URLError, OSError, ValueError):
            message = 'Discord non raggiungibile; controlla la connessione'
            if row['attempts'] < 2:
                retry = 30 * (row['attempts'] + 1)
        finally:
            with self.lock:
                self.busy = False
                if row in self.state['pending']:
                    if sent:
                        self.state['sent'] = (self.state['sent'] + [row['key']])[-10000:]
                    if retry is not None and not sent:
                        row['after'], row['attempts'] = time.time() + retry, row['attempts'] + 1
                    else:
                        self.state['pending'].remove(row)
                    self.state['message'] = message
                    self.save()

    def start(self):
        def work():
            while not self.stop_event.wait(1):
                try:
                    self.deliver_one()
                except (OSError, ValueError, KeyError, TypeError):
                    with self.lock:
                        self.state['message'] = 'Coda Discord non disponibile; controlla il file locale e i permessi'
        self.thread = threading.Thread(target=work, daemon=True)
        self.thread.start()

    def close(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=9)

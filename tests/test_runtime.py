import http.client
import io
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.error import HTTPError
import server
import radar_discord
from radar_lifecycle import DashboardLifetime

WEBHOOK = 'https://discord.com/api/webhooks/123456789012345678/' + 'a' * 60
ITEM = {'platform': 'EBAY', 'url': 'https://ebay.it/itm/12345?tracking=x', 'title': 'Laptop RTX 4070 @everyone',
        'price': 800, 'estimate': 1250, 'isDeal': True, 'score': 82, 'confidence': 90, 'condition': 'Usato'}

class DiscordTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.service = radar_discord.DiscordService(self.directory.name, server.atomic_write, server.canonical_url)

    def enable(self):
        return self.service.configure({'url': WEBHOOK, 'enabled': True, 'minMargin': 100})

    def test_webhook_stays_private_and_is_disabled_by_default(self):
        self.assertFalse(self.service.enqueue(ITEM)['queued'])
        data = self.enable()
        self.assertNotIn(WEBHOOK, json.dumps(data))
        self.assertNotIn('url', data)
        self.assertIn(WEBHOOK, self.service.path.read_text())
        for url in [WEBHOOK.replace('discord.com', 'evil.example'), WEBHOOK+'?x=1', 'http://discord.com/api/webhooks/12345/'+'a'*60]:
            with self.assertRaises(ValueError):
                self.service.configure({'url': url, 'enabled': True})

    def test_threshold_and_dedup_survive_restart_and_mentions_are_disabled(self):
        self.enable()
        self.assertFalse(self.service.enqueue({**ITEM, 'price': 1200})['queued'])
        self.assertTrue(self.service.enqueue(ITEM)['queued'])
        self.assertFalse(self.service.enqueue(ITEM)['queued'])
        response = Mock(status=200)
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        with patch.object(radar_discord, 'build_opener') as opener:
            opener.return_value.open.return_value = response
            self.service.deliver_one()
            request = opener.return_value.open.call_args.args[0]
            self.assertTrue(request.full_url.endswith('?wait=true'))
            self.assertEqual(json.loads(request.data)['allowed_mentions'], {'parse': []})
        restarted = radar_discord.DiscordService(self.directory.name, server.atomic_write, server.canonical_url)
        self.assertFalse(restarted.enqueue(ITEM)['queued'])

    def test_rate_limit_keeps_queue_and_does_not_repeat_until_retry_after(self):
        self.enable()
        self.service.enqueue(ITEM)
        error = HTTPError(WEBHOOK, 429, 'Limited', {}, io.BytesIO(b'{"retry_after":120}'))
        with patch.object(radar_discord, 'build_opener') as opener:
            opener.return_value.open.side_effect = error
            self.service.deliver_one()
            self.service.deliver_one()
            self.assertEqual(opener.return_value.open.call_count, 1)
        self.assertEqual(self.service.status()['pending'], 1)
        self.assertNotIn(WEBHOOK, self.service.status()['message'])

    def test_disable_removes_pending_and_corrupt_file_is_preserved(self):
        self.enable()
        self.service.enqueue(ITEM)
        self.service.configure({'enabled': False})
        self.assertEqual(self.service.status()['pending'], 0)
        self.service.path.write_text('{broken')
        broken = radar_discord.DiscordService(self.directory.name, server.atomic_write, server.canonical_url)
        with self.assertRaises(ValueError):
            broken.configure({'url': WEBHOOK, 'enabled': True})
        self.assertFalse(broken.enqueue(ITEM)['queued'])
        self.assertEqual(self.service.path.read_text(), '{broken')

class LifetimeTests(unittest.TestCase):
    def test_reload_and_multiple_tabs_do_not_stop_server(self):
        now = [0]
        life = DashboardLifetime(True, clock=lambda: now[0])
        life.update('client-one')
        life.update('client-two')
        life.update('client-one', closing=True)
        now[0] = 46
        self.assertFalse(life.should_stop())
        life.update('client-two', closing=True)
        now[0] = 60
        life.update('client-one')
        self.assertFalse(life.should_stop())
        life.update('client-one', closing=True)
        now[0] = 106
        self.assertTrue(life.should_stop())

    def test_crashed_browser_and_failed_initial_open_expire(self):
        now = [0]
        life = DashboardLifetime(True, clock=lambda: now[0])
        now[0] = 121
        self.assertTrue(life.should_stop())
        life.update('client-one')
        now[0] = 302
        self.assertTrue(life.should_stop())
        self.assertFalse(DashboardLifetime(False, clock=lambda: now[0]).should_stop())

class RuntimeApiTests(unittest.TestCase):
    def test_sensitive_settings_reject_foreign_origins_and_shutdown_stops_server(self):
        with tempfile.TemporaryDirectory() as directory:
            httpd = server.RadarServer(('127.0.0.1', 0), auto_stop=True, data_root=directory)
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            try:
                port = httpd.server_address[1]
                def request(path, data, origin=None):
                    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=2)
                    headers = {'Content-Type': 'application/json'}
                    if origin:
                        headers['Origin'] = origin
                    connection.request('POST', path, json.dumps(data), headers)
                    response = connection.getresponse()
                    body = response.read()
                    connection.close()
                    return response.status, json.loads(body)
                for origin in ['null', 'chrome-extension://abc', 'https://evil.example']:
                    self.assertEqual(request('/api/discord', {'url': WEBHOOK, 'enabled': True}, origin)[0], 403)
                self.assertFalse((Path(directory)/'radar-discord.json').exists())
                self.assertEqual(request('/api/heartbeat', {'client':'test-client'})[1]['autoStop'], True)
                self.assertEqual(request('/api/shutdown', {})[0], 200)
                thread.join(timeout=2)
                self.assertFalse(thread.is_alive())
            finally:
                httpd.shutdown()
                httpd.server_close()

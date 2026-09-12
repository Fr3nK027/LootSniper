import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError
import launcher
import server


class LauncherTests(unittest.TestCase):
    def test_existing_server_is_reused_only_for_same_project(self):
        for status, expected in [
            ({"online": True, "version": server.VERSION, "workspace": launcher.WORKSPACE_ID}, 0),
            ({"online": True, "version": server.VERSION, "workspace": "another-project"}, 1),
            ({"online": True}, 1),
            ({"conflict": True}, 1),
        ]:
            with patch.object(launcher, "server_status", return_value=status), \
                    patch.object(launcher.webbrowser, "open") as browser, \
                    patch.object(launcher.subprocess, "Popen") as process:
                self.assertEqual(launcher.main(), expected)
                self.assertEqual(browser.call_count, int(expected == 0))
                process.assert_not_called()

    def test_browser_opens_only_after_new_server_is_ready(self):
        with tempfile.TemporaryDirectory() as directory:
            process = Mock()
            process.poll.side_effect = [None, None, 0]
            process.returncode = 0
            ready = {"online": True, "version": server.VERSION, "workspace": launcher.WORKSPACE_ID}
            with patch.object(launcher, "ROOT", Path(directory)), \
                    patch.object(launcher, "server_status", side_effect=[None, None, ready]), \
                    patch.object(launcher.time, "sleep"), \
                    patch.object(launcher.webbrowser, "open") as browser, \
                    patch.object(launcher.subprocess, "Popen", return_value=process):
                self.assertEqual(launcher.main(), 0)
                browser.assert_called_once_with(launcher.URL)
                process.wait.assert_called_once()
                process.terminate.assert_not_called()

    def test_non_radar_http_server_is_reported_as_port_conflict(self):
        with patch.object(launcher, "urlopen", side_effect=HTTPError(launcher.URL, 404, "", {}, None)):
            self.assertEqual(launcher.server_status(), {"conflict": True})
        with patch.object(launcher, "urlopen", side_effect=URLError("connection refused")):
            self.assertIsNone(launcher.server_status())

    def test_background_launcher_exits_without_terminating_its_server(self):
        with tempfile.TemporaryDirectory() as directory:
            process = Mock()
            process.poll.return_value = None
            ready = {'online': True, 'version': server.VERSION, 'workspace': launcher.WORKSPACE_ID}
            with patch.object(launcher, 'ROOT', Path(directory)), \
                    patch.object(launcher, 'server_status', side_effect=[None, ready]), \
                    patch.object(launcher.webbrowser, 'open'), \
                    patch.object(launcher.subprocess, 'Popen', return_value=process) as spawn:
                self.assertEqual(launcher.main(background=True), 0)
                self.assertIn('--auto-stop', spawn.call_args.args[0])
                process.wait.assert_not_called()
                process.terminate.assert_not_called()


class WindowsIoTests(unittest.TestCase):
    def test_client_aborting_during_headers_or_body_is_not_a_server_error(self):
        for in_headers in (True, False):
            handler = server.Handler.__new__(server.Handler)
            handler.send_response = Mock()
            handler.send_header = Mock()
            handler.send_cors_headers = Mock()
            handler.end_headers = Mock(side_effect=ConnectionAbortedError if in_headers else None)
            handler.wfile = Mock()
            if not in_headers:
                handler.wfile.write.side_effect = ConnectionAbortedError
            handler.send_json(200, {"ok": True})

    def test_utf8_bom_archive_is_readable(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "searches.json"
            path.write_text('[{"name":"Prova"}]', encoding="utf-8-sig")
            self.assertEqual(server.read_list(path)[0]["name"], "Prova")

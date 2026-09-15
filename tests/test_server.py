import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
import server


class RadarApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.searches = Path(self.temp.name) / "searches.json"
        self.imports = Path(self.temp.name) / "imports.json"
        self.patches = [patch.object(server, "SEARCHES_FILE", self.searches),
                        patch.object(server, "IMPORTS_FILE", self.imports)]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in self.patches:
            item.stop()
        self.temp.cleanup()

    def request(self, path, body=None, headers=None, method=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        default_headers = {"Content-Type": "application/json"}
        default_headers.update(headers or {})
        connection.request(method or ("POST" if body is not None else "GET"), path,
                           json.dumps(body) if body is not None else None, default_headers)
        response = connection.getresponse()
        data = response.read()
        status, response_headers = response.status, dict(response.getheaders())
        connection.close()
        try:
            data = json.loads(data)
        except ValueError:
            pass
        return status, data, response_headers

    def sample_search(self):
        return {"name": "Laptop", "ebay": "https://www.ebay.it/sch/i.html?_nkw=laptop"}

    def sample_import(self):
        return {"platform": "EBAY", "items": [{"title": "Laptop RTX 4070", "price": "900 EUR",
                "url": "https://www.ebay.it/itm/laptop/123456789?tracking=1", "details": "32 GB RAM"}]}

    def test_status_and_static_allowlist(self):
        code, status, _ = self.request("/api/status")
        self.assertEqual(code, 200)
        self.assertTrue(status["session"])
        self.assertEqual(self.request("/")[0], 200)
        self.assertEqual(self.request("/radar-core.js")[0], 200)
        for path in ("/server.py", "/radar-searches.json", "/.backups/baseline/app.js", "/%2e%2e/server.py"):
            self.assertEqual(self.request(path)[0], 404)

    def test_radar_server_allows_only_one_process_on_its_port(self):
        first = server.RadarServer(("127.0.0.1", 0), data_root=Path(self.temp.name))
        try:
            with self.assertRaises(OSError):
                server.RadarServer(("127.0.0.1", first.server_address[1]), data_root=Path(self.temp.name))
        finally:
            first.server_close()

    def test_save_requires_current_revision(self):
        _, initial, _ = self.request("/api/searches")
        payload = {"searches": [self.sample_search()], "revision": initial["revision"]}
        code, saved, _ = self.request("/api/searches", payload)
        self.assertEqual(code, 200)
        self.assertNotEqual(saved["revision"], initial["revision"])
        self.assertEqual(self.request("/api/searches", {"searches": [], "revision": initial["revision"]})[0], 409)
        self.assertEqual(len(json.loads(self.searches.read_text())), 1)
        self.assertFalse(self.searches.with_suffix(".json.tmp").exists())

    def test_invalid_searches_never_overwrite(self):
        for value in (None, {}, ["bad"], [{"name": ""}], [{"name": "bad", "ebay": "https://evil.example"}]):
            self.assertEqual(self.request("/api/searches", {"searches": value, "revision": server.revision([])})[0], 400)
        self.assertFalse(self.searches.exists())

    def test_search_profiles_preserve_general_electronics_filters(self):
        search = {"name": "NAS economici", "query": "NAS Synology 4 bay", "ebay": "https://www.ebay.it/sch/i.html?_nkw=nas",
                  "vinted": "", "subito": "", "customPlatforms": ["EBAY"], "minPrice": 150, "maxPrice": 450,
                  "minMargin": None, "platformFilter": "EBAY", "categoryFilter": "nas", "sortOrder": "price-asc",
                  "resultQuery": "4 bay", "deepScan": False, "withPhotoOnly": True, "linkMode": "manual",
                  "resultScope": "all", "featureFilters": {"storage1tb": "include", "repair": "exclude"},
                  "primaryIntent": "nas", "guidedFilters": {"usage": ["nas"], "storageType": ["hdd", "unknown"]}}
        clean = server.clean_searches([search])[0]
        self.assertEqual(clean["query"], "NAS Synology 4 bay")
        self.assertEqual(clean["customPlatforms"], ["EBAY"])
        self.assertEqual(clean["linkMode"], "manual")
        self.assertEqual(clean["minPrice"], 150)
        self.assertEqual(clean["maxPrice"], 450)
        self.assertEqual(clean["categoryFilter"], "nas")
        self.assertEqual(clean["sortOrder"], "price-asc")
        self.assertTrue(clean["withPhotoOnly"])
        self.assertEqual(clean["resultScope"], "all")
        self.assertEqual(clean["featureFilters"], {"storage1tb": "include", "repair": "exclude"})
        self.assertEqual(clean["primaryIntent"], "nas")
        self.assertEqual(clean["guidedFilters"], {"usage": ["nas"], "storageType": ["hdd", "unknown"]})
        self.assertFalse(clean["deepScan"])
        for invalid in ({**search, "minPrice": -1}, {**search, "maxPrice": float("nan")}, {**search, "deepScan": "false"},
                        {**search, "withPhotoOnly": "true"}, {**search, "categoryFilter": "televisori"},
                        {**search, "customPlatforms": ["UNKNOWN"]}, {**search, "linkMode": "mixed"},
                        {**search, "resultScope": "maybe"}, {**search, "featureFilters": {"unknown": "include"}},
                        {**search, "featureFilters": {"ram": "maybe"}}, {**search, "primaryIntent": "televisori"},
                        {**search, "guidedFilters": {"gpuSeries": ["rtx60"]}},
                        {**search, "guidedFilters": {"ramAmount": "32"}}):
            with self.assertRaises(ValueError):
                server.clean_searches([invalid])

    def test_import_deduplicates_batch_and_updates_prices(self):
        payload = self.sample_import()
        payload["items"].append({**payload["items"][0], "url": "https://ebay.it/itm/123456789?another=2"})
        code, result, _ = self.request("/api/import", payload)
        self.assertEqual(code, 200)
        self.assertEqual(result["imported"], 1)
        self.assertEqual(self.request("/api/import", payload)[1]["imported"], 0)
        payload["items"] = [{**payload["items"][0], "price": "850 EUR"}]
        self.assertEqual(self.request("/api/import", payload)[1]["updated"], 1)
        _, saved, _ = self.request("/api/import/latest")
        self.assertEqual(len(saved["items"]), 1)
        self.assertEqual(saved["items"][0]["price"], "850 EUR")
        self.assertEqual(saved["items"][0]["url"], "https://www.ebay.it/itm/123456789")
        self.assertTrue(self.imports.exists())

    def test_invalid_imports(self):
        for payload in ([], {"platform": [], "items": []}, {"platform": "EBAY", "items": ["bad"]}):
            self.assertEqual(self.request("/api/import", payload)[0], 400)
        payload = self.sample_import()
        payload["items"][0]["url"] = "javascript:alert(1)"
        self.assertEqual(self.request("/api/import", payload)[0], 400)
        self.assertFalse(self.imports.exists())

    def test_incremental_import_cursor(self):
        payload = self.sample_import()
        self.request('/api/import', payload)
        initial = self.request('/api/import/latest')[1]
        cursor = initial['cursor']
        self.assertEqual(self.request('/api/import/latest?after=' + str(cursor))[1]['items'], [])
        payload['items'][0]['price'] = '800 EUR'
        with patch.object(server.time, 'time_ns', return_value=cursor * 1_000_000):
            self.request('/api/import', payload)
        changed = self.request('/api/import/latest?after=' + str(cursor))[1]
        self.assertEqual(len(changed['items']), 1)
        self.assertGreater(changed['cursor'], cursor)
        self.assertEqual(self.request('/api/import/latest?after=broken')[0], 400)

    def test_origin_and_host_validation(self):
        code, _, headers = self.request("/api/searches", headers={"Origin": "https://evil.example"})
        self.assertEqual(code, 403)
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertEqual(self.request("/api/status", headers={"Host": "evil.example"})[0], 403)
        code, _, headers = self.request("/api/status", headers={"Origin": "chrome-extension://abc"})
        self.assertEqual(code, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "chrome-extension://abc")

    def test_corrupt_archive_preserved(self):
        self.searches.write_text("{broken")
        self.assertEqual(self.request("/api/searches")[0], 500)
        self.assertEqual(self.request("/api/searches", {"searches": [], "revision": server.revision([])})[0], 400)
        self.assertEqual(self.searches.read_text(), "{broken")

    def test_request_size_and_content_type(self):
        self.assertEqual(self.request("/api/import", {}, headers={"Content-Type": "text/plain"})[0], 400)
        self.assertEqual(self.request("/api/import", {}, headers={"Content-Length": str(server.MAX_BODY + 1)})[0], 400)

    def test_fetch_rejects_untrusted_target_without_network(self):
        for url in ("https://evil.example", "http://www.ebay.it", "https://www.ebay.it:444/x", "https://user@ebay.it"):
            self.assertEqual(self.request("/api/fetch?url=" + url)[0], 400)


class UtilityTests(unittest.TestCase):
    def test_new_run_resets_searches_and_imports(self):
        with tempfile.TemporaryDirectory() as directory:
            searches = Path(directory) / "searches.json"
            imports = Path(directory) / "imports.json"
            searches.write_text('[{"name":"old"}]', encoding="utf-8")
            imports.write_text('[{"title":"old"}]', encoding="utf-8")
            with patch.object(server, "SEARCHES_FILE", searches), patch.object(server, "IMPORTS_FILE", imports):
                server.reset_session_data()
            self.assertEqual(json.loads(searches.read_text(encoding="utf-8")), [])
            self.assertEqual(json.loads(imports.read_text(encoding="utf-8")), [])

    def test_pagination(self):
        self.assertTrue(server.has_next_page('<a href="?q=laptop&amp;page=4">', "https://vinted.it/catalog?page=3"))
        self.assertTrue(server.has_next_page('?page=2 ', "https://vinted.it/catalog?page=broken"))
        self.assertFalse(server.has_next_page('?page=20"', "https://vinted.it/catalog"))
        self.assertTrue(server.has_next_page('?_pgn=2"', "https://www.ebay.it/sch/i.html"))

    def test_redirect_validation(self):
        redirect = server.SafeRedirect()
        with self.assertRaises(ValueError):
            redirect.redirect_request(None, None, 302, "", {}, "http://127.0.0.1/private")

    def test_platform_url_validation(self):
        filtered = ("https://www.ebay.com/sch/i.html?_dcat=177&_fsrp=1&_nkw=gaming+laptop"
                    "&RAM%2520Size=64%2520GB%7C32%2520GB&_udlo=1300&_udhi=2000")
        self.assertEqual(server.validate_url(filtered, "EBAY").hostname, "www.ebay.com")
        with self.assertRaises(ValueError):
            server.validate_url("https://vinted.it/catalog", "EBAY")
        with self.assertRaises(ValueError):
            server.validate_url("https://fake-ebay.com/sch/i.html", "EBAY")


if __name__ == "__main__":
    unittest.main()

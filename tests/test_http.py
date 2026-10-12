from http.client import HTTPConnection
import json
from pathlib import Path
import tempfile
from threading import Thread
import unittest

from otmetki_core import InvalidInput, Store
from otmetki_core.api import LocalServer, MAX_BODY_BYTES
from otmetki_core.demo import seed_demo


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.database = Path(self.folder.name) / "demo.db"
        with Store(self.database) as store:
            seed_demo(store)
        self.server = LocalServer(("127.0.0.1", 0), self.database)
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.folder.cleanup()

    def request(self, method, path, body=None, headers=None):
        connection = HTTPConnection("127.0.0.1", self.port, timeout=5)
        raw = json.dumps(body).encode() if body is not None else None
        final_headers = {"Content-Type": "application/json", **(headers or {})} if body is not None else (headers or {})
        connection.request(method, path, body=raw, headers=final_headers)
        response = connection.getresponse()
        status, content, result_headers = response.status, response.read(), dict(response.getheaders())
        connection.close()
        return status, content, result_headers

    def test_native_http_read_edit_historical_export(self):
        status, content, _ = self.request("GET", "/api/courses?direction=management")
        self.assertEqual(status, 200)
        course = json.loads(content)["courses"][0]
        _, content, _ = self.request("GET", f"/api/courses/{course['id']}/materials")
        material = json.loads(content)["materials"][0]
        status, content, _ = self.request("PUT", f"/api/materials/{material['id']}", {"expectedVersion": 1, "title": "Updated synthetic material"})
        self.assertEqual((status, json.loads(content)["version"]), (200, 2))
        status, content, _ = self.request("PUT", f"/api/materials/{material['id']}", {"expectedVersion": 1, "title": "Stale"})
        self.assertEqual(status, 409)
        status, content, headers = self.request("POST", "/api/context.txt", {"materials": [{"id": material["id"], "version": 1}]})
        self.assertEqual(status, 200)
        self.assertIn(material["title"], content.decode())
        self.assertNotIn("Updated synthetic material", content.decode())
        self.assertEqual(headers["Content-Disposition"], 'attachment; filename="context.txt"')

    def test_loopback_origin_and_host_guard(self):
        foreign = "https://" + "foreign.invalid"
        status, _, _ = self.request("POST", "/api/subjects", {"code": "foreign", "title": "Foreign"}, {"Origin": foreign})
        self.assertEqual(status, 403)
        status, _, _ = self.request("GET", "/api/subjects", headers={"Host": "unapproved.invalid"})
        self.assertEqual(status, 403)
        status, _, _ = self.request("GET", "/api/subjects", headers={"Origin": f"http://127.0.0.1:{self.port}"})
        self.assertEqual(status, 200)

    def test_json_media_limits_and_missing_route(self):
        status, _, _ = self.request("POST", "/api/subjects", {"code": "bad", "title": "Bad"}, {"Content-Type": "text/plain"})
        self.assertEqual(status, 415)
        status, _, _ = self.request("GET", "/api/not-a-real-route")
        self.assertEqual(status, 404)
        status, _, _ = self.request("DELETE", "/api/subjects")
        self.assertEqual(status, 405)
        status, _, _ = self.request("POST", "/api/subjects", {}, {"Content-Length": str(MAX_BODY_BYTES + 1)})
        self.assertEqual(status, 413)

    def test_static_ui_csp_and_safe_content(self):
        status, content, headers = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn("Все примеры вымышлены", content.decode())
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        self.assertNotIn(str(self.database), content.decode())
        status, content, _ = self.request("GET", "/app.js")
        self.assertEqual(status, 200)
        self.assertIn("textContent", content.decode())
        self.assertNotIn("innerHTML", content.decode())

    def test_demo_cannot_bind_public_interface(self):
        public = ".".join(["0", "0", "0", "0"])
        with self.assertRaises(InvalidInput):
            LocalServer((public, 0), self.database)


if __name__ == "__main__":
    unittest.main()

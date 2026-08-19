import base64
import json
import os
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path

import server


ROOT = Path(__file__).resolve().parent


class ClassifyErrorTest(unittest.TestCase):
    def test_geo_reject_code(self) -> None:
        code, message = server.classify_error("X-Radiko-Reject-Code: 113", 1)
        self.assertEqual(code, "GEO_REJECTED")
        self.assertIn("113", message)

    def test_generic_exit(self) -> None:
        code, message = server.classify_error("boom", 2)
        self.assertEqual(code, "YTDLP_EXIT")
        self.assertIn("2", message)


class UrlValidationTest(unittest.TestCase):
    def test_timeshift_hash(self) -> None:
        self.assertTrue(server.validate_timeshift_url("https://radiko.jp/#!/ts/FMT/20251012140000"))

    def test_share_url(self) -> None:
        self.assertTrue(
            server.validate_timeshift_url("https://radiko.jp/share/?sid=FMT&t=20250528142747")
        )

    def test_rejects_other_hosts(self) -> None:
        self.assertFalse(server.validate_timeshift_url("https://example.com/#!/ts/FMT/1"))


class HttpServerTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        os.environ["RIRE_WORKDIR"] = self._tmpdir.name
        os.environ["YTDLP_CMD"] = str(ROOT / "fake_ytdlp.py")
        os.environ.pop("FAKE_YTDLP_FAIL", None)
        server.WORKDIR = self._tmpdir.name
        server.YTDLP_CMD = os.environ["YTDLP_CMD"]
        self._httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self._port = self._httpd.server_address[1]
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()

    def tearDown(self) -> None:
        self._httpd.shutdown()
        self._httpd.server_close()
        self._tmpdir.cleanup()
        os.environ.pop("FAKE_YTDLP_FAIL", None)

    def _conn(self) -> HTTPConnection:
        return HTTPConnection("127.0.0.1", self._port, timeout=5)

    def test_health(self) -> None:
        conn = self._conn()
        conn.request("GET", "/health")
        response = conn.getresponse()
        body = json.loads(response.read().decode())
        conn.close()
        self.assertEqual(response.status, 200)
        self.assertTrue(body["ok"])

    def test_record_simulate(self) -> None:
        conn = self._conn()
        payload = json.dumps(
            {
                "timeshiftUrl": "https://radiko.jp/#!/ts/FMT/20251012140000",
                "stationId": "FMT",
                "simulate": True,
            }
        )
        conn.request("POST", "/record", body=payload, headers={"content-type": "application/json"})
        response = conn.getresponse()
        raw = response.read()
        header = response.getheader("x-rire-result")
        conn.close()
        self.assertEqual(response.status, 200)
        self.assertEqual(raw, b"")
        self.assertIsNotNone(header)
        meta = json.loads(base64.b64decode(header or ""))
        self.assertTrue(meta["ok"])
        self.assertEqual(meta["extractor"], "rajiko")
        self.assertEqual(meta["sidecar"]["ytDlpId"], "fakeid")

    def test_record_writes_audio(self) -> None:
        conn = self._conn()
        payload = json.dumps(
            {
                "timeshiftUrl": "https://radiko.jp/#!/ts/FMT/20251012140000",
                "stationId": "FMT",
            }
        )
        conn.request("POST", "/record", body=payload, headers={"content-type": "application/json"})
        response = conn.getresponse()
        raw = response.read()
        conn.close()
        self.assertEqual(response.status, 200)
        self.assertEqual(raw, b"fake-aac-bytes")

    def test_geo_failure(self) -> None:
        os.environ["FAKE_YTDLP_FAIL"] = "geo"
        conn = self._conn()
        payload = json.dumps({"timeshiftUrl": "https://radiko.jp/#!/ts/FMT/20251012140000"})
        conn.request("POST", "/record", body=payload, headers={"content-type": "application/json"})
        response = conn.getresponse()
        body = json.loads(response.read().decode())
        conn.close()
        self.assertEqual(response.status, 403)
        self.assertEqual(body["errorCode"], "GEO_REJECTED")

    def test_rejects_non_radiko(self) -> None:
        conn = self._conn()
        payload = json.dumps({"timeshiftUrl": "https://example.com/audio"})
        conn.request("POST", "/record", body=payload, headers={"content-type": "application/json"})
        response = conn.getresponse()
        body = json.loads(response.read().decode())
        conn.close()
        self.assertEqual(response.status, 400)
        self.assertEqual(body["errorCode"], "BAD_REQUEST")


if __name__ == "__main__":
    unittest.main()

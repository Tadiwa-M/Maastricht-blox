import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
import requests

from blox_pipeline.sources.http import DownloadError, download, expect_magic

PAYLOAD = b"II*\x00" + bytes(range(256)) * 40


class _Handler(BaseHTTPRequestHandler):
    hits: list[str] = []

    def log_message(self, *a):  # quiet
        pass

    def do_GET(self):
        _Handler.hits.append(self.headers.get("Range", ""))
        if self.path.startswith("/xml"):
            body = b"<?xml version='1.0'?><ows:ExceptionReport/>"
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.startswith("/missing"):
            self.send_error(404)
            return
        rng = self.headers.get("Range")
        start = int(rng.split("=")[1].split("-")[0]) if rng else 0
        body = PAYLOAD[start:]
        self.send_response(206 if rng else 200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@pytest.fixture()
def server():
    _Handler.hits = []
    srv = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


@pytest.fixture()
def session():
    s = requests.Session()
    s.trust_env = False  # never route the local test server through a proxy
    return s


def test_download_is_idempotent(server, session, tmp_path):
    dest = tmp_path / "a" / "x.tif"
    download(f"{server}/x.tif", dest, session=session, validate=expect_magic(b"II*\x00"))
    assert dest.read_bytes() == PAYLOAD
    download(f"{server}/x.tif", dest, session=session)
    assert len(_Handler.hits) == 1  # second call served from cache


def test_download_resumes_part_file(server, session, tmp_path):
    dest = tmp_path / "x.tif"
    (tmp_path / "x.tif.part").write_bytes(PAYLOAD[:1000])
    download(f"{server}/x.tif", dest, session=session)
    assert _Handler.hits == ["bytes=1000-"]
    assert dest.read_bytes() == PAYLOAD
    assert not (tmp_path / "x.tif.part").exists()


def test_validator_rejects_error_documents(server, session, tmp_path):
    dest = tmp_path / "e.tif"
    with pytest.raises(DownloadError, match="ExceptionReport"):
        download(f"{server}/xml", dest, session=session, validate=expect_magic(b"II*\x00"))
    assert not dest.exists() and not (tmp_path / "e.tif.part").exists()


def test_http_errors_raise_after_retries(server, session, tmp_path, monkeypatch):
    monkeypatch.setattr("blox_pipeline.sources.http.time.sleep", lambda s: None)
    with pytest.raises(DownloadError):
        download(f"{server}/missing", tmp_path / "m", session=session, retries=2)

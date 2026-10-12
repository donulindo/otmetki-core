"""Local development HTTP adapter; deliberately not a public deployment server."""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
from pathlib import Path
import re
import sqlite3
import sys
from urllib.parse import parse_qs, urlsplit

from .context import build_context, context_txt
from .store import Conflict, InvalidInput, NotFound, Store


MAX_BODY_BYTES = 2 * 1024 * 1024


def dispatch(store: Store, method: str, path: str, query: dict, body: dict | None = None) -> tuple[int, object, str]:
    """Transport-independent contract. The embedding application supplies access checks."""
    body = {} if body is None else body
    creators = {"/api/subjects": store.create_subject, "/api/courses": store.create_course, "/api/topics": store.create_topic,
                "/api/materials": store.create_material, "/api/assignments": store.create_assignment, "/api/point-rules": store.create_point_rule}
    if method == "POST" and path in creators:
        return 201, creators[path](body), "application/json"
    if method == "GET" and path == "/api/subjects":
        return 200, {"subjects": store.list_subjects()}, "application/json"
    if method == "GET" and path == "/api/courses":
        return 200, {"courses": store.list_courses(query.get("direction", [None])[0], query.get("cohort", [None])[0])}, "application/json"
    route = re.fullmatch(r"/api/courses/([a-z0-9]+)/(?P<collection>topics|materials|assignments|point-rules)", path)
    if method == "GET" and route:
        collection = route["collection"]
        functions = {"topics": store.list_topics, "materials": store.list_materials, "assignments": store.list_assignments, "point-rules": store.list_point_rules}
        return 200, {collection: functions[collection](route[1])}, "application/json"
    route = re.fullmatch(r"/api/materials/([a-z0-9]+)", path)
    if route:
        if method == "GET":
            raw_version = query.get("version", [None])[0]
            try:
                version = int(raw_version) if raw_version is not None else None
            except (ValueError, TypeError):
                raise InvalidInput("Invalid version.") from None
            return 200, store.material(route[1], version), "application/json"
        if method == "PUT":
            return 200, store.update_material(route[1], body), "application/json"
    if method == "POST" and path in {"/api/context", "/api/context.txt"}:
        if not isinstance(body, dict) or set(body) != {"materials"}:
            raise InvalidInput("Expected a materials selection.")
        materials = store.context_materials(body["materials"])
        if path.endswith(".txt"):
            return 200, context_txt(materials), "text/plain"
        return 200, build_context(materials), "application/json"
    raise NotFound("Route not found.")


class LocalServer(ThreadingHTTPServer):
    def __init__(self, address: tuple[str, int], database: str | Path) -> None:
        if not ipaddress.ip_address(address[0]).is_loopback:
            raise InvalidInput("The demo server only binds to loopback.")
        self.database = str(database)
        if self.database == ":memory:":
            raise InvalidInput("The HTTP demo requires a local file database.")
        with Store(database):
            pass
        super().__init__(address, Handler)

    def handle_error(self, request: object, client_address: object) -> None:
        # The default implementation prints a traceback with local machine paths.
        print("Local demo request failed.", file=sys.stderr)


class Handler(BaseHTTPRequestHandler):
    server: LocalServer
    server_version = "OtmetkiCore"
    sys_version = ""

    def log_message(self, *_: object) -> None:
        # Local console logs contain no request body, document or query text.
        pass

    def _reply(self, code: int, payload: object, content_type: str = "application/json") -> None:
        encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode() if content_type == "application/json" else str(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", content_type + "; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'")
        if content_type == "text/plain":
            self.send_header("Content-Disposition", 'attachment; filename="context.txt"')
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(encoded)

    def _handle(self) -> None:
        port = self.server.server_address[1]
        hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        # Prevent a foreign website from treating loopback as its own origin.
        host = self.headers.get("Host", "")
        if host not in hosts:
            self._reply(403, {"error": "Invalid local host."})
            return
        origin = self.headers.get("Origin")
        if origin is not None and origin not in {"http://" + entry for entry in hosts}:
            self._reply(403, {"error": "Cross-origin requests are not allowed."})
            return
        parsed = urlsplit(self.path)
        if parsed.scheme or parsed.netloc:
            self._reply(400, {"error": "Invalid request target."})
            return
        static = {"/": ("index.html", "text/html"), "/app.css": ("app.css", "text/css"), "/app.js": ("app.js", "text/javascript")}
        if self.command == "GET" and parsed.path in static:
            filename, mime = static[parsed.path]
            self._reply(200, Path(__file__).with_name("web").joinpath(filename).read_text(encoding="utf-8"), mime)
            return
        try:
            body = None
            if self.command in {"POST", "PUT"}:
                if self.headers.get("Transfer-Encoding"):
                    self._reply(400, {"error": "Unsupported transfer encoding."})
                    return
                if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
                    self._reply(415, {"error": "Use application/json."})
                    return
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                except ValueError:
                    raise InvalidInput("Invalid content length.") from None
                if length <= 0 or length > MAX_BODY_BYTES:
                    self._reply(413, {"error": "Request body is empty or too large."})
                    return
                self.connection.settimeout(10)
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise InvalidInput("Incomplete request body.")
                try:
                    body = json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
                except (ValueError, UnicodeDecodeError):
                    raise InvalidInput("Invalid JSON.") from None
                if not isinstance(body, dict):
                    raise InvalidInput("JSON must be an object.")
            with Store(self.server.database) as store:
                code, payload, mime = dispatch(store, self.command, parsed.path, parse_qs(parsed.query), body)
            self._reply(code, payload, mime)
        except InvalidInput as error:
            self._reply(400, {"error": str(error)})
        except NotFound as error:
            self._reply(404, {"error": str(error)})
        except Conflict as error:
            self._reply(409, {"error": str(error)})
        except (sqlite3.Error, OSError):
            self._reply(500, {"error": "Local storage is unavailable."})

    do_GET = _handle
    do_POST = _handle
    do_PUT = _handle

    def _unsupported(self) -> None:
        self._reply(405, {"error": "Method not allowed."})

    do_DELETE = _unsupported
    do_PATCH = _unsupported
    do_HEAD = _unsupported
    do_OPTIONS = _unsupported

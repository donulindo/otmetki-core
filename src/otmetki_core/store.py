"""SQLite persistence for the published educational model only."""

from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
import re
import sqlite3
from typing import Any
from urllib.parse import urlsplit
from uuid import uuid4


class InvalidInput(ValueError):
    pass


class NotFound(LookupError):
    pass


class Conflict(RuntimeError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _text(value: Any, label: str, limit: int = 240, *, empty: bool = False) -> str:
    if not isinstance(value, str) or len(value) > limit or (not empty and not value.strip()):
        raise InvalidInput(f"Invalid {label}.")
    return value.strip()


def _enum(value: Any, label: str, options: tuple[str, ...]) -> str:
    if value not in options:
        raise InvalidInput(f"Invalid {label}.")
    return value


def _integer(value: Any, label: str, low: int, high: int) -> int:
    if type(value) is not int or not low <= value <= high:
        raise InvalidInput(f"Invalid {label}.")
    return value


def _points(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise InvalidInput("Invalid maxPoints.")
    return float(value)


def _date(value: Any, label: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > 64:
        raise InvalidInput(f"Invalid {label}.")
    try:
        date = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise InvalidInput(f"Invalid {label}.") from None
    if date.tzinfo is None:
        raise InvalidInput(f"{label} requires a time zone.")
    return date.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _url(value: Any) -> str | None:
    if value is None:
        return None
    url = _text(value, "externalUrl", 2000)
    try:
        parsed = urlsplit(url)
        port = parsed.port
    except ValueError:
        raise InvalidInput("Invalid externalUrl.") from None
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise InvalidInput("externalUrl must be an HTTPS link without credentials.")
    if port is not None and not 1 <= port <= 65535:
        raise InvalidInput("Invalid externalUrl.")
    return url


def _allowed(data: dict, fields: set[str]) -> None:
    if not isinstance(data, dict) or set(data) - fields:
        raise InvalidInput("Unexpected fields.")


def _blocks(raw: Any) -> list[dict]:
    if not isinstance(raw, list) or len(raw) > 1000:
        raise InvalidInput("blocks must be an array of at most 1000 items.")
    result, seen, length = [], set(), 0
    for entry in raw:
        _allowed(entry, {"id", "text", "kind", "page", "slide", "scope", "warning"})
        block_id = _text(entry.get("id", uuid4().hex), "block id", 96)
        if block_id in seen:
            raise InvalidInput("Duplicate block id.")
        seen.add(block_id)
        text = _text(entry.get("text"), "block text", 1_000_000, empty=True)
        length += len(text)
        if length > 2_000_000:
            raise InvalidInput("Material text is too large.")
        block = {"id": block_id, "text": text, "kind": _enum(entry.get("kind", "text"), "block kind", ("text", "table", "formula"))}
        for locator in ("page", "slide"):
            if entry.get(locator) is not None:
                block[locator] = _integer(entry[locator], locator, 1, 10000)
        for optional in ("scope", "warning"):
            if entry.get(optional) is not None:
                block[optional] = _text(entry[optional], optional, 2000, empty=True)
        result.append(block)
    return result


def _warnings(raw: Any) -> list[str]:
    if not isinstance(raw, list) or len(raw) > 100:
        raise InvalidInput("Invalid warnings.")
    return [_text(warning, "warning", 2000) for warning in raw]


class Store:
    """Callers authenticate and authorize before invoking this library.

    No student identities, tokens, attendance or administrative rights are
    represented here. A course identifier is an organizational key, not a grant
    of access. Every write uses bound parameters and database constraints.
    """

    def __init__(self, database: str | Path = ":memory:") -> None:
        if str(database) != ":memory:":
            Path(database).parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(str(database), timeout=10)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.execute("PRAGMA busy_timeout = 10000")
        try:
            self._migrate()
        except Exception:
            self.connection.close()
            raise

    def __enter__(self) -> Store:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def close(self) -> None:
        self.connection.close()

    def _migrate(self) -> None:
        self.connection.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)")
        self.connection.commit()
        for path in sorted(Path(__file__).with_name("migrations").glob("[0-9][0-9][0-9]_*.sql")):
            version = int(path.name[:3])
            body = path.read_text(encoding="utf-8")
            digest = hashlib.sha256(body.encode()).hexdigest()
            applied = self.connection.execute("SELECT checksum FROM schema_migrations WHERE version = ?", (version,)).fetchone()
            if applied:
                if applied["checksum"] != digest:
                    raise Conflict("An applied migration was modified.")
                continue
            # Inputs below are a numeric migration identifier and fixed-format hashes/time.
            stamp = _now()
            try:
                self.connection.executescript(f"BEGIN IMMEDIATE;\n{body}\nINSERT INTO schema_migrations VALUES ({version}, '{digest}', '{stamp}');\nCOMMIT;")
            except sqlite3.Error:
                self.connection.rollback()
                raise

    def _one(self, table: str, entry_id: str) -> dict:
        if table not in {"subjects", "courses", "topics", "assignments", "point_rules", "materials"}:
            raise InvalidInput("Unknown entity.")
        row = self.connection.execute(f"SELECT * FROM {table} WHERE id = ?", (entry_id,)).fetchone()
        if not row:
            raise NotFound("Entity not found.")
        return dict(row)

    @staticmethod
    def _map(row: dict | sqlite3.Row) -> dict:
        names = {"subject_id": "subjectId", "course_id": "courseId", "topic_id": "topicId", "created_at": "createdAt", "updated_at": "updatedAt", "max_points": "maxPoints", "starts_at": "startsAt", "due_at": "dueAt"}
        return {names.get(key, key): bool(value) if key == "tentative" else value for key, value in dict(row).items()}

    def create_subject(self, data: dict) -> dict:
        _allowed(data, {"code", "title"})
        code, title = _text(data.get("code"), "code", 64), _text(data.get("title"), "title")
        if not re.fullmatch(r"[a-z][a-z0-9_-]*", code):
            raise InvalidInput("code requires lower-case letters, digits, hyphens or underscores.")
        entry_id = uuid4().hex
        try:
            with self.connection:
                self.connection.execute("INSERT INTO subjects VALUES (?, ?, ?, ?)", (entry_id, code, title, _now()))
        except sqlite3.IntegrityError:
            raise Conflict("Subject code already exists.") from None
        return self._map(self._one("subjects", entry_id))

    def list_subjects(self) -> list[dict]:
        return [self._map(row) for row in self.connection.execute("SELECT * FROM subjects ORDER BY title, id")]

    def create_course(self, data: dict) -> dict:
        _allowed(data, {"subjectId", "direction", "cohort", "semester", "title"})
        subject = self._one("subjects", _text(data.get("subjectId"), "subjectId", 96))
        direction = _enum(data.get("direction"), "direction", ("management", "economics"))
        cohort = _text(data.get("cohort"), "cohort", 96)
        semester = _integer(data.get("semester"), "semester", 1, 12)
        title = _text(data.get("title", subject["title"]), "title")
        entry_id = uuid4().hex
        try:
            with self.connection:
                self.connection.execute("INSERT INTO courses VALUES (?, ?, ?, ?, ?, ?, ?)", (entry_id, subject["id"], direction, cohort, semester, title, _now()))
        except sqlite3.IntegrityError:
            raise Conflict("Course already exists for this subject and audience.") from None
        return self._map(self._one("courses", entry_id))

    def list_courses(self, direction: str | None = None, cohort: str | None = None) -> list[dict]:
        clauses, args = [], []
        if direction is not None:
            clauses.append("direction = ?")
            args.append(_enum(direction, "direction", ("management", "economics")))
        if cohort is not None:
            clauses.append("cohort = ?")
            args.append(_text(cohort, "cohort", 96))
        query = "SELECT * FROM courses" + (" WHERE " + " AND ".join(clauses) if clauses else "") + " ORDER BY title, id"
        return [self._map(row) for row in self.connection.execute(query, args)]

    def course(self, course_id: str) -> dict:
        return self._map(self._one("courses", course_id))

    def _topic(self, topic_id: Any, course_id: str) -> str | None:
        if topic_id is None:
            return None
        topic = self._one("topics", _text(topic_id, "topicId", 96))
        if topic["course_id"] != course_id:
            raise InvalidInput("Topic belongs to a different course.")
        return topic["id"]

    def create_topic(self, data: dict) -> dict:
        _allowed(data, {"courseId", "title", "position"})
        course = self._one("courses", _text(data.get("courseId"), "courseId", 96))
        entry_id = uuid4().hex
        title = _text(data.get("title"), "title")
        position = _integer(data.get("position", 0), "position", 0, 10000)
        with self.connection:
            self.connection.execute("INSERT INTO topics VALUES (?, ?, ?, ?, ?)", (entry_id, course["id"], title, position, _now()))
        return self._map(self._one("topics", entry_id))

    def list_topics(self, course_id: str) -> list[dict]:
        self._one("courses", course_id)
        return [self._map(row) for row in self.connection.execute("SELECT * FROM topics WHERE course_id = ? ORDER BY position, id", (course_id,))]

    def _revision_data(self, data: dict) -> tuple:
        return (_text(data.get("title"), "title"), _enum(data.get("kind", "lecture"), "kind", ("lecture", "seminar", "reference", "glossary")),
                _enum(data.get("status", "ready"), "status", ("ready", "limited")), _url(data.get("externalUrl")),
                json.dumps(_blocks(data.get("blocks", [])), ensure_ascii=False), json.dumps(_warnings(data.get("warnings", [])), ensure_ascii=False))

    def create_material(self, data: dict) -> dict:
        _allowed(data, {"courseId", "topicId", "title", "kind", "status", "externalUrl", "blocks", "warnings"})
        course = self._one("courses", _text(data.get("courseId"), "courseId", 96))
        topic_id = self._topic(data.get("topicId"), course["id"])
        values, entry_id, stamp = self._revision_data(data), uuid4().hex, _now()
        with self.connection:
            self.connection.execute("INSERT INTO materials VALUES (?, ?, ?, 1, ?, ?)", (entry_id, course["id"], topic_id, stamp, stamp))
            self.connection.execute("INSERT INTO material_revisions VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)", (entry_id, *values, stamp))
        return self.material(entry_id)

    def material(self, material_id: str, version: int | None = None) -> dict:
        entry = self._one("materials", material_id)
        selected = entry["current_version"] if version is None else _integer(version, "version", 1, 1_000_000)
        row = self.connection.execute("SELECT * FROM material_revisions WHERE material_id = ? AND version = ?", (material_id, selected)).fetchone()
        if not row:
            raise NotFound("Material version not found.")
        return {"id": material_id, "courseId": entry["course_id"], "topicId": entry["topic_id"], "version": selected,
                "currentVersion": entry["current_version"], "title": row["title"], "kind": row["kind"], "status": row["status"],
                "externalUrl": row["external_url"], "blocks": json.loads(row["blocks_json"]), "warnings": json.loads(row["warnings_json"]),
                "createdAt": row["created_at"]}

    def list_materials(self, course_id: str) -> list[dict]:
        self._one("courses", course_id)
        rows = self.connection.execute("SELECT id FROM materials WHERE course_id = ? ORDER BY created_at, id", (course_id,)).fetchall()
        return [self.material(row["id"]) for row in rows]

    def update_material(self, material_id: str, data: dict) -> dict:
        _allowed(data, {"expectedVersion", "title", "kind", "status", "externalUrl", "blocks", "warnings"})
        expected = _integer(data.get("expectedVersion"), "expectedVersion", 1, 1_000_000)
        current = self.material(material_id)
        merged = {key: current[key] for key in ("title", "kind", "status", "externalUrl", "blocks", "warnings")}
        merged.update({key: value for key, value in data.items() if key != "expectedVersion"})
        values, stamp = self._revision_data(merged), _now()
        with self.connection:
            changed = self.connection.execute("UPDATE materials SET current_version = current_version + 1, updated_at = ? WHERE id = ? AND current_version = ?", (stamp, material_id, expected))
            if changed.rowcount != 1:
                raise Conflict("Material has changed; load its current version.")
            self.connection.execute("INSERT INTO material_revisions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (material_id, expected + 1, *values, stamp))
        return self.material(material_id)

    def context_materials(self, selections: list[dict]) -> list[dict]:
        if not isinstance(selections, list) or not 1 <= len(selections) <= 50:
            raise InvalidInput("Select between 1 and 50 materials.")
        result, seen = [], set()
        for selection in selections:
            _allowed(selection, {"id", "version"})
            material_id = _text(selection.get("id"), "material id", 96)
            material = self.material(material_id, selection.get("version"))
            key = (material_id, material["version"])
            if key not in seen:
                result.append(material)
                seen.add(key)
        if len({material["courseId"] for material in result}) != 1:
            raise InvalidInput("A context export must belong to one course.")
        return result

    def create_assignment(self, data: dict) -> dict:
        _allowed(data, {"courseId", "topicId", "title", "kind", "description", "startsAt", "dueAt", "tentative", "maxPoints"})
        course = self._one("courses", _text(data.get("courseId"), "courseId", 96))
        topic = self._topic(data.get("topicId"), course["id"])
        title = _text(data.get("title"), "title")
        kind = _enum(data.get("kind", "homework"), "kind", ("homework", "test", "independent", "exam", "project"))
        description = _text(data.get("description", ""), "description", 10000, empty=True)
        start, due = _date(data.get("startsAt"), "startsAt"), _date(data.get("dueAt"), "dueAt")
        if start and due and start > due:
            raise InvalidInput("startsAt must not be after dueAt.")
        tentative = data.get("tentative", False)
        if type(tentative) is not bool:
            raise InvalidInput("tentative must be a boolean.")
        points, entry_id, stamp = _points(data.get("maxPoints")), uuid4().hex, _now()
        with self.connection:
            self.connection.execute("INSERT INTO assignments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
                                    (entry_id, course["id"], topic, title, kind, description, start, due, int(tentative), points, stamp, stamp))
        return self._map(self._one("assignments", entry_id))

    def list_assignments(self, course_id: str) -> list[dict]:
        self._one("courses", course_id)
        return [self._map(row) for row in self.connection.execute("SELECT * FROM assignments WHERE course_id = ? ORDER BY due_at IS NULL, due_at, id", (course_id,))]

    def create_point_rule(self, data: dict) -> dict:
        _allowed(data, {"courseId", "topicId", "title", "description", "maxPoints"})
        course = self._one("courses", _text(data.get("courseId"), "courseId", 96))
        topic, entry_id = self._topic(data.get("topicId"), course["id"]), uuid4().hex
        title = _text(data.get("title"), "title")
        description = _text(data.get("description", ""), "description", 10000, empty=True)
        points = _points(data.get("maxPoints"))
        with self.connection:
            self.connection.execute("INSERT INTO point_rules VALUES (?, ?, ?, ?, ?, ?, ?)", (entry_id, course["id"], topic, title, description, points, _now()))
        return self._map(self._one("point_rules", entry_id))

    def list_point_rules(self, course_id: str) -> list[dict]:
        self._one("courses", course_id)
        return [self._map(row) for row in self.connection.execute("SELECT * FROM point_rules WHERE course_id = ? ORDER BY title, id", (course_id,))]

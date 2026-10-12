import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from otmetki_core import Conflict, InvalidInput, NotFound, Store, build_context, context_txt
from otmetki_core.api import dispatch
from otmetki_core.demo import seed_demo


class CoreTests(unittest.TestCase):
    def setUp(self):
        self.store = Store()
        self.subject = self.store.create_subject({"code": "demo", "title": "Demo"})
        self.course = self.store.create_course({"subjectId": self.subject["id"], "direction": "management", "cohort": "DEMO-M", "semester": 1})

    def tearDown(self):
        self.store.close()

    def material(self, **overrides):
        return self.store.create_material({"courseId": self.course["id"], "title": "Source", "blocks": [{"id": "a", "text": "A sufficiently long educational sentence for deduplication."}], **overrides})

    def test_direction_filters_are_real_database_queries(self):
        second = self.store.create_course({"subjectId": self.subject["id"], "direction": "economics", "cohort": "DEMO-E", "semester": 1})
        self.assertEqual([self.course["id"]], [entry["id"] for entry in self.store.list_courses("management")])
        self.assertEqual([second["id"]], [entry["id"] for entry in self.store.list_courses("economics")])
        with self.assertRaises(InvalidInput):
            self.store.list_courses("unexpected")

    def test_foreign_key_and_audience_uniqueness(self):
        with self.assertRaises(NotFound):
            self.store.create_course({"subjectId": "missing", "direction": "management", "cohort": "DEMO", "semester": 1})
        with self.assertRaises(Conflict):
            self.store.create_course({"subjectId": self.subject["id"], "direction": "management", "cohort": "DEMO-M", "semester": 1})

    def test_topics_cannot_be_assigned_across_courses(self):
        other = self.store.create_course({"subjectId": self.subject["id"], "direction": "economics", "cohort": "DEMO-E", "semester": 1})
        topic = self.store.create_topic({"courseId": other["id"], "title": "Other topic"})
        with self.assertRaises(InvalidInput):
            self.material(topicId=topic["id"])
        with self.assertRaises(InvalidInput):
            self.store.create_assignment({"courseId": self.course["id"], "topicId": topic["id"], "title": "Task"})

    def test_revision_snapshots_and_stale_write_protection(self):
        original = self.material()
        changed = self.store.update_material(original["id"], {"expectedVersion": 1, "title": "Changed", "blocks": [{"id": "a", "text": "New text."}]})
        self.assertEqual(changed["version"], 2)
        self.assertEqual(self.store.material(original["id"], 1)["blocks"], original["blocks"])
        with self.assertRaises(Conflict):
            self.store.update_material(original["id"], {"expectedVersion": 1, "title": "Stale"})
        self.assertEqual(self.store.material(original["id"])["title"], "Changed")
        self.assertEqual(self.store.connection.execute("SELECT count(*) FROM material_revisions").fetchone()[0], 2)

    def test_two_connections_cannot_overwrite_a_revision(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "synthetic.db"
            with Store(path) as first:
                seed_demo(first)
                material = first.list_materials(first.list_courses("management")[0]["id"])[0]
                with Store(path) as second:
                    first.update_material(material["id"], {"expectedVersion": 1, "title": "First writer"})
                    with self.assertRaises(Conflict):
                        second.update_material(material["id"], {"expectedVersion": 1, "title": "Second writer"})

    def test_invalid_edit_is_atomic(self):
        material = self.material()
        with self.assertRaises(InvalidInput):
            self.store.update_material(material["id"], {"expectedVersion": 1, "blocks": [{"id": "a", "text": "X"}, {"id": "a", "text": "Y"}]})
        self.assertEqual(self.store.material(material["id"])["version"], 1)

    def test_points_are_optional_finite_nonnegative(self):
        unknown = self.store.create_assignment({"courseId": self.course["id"], "title": "Unscheduled"})
        self.assertIsNone(unknown["maxPoints"])
        self.assertIsNone(unknown["dueAt"])
        for bad in (-1, True, float("inf"), float("nan"), "10"):
            with self.subTest(bad=str(bad)), self.assertRaises(InvalidInput):
                self.store.create_point_rule({"courseId": self.course["id"], "title": "Rule", "maxPoints": bad})
        good = self.store.create_point_rule({"courseId": self.course["id"], "title": "Rule", "maxPoints": 2.5})
        self.assertEqual(good["maxPoints"], 2.5)

    def test_assignment_dates_require_timezone_and_valid_order(self):
        base = {"courseId": self.course["id"], "title": "Task"}
        with self.assertRaises(InvalidInput):
            self.store.create_assignment({**base, "dueAt": "2027-01-01T10:00:00"})
        with self.assertRaises(InvalidInput):
            self.store.create_assignment({**base, "startsAt": "2027-01-02T10:00:00Z", "dueAt": "2027-01-01T10:00:00Z"})
        saved = self.store.create_assignment({**base, "dueAt": "2027-01-01T10:00:00+03:00", "tentative": True})
        self.assertEqual(saved["dueAt"], "2027-01-01T07:00:00Z")
        self.assertIs(saved["tentative"], True)

    def test_exact_prose_duplicates_keep_all_sources(self):
        first = self.material()
        second = self.material(title="Second source", blocks=[{"id": "b", "text": "A sufficiently long\n educational sentence for deduplication.", "page": 4}])
        context = build_context([first, second])
        self.assertEqual(context["duplicateCount"], 1)
        self.assertEqual(len(context["blocks"]), 1)
        self.assertEqual(context["blocks"][0]["sources"][1]["page"], 4)
        self.assertEqual(context["blocks"][0]["sources"][0]["version"], 1)
        self.assertEqual(self.store.material(second["id"])["blocks"][0]["text"], second["blocks"][0]["text"])

    def test_formula_signs_table_spacing_and_short_labels_survive(self):
        first = self.material(blocks=[{"id": "f", "kind": "formula", "text": "Long expression with x + y = z"}, {"id": "t", "kind": "table", "text": "column one    column two\nitem one      item two"}, {"id": "short", "text": "Answer"}])
        second = self.material(blocks=[{"id": "f", "kind": "formula", "text": "Long expression with x - y = z"}, {"id": "t", "kind": "table", "text": "column one column two\nitem one item two"}, {"id": "short", "text": "Answer"}])
        result = build_context([first, second])
        self.assertEqual(result["duplicateCount"], 0)
        self.assertEqual(len(result["blocks"]), 6)

    def test_explicit_and_detected_conditions_do_not_merge(self):
        answer = "A sufficiently long answer that changes meaning with conditions."
        first = self.material(blocks=[{"id": "a", "text": answer, "scope": "variant-a"}])
        second = self.material(blocks=[{"id": "a", "text": answer, "scope": "variant-b"}])
        self.assertEqual(build_context([first, second])["duplicateCount"], 0)
        first = self.material(blocks=[{"id": "condition", "text": "Если параметр положительный"}, {"id": "answer", "text": answer}])
        second = self.material(blocks=[{"id": "condition", "text": "Если параметр отрицательный"}, {"id": "answer", "text": answer}])
        self.assertEqual(build_context([first, second])["duplicateCount"], 0)

    def test_txt_preserves_limits_source_versions_and_unicode(self):
        original = self.material(title="Лекция", status="limited", warnings=["Таблицу нужно сверить."], blocks=[{"id": "a", "kind": "formula", "text": "α + β = γ", "page": 2, "warning": "Символ не уверен."}])
        content = context_txt([original])
        self.assertIn("α + β = γ", content)
        self.assertIn("v1 · page 2", content)
        self.assertIn("Таблицу нужно сверить.", content)
        self.assertIn("Символ не уверен.", content)

    def test_conditions_remain_relevant_after_many_intermediate_blocks(self):
        answer = "An identical long conclusion under two incompatible conditions."
        blocks = [{"id": "middle-one", "text": "First explanatory passage."}, {"id": "middle-two", "text": "Second explanatory passage."},
                  {"id": "middle-three", "text": "Third explanatory passage."}, {"id": "answer", "text": answer, "scope": "same-section"}]
        first = self.material(blocks=[{"id": "condition", "text": "Если вариант A"}, *blocks])
        second = self.material(blocks=[{"id": "condition", "text": "Если вариант B"}, *blocks])
        result = build_context([first, second])
        conclusions = [block for block in result["blocks"] if block["text"] == answer]
        self.assertEqual(len(conclusions), 2)
        self.assertEqual(result["duplicateCount"], 0)

    def test_selected_historical_context_does_not_move_to_latest(self):
        material = self.material()
        self.store.update_material(material["id"], {"expectedVersion": 1, "title": "New"})
        selected = self.store.context_materials([{"id": material["id"], "version": 1}, {"id": material["id"], "version": 1}])
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0]["title"], "Source")
        with self.assertRaises(NotFound):
            self.store.context_materials([{"id": material["id"], "version": 999}])

    def test_cross_course_context_rejected(self):
        first = self.material()
        other = self.store.create_course({"subjectId": self.subject["id"], "direction": "economics", "cohort": "DEMO-E", "semester": 1})
        second = self.material(courseId=other["id"])
        with self.assertRaises(InvalidInput):
            self.store.context_materials([{"id": first["id"]}, {"id": second["id"]}])

    def test_material_links_not_fetched_and_cannot_embed_credentials(self):
        valid = self.material(externalUrl="https://example.org/lesson")
        self.assertEqual(valid["externalUrl"], "https://example.org/lesson")
        for value in ("file:///document", "javascript:alert(1)", "https://" + "login:password@" + "example.org/file"):
            with self.subTest(value=value), self.assertRaises(InvalidInput):
                self.material(externalUrl=value)

    def test_private_schema_fields_cannot_be_smuggled_into_core(self):
        with self.assertRaises(InvalidInput):
            self.material(secret="not-part-of-model")
        tables = {row[0] for row in self.store.connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        self.assertEqual(tables, {"schema_migrations", "subjects", "courses", "topics", "materials", "material_revisions", "assignments", "point_rules"})

    def test_http_contract_matches_storage_and_txt(self):
        material = self.material()
        code, content, mime = dispatch(self.store, "GET", "/api/courses", {"direction": ["management"]})
        self.assertEqual((code, mime), (200, "application/json"))
        self.assertEqual(content["courses"][0]["id"], self.course["id"])
        code, content, mime = dispatch(self.store, "POST", "/api/context.txt", {}, {"materials": [{"id": material["id"], "version": 1}]})
        self.assertEqual((code, mime), (200, "text/plain"))
        self.assertIn("Source · v1", content)
        with self.assertRaises(NotFound):
            dispatch(self.store, "GET", "/api/unknown", {})

    def test_database_foreign_keys_enabled(self):
        with self.assertRaises(sqlite3.IntegrityError), self.store.connection:
            self.store.connection.execute("INSERT INTO topics VALUES ('bad', 'missing', 'Bad', 0, 'date')")

    def test_migrations_are_idempotent_and_checksum_verified(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "synthetic.db"
            with Store(path) as first:
                seed_demo(first)
                self.assertFalse(seed_demo(first)["seeded"])
            with Store(path) as second:
                self.assertEqual(len(second.list_subjects()), 2)
                self.assertEqual(second.connection.execute("SELECT count(*) FROM schema_migrations").fetchone()[0], 1)
                with second.connection:
                    second.connection.execute("UPDATE schema_migrations SET checksum = 'modified'")
            with self.assertRaises(Conflict):
                Store(path)


if __name__ == "__main__":
    unittest.main()

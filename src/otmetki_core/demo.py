"""Synthetic data only. The examples are not an actual faculty timetable."""

from .store import Store


def seed_demo(store: Store) -> dict:
    if store.list_subjects():
        return {"seeded": False, "reason": "The database is not empty."}
    maths = store.create_subject({"code": "demo-maths", "title": "Математика · пример"})
    economy = store.create_subject({"code": "demo-economics", "title": "Экономика · пример"})
    first = store.create_course({"subjectId": maths["id"], "direction": "management", "cohort": "DEMO-M", "semester": 1})
    second = store.create_course({"subjectId": economy["id"], "direction": "economics", "cohort": "DEMO-E", "semester": 1})
    topic = store.create_topic({"courseId": first["id"], "title": "Линейные модели", "position": 1})
    prose = "Линейная модель задаёт зависимость результата от одного или нескольких факторов."
    store.create_material({"courseId": first["id"], "topicId": topic["id"], "title": "Лекция · линейные модели", "kind": "lecture", "blocks": [
        {"id": "intro", "text": prose, "kind": "text", "page": 1},
        {"id": "formula", "text": "y = a + b x", "kind": "formula", "page": 1},
    ]})
    store.create_material({"courseId": first["id"], "topicId": topic["id"], "title": "Семинар · пример расчёта", "kind": "seminar", "blocks": [
        {"id": "intro", "text": prose, "kind": "text", "page": 1},
        {"id": "task", "text": "При a = 2 и b = 3 рассчитайте результат для x = 4.", "kind": "text", "page": 1},
        {"id": "answer", "text": "y = 2 + 3 × 4 = 14", "kind": "formula", "page": 1},
    ]})
    store.create_material({"courseId": second["id"], "title": "Глоссарий · пример", "kind": "glossary", "blocks": [
        {"id": "term", "text": "Demand — спрос. Supply — предложение.", "kind": "text"},
    ]})
    store.create_assignment({"courseId": first["id"], "topicId": topic["id"], "title": "Самостоятельная работа · пример", "kind": "independent", "tentative": True,
                             "maxPoints": 5, "description": "Вымышленное задание для проверки интерфейса. Дата ещё не определена."})
    store.create_point_rule({"courseId": first["id"], "title": "Работа на семинаре · пример", "maxPoints": 10,
                             "description": "Учебный пример правила. Это возможные баллы, а не личная оценка."})
    return {"seeded": True, "courses": [first, second]}

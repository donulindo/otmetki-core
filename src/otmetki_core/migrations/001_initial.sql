CREATE TABLE subjects (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE courses (
    id TEXT PRIMARY KEY,
    subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    direction TEXT NOT NULL CHECK (direction IN ('management', 'economics')),
    cohort TEXT NOT NULL,
    semester INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 12),
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (subject_id, direction, cohort, semester)
);
CREATE INDEX courses_direction ON courses(direction, cohort, semester);

CREATE TABLE topics (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    created_at TEXT NOT NULL
);
CREATE INDEX topics_course ON topics(course_id, position, id);

CREATE TABLE materials (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
    topic_id TEXT REFERENCES topics(id) ON DELETE RESTRICT,
    current_version INTEGER NOT NULL CHECK (current_version >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX materials_course ON materials(course_id, created_at, id);

CREATE TABLE material_revisions (
    material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
    version INTEGER NOT NULL CHECK (version >= 1),
    title TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('lecture', 'seminar', 'reference', 'glossary')),
    status TEXT NOT NULL CHECK (status IN ('ready', 'limited')),
    external_url TEXT,
    blocks_json TEXT NOT NULL CHECK (json_valid(blocks_json)),
    warnings_json TEXT NOT NULL CHECK (json_valid(warnings_json)),
    created_at TEXT NOT NULL,
    PRIMARY KEY (material_id, version)
);

CREATE TABLE assignments (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
    topic_id TEXT REFERENCES topics(id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('homework', 'test', 'independent', 'exam', 'project')),
    description TEXT NOT NULL,
    starts_at TEXT,
    due_at TEXT,
    tentative INTEGER NOT NULL CHECK (tentative IN (0, 1)),
    max_points REAL CHECK (max_points IS NULL OR max_points >= 0),
    version INTEGER NOT NULL CHECK (version >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX assignments_course ON assignments(course_id, due_at, id);

CREATE TABLE point_rules (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
    topic_id TEXT REFERENCES topics(id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    max_points REAL CHECK (max_points IS NULL OR max_points >= 0),
    created_at TEXT NOT NULL
);
CREATE INDEX point_rules_course ON point_rules(course_id, id);

// SQLite via Node's built-in driver (Node 22.13+). One file: data/enhancements.db
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(process.env.DB_PATH || path.join(dataDir, 'enhancements.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  -- Anyone with an allowed email domain can register; is_staff = may verify projects.
  CREATE TABLE IF NOT EXISTS users (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    email             TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name              TEXT NOT NULL,
    password_hash     TEXT NOT NULL,
    is_staff          INTEGER NOT NULL DEFAULT 0,
    email_verified_at TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Single-use links sent by email: purpose 'verify' (confirm address) or 'reset' (new password).
  CREATE TABLE IF NOT EXISTS email_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT NOT NULL,
    parent_project      TEXT,
    submitter           TEXT NOT NULL,
    submitter_email     TEXT,
    details             TEXT NOT NULL,
    people_needed       INTEGER,
    time_needed         TEXT,
    backend_languages   TEXT,
    frontend_libraries  TEXT,
    mobile_languages    TEXT,
    created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
    verified_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    verified_at         TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS work_requests (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    organization   TEXT NOT NULL,
    participants   TEXT NOT NULL,
    start_date     TEXT,
    end_date       TEXT,
    timeframe      TEXT,
    contact_email  TEXT,
    created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_requests_project ON work_requests(project_id);
`);

// ---- upgrade databases created by the first version (staff table, staff-only sessions) ----------
const hasTable = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
const hasColumn = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((r) => r.name === c);

if (hasTable('staff')) {
  // projects.verified_by pointed at staff(id); rebuild the table so it points at users(id).
  // Staff ids are carried over unchanged, so existing verified_by values stay correct.
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      INSERT OR IGNORE INTO users (id, email, name, password_hash, is_staff, email_verified_at, created_at)
        SELECT id, email, name, password_hash, 1, created_at, created_at FROM staff;
      CREATE TABLE projects_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, parent_project TEXT, submitter TEXT NOT NULL,
        submitter_email TEXT, details TEXT NOT NULL, people_needed INTEGER, time_needed TEXT,
        backend_languages TEXT, frontend_libraries TEXT, mobile_languages TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        verified_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO projects_new (id, name, parent_project, submitter, submitter_email, details, people_needed, time_needed,
        backend_languages, frontend_libraries, mobile_languages, verified_by, verified_at, created_at)
        SELECT id, name, parent_project, submitter, submitter_email, details, people_needed, time_needed,
          backend_languages, frontend_libraries, mobile_languages, verified_by, verified_at, created_at FROM projects;
      -- SQLite's recommended order (new, copy, drop old, rename new) keeps work_requests pointing at "projects".
      DROP TABLE projects;
      ALTER TABLE projects_new RENAME TO projects;
      DROP TABLE IF EXISTS sessions;
      DROP TABLE staff;
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  console.log('[DB] Moved staff accounts into users (as staff).');
}
// Submission form fields added later. Yes/no answers are stored as 1/0 (NULL = not answered).
const PROJECT_COLUMNS_ADDED = {
  submitter_phone:      'TEXT',
  short_description:    'TEXT',
  copyright_handling:   'TEXT',
  multiple_teams:       'INTEGER',
  multiple_teams_note:  'TEXT',
  security_sensitive:   'INTEGER',
  security_note:        'TEXT',
  // 'both' | 'descriptions' | 'screenshots' | 'none'
  promo_use:            'TEXT',
};
for (const [col, type] of Object.entries(PROJECT_COLUMNS_ADDED)) {
  if (!hasColumn('projects', col)) db.exec(`ALTER TABLE projects ADD COLUMN ${col} ${type}`);
}

if (!hasColumn('work_requests', 'created_by')) {
  db.exec('ALTER TABLE work_requests ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
`);

module.exports = db;

// One-time copy of everything in the old SQLite database (data/enhancements.db) into PostgreSQL.
// Accounts, passwords, staff flags, projects, requests and unexpired sessions/links are all kept.
//
//   npm run import-sqlite                    uses data/enhancements.db
//   npm run import-sqlite -- path/to/old.db  another file
//
// Refuses to run if PostgreSQL already has users or projects, so it can't duplicate or overwrite data.
// The SQLite file is only read, never changed.
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const db = require('../src/db');

const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data', 'enhancements.db'));

// SQLite stored UTC times as "YYYY-MM-DD HH:MM:SS" (or ISO strings for expiry times).
const ts = (v) => (v == null ? null : new Date(/[TZ]/.test(v) ? v : v.replace(' ', 'T') + 'Z'));
const bit = (v) => (v === 1 || v === 0 ? v : null);

async function main() {
  if (!fs.existsSync(file)) throw new Error(`No SQLite database at ${file}`);
  const src = new DatabaseSync(file, { readOnly: true });
  const has = (t) => !!src.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  if (has('staff')) throw new Error('This SQLite file is from the first version. Start the old app once to upgrade it, then import.');
  const all = (t) => (has(t) ? src.prepare(`SELECT * FROM ${t}`).all() : []);

  await db.init();
  const existing = await db.one('SELECT (SELECT count(*) FROM users) + (SELECT count(*) FROM projects) AS n');
  if (Number(existing.n) > 0) throw new Error('PostgreSQL already has data; import stopped so nothing is duplicated.');

  const users = all('users'), projects = all('projects'), requests = all('work_requests');
  const sessions = all('sessions'), tokens = all('email_tokens');
  const now = Date.now();

  await db.tx(async (t) => {
    for (const u of users) {
      await t.run(`INSERT INTO users (id, email, name, password_hash, is_staff, email_verified_at, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [u.id, u.email, u.name, u.password_hash, !!u.is_staff, ts(u.email_verified_at), ts(u.created_at)]);
    }
    for (const p of projects) {
      await t.run(`INSERT INTO projects (id, name, parent_project, short_description, details, submitter, submitter_email,
          submitter_phone, people_needed, time_needed, backend_languages, frontend_libraries, mobile_languages,
          copyright_handling, multiple_teams, multiple_teams_note, security_sensitive, security_note, promo_use,
          created_by, verified_by, verified_at, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
        [p.id, p.name, p.parent_project, p.short_description ?? null, p.details, p.submitter, p.submitter_email,
          p.submitter_phone ?? null, p.people_needed, p.time_needed, p.backend_languages, p.frontend_libraries,
          p.mobile_languages, p.copyright_handling ?? null, bit(p.multiple_teams), p.multiple_teams_note ?? null,
          bit(p.security_sensitive), p.security_note ?? null, p.promo_use ?? null,
          p.created_by ?? null, p.verified_by, ts(p.verified_at), ts(p.created_at)]);
    }
    for (const r of requests) {
      await t.run(`INSERT INTO work_requests (id, project_id, organization, participants, start_date, end_date,
          timeframe, contact_email, created_by, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [r.id, r.project_id, r.organization, r.participants, r.start_date || null, r.end_date || null,
          r.timeframe, r.contact_email, r.created_by ?? null, ts(r.created_at)]);
    }
    for (const s of sessions) {
      if (ts(s.expires_at) > now) {
        await t.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [s.token_hash, s.user_id, ts(s.expires_at)]);
      }
    }
    for (const k of tokens) {
      if (ts(k.expires_at) > now) {
        await t.run('INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1, $2, $3, $4)',
          [k.token_hash, k.user_id, k.purpose, ts(k.expires_at)]);
      }
    }
    // New rows continue numbering after the imported ids.
    for (const table of ['users', 'projects', 'work_requests']) {
      await t.run(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT max(id) FROM ${table}), 0) + 1, false)`);
    }
  });

  console.log(`[IMPORT] Copied ${users.length} users, ${projects.length} projects, ${requests.length} requests from ${file}.`);
}

main()
  .catch((err) => { console.error('[IMPORT]', err.message); process.exitCode = 1; })
  .finally(() => db.end());

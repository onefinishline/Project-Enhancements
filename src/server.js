// Project Enhancements: JSON API + serves the built React app (client/dist).
const path = require('path');
const fs = require('fs');
const express = require('express');
const db = require('./db');
const auth = require('./auth');
const mailer = require('./mailer');

const app = express();
const PORT = Number(process.env.PORT) || 3100;
const SECURE_COOKIES = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
// Exactly one proxy (nginx) sits in front: visitor IPs (for rate limits) come from its X-Forwarded-For header.
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
// Content-Security-Policy: the browser only runs this site's own script files (never inline or injected code),
// and only loads styles and fonts from here and Google Fonts. A second guard if text ever slipped through as HTML.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
app.use((_req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (SECURE_COOKIES) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Requests that change data must be JSON and come from this site. A form or script on another website
// can't send JSON here without the browser asking permission first (which this server never gives),
// and a mismatched Origin header is refused outright.
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (!req.is('application/json')) return res.status(415).json({ error: 'Requests must be sent as JSON.' });
  const origin = req.get('origin');
  if (origin) {
    let host = null;
    try { host = new URL(origin).host; } catch { /* malformed: refused below */ }
    if (host !== req.get('host')) return res.status(403).json({ error: 'Request refused.' });
  }
  next();
});
app.use(auth.loadUser);

// ---- tiny in-memory rate limiter --------------------------------------------
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const entry = hits.get(key);
    if (!entry || entry.reset < now) hits.set(key, { count: 1, reset: now + windowMs });
    else if (++entry.count > max) return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    if (hits.size > 10000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    next();
  };
}
const loginLimiter = rateLimit({ windowMs: 15 * 60e3, max: 10 });
const submitLimiter = rateLimit({ windowMs: 60 * 60e3, max: 30 });

// ---- input helpers ----------------------------------------------------------
// Every field is checked here before it is stored. Values are always saved through query parameters
// (never pasted into SQL) and React shows them as plain text, so these rules are an extra layer on top.
class InputError extends Error {}
// Invisible control characters (and, for one-line fields, line breaks) are removed, so text can't carry
// hidden commands, break into email headers or disguise itself. Only real text is kept.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g;
function text(body, field, label, { max = 200, required = false, multiline = false } = {}) {
  let v = typeof body[field] === 'string' ? body[field] : '';
  v = v.normalize('NFC').replace(CONTROL_CHARS, '');
  v = multiline ? v.replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n') : v.replace(/[\r\n\t]+/g, ' ');
  v = v.trim();
  if (required && !v) throw new InputError(`${label} is required.`);
  if (v.length > max) throw new InputError(`${label} must be ${max} characters or fewer.`);
  return v || null;
}
// Plain addresses only (name@example.org): no spaces, quotes, angle brackets or other characters that
// could add recipients or extra parts to a mailto: link.
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+\/=^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
function email(body, field, label) {
  const v = text(body, field, label, { max: 254 });
  if (v && (!EMAIL_RE.test(v) || v.includes('..'))) throw new InputError(`${label} is not a valid email address.`);
  return v;
}
// People's names: letters (any language), spaces and . , ' - only. Account names go into emails sent to
// that address, so they must not carry links or markup.
function personName(body, field, label, opts) {
  const v = text(body, field, label, { max: 120, ...opts });
  if (v && !/^[\p{L}\p{M}][\p{L}\p{M} .,'’-]*$/u.test(v)) {
    throw new InputError(`${label} can only contain letters, spaces and . , ' -`);
  }
  return v;
}
function date(body, field, label) {
  const v = text(body, field, label, { max: 10 });
  if (!v) return v;
  // Must be a real calendar day (rejects e.g. 2026-02-31) within a sensible range.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || +m[1] < 2000 || +m[1] > 2100 || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    throw new InputError(`${label} must be a date.`);
  }
  return v;
}
function wholeNumber(body, field, label) {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 10000) throw new InputError(`${label} must be a whole number from 1 to 10000.`);
  return n;
}
function phone(body, field, label) {
  const v = text(body, field, label, { max: 40 });
  if (v && !/^[+()\d][\d\s().\-+\/x#ext]*$/i.test(v)) throw new InputError(`${label} should contain only digits, spaces and + ( ) - .`);
  return v;
}
// Yes/no answers arrive as true/false; stored as 1/0.
function yesNo(body, field, label, { required = false } = {}) {
  const v = body[field];
  if (v === true || v === false) return v ? 1 : 0;
  if (required) throw new InputError(`Answer yes or no: ${label}`);
  return null;
}
function oneOf(body, field, label, options, { required = false } = {}) {
  const v = typeof body[field] === 'string' ? body[field] : '';
  if (!v) { if (required) throw new InputError(`${label} is required.`); return null; }
  if (!options.includes(v)) throw new InputError(`${label} is not a valid choice.`);
  return v;
}
const PROMO_CHOICES = ['both', 'descriptions', 'screenshots', 'none'];

const idParam = (req) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};
function handle(area, fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (err) {
      if (err instanceof InputError) return res.status(400).json({ error: err.message });
      console.error(`[${area}]`, err);
      if (!res.headersSent) res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
}

// ---- auth -------------------------------------------------------------------
// Accounts: anyone at the allowed domain (default sil.org). Registering only takes name + email;
// the password is chosen on the page the emailed link opens, which proves the person owns the address.
const NO_PASSWORD = '!'; // placeholder hash for accounts that have not set a password yet; never matches
const MIN_PASSWORD = 10;
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const registerLimiter = rateLimit({ windowMs: 15 * 60e3, max: 10 });
const forgotLimiter = rateLimit({ windowMs: 15 * 60e3, max: 10 });
const tokenLimiter = rateLimit({ windowMs: 15 * 60e3, max: 20 });
const SENT = { ok: true, message: 'Check your email for a link to continue. It may take a minute to arrive.' };

function password(body) {
  const pw = typeof body.password === 'string' ? body.password : '';
  if (pw.length < MIN_PASSWORD) throw new InputError(`Password must be at least ${MIN_PASSWORD} characters.`);
  if (pw.length > 200) throw new InputError('Password must be 200 characters or fewer.');
  return pw;
}

// Started without waiting (see the end of the function), so response time doesn't reveal whether an account exists.
function sendAccountEmail(user, kind) {
  buildAndSendAccountEmail(user, kind)
    .catch((err) => console.error('[MAIL] Could not send', kind, 'email:', err.message));
}
async function buildAndSendAccountEmail(user, kind) {
  let subject, body;
  if (kind === 'verify') {
    const link = `${APP_URL}/set-password?token=${await auth.createEmailToken(user.id, 'verify', 48)}`;
    subject = 'Finish creating your Project Enhancements account';
    body = `Hi ${user.name},\n\nTo finish creating your Project Enhancements account, open this link and choose a password:\n\n${link}\n\nThe link works once and expires in 48 hours. If you didn't ask for an account, you can ignore this email.`;
  } else if (kind === 'reset') {
    const link = `${APP_URL}/set-password?token=${await auth.createEmailToken(user.id, 'reset', 1)}`;
    subject = 'Reset your Project Enhancements password';
    body = `Hi ${user.name},\n\nTo choose a new password, open this link:\n\n${link}\n\nThe link works once and expires in 1 hour. If you didn't ask for this, you can ignore this email; your password hasn't changed.`;
  } else {
    subject = 'You already have a Project Enhancements account';
    body = `Hi ${user.name},\n\nSomeone (probably you) tried to create an account with this address, but you already have one.\nSign in at ${APP_URL}/signin. If you've forgotten your password, use "Forgot password?" there.`;
  }
  await mailer.sendMail({ to: user.email, subject, text: body });
}

function requireMail(_req, res, next) {
  if (!mailer.canSend()) {
    console.error('[AUTH] Account email requested but SMTP is not configured (set SMTP_HOST in .env).');
    return res.status(503).json({ error: "Email isn't set up on this server yet, so accounts can't be created or reset. Please contact the site administrator." });
  }
  next();
}

app.get('/api/auth/me', (req, res) => res.json({ user: req.user || null, domain: auth.ALLOWED_DOMAIN }));

app.post('/api/auth/register', registerLimiter, requireMail, handle('AUTH', async (req, res) => {
  const name = personName(req.body, 'name', 'Your name', { required: true });
  const em = (email(req.body, 'email', 'Email') || '').toLowerCase();
  if (!em) throw new InputError('Email is required.');
  if (!auth.isAllowedEmail(em)) throw new InputError(`Use your @${auth.ALLOWED_DOMAIN} email address.`);
  const existing = await db.one('SELECT id, name, email, email_verified_at FROM users WHERE lower(email) = $1', [em]);
  if (existing && existing.email_verified_at) {
    sendAccountEmail(existing, 'exists');
  } else if (existing) {
    await db.run('UPDATE users SET name = $1 WHERE id = $2', [name, existing.id]);
    sendAccountEmail({ ...existing, name }, 'verify');
  } else {
    // ON CONFLICT: two sign-ups for the same address at the same moment both succeed quietly.
    const created = await db.one(`
      INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
      ON CONFLICT ((lower(email))) DO NOTHING RETURNING id`, [em, name, NO_PASSWORD]);
    if (created) sendAccountEmail({ id: created.id, name, email: em }, 'verify');
  }
  res.json(SENT); // same answer either way, so this can't be used to find out who has an account
}));

app.post('/api/auth/forgot', forgotLimiter, requireMail, handle('AUTH', async (req, res) => {
  const em = email(req.body, 'email', 'Email');
  if (!em) throw new InputError('Email is required.');
  const user = await db.one('SELECT id, name, email, email_verified_at FROM users WHERE lower(email) = lower($1)', [em]);
  if (user) sendAccountEmail(user, user.email_verified_at ? 'reset' : 'verify');
  res.json(SENT);
}));

app.get('/api/auth/token', tokenLimiter, handle('AUTH', async (req, res) => {
  const info = await auth.peekEmailToken(req.query.token);
  if (!info) return res.status(400).json({ error: 'This link is invalid or has expired. Please request a new one.' });
  res.json({ email: info.email, name: info.name, purpose: info.purpose });
}));

app.post('/api/auth/set-password', tokenLimiter, handle('AUTH', async (req, res) => {
  const pw = password(req.body);
  const name = personName(req.body, 'name', 'Your name');
  const info = await auth.consumeEmailToken(req.body.token);
  if (!info) return res.status(400).json({ error: 'This link is invalid or has expired. Please request a new one.' });
  const hash = await auth.hashPassword(pw);
  await db.tx(async (t) => {
    await t.run(`
      UPDATE users SET password_hash = $1, name = COALESCE($2, name), email_verified_at = COALESCE(email_verified_at, now())
      WHERE id = $3`, [hash, name, info.user_id]);
    await t.run('DELETE FROM sessions WHERE user_id = $1', [info.user_id]); // sign out everywhere else
  });
  await auth.createSession(res, info.user_id, SECURE_COOKIES);
  const row = await db.one('SELECT id, name, email, is_staff FROM users WHERE id = $1', [info.user_id]);
  res.json({ user: auth.publicUser(row) });
}));

app.post('/api/auth/login', loginLimiter, handle('AUTH', async (req, res) => {
  const em = text(req.body, 'email', 'Email', { required: true, max: 254 });
  const pw = typeof req.body.password === 'string' ? req.body.password : '';
  const row = await db.one(
    'SELECT id, name, email, is_staff, password_hash, email_verified_at FROM users WHERE lower(email) = lower($1)', [em]);
  const ok = await auth.checkPassword(pw, row && row.email_verified_at ? row.password_hash : auth.DUMMY_HASH);
  if (!row || !row.email_verified_at || !pw || !ok) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  await auth.createSession(res, row.id, SECURE_COOKIES);
  res.json({ user: auth.publicUser(row) });
}));

app.post('/api/auth/logout', handle('AUTH', async (req, res) => {
  await auth.destroySession(req, res);
  res.json({ ok: true });
}));

// ---- projects ---------------------------------------------------------------
app.get('/api/projects', handle('PROJECTS', async (req, res) => {
  // Security-sensitive projects are only sent to signed-in users; the public never receives them.
  // ($1 is true for signed-in users, which shows every project.)
  const projects = await db.query(`
    SELECT p.*, s.name AS verified_by_name
    FROM projects p LEFT JOIN users s ON s.id = p.verified_by
    WHERE $1 OR p.security_sensitive IS DISTINCT FROM 1
    ORDER BY p.created_at DESC, p.id DESC`, [!!req.user]);
  const shownIds = projects.map((p) => p.id);
  const requests = await db.query(
    'SELECT * FROM work_requests WHERE project_id = ANY($1::int[]) ORDER BY created_at ASC, id ASC', [shownIds]);
  const isStaff = !!(req.user && req.user.is_staff);
  const byProject = new Map();
  for (const r of requests) {
    if (!isStaff) delete r.contact_email; // contact details are for staff only
    delete r.created_by;
    if (!byProject.has(r.project_id)) byProject.set(r.project_id, []);
    byProject.get(r.project_id).push(r);
  }
  res.json({
    projects: projects.map((p) => {
      const out = { ...p, verified: !!p.verified_at, requests: byProject.get(p.id) || [] };
      if (!isStaff) { delete out.submitter_email; delete out.submitter_phone; }
      delete out.verified_by;
      delete out.created_by;
      return out;
    }),
  });
}));

// Submitting needs an account; viewing the list (GET above) and requesting to work on a project stay open.
app.post('/api/projects', submitLimiter, auth.requireUser, handle('PROJECTS', async (req, res) => {
  const b = req.body || {};
  const multipleTeams = yesNo(b, 'multiple_teams', 'Can more than one team work on this project?', { required: true });
  const securitySensitive = yesNo(b, 'security_sensitive', 'Is this project security-sensitive?', { required: true });
  const fields = {
    name: text(b, 'name', 'Project name', { required: true }),
    parent_project: text(b, 'parent_project', 'Larger project'),
    short_description: text(b, 'short_description', 'Short project description', { required: true, max: 300 }),
    details: text(b, 'details', 'Full project description', { required: true, max: 5000, multiline: true }),
    submitter: text(b, 'submitter', 'Submitter', { required: true }),
    submitter_email: email(b, 'submitter_email', 'Submitter email'),
    submitter_phone: phone(b, 'submitter_phone', 'Submitter phone number'),
    people_needed: wholeNumber(b, 'people_needed', 'People needed'),
    time_needed: text(b, 'time_needed', 'Time needed'),
    backend_languages: text(b, 'backend_languages', 'Desktop and backend languages', { max: 500 }),
    frontend_libraries: text(b, 'frontend_libraries', 'Front-end libraries', { max: 500 }),
    mobile_languages: text(b, 'mobile_languages', 'Mobile languages', { max: 500 }),
    copyright_handling: text(b, 'copyright_handling', 'How copyrights should be handled', { required: true, max: 2000, multiline: true }),
    multiple_teams: multipleTeams,
    multiple_teams_note: text(b, 'multiple_teams_note', 'Explanation of whether more than one team can work on it', { required: true, max: 2000, multiline: true }),
    security_sensitive: securitySensitive,
    security_note: securitySensitive
      ? text(b, 'security_note', 'What makes it security-sensitive', { required: true, max: 2000, multiline: true })
      : null,
    promo_use: oneOf(b, 'promo_use', 'Use in promotional material', PROMO_CHOICES, { required: true }),
    created_by: req.user.id,
  };
  // Column names come from the fixed list above (never from the request); values go in as $1, $2, ...
  const cols = Object.keys(fields);
  const row = await db.one(
    `INSERT INTO projects (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    Object.values(fields));
  res.status(201).json({ id: row.id });
}));

app.post('/api/projects/:id/verify', auth.requireStaff, handle('VERIFY', async (req, res) => {
  const id = idParam(req);
  if (!id) return res.status(404).json({ error: 'Project not found.' });
  const verified = req.body && req.body.verified === true;
  const r = verified
    ? await db.run('UPDATE projects SET verified_by = $1, verified_at = now() WHERE id = $2', [req.user.id, id])
    : await db.run('UPDATE projects SET verified_by = NULL, verified_at = NULL WHERE id = $1', [id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'Project not found.' });
  res.json({ ok: true, verified });
}));

app.post('/api/projects/:id/requests', submitLimiter, handle('REQUESTS', async (req, res) => {
  const id = idParam(req);
  const project = id && await db.one('SELECT security_sensitive FROM projects WHERE id = $1', [id]);
  // Signed-out visitors can't see security-sensitive projects, so they can't request them either.
  if (!project || (project.security_sensitive === 1 && !req.user)) {
    return res.status(404).json({ error: 'Project not found.' });
  }
  const b = req.body || {};
  const organization = text(b, 'organization', 'Team or organization', { required: true });
  const participants = text(b, 'participants', 'Participant names', { required: true, max: 2000, multiline: true });
  const start = date(b, 'start_date', 'Start date');
  const end = date(b, 'end_date', 'End date');
  const timeframe = text(b, 'timeframe', 'Timeframe', { max: 500 });
  const contact = email(b, 'contact_email', 'Contact email');
  if (!start && !end && !timeframe) throw new InputError('Give the event dates or describe the timeframe.');
  if (start && end && end < start) throw new InputError('End date must be on or after the start date.');
  const row = await db.one(`
    INSERT INTO work_requests (project_id, organization, participants, start_date, end_date, timeframe, contact_email, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [id, organization, participants, start, end, timeframe, contact, req.user ? req.user.id : null]);
  res.status(201).json({ id: row.id });
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

// ---- React app --------------------------------------------------------------
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false }));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  app.get('/', (_req, res) => res.type('text').send('API running. Build the client (npm run build) or use the Vite dev server on :5173.'));
}

// Malformed or oversized request bodies get a short JSON error; no stack traces or internals are ever sent.
app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[SERVER]', err);
  const message = err.type === 'entity.too.large' ? 'That request is too large.'
    : status === 400 ? 'The request could not be read.'
    : 'Something went wrong. Please try again.';
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
});

// Create any missing tables, then start taking requests.
// Listens only on this machine by default: in production nginx is the one public entry point (HTTPS),
// so nobody can reach the app directly over plain HTTP. Set HOST=0.0.0.0 only if you really need that.
const HOST = process.env.HOST || '127.0.0.1';
db.init().then(() => app.listen(PORT, HOST, () => {
  console.log(`[SERVER] Project Enhancements on http://${HOST}:${PORT}`);
  if (process.env.NODE_ENV === 'production' && !process.env.APP_URL) {
    console.error('[SERVER] APP_URL is not set: emailed sign-up and reset links will point at localhost.');
  }
  if (!mailer.isConfigured()) {
    console.warn(process.env.NODE_ENV === 'production'
      ? '[MAIL] SMTP_HOST is not set: people cannot create accounts or reset passwords.'
      : '[MAIL] SMTP_HOST is not set: account emails will be printed here instead of sent.');
  }
})).catch((err) => {
  console.error('[DB] Could not connect to PostgreSQL or set up tables:', err.message);
  process.exit(1);
});

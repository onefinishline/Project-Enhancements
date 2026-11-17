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
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
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
class InputError extends Error {}
function text(body, field, label, { max = 200, required = false } = {}) {
  const v = typeof body[field] === 'string' ? body[field].trim() : '';
  if (required && !v) throw new InputError(`${label} is required.`);
  if (v.length > max) throw new InputError(`${label} must be ${max} characters or fewer.`);
  return v || null;
}
function email(body, field, label) {
  const v = text(body, field, label, { max: 254 });
  if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new InputError(`${label} is not a valid email address.`);
  return v;
}
function date(body, field, label) {
  const v = text(body, field, label, { max: 10 });
  if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v)))) throw new InputError(`${label} must be a date.`);
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
  return (req, res) => {
    try { fn(req, res); }
    catch (err) {
      if (err instanceof InputError) return res.status(400).json({ error: err.message });
      console.error(`[${area}]`, err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
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

function sendAccountEmail(user, kind) {
  let subject, body;
  if (kind === 'verify') {
    const link = `${APP_URL}/set-password?token=${auth.createEmailToken(user.id, 'verify', 48)}`;
    subject = 'Finish creating your Project Enhancements account';
    body = `Hi ${user.name},\n\nTo finish creating your Project Enhancements account, open this link and choose a password:\n\n${link}\n\nThe link works once and expires in 48 hours. If you didn't ask for an account, you can ignore this email.`;
  } else if (kind === 'reset') {
    const link = `${APP_URL}/set-password?token=${auth.createEmailToken(user.id, 'reset', 1)}`;
    subject = 'Reset your Project Enhancements password';
    body = `Hi ${user.name},\n\nTo choose a new password, open this link:\n\n${link}\n\nThe link works once and expires in 1 hour. If you didn't ask for this, you can ignore this email; your password hasn't changed.`;
  } else {
    subject = 'You already have a Project Enhancements account';
    body = `Hi ${user.name},\n\nSomeone (probably you) tried to create an account with this address, but you already have one.\nSign in at ${APP_URL}/signin. If you've forgotten your password, use "Forgot password?" there.`;
  }
  // Sent in the background so response time doesn't reveal whether an account exists.
  mailer.sendMail({ to: user.email, subject, text: body })
    .catch((err) => console.error('[MAIL] Could not send', kind, 'email:', err.message));
}

function requireMail(_req, res, next) {
  if (!mailer.canSend()) {
    console.error('[AUTH] Account email requested but SMTP is not configured (set SMTP_HOST in .env).');
    return res.status(503).json({ error: "Email isn't set up on this server yet, so accounts can't be created or reset. Please contact the site administrator." });
  }
  next();
}

app.get('/api/auth/me', (req, res) => res.json({ user: req.user || null, domain: auth.ALLOWED_DOMAIN }));

app.post('/api/auth/register', registerLimiter, requireMail, handle('AUTH', (req, res) => {
  const name = text(req.body, 'name', 'Your name', { required: true, max: 120 });
  const em = (email(req.body, 'email', 'Email') || '').toLowerCase();
  if (!em) throw new InputError('Email is required.');
  if (!auth.isAllowedEmail(em)) throw new InputError(`Use your @${auth.ALLOWED_DOMAIN} email address.`);
  const existing = db.prepare('SELECT id, name, email, email_verified_at FROM users WHERE email = ?').get(em);
  if (existing && existing.email_verified_at) {
    sendAccountEmail(existing, 'exists');
  } else if (existing) {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, existing.id);
    sendAccountEmail({ ...existing, name }, 'verify');
  } else {
    const r = db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run(em, name, NO_PASSWORD);
    sendAccountEmail({ id: Number(r.lastInsertRowid), name, email: em }, 'verify');
  }
  res.json(SENT); // same answer either way, so this can't be used to find out who has an account
}));

app.post('/api/auth/forgot', forgotLimiter, requireMail, handle('AUTH', (req, res) => {
  const em = email(req.body, 'email', 'Email');
  if (!em) throw new InputError('Email is required.');
  const user = db.prepare('SELECT id, name, email, email_verified_at FROM users WHERE email = ?').get(em);
  if (user) sendAccountEmail(user, user.email_verified_at ? 'reset' : 'verify');
  res.json(SENT);
}));

app.get('/api/auth/token', tokenLimiter, (req, res) => {
  const info = auth.peekEmailToken(req.query.token);
  if (!info) return res.status(400).json({ error: 'This link is invalid or has expired. Please request a new one.' });
  res.json({ email: info.email, name: info.name, purpose: info.purpose });
});

app.post('/api/auth/set-password', tokenLimiter, handle('AUTH', (req, res) => {
  const pw = password(req.body);
  const name = text(req.body, 'name', 'Your name', { max: 120 });
  const info = auth.consumeEmailToken(req.body.token);
  if (!info) return res.status(400).json({ error: 'This link is invalid or has expired. Please request a new one.' });
  db.prepare(`
    UPDATE users SET password_hash = ?, name = COALESCE(?, name), email_verified_at = COALESCE(email_verified_at, datetime('now'))
    WHERE id = ?`).run(auth.hashPassword(pw), name, info.user_id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(info.user_id); // sign out everywhere else
  auth.createSession(res, info.user_id, SECURE_COOKIES);
  const row = db.prepare('SELECT id, name, email, is_staff FROM users WHERE id = ?').get(info.user_id);
  res.json({ user: auth.publicUser(row) });
}));

app.post('/api/auth/login', loginLimiter, handle('AUTH', (req, res) => {
  const em = text(req.body, 'email', 'Email', { required: true, max: 254 });
  const pw = typeof req.body.password === 'string' ? req.body.password : '';
  const row = db.prepare('SELECT id, name, email, is_staff, password_hash, email_verified_at FROM users WHERE email = ?').get(em);
  const ok = auth.checkPassword(pw, row && row.email_verified_at ? row.password_hash : auth.DUMMY_HASH);
  if (!row || !row.email_verified_at || !pw || !ok) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  auth.createSession(res, row.id, SECURE_COOKIES);
  res.json({ user: auth.publicUser(row) });
}));

app.post('/api/auth/logout', (req, res) => {
  auth.destroySession(req, res);
  res.json({ ok: true });
});

// ---- projects ---------------------------------------------------------------
app.get('/api/projects', handle('PROJECTS', (req, res) => {
  // Security-sensitive projects are only sent to signed-in users; the public never receives them.
  const projects = db.prepare(`
    SELECT p.*, s.name AS verified_by_name
    FROM projects p LEFT JOIN users s ON s.id = p.verified_by
    ${req.user ? '' : 'WHERE p.security_sensitive IS NOT 1'}
    ORDER BY p.created_at DESC, p.id DESC`).all();
  const requests = db.prepare('SELECT * FROM work_requests ORDER BY created_at ASC').all();
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
app.post('/api/projects', submitLimiter, auth.requireUser, handle('PROJECTS', (req, res) => {
  const b = req.body || {};
  const multipleTeams = yesNo(b, 'multiple_teams', 'Can more than one team work on this project?', { required: true });
  const securitySensitive = yesNo(b, 'security_sensitive', 'Is this project security-sensitive?', { required: true });
  const fields = {
    name: text(b, 'name', 'Project name', { required: true }),
    parent_project: text(b, 'parent_project', 'Larger project'),
    short_description: text(b, 'short_description', 'Short project description', { required: true, max: 300 }),
    details: text(b, 'details', 'Full project description', { required: true, max: 5000 }),
    submitter: text(b, 'submitter', 'Submitter', { required: true }),
    submitter_email: email(b, 'submitter_email', 'Submitter email'),
    submitter_phone: phone(b, 'submitter_phone', 'Submitter phone number'),
    people_needed: wholeNumber(b, 'people_needed', 'People needed'),
    time_needed: text(b, 'time_needed', 'Time needed'),
    backend_languages: text(b, 'backend_languages', 'Desktop and backend languages', { max: 500 }),
    frontend_libraries: text(b, 'frontend_libraries', 'Front-end libraries', { max: 500 }),
    mobile_languages: text(b, 'mobile_languages', 'Mobile languages', { max: 500 }),
    copyright_handling: text(b, 'copyright_handling', 'How copyrights should be handled', { required: true, max: 2000 }),
    multiple_teams: multipleTeams,
    multiple_teams_note: text(b, 'multiple_teams_note', 'Explanation of whether more than one team can work on it', { required: true, max: 2000 }),
    security_sensitive: securitySensitive,
    security_note: securitySensitive
      ? text(b, 'security_note', 'What makes it security-sensitive', { required: true, max: 2000 })
      : null,
    promo_use: oneOf(b, 'promo_use', 'Use in promotional material', PROMO_CHOICES, { required: true }),
    created_by: req.user.id,
  };
  const cols = Object.keys(fields);
  const r = db.prepare(`INSERT INTO projects (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...Object.values(fields));
  res.status(201).json({ id: Number(r.lastInsertRowid) });
}));

app.post('/api/projects/:id/verify', auth.requireStaff, handle('VERIFY', (req, res) => {
  const id = idParam(req);
  if (!id) return res.status(404).json({ error: 'Project not found.' });
  const verified = req.body && req.body.verified === true;
  const r = verified
    ? db.prepare("UPDATE projects SET verified_by = ?, verified_at = datetime('now') WHERE id = ?").run(req.user.id, id)
    : db.prepare('UPDATE projects SET verified_by = NULL, verified_at = NULL WHERE id = ?').run(id);
  if (r.changes === 0) return res.status(404).json({ error: 'Project not found.' });
  res.json({ ok: true, verified });
}));

app.post('/api/projects/:id/requests', submitLimiter, handle('REQUESTS', (req, res) => {
  const id = idParam(req);
  const project = id && db.prepare('SELECT security_sensitive FROM projects WHERE id = ?').get(id);
  // Signed-out visitors can't see security-sensitive projects, so they can't request them either.
  if (!project || (project.security_sensitive === 1 && !req.user)) {
    return res.status(404).json({ error: 'Project not found.' });
  }
  const b = req.body || {};
  const organization = text(b, 'organization', 'Team or organization', { required: true });
  const participants = text(b, 'participants', 'Participant names', { required: true, max: 2000 });
  const start = date(b, 'start_date', 'Start date');
  const end = date(b, 'end_date', 'End date');
  const timeframe = text(b, 'timeframe', 'Timeframe', { max: 500 });
  const contact = email(b, 'contact_email', 'Contact email');
  if (!start && !end && !timeframe) throw new InputError('Give the event dates or describe the timeframe.');
  if (start && end && end < start) throw new InputError('End date must be on or after the start date.');
  const r = db.prepare(`
    INSERT INTO work_requests (project_id, organization, participants, start_date, end_date, timeframe, contact_email, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, organization, participants, start, end, timeframe, contact, req.user ? req.user.id : null);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
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

app.listen(PORT, () => {
  console.log(`[SERVER] Project Enhancements on http://localhost:${PORT}`);
  if (process.env.NODE_ENV === 'production' && !process.env.APP_URL) {
    console.error('[SERVER] APP_URL is not set: emailed sign-up and reset links will point at localhost.');
  }
  if (!mailer.isConfigured()) {
    console.warn(process.env.NODE_ENV === 'production'
      ? '[MAIL] SMTP_HOST is not set: people cannot create accounts or reset passwords.'
      : '[MAIL] SMTP_HOST is not set: account emails will be printed here instead of sent.');
  }
});

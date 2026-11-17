// Accounts: scrypt password hashes; random session and email tokens (only their SHA-256 is stored).
const crypto = require('crypto');
const db = require('./db');

const SESSION_DAYS = 7;
const COOKIE = 'pe_session';
const ALLOWED_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN || 'sil.org').toLowerCase();

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

function checkPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split(':');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// A dummy hash so a sign-in for an unknown email takes as long as one for a real account.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const nowIso = () => new Date().toISOString();

function isAllowedEmail(email) {
  const at = String(email).lastIndexOf('@');
  return at > 0 && String(email).slice(at + 1).toLowerCase() === ALLOWED_DOMAIN;
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; } // malformed cookie = signed out
    }
  }
  return null;
}

function createSession(res, userId, secure) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, expires.toISOString());
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Expires=${expires.toUTCString()}${secure ? '; Secure' : ''}`);
}

function destroySession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

const publicUser = (row) => ({ id: row.id, name: row.name, email: row.email, is_staff: !!row.is_staff });

// Attaches req.user ({ id, name, email, is_staff }) when a valid session cookie is present.
function loadUser(req, _res, next) {
  const token = readCookie(req, COOKIE);
  if (token) {
    const row = db.prepare(`
      SELECT u.id, u.name, u.email, u.is_staff FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.email_verified_at IS NOT NULL`).get(sha256(token), nowIso());
    if (row) req.user = publicUser(row);
  }
  next();
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in first.' });
  next();
}

function requireStaff(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in first.' });
  if (!req.user.is_staff) return res.status(403).json({ error: 'Only authorized staff can verify projects.' });
  next();
}

// Single-use email link tokens. Issuing a new one replaces any older one of the same purpose.
function createEmailToken(userId, purpose, hours) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM email_tokens WHERE user_id = ? AND purpose = ?').run(userId, purpose);
  db.prepare('INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256(token), userId, purpose, new Date(Date.now() + hours * 36e5).toISOString());
  return token;
}

// Looks up a live email token: { user_id, purpose, email, name, verified } or null. Does not use it up.
function peekEmailToken(token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null;
  const row = db.prepare(`
    SELECT t.user_id, t.purpose, u.email, u.name, u.email_verified_at
    FROM email_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ? AND t.expires_at > ?`).get(sha256(token), nowIso());
  return row ? { user_id: row.user_id, purpose: row.purpose, email: row.email, name: row.name, verified: !!row.email_verified_at } : null;
}

// Same as peek, but deletes every outstanding token for that user (any link already sent stops working).
function consumeEmailToken(token) {
  const info = peekEmailToken(token);
  if (info) db.prepare('DELETE FROM email_tokens WHERE user_id = ?').run(info.user_id);
  return info;
}

module.exports = {
  ALLOWED_DOMAIN, DUMMY_HASH, hashPassword, checkPassword, isAllowedEmail, publicUser,
  createSession, destroySession, loadUser, requireUser, requireStaff, createEmailToken, peekEmailToken, consumeEmailToken,
};

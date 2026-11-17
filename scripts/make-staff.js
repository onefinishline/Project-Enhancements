// Let a signed-up user verify projects (or take that away).
// The person must first create an account on the site's Sign in page.
// Usage: node scripts/make-staff.js <email>            grant staff
//        node scripts/make-staff.js <email> --remove   revoke staff
//        node scripts/make-staff.js --list             show current staff
const db = require('../src/db');

const args = process.argv.slice(2);
if (args[0] === '--list') {
  const rows = db.prepare('SELECT name, email FROM users WHERE is_staff = 1 ORDER BY name').all();
  console.log(rows.length ? rows.map((r) => `${r.name} <${r.email}>`).join('\n') : '(no staff yet)');
  process.exit(0);
}

const email = args[0];
const remove = args.includes('--remove');
if (!email) {
  console.error('Usage: node scripts/make-staff.js <email> [--remove] | --list');
  process.exit(1);
}
const user = db.prepare('SELECT id, name, email_verified_at FROM users WHERE email = ?').get(email.trim());
if (!user) {
  console.error(`[STAFF] No account for ${email}. Ask them to create one on the Sign in page first.`);
  process.exit(1);
}
if (!user.email_verified_at) console.warn(`[STAFF] Note: ${email} hasn't finished setting up their account yet.`);
db.prepare('UPDATE users SET is_staff = ? WHERE id = ?').run(remove ? 0 : 1, user.id);
console.log(`[STAFF] ${user.name} <${email}> ${remove ? 'can no longer' : 'can now'} verify projects.`);

// Let a signed-up user verify projects (or take that away).
// The person must first create an account on the site's Sign in page.
// Usage: npm run make-staff -- <email>            grant staff
//        npm run make-staff -- <email> --remove   revoke staff
//        npm run make-staff -- --list             show current staff
const db = require('../src/db');

async function main() {
  await db.init();
  const args = process.argv.slice(2);
  if (args[0] === '--list') {
    const rows = await db.query('SELECT name, email FROM users WHERE is_staff ORDER BY name');
    console.log(rows.length ? rows.map((r) => `${r.name} <${r.email}>`).join('\n') : '(no staff yet)');
    return 0;
  }

  const email = (args[0] || '').trim();
  const remove = args.includes('--remove');
  if (!email) {
    console.error('Usage: npm run make-staff -- <email> [--remove] | --list');
    return 1;
  }
  const user = await db.one('SELECT id, name, email_verified_at FROM users WHERE lower(email) = lower($1)', [email]);
  if (!user) {
    console.error(`[STAFF] No account for ${email}. Ask them to create one on the Sign in page first.`);
    return 1;
  }
  if (!user.email_verified_at) console.warn(`[STAFF] Note: ${email} hasn't finished setting up their account yet.`);
  await db.run('UPDATE users SET is_staff = $1 WHERE id = $2', [!remove, user.id]);
  console.log(`[STAFF] ${user.name} <${email}> ${remove ? 'can no longer' : 'can now'} verify projects.`);
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => { console.error('[STAFF]', err.message); process.exitCode = 1; })
  .finally(() => db.end());

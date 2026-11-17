# Project Enhancements

Collects enhancement proposals for current projects and connects them with teams who want to build them.

- **Backend:** Node.js + Express (`src/server.js`), PostgreSQL via `pg` (`src/db.js`; tables are created on start). Requires Node 22.13+ and PostgreSQL 13+.
- **Frontend:** React 18 + Vite + React Router (`client/`). Production build goes to `client/dist`, served by Express.

## Branding
Follows the SIL Brand Manual: SIL Blue / SIL Green / SIL Red palette (tokens at the top of `client/src/styles.css`),
Playfair (headings), Lora (prose), Source Sans 3 (subheads and interface), loaded from Google Fonts.
The page header copies the software.sil.org light header (logo + title bar, menu row, breadcrumbs, Noto Sans).
`client/public/sil-logo-glyph.png` is the official logo file used on software.sil.org; replace it only with
artwork from the Brand Help Desk (brandhelps.sil.org), and never redraw or recolor it.

## Pages
| Path | What it does |
|---|---|
| `/` | Home: purpose, reasons, how it works (edit copy in `client/src/pages/Home.jsx`) |
| `/submit` | Submission form (**sign-in required**): project name, larger project, short and full description, people/time, languages and libraries, whether more than one team can work on it (yes/no + explanation), security-sensitive (yes/no + what makes it so), copyright handling, promotional use of descriptions/screenshots, submitter name, email and phone (email and phone shown only to staff) |
| `/projects` | All submissions, with search and filter. **Verified** checkbox (staff only) and **Request to work on this project** checkbox, which opens the request form (team/org, participants, event dates or timeframe) |
| `/signin` | Sign in, **Create an account** (`?mode=register`) and **Forgot password** (`?mode=forgot`) |
| `/set-password` | Opened from the emailed link: choose a password (new account or reset) and get signed in |

Viewing the Projects page and requesting to work on a project need no account (outside teams may not have one).
Signed-in users get their name and email filled in on the Submit form, and their email plus name in the
request form (all still editable). Submitter and contact emails are shown only to staff.
Projects marked **security-sensitive** are hidden from the public: the server only sends them to signed-in users,
and signed-out visitors can't request to work on them.

## Accounts
- Anyone with an `@sil.org` address (set by `ALLOWED_EMAIL_DOMAIN`) can create an account. They give their name and
  email, get an emailed link, and choose their password on the page it opens, which proves they own the address.
  Links are single-use (48 hours for new accounts, 1 hour for resets). Setting a password signs the person out everywhere else.
- Registration and "forgot password" always give the same reply, so they can't be used to find out who has an account.
- **Staff** (who can tick *Verified*) are ordinary accounts with the staff flag:
  ```bash
  npm run make-staff -- someone@sil.org            # grant (they must have created an account first)
  npm run make-staff -- someone@sil.org --remove   # revoke
  npm run make-staff -- --list
  ```

## Security
- **SQL injection:** every query passes user input as a numbered parameter (`$1`, `$2`, ...), never as part of the SQL text.
- **Script injection (XSS):** React shows all stored text as text; nothing uses `dangerouslySetInnerHTML`.
  A Content-Security-Policy header also stops the browser running any script not served from this site.
- **Input rules** (`src/server.js`): every field is trimmed, length-limited and type-checked; invisible control
  characters are removed (and line breaks, except in the long description fields). Emails must be plain
  addresses, account names may only contain letters, spaces and `. , ' -`, and yes/no, choice, number and
  date fields only accept their allowed values.
- **Forged requests (CSRF):** data-changing requests must be JSON from this site's own origin, and the session
  cookie is `HttpOnly; SameSite=Strict` (plus `Secure` in production).
- **Other headers:** no framing (clickjacking), `nosniff`, HSTS in production. Errors never return stack traces.
- Passwords are hashed with scrypt; session and email-link tokens are stored only as SHA-256 hashes.
- Run `npm audit` and `npm --prefix client audit` before deploying.

## Run
Create an empty PostgreSQL database and a user that owns it, and put its address in `DATABASE_URL`. Then:
```bash
npm install
npm run build          # installs and builds the React client
npm start              # http://localhost:3100
```

### Moving data from the old SQLite version
The app used to keep its data in `data/enhancements.db` (SQLite). To copy all of it (accounts, staff, projects,
requests) into a new, empty PostgreSQL database, run once: `npm run import-sqlite`. It refuses to run if
PostgreSQL already has data, and never changes the SQLite file.

Development (hot reload): `npm run dev` (API on :3100) and `npm run dev:client` (Vite on :5173, proxies `/api`).

## Deploying
Production runs behind nginx with HTTPS (Let's Encrypt). Step-by-step guide, nginx config and systemd service:
[`deploy/DEPLOY.md`](deploy/DEPLOY.md).

## Config (`.env`, see `.env.example`)
`npm start` / `npm run dev` read `.env` automatically.
- `DATABASE_URL` (**required**): `postgres://USER:PASSWORD@HOST:5432/DATABASE`. Set `PGSSL=true` if the server requires TLS.
- `PORT` (default 3100), `ALLOWED_EMAIL_DOMAIN` (default `sil.org`).
- `APP_URL`: the site's public address, used in emailed links. **Required in production.**
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`: same meaning as in RecruitFlow.
  Without `SMTP_HOST`, account emails are printed to the server console (local testing only); in production,
  sign-up and reset are refused until email is configured.
- `NODE_ENV=production` adds `Secure` to the session cookie; run behind HTTPS.

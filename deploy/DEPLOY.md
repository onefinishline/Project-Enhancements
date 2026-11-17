# Deploying Project Enhancements (nginx + HTTPS)

```
Browser ──HTTPS:443──▶ nginx ──HTTP──▶ Node app (127.0.0.1:3100) ──▶ PostgreSQL
           (port 80 only redirects to HTTPS)
```

The Node app listens only on `127.0.0.1`, so nginx is the single public entry point. Port 3100 is never
opened to the network. Commands below are for Ubuntu/Debian; adjust package commands for other distributions.

Files in this folder:

| File | Goes to |
|---|---|
| `nginx/project-enhancements.conf` | `/etc/nginx/sites-available/project-enhancements.conf` |
| `project-enhancements.service` | `/etc/systemd/system/project-enhancements.service` |

Throughout, replace `enhancements.example.org` with the real domain.

## 0. Before you start
- A DNS `A` (and `AAAA` if the server has IPv6) record pointing the domain at this server.
- Ports **80 and 443** open to the internet (Let's Encrypt checks the domain over port 80). Keep 3100 closed.
- Packages: Node.js **22.13 or newer**, PostgreSQL **13 or newer**, nginx **1.18 or newer**, certbot with its nginx plugin.
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs postgresql nginx certbot python3-certbot-nginx git
  node --version   # must be v22.13 or newer
  ```

## 1. App user and code
```bash
sudo useradd --system --create-home --home-dir /opt/project-enhancements --shell /usr/sbin/nologin enhancements
sudo -u enhancements git clone https://github.com/onefinishline/Project-Enhancements.git /opt/project-enhancements
cd /opt/project-enhancements
sudo -u enhancements npm ci --omit=dev
sudo -u enhancements npm run build        # builds the web pages into client/dist
```

## 2. Database and settings
```bash
sudo -u postgres psql -c "CREATE ROLE enhancements LOGIN PASSWORD 'choose-a-long-random-password';"
sudo -u postgres psql -c "CREATE DATABASE project_enhancements OWNER enhancements;"

sudo -u enhancements cp .env.example .env
sudo chmod 600 .env
sudo -u enhancements nano .env
```
In `.env` set at least:
- `DATABASE_URL=postgres://enhancements:THE_PASSWORD@localhost:5432/project_enhancements`
- `APP_URL=https://enhancements.example.org` (used in emailed sign-up and reset links)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (account emails)

`NODE_ENV=production`, `HOST=127.0.0.1` and `PORT=3100` are set by the service file, so leave them out of `.env`.

**Existing data (optional):** to bring over the current projects and accounts, copy the old SQLite file to
`/opt/project-enhancements/data/enhancements.db` and run once: `sudo -u enhancements npm run import-sqlite`.
It only runs on an empty database.

## 3. Run the app as a service
```bash
sudo cp deploy/project-enhancements.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now project-enhancements
sudo systemctl status project-enhancements          # should say "active (running)"
curl -s http://127.0.0.1:3100/api/auth/me           # should print {"user":null,...}
```
Logs: `journalctl -u project-enhancements -f`

## 4. HTTPS certificate (Let's Encrypt)
Get the certificate **before** enabling the site, because the site config points at the certificate files.
`certonly` gets the certificate without changing any nginx files.
```bash
sudo certbot certonly --nginx -d enhancements.example.org
```
Certbot renews it automatically (a systemd timer) and reloads nginx afterwards. Check renewal works:
```bash
sudo certbot renew --dry-run
```

## 5. nginx
```bash
DOMAIN=enhancements.example.org
sudo cp deploy/nginx/project-enhancements.conf /etc/nginx/sites-available/
sudo sed -i "s/enhancements\.example\.org/$DOMAIN/g" /etc/nginx/sites-available/project-enhancements.conf
sudo ln -s /etc/nginx/sites-available/project-enhancements.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```
If a firewall is on: `sudo ufw allow 'Nginx Full'` (opens 80 and 443 only).

## 6. Check it
```bash
curl -I http://$DOMAIN            # 301 redirect to https://
curl -I https://$DOMAIN/projects  # 200, with Strict-Transport-Security and Content-Security-Policy headers
```
Then in a browser: open the Projects page signed out, create an account (the email must arrive with an
`https://` link), sign in and submit a test project. An outside check of the TLS setup:
https://www.ssllabs.com/ssltest/ (expect grade A).

Give someone staff rights (they must create an account first):
`cd /opt/project-enhancements && sudo -u enhancements npm run make-staff -- name@sil.org`

## Updating to a new version
```bash
cd /opt/project-enhancements
sudo -u enhancements git pull
sudo -u enhancements npm ci --omit=dev
sudo -u enhancements npm run build
sudo systemctl restart project-enhancements
```

## Backups
All data (accounts, projects, requests) is in the PostgreSQL database `project_enhancements`. Include it in
the server's regular database backups, for example a nightly
`pg_dump -Fc project_enhancements > project_enhancements-$(date +%F).dump`. The `.env` file holds passwords:
back it up somewhere private, never in Git.

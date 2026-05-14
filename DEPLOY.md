# Deploying the backend on Railway

The frontend already lives on GitHub Pages. This guide gets the backend running so users can sign in, edit live, and see each other's changes in real time.

## What you need

- A free Railway account at https://railway.app
- This repo on your GitHub (already done)
- 5 to 10 minutes

## Steps

### 1. Create a new Railway project

- Click **New Project** in Railway, pick **Deploy from GitHub repo**.
- Pick `sashaok123/BigDusty_INSIDE_ARG_Map`.

### 2. Set the service root to `/backend`

After the project is created, open the service settings:

- Settings → **Root Directory** → set to `/backend`.
- This tells Railway to look inside `backend/` for `requirements.txt`, `Procfile`, and `railway.toml`.

### 3. Add a Postgres database

- In the project, click **New** → **Database** → **Add PostgreSQL**.
- Railway will inject `DATABASE_URL` into the backend service automatically (no manual copy needed).

### 4. Set required env vars

Open the backend service → Variables, add:

- `JWT_SECRET` — generate one locally with:
  ```
  python -c "import secrets; print(secrets.token_urlsafe(48))"
  ```
  Paste the output.
- `INITIAL_ADMIN_USERNAME` — your choice, e.g. `admin` (default if you skip).
- `INITIAL_ADMIN_PASSWORD` — your choice, or leave blank to have a random one generated on first boot.

Optional:
- `ALLOWED_ORIGINS` — defaults to `https://sashaok123.github.io,http://localhost:8000`. Change if your frontend URL differs.

### 5. Deploy

Railway will deploy automatically once the service is configured. Watch the deploy log for this block on first boot:

```
==============================================================
INITIAL ADMIN CREATED.
  username: admin
  password: <some random string>
Change it immediately via POST /auth/change_password.
==============================================================
```

Save that password somewhere safe. If you set `INITIAL_ADMIN_PASSWORD` yourself, this block will not appear; use what you set.

### 6. Get the public URL

Service → Settings → **Networking** → **Generate Domain**. You will get something like:

```
https://bigdusty-inside-arg-map-production.up.railway.app
```

Copy it.

### 7. Point the frontend at the backend

Open `js/config.js` in the repo, replace the placeholder:

```javascript
export const API_BASE = window.__ARG_API_BASE__ || 'https://YOUR_RAILWAY_URL_HERE.up.railway.app';
```

with the URL Railway gave you. Commit and push. GitHub Pages will redeploy.

### 8. Sign in

Open the live site, press `Ctrl+Shift+L` (or click the small key icon in the bottom-right corner). Sign in with the admin credentials from step 5. The editor mode unlocks; the realtime status dot turns green.

### 9. Change your admin password

In the user chip dropdown (top-right), pick **Change password**. Enter the random one from logs, then your new one twice.

### 10. Add more users

Same dropdown → **Manage users** → **Add user**. Hand the new username + password to the people who should be able to edit. They sign in the same way you did.

## Local dev (optional)

If you want to run the backend on your machine instead of Railway:

```
cd backend
python -m venv .venv
.venv\Scripts\activate    # Windows
pip install -r requirements.txt
set DATABASE_URL=postgresql+asyncpg://localhost/argmap
set JWT_SECRET=local-dev-secret-at-least-32-chars-long
set INITIAL_ADMIN_PASSWORD=changeme
uvicorn app.main:app --reload --port 8000
```

Then in `index.html`, add this line right before the existing module script tag:

```html
<script>window.__ARG_API_BASE__ = 'http://localhost:8000';</script>
```

Reload, sign in. The realtime dot turns green when the WebSocket connects.

## Costs

Railway's free tier covers:
- 500 hours of execution per month
- 1 GB Postgres storage
- 100 GB egress

Plenty for community editing. If usage grows, switch to a paid plan.

## Backups

The canvas data lives in one Postgres row (`canvas` table, id=`main`, `data` jsonb). To export a snapshot:

```
curl https://<your-railway-url>/canvas/main > canvas_backup.json
```

To restore, sign in as admin and `PUT` the backup back.

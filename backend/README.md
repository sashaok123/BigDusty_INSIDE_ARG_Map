# INSIDE ARG Investigation Map API

FastAPI backend for the INSIDE ARG Investigation Map. Stores the canvas
document, authenticates users, and broadcasts mutations over WebSockets to
connected viewers.

## Stack

- Python 3.11
- FastAPI + uvicorn
- SQLAlchemy 2 async + asyncpg (sqlite+aiosqlite for tests)
- Alembic migrations
- Pydantic v2 + pydantic-settings
- passlib[bcrypt], python-jose[cryptography] for auth

## Layout

```
backend/
  app/
    main.py        FastAPI factory + lifespan
    config.py      env-driven Settings
    database.py    async engine + session factory
    models.py      SQLAlchemy ORM
    schemas.py     Pydantic request/response models
    security.py    bcrypt hashing + JWT helpers
    deps.py        get_db, get_current_user, require_admin
    seed.py        initial admin + canvas seed
    ws.py          in-memory WebSocket broadcaster
    routers/
      auth.py
      admin.py
      canvas.py
  alembic/         migrations
  alembic.ini
  Procfile
  railway.toml
  requirements.txt
  tests/test_smoke.py
```

## Local development

1. Install Postgres 14+ and create a database, OR plan to run the test
   suite which uses sqlite-in-memory and needs no database server.
2. From `backend/`:
   ```
   pip install -r requirements.txt
   copy .env.example .env       # Windows
   # or
   cp .env.example .env         # POSIX
   ```
3. Edit `.env` and set `DATABASE_URL` and `JWT_SECRET`. Generate a JWT
   secret with:
   ```
   python -c "import secrets; print(secrets.token_urlsafe(48))"
   ```
4. Apply migrations:
   ```
   alembic upgrade head
   ```
5. Run the server:
   ```
   uvicorn app.main:app --reload
   ```
6. First boot creates an admin user. Look in the server log for the
   block beginning `INITIAL ADMIN CREATED`.

Tests:
```
pytest tests/test_smoke.py
```
The test suite uses sqlite+aiosqlite in-memory and does not need
Postgres.

## Required environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | - | `postgres://`, `postgresql://`, or `postgresql+asyncpg://` all accepted; the first two are rewritten. |
| `JWT_SECRET` | yes | - | 32+ chars. |
| `JWT_ACCESS_TTL_MIN` | no | 30 | Access token lifetime in minutes. |
| `JWT_REFRESH_TTL_DAYS` | no | 7 | Refresh token lifetime in days. |
| `INITIAL_ADMIN_USERNAME` | no | `admin` | Username for first-boot admin. |
| `INITIAL_ADMIN_PASSWORD` | no | auto-gen | If unset, a 24-char token_urlsafe is generated and printed to the log. |
| `ALLOWED_ORIGINS` | no | `https://sashaok123.github.io,http://localhost:8000` | Comma-separated CORS origins. |
| `CANVAS_SEED_PATH` | no | `../data/canvas.canvas` | Path to the JSON canvas seed; resolved relative to `backend/`. |
| `ENV` | no | `production` | `development` auto-creates tables without alembic. |

## Deploying to Railway

1. Create a new Railway project and connect it to the GitHub repo
   `sashaok123/BigDusty_INSIDE_ARG_Map`.
2. When adding a service from the repo, set the root directory to
   `/backend` so the deploy uses `Procfile`, `requirements.txt`, and
   `railway.toml` from this subdirectory.
3. Click "Add plugin" and choose Postgres. Railway will inject
   `DATABASE_URL` automatically.
4. Set the rest of the environment variables in the Railway dashboard:
   - `JWT_SECRET` (generate one locally with
     `python -c "import secrets; print(secrets.token_urlsafe(48))"`)
   - `INITIAL_ADMIN_USERNAME` (defaults to `admin` if omitted)
   - `INITIAL_ADMIN_PASSWORD` (leave blank to auto-generate; the
     generated value will appear in the Railway deploy log)
   - `ALLOWED_ORIGINS` (only needed if your frontend lives somewhere
     other than `https://sashaok123.github.io`)
5. Deploy. The `release` step in `Procfile` runs `alembic upgrade head`
   before the web process starts. On first boot the seed routine reads
   `../data/canvas.canvas` (the same file the static frontend ships
   with) and writes it to the database; subsequent boots leave it
   alone.
6. After the first deploy succeeds, generate a public URL from the
   Railway service settings and copy it.
7. In the frontend repo, point `js/api-client.js` at that URL.

## API surface

Auth:
- `POST /auth/login` body `{username, password}` returns
  `{access_token, refresh_token, user}`
- `POST /auth/refresh` body `{refresh_token}` returns `{access_token}`
- `POST /auth/logout` body `{refresh_token}` revokes the refresh JTI
- `POST /auth/change_password` body `{old_password, new_password}`
- `GET /auth/me` returns the current user

Admin (requires `is_admin`):
- `GET /admin/users`
- `POST /admin/users` body `{username, password, is_admin?}`
- `DELETE /admin/users/{id}` (cannot delete yourself)
- `POST /admin/users/{id}/reset_password` body `{new_password}`
- `PATCH /admin/users/{id}` body `{is_admin?}`

Canvas:
- `GET /canvas/{canvas_id}` returns `{revision, data}` (no auth)
- `GET /canvas/{canvas_id}/revision` returns `{revision}` (no auth)
- `PUT /canvas/{canvas_id}` body `{data, expected_revision}`; 409 on
  revision mismatch.
- `POST /canvas/{canvas_id}/nodes` body is a full node object
- `PATCH /canvas/{canvas_id}/nodes/{node_id}` body is a partial node
- `DELETE /canvas/{canvas_id}/nodes/{node_id}` cascades to edges
- Same three verbs at `/canvas/{canvas_id}/edges`

WebSocket:
- `WS /ws/canvas/{canvas_id}?token=<optional access token>`
- On connect: `{"type":"hello","revision":N}`
- On every mutation:
  `{"type":"revision","revision":N,"change":{...},"by":"<username>"}`

Health:
- `GET /health` returns `{"status":"ok"}`. Used by the Railway
  healthcheck.

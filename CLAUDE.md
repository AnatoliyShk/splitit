# Splitit

Splitit helps people go to occasions together and find community and friends. Users discover occasions, join others who are going, and meet new people around shared interests. Shared costs for an occasion (tickets, travel, food) can be split within the group.

## Stack

- **Backend:** Django 6 + Django REST Framework, Python 3.12, dependencies managed with uv (`backend/pyproject.toml`, `backend/uv.lock`)
- **Frontend:** React 19 + TypeScript + Vite, Yarn 4, linted with oxlint
- **Database:** PostgreSQL 17 with pgvector (`pgvector/pgvector:pg17` image); `occasions` and `tags` have 768-dim `embedding` columns with HNSW cosine indexes
- **Cache:** Redis 7 (Django's `CACHES` default backend)
- **Background tasks:** Django 6 `django.tasks`, queued in Postgres by `django-tasks-db` and run by the `worker` service
- **Embeddings:** Google Gemini (`gemini-embedding-001`, shortened to 768 dims) via `google-genai`
- **Local dev:** Docker Compose runs all five services

## Layout

```
backend/            Django project
  config/           settings, root urls, wsgi/asgi
  apps/api/         REST API app (urls mounted at /api/)
  apps/users/       custom User (email login, public UUIDv7 `uuid`) + session auth API at /api/auth/; user_from_url() guards /api/users/<uuid>/ routes
  apps/occasions/   Occasion model (many-to-many with users, directory is `apps/occasions` with app label `occasions`); GET /api/users/<uuid>/occasions/, GET /api/occasions/explore/, POST /api/occasions/<id>/join/
  apps/tags/        Tag model (many-to-many with occasions: tag.occasions / occasion.tags)
  apps/panel/       staff-only admin API at /api/panel/ (stats, users, occasions)
  apps/ai/          Gemini embedding client; saving a tag/occasion queues a task that fills its embedding
  apps/connections/ Connection between users who shared occasions (strength += 1/(attendees-1) per occasion, counted after it ends by a worker task); GET /api/users/<uuid>/connections/ and .../connections/graph/ (network for the profile graph); `manage.py apply_connections [--rebuild]`
frontend/           Vite React app
  src/App.tsx       layout (header, footer) and routes
  src/pages/        Home (landing), Login, Register, Profile, Settings (name/password, linked from Profile), Explore (accept/decline upcoming occasions)
  src/pages/panel/  admin control panel at /admin (staff only)
  src/components/   shared UI (form fields, auth card)
  src/api.ts        fetch helpers with CSRF handling
  src/auth.ts       useAuth() hook; state lives in AuthProvider.tsx
  src/index.css     design tokens (colors, borders, shadows, fonts)
  src/App.css       component styles
docker-compose.yml  db, redis, backend, worker, frontend
.env.example        copy to .env; all config and host ports live here
.claude/skills/     team Claude Code skills (ui-ux-pro-max)
```

## Running locally

```bash
cp .env.example .env         # first time only
docker compose up -d --build
```

- Frontend: http://localhost:5173 (Vite proxies `/api` to the backend)
- Backend: http://localhost:5000 (`/django-admin/`, `/api/health/`)
- Postgres and Redis are bound to 127.0.0.1 on the ports in `.env`

If a host port is taken, change the matching `*_HOST_PORT` in `.env`.

## Common commands

```bash
docker compose exec backend python manage.py makemigrations
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py createsuperuser
docker compose exec backend python manage.py test
docker compose exec backend python manage.py embed_missing   # embed rows with no vector yet
docker compose logs -f worker                                 # background task output

cd frontend && yarn build    # type-check and build
cd frontend && yarn lint
```

Add backend dependencies with `uv add <pkg>` in `backend/`, then rebuild the backend image. Add frontend dependencies with `yarn add <pkg>` in `frontend/`, then rebuild the frontend image.

## Configuration

Django settings read from environment variables (`DJANGO_SECRET_KEY`, `DJANGO_DEBUG`, `DJANGO_ALLOWED_HOSTS`, `POSTGRES_*`, `REDIS_URL`, `GEMINI_API_KEY`, `EMBEDDING_MODEL`) with local-dev defaults. Without `GEMINI_API_KEY`, nothing is embedded; run `embed_missing` after adding one. Never commit `.env`.

## Design system: Soft Brutalism

Thick ink borders, hard offset shadows, flat pastel fills, rounded corners, bold type (Bricolage Grotesque for headings, DM Sans for body). All tokens are in `frontend/src/index.css`; use them instead of raw values.

Color rules are strict:

- `--primary` (yellow) and `--secondary` (lilac) are the **only** colors for decorating elements.
- `--danger` (red) is **only** for terminal actions: exit, log out, delete (`.btn-danger`).
- `--confirm` (green) is **only** for apply and confirm actions (`.btn-confirm`).
- Never use danger or confirm colors for decoration or status. Status indicators stay neutral.

Every page must support dark mode, visible keyboard focus, `prefers-reduced-motion`, 44px minimum tap targets, and 4.5:1 text contrast.

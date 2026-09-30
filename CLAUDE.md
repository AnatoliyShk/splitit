# Splitit

Splitit helps people go to events together and find community and friends. Users discover events, join others who are going, and meet new people around shared interests. Shared costs for an event (tickets, travel, food) can be split within the group.

## Stack

- **Backend:** Django 6 + Django REST Framework, Python 3.12, dependencies managed with uv (`backend/pyproject.toml`, `backend/uv.lock`)
- **Frontend:** React 19 + TypeScript + Vite, Yarn 4, linted with oxlint
- **Database:** PostgreSQL 17
- **Cache:** Redis 7 (Django's `CACHES` default backend)
- **Local dev:** Docker Compose runs all four services

## Layout

```
backend/            Django project
  config/           settings, root urls, wsgi/asgi
  api/              REST API app (urls mounted at /api/)
frontend/           Vite React app
  src/App.tsx       landing page
  src/index.css     design tokens (colors, borders, shadows, fonts)
  src/App.css       component styles
docker-compose.yml  db, redis, backend, frontend
.env.example        copy to .env; all config and host ports live here
.claude/skills/     team Claude Code skills (ui-ux-pro-max)
```

## Running locally

```bash
cp .env.example .env         # first time only
docker compose up -d --build
```

- Frontend: http://localhost:5173 (Vite proxies `/api` to the backend)
- Backend: http://localhost:5000 (`/admin/`, `/api/health/`)
- Postgres and Redis are bound to 127.0.0.1 on the ports in `.env`

If a host port is taken, change the matching `*_HOST_PORT` in `.env`.

## Common commands

```bash
docker compose exec backend python manage.py makemigrations
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py createsuperuser
docker compose exec backend python manage.py test

cd frontend && yarn build    # type-check and build
cd frontend && yarn lint
```

Add backend dependencies with `uv add <pkg>` in `backend/`, then rebuild the backend image. Add frontend dependencies with `yarn add <pkg>` in `frontend/`, then rebuild the frontend image.

## Configuration

Django settings read from environment variables (`DJANGO_SECRET_KEY`, `DJANGO_DEBUG`, `DJANGO_ALLOWED_HOSTS`, `POSTGRES_*`, `REDIS_URL`) with local-dev defaults. Never commit `.env`.

## Design system: Soft Brutalism

Thick ink borders, hard offset shadows, flat pastel fills, rounded corners, bold type (Bricolage Grotesque for headings, DM Sans for body). All tokens are in `frontend/src/index.css`; use them instead of raw values.

Color rules are strict:

- `--primary` (yellow) and `--secondary` (lilac) are the **only** colors for decorating elements.
- `--danger` (red) is **only** for terminal actions: exit, log out, delete (`.btn-danger`).
- `--confirm` (green) is **only** for apply and confirm actions (`.btn-confirm`).
- Never use danger or confirm colors for decoration or status. Status indicators stay neutral.

Every page must support dark mode, visible keyboard focus, `prefers-reduced-motion`, 44px minimum tap targets, and 4.5:1 text contrast.

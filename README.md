# Splitit

Splitit helps people go to occasions together and find community and friends. You discover occasions, join others who are going, and meet new people around shared interests. Costs for an occasion, such as tickets, travel and food, can be split within the group.

## Features

- **Explore.** A deck of upcoming occasions that you accept or decline. Each card shows the date, the times, a short description, tags, and the gender mix of the people going. You can save filters by tag and weekday and switch them on or off.
- **One occasion at a time.** You go to one occasion at a time. Until it ends or is cancelled, Explore shows that occasion instead of the deck.
- **Add an occasion from a link.** Paste the link to an event page on your profile. Gemini reads the name, dates, description and tags from the page. Splitit then creates the occasion with a generated preview picture and signs you up for it.
- **Templates.** Staff prepare reusable occasions that have no date. Users pick one and choose a start time to create their own occasion from it.
- **Private occasions.** Occasions made by staff are public. An occasion made by a regular user is visible only to its creator, the people directly connected to them, and its attendees. The creator can cancel it.
- **Connections.** When an occasion ends, everyone who went to it becomes connected, and those connections grow stronger with each occasion they share. Your profile shows your connections as an interactive graph.
- **Embeddings.** Occasions and tags are embedded with Gemini and stored in pgvector, ready for similarity search.
- **Adults only.** Sign-up requires confirming that you are 18 or older.
- **Admin panel** at `/admin`, for staff only. It covers stats, users, occasions (with images), templates and tags, and has generators for test data.

## Stack

| Layer | Tech |
|---|---|
| Backend | Django 6, Django REST Framework, drf-spectacular (OpenAPI), Python 3.12, uv |
| Frontend | React 19, TypeScript, Vite, TanStack Query, React Router, Sigma.js (graph), Yarn 4, oxlint |
| Database | PostgreSQL 17 with pgvector (768-dim vectors, HNSW cosine indexes) |
| Cache | Redis 7 |
| Background tasks | Django `django.tasks` queued in Postgres by `django-tasks-db`, run by a `worker` service |
| AI | Google Gemini: `gemini-embedding-001` for embeddings, `gemini-2.5-flash` for reading event pages |
| E2E tests | Playwright |

## Getting started

You need Docker with Compose.

```bash
cp .env.example .env         # first time only; set GEMINI_API_KEY to enable AI features
docker compose up -d --build
docker compose exec backend python manage.py createsuperuser
```

| Service | URL |
|---|---|
| App | http://localhost:5173 |
| API | http://localhost:5000/api/ (health check: `/api/health/`) |
| API docs | http://localhost:5000/api/docs/ (the admin API has its own docs at `/api/admin/docs/`) |
| Django admin | http://localhost:5000/django-admin/ |

Compose runs five services: `db`, `redis`, `backend`, `worker` and `frontend`. The backend applies migrations when it starts. Vite proxies `/api` and `/media` to the backend, so the app only needs port 5173. Postgres and Redis are bound to 127.0.0.1.

If a host port is already taken, change the matching `*_HOST_PORT` value in `.env`.

### Configuration

All settings are read from `.env`. See `.env.example` for the full list.

| Variable | Purpose |
|---|---|
| `DJANGO_SECRET_KEY`, `DJANGO_DEBUG`, `DJANGO_ALLOWED_HOSTS` | Django basics |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Database credentials |
| `GEMINI_API_KEY` | Enables embeddings and adding occasions from links. Leave it empty to turn both off. |
| `EMBEDDING_MODEL`, `GEMINI_MODEL` | Optional overrides for the Gemini models |
| `*_HOST_PORT` | Host ports for Postgres, Redis, the backend and the frontend |

If you add a Gemini key later, fill in the missing vectors with `manage.py embed_missing`.

## Development

```bash
# Backend
docker compose exec backend python manage.py test
docker compose exec backend python manage.py makemigrations
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py spectacular --validate --fail-on-warn --file /tmp/schema.yml
docker compose logs -f worker

# Frontend
cd frontend && yarn build      # type-check and build
cd frontend && yarn lint
cd frontend && yarn test:e2e   # Playwright, against the running app on :5173
```

The maintenance commands are:
- `embed_missing` embeds rows that have no vector yet.
- `deactivate_finished` frees the attendees of occasions that have ended or been cancelled. The worker normally does this on its own.
- `apply_connections [--rebuild]` counts connections from finished occasions.

To add a dependency, run `uv add <pkg>` in `backend/` or `yarn add <pkg>` in `frontend/`, then rebuild that image with `docker compose up -d --build -V`.

## Project layout

```
backend/
  config/            settings, root URLs, schema hooks
  apps/api/          API root (/api/)
  apps/users/        custom user (email login), session auth, 18+ check, saved Explore filters
  apps/occasions/    occasions, images, templates, explore, join/cancel, import from a link
  apps/tags/         tags
  apps/connections/  connections between people who shared occasions
  apps/ai/           Gemini embedding client and tasks
  apps/panel/        staff-only admin API (/api/admin/)
frontend/
  src/pages/         app pages; src/pages/panel/ is the admin panel
  src/components/    shared UI (OccasionCard, Modal, Switch, RollOut, ...)
  src/types/         API response shapes and component props
  src/queryClient.ts TanStack Query client and query keys
  e2e/               Playwright specs
docker-compose.yml   db, redis, backend, worker, frontend
```

## Conventions

- Write every database query with the Django ORM, not raw SQL. Schema changes go through migrations.
- On the frontend, fetch server data with TanStack Query (`useQuery`/`useMutation`), not `useEffect`.
- Name variables after what they hold, for example `active_occasion` and `upcoming_occasions`.
- The design system is Soft Brutalism: thick ink borders, hard offset shadows and pastel fills. Use the tokens in `frontend/src/index.css`. Every page supports dark mode, keyboard focus and reduced motion.

[CLAUDE.md](CLAUDE.md) has the detailed reference for the API, the models and the design rules.

Never commit `.env`.

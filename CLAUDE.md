# Splitit

Splitit helps people go to occasions together and find community and friends. Users discover occasions, join others who are going, and meet new people around shared interests. Shared costs for an occasion (tickets, travel, food) can be split within the group.

## Stack

- **Backend:** Django 6 + Django REST Framework, Python 3.12, dependencies managed with uv (`backend/pyproject.toml`, `backend/uv.lock`); OpenAPI docs by drf-spectacular
- **Frontend:** React 19 + TypeScript + Vite, Yarn 4, linted with oxlint; server data fetched with TanStack Query (`src/queryClient.ts`)
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
                    FilterPreference (one per user, table `filter_preferences`): saved Explore filters, normalized to 5NF; one table per filter kind: tags (`filter_preference_tags`) and ISO weekdays 1-7 (`filter_preference_weekdays`). No JSON columns for filters. GET/PUT /api/users/<uuid>/filter-preference/ reads and replaces them; Explore lists only occasions with any saved tag that start on a saved weekday (UTC)
  apps/occasions/   Occasion model (many-to-many with users through OccasionUser, table `occasion_users`, app label `occasions`); GET /api/users/<uuid>/occasions/, GET /api/occasions/explore/, GET /api/occasions/<id>/, POST /api/occasions/<id>/join/
                    OccasionImage (table `occasion_images`): `order` 0 is the main image (cards, lists), 1-3 the gallery on the occasion page; uploaded in the panel via POST/DELETE /api/admin/occasions/<id>/images/[<order>/]; files live in MEDIA_ROOT (backend/media, git-ignored) and are removed with their row
                    One occasion at a time: OccasionUser.is_active stays on until the occasion ends or is cancelled (panel Cancel sets `cancelled_at`); join returns 409 while another is active, and explore returns `active_occasion` instead of the deck. A worker task flips is_active off when an occasion ends; `manage.py deactivate_finished` sweeps manually
  apps/tags/        Tag model (many-to-many with occasions: tag.occasions / occasion.tags); GET /api/tags/ lists every tag (for Explore filters)
  apps/panel/       staff-only admin API at /api/admin/ (stats, users, occasions)
  apps/ai/          Gemini embedding client; saving a tag/occasion queues a task that fills its embedding
  apps/connections/ Connection between users who shared occasions (strength += 1/(attendees-1) per occasion, counted after it ends by a worker task); GET /api/users/<uuid>/connections/ and .../connections/graph/ (network for the profile graph); `manage.py apply_connections [--rebuild]`
frontend/           Vite React app
  src/App.tsx       layout (header, footer) and routes
  src/pages/        Home (landing), Login, Register, Profile, Settings (name/password, linked from Profile), Explore (accept/decline upcoming occasions; the ExploreFilters panel saves tag and weekday filters), OccasionPage (/occasions/:id, main image + gallery; Explore cards and Profile rows link to it)
  src/pages/panel/  admin control panel at /admin (staff only)
  src/components/   shared UI (form fields, auth card, OccasionCard for Explore, TagList of tag names)
  src/api.ts        fetch helpers with CSRF handling; useFieldErrors() turns query/mutation errors into form errors
  src/queryClient.ts  TanStack QueryClient (retry policy) and `queryKeys`, every query key in one place
  src/types/        API response types shared across pages, one file per backend app (users, occasions, tags, connections); types used by one file stay in it, panel-only types in pages/panel/shared.ts
  src/auth.ts       useAuth() hook; state lives in AuthProvider.tsx
  src/filterPreference.ts  useFilterPreference(): the user's saved Explore filters
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

- Frontend: http://localhost:5173 (Vite proxies `/api` and `/media` to the backend)
- Backend: http://localhost:5000 (`/django-admin/`, `/api/health/`)
- API docs: http://localhost:5000/api/docs/ (Swagger UI) and `/api/schema/` (OpenAPI), without the admin API; open to anyone while `DJANGO_DEBUG=1`, staff only otherwise. The admin API has its own staff-only docs at `/api/admin/docs/` and `/api/admin/schema/` (split by the hooks in `config/schema.py`). Plain `APIView`s need `@extend_schema(request=..., responses=...)` to show their bodies; check with `manage.py spectacular --validate --fail-on-warn --file /tmp/schema.yml`
- Postgres and Redis are bound to 127.0.0.1 on the ports in `.env`

If a host port is taken, change the matching `*_HOST_PORT` in `.env`.

## Common commands

```bash
docker compose exec backend python manage.py makemigrations
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py createsuperuser
docker compose exec backend python manage.py test
docker compose exec backend python manage.py embed_missing   # embed rows with no vector yet
docker compose exec backend python manage.py deactivate_finished  # free attendees of ended/cancelled occasions
docker compose logs -f worker                                 # background task output

cd frontend && yarn build    # type-check and build
cd frontend && yarn lint
```

Add backend dependencies with `uv add <pkg>` in `backend/`, then rebuild the backend image. Add frontend dependencies with `yarn add <pkg>` in `frontend/`, then rebuild the frontend image.

## Configuration

Django settings read from environment variables (`DJANGO_SECRET_KEY`, `DJANGO_DEBUG`, `DJANGO_ALLOWED_HOSTS`, `POSTGRES_*`, `REDIS_URL`, `GEMINI_API_KEY`, `EMBEDDING_MODEL`) with local-dev defaults. Without `GEMINI_API_KEY`, nothing is embedded; run `embed_missing` after adding one. Never commit `.env`.

## Database queries

Write every query with the Django ORM: QuerySets, `F`/`Q` expressions, `annotate`/`aggregate`, `Subquery`/`Exists`, `bulk_create`/`bulk_update`, `update()`/`delete()`. Don't write raw SQL strings: no `cursor.execute()`, `.raw()`, `.extra()` or `RawSQL`.

- An upsert that adds to existing values: `bulk_create(..., ignore_conflicts=True)` for missing rows, then one `update()` with `F()` expressions (see `apps/connections/services.py`).
- Schema changes go through migrations made by `makemigrations`. Use Django or pgvector operations (e.g. `VectorExtension`, `SeparateDatabaseAndState`) instead of `RunSQL`.
- If a query really can't be written with the ORM, ask first. Keep it in one function and pass values as query parameters, never by string formatting.

## Frontend data

Fetch server data with TanStack Query, never `useEffect` + `useState`:

- Reads use `useQuery` with a key from `queryKeys` in `src/queryClient.ts`; add new keys there. Paged lists pass `placeholderData: keepPreviousData`.
- Writes use `useMutation`. Update the cache in `onSuccess` (`setQueryData` for a returned row, `invalidateQueries` with a key prefix to refetch lists).
- Show errors with `useFieldErrors(mutation.error, query.error)`; it returns the first error as stable `FieldErrors`.
- Data goes stale right away, so a page refetches when it mounts. Logging out clears every cached query except the session.

## Naming

Name variables after what they hold, as concretely as you can. When a variable holds an instance of a class or a typed object, put that class or type name in it: `active_occasion` rather than `active`, `other_occasion` rather than `other`, `tag` or `selected_tag` rather than `item`. The same goes for lists and QuerySets (`upcoming_occasions`, `attendee_ids`). Follow each language's case style: snake_case in Python (`active_occasion`), camelCase in TypeScript (`activeOccasion`).

## Design system: Soft Brutalism

Thick ink borders, hard offset shadows, flat pastel fills, rounded corners, bold type (Bricolage Grotesque for headings, DM Sans for body). All tokens are in `frontend/src/index.css`; use them instead of raw values.

Color rules are strict:

- `--primary` (yellow) and `--secondary` (lilac) are the **only** colors for decorating elements.
- `--danger` (red) is **only** for terminal actions: exit, log out, delete, and Decline on Explore (`.btn-danger`).
- `--confirm` (green) is **only** for apply and confirm actions (`.btn-confirm`).
- Never use danger or confirm colors for decoration or status. Status indicators stay neutral.

Every page must support dark mode, visible keyboard focus, `prefers-reduced-motion`, 44px minimum tap targets, and 4.5:1 text contrast.

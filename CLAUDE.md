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
  apps/users/       custom User (email login, public UUIDv7 `uuid`; `gender`: man, woman or undisclosed ("Do not want to tell", the default), changed with PATCH /api/auth/me/) + session auth API at /api/auth/; user_from_url() guards /api/users/<uuid>/ routes
                    Adults only (18+): sign-up requires `is_adult: true` (an unticked checkbox) and records `adult_confirmed_at`; an account without it (made before sign-up asked) gets 403 `age_confirmation_required` from every /api/ path except /api/auth/ and /api/health/ (`AdultConfirmationMiddleware`) until it answers POST /api/auth/age/ {"is_adult"}: true records it, false deletes the account and logs out
                    FilterPreference (one per user, table `filter_preferences`): saved Explore filters, normalized to 5NF; one table per filter kind: tags (`filter_preference_tags`) and ISO weekdays 1-7 (`filter_preference_weekdays`). No JSON columns for filters. `is_enabled` turns the preset off without deleting it. GET/PUT/PATCH /api/users/<uuid>/filter-preference/ reads, replaces or partly changes them; while enabled, Explore lists only occasions with any saved tag that start on a saved weekday (UTC)
  apps/occasions/   Occasion model (many-to-many with users through OccasionUser, table `occasion_users`, app label `occasions`); GET /api/users/<uuid>/occasions/, POST /api/occasions/import/ (the only way a regular user adds an occasion, which they then go to: `importing.py` sends the link inside a prompt to Gemini (`GEMINI_MODEL`, URL context and Google Search tools; search is dropped and the call retried when the plan has no quota for it), a `start_at` (or `at`) query parameter in the link, if it holds a date, is used as the start and Gemini is told not to look for it; parses the JSON reply, upserts its 1-2 tags ignoring case, then creates the occasion with a link-preview card as main image: `preview.py` builds a 1200x630 SVG from the title, description and link domain, themed by the reply's `icon` (sakura, star or wave), with every text escaped; throttled to 10/hour), GET /api/occasions/explore/, GET /api/occasions/<id>/, POST /api/occasions/<id>/join/, POST /api/occasions/<id>/cancel/ (only the creator, while it's still ahead or running; frees its attendees; the detail response has `is_mine`)
                    OccasionImage (table `occasion_images`): `order` 0 is the main image (cards, lists), 1-3 the gallery on the occasion page; uploaded in the panel via POST/DELETE /api/admin/occasions/<id>/images/[<order>/]; files live in MEDIA_ROOT (backend/media, git-ignored) and are removed with their row
                    `description`: plain text up to 2000 characters, optional; Explore cards show the first 100 characters beside the date badge, under the times, and the rest under Show details; it's part of the occasion's embedding text. Panel test occasions get placeholder text
                    Visibility (OccasionQuerySet.visible_to, used by explore, detail and join): `created_by` null or staff = public; made by a regular user = only the creator, people directly connected to them (a Connection row, not friends of friends) and attendees. Cards show `created_by` (name) only for regular users' occasions
                    One occasion at a time: OccasionUser.is_active stays on until the occasion ends or is cancelled (panel Cancel sets `cancelled_at`); join returns 409 while another is active, and explore returns `active_occasion` instead of the deck. A worker task flips is_active off when an occasion ends; `manage.py deactivate_finished` sweeps manually
                    OccasionTemplate (table `occasion_templates`, tags in `occasion_template_tags`): a reusable occasion without a date (name, description, `duration_minutes` or null for no fixed end, tags, images), made by staff in the panel at /api/admin/templates/ (images through .../templates/<id>/images/[<order>/], like an occasion's); OccasionTemplateImage (table `occasion_template_images`, files in MEDIA_ROOT under occasion_templates/) has the same slots as OccasionImage and each occasion made from a template gets its own copy of every image; GET /api/occasion-templates/ lists them for users, POST /api/occasion-templates/<id>/occasions/ {start_datetime} makes an occasion from one the way a regular user does (they go to it; 409 while going to another)
  apps/tags/        Tag model (many-to-many with occasions: tag.occasions / occasion.tags); GET /api/tags/ lists every tag (for Explore filters)
  apps/panel/       staff-only admin API at /api/admin/ (stats, users, occasions, templates, tags; POST users/test/ and occasions/test/ make test data)
  apps/ai/          Gemini embedding client; saving a tag/occasion queues a task that fills its embedding
  apps/connections/ Connection between users who shared occasions (strength += 1/(attendees-1) per occasion, counted after it ends by a worker task); GET /api/users/<uuid>/connections/ and .../connections/graph/ (network for the profile graph); `manage.py apply_connections [--rebuild]`
frontend/           Vite React app
  src/App.tsx       layout (header, footer) and routes
  src/pages/        AdultsOnly (/adults-only, the public 18+ rules, linked from sign-up and the footer), AgeConfirmation (shown instead of every page to an account with no 18+ declaration), Home (landing: blocks leading to Explore and to adding an occasion from a link on Profile), Login, Register, Profile (also lists the occasion templates, each with a Create button that asks for a start and makes the occasion), Settings (name/password, linked from Profile), Explore (accept/decline upcoming occasions; the Filters button opens a modal (ExploreFilters) that saves tag and weekday filters), OccasionPage (/occasions/:id, main image + gallery; Explore cards and Profile rows link to it)
  src/pages/panel/  admin control panel at /admin (staff only); Templates and TemplateForm (/admin/templates[/new|/:id]) are the occasion form without dates and people (images and tags included)
  src/components/   shared UI (form fields, CheckboxField for a statement the user ticks, auth card, OccasionCard for Explore, TagList of tag names, RollOut: a toggle that rolls content open, used by the Explore card; GenderBar: a line split into blue/gray/pink by attendees' gender with male and female icons whose hover shows the numbers, used by the Explore card (explore returns `gender_counts`); Modal: a dialog on native <dialog>, used by the Explore filters; InfoTip: an info icon with a tooltip, used by the Explore title for the one-occasion rule; Switch: an on/off toggle (role="switch") with an elastic thumb, used to turn the Explore filters on and off; RowMenu: a gear button that springs a table row's action buttons out, used by every admin panel table; use these for any new collapsible section, modal, tooltip, toggle or row actions)
  src/api.ts        fetch helpers with CSRF handling; useFieldErrors() turns query/mutation errors into form errors
  src/queryClient.ts  TanStack QueryClient (retry policy) and `queryKeys`, every query key in one place
  src/types/api/    backend response shapes, one file per API area (users, occasions, tags, connections, admin, pagination); each mirrors a serializer
  src/types/ui/     component props and UI state, one file per component (rollOut, tagList, field, ...); small helper types used inside one file stay in it
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

Django settings read from environment variables (`DJANGO_SECRET_KEY`, `DJANGO_DEBUG`, `DJANGO_ALLOWED_HOSTS`, `POSTGRES_*`, `REDIS_URL`, `GEMINI_API_KEY`, `EMBEDDING_MODEL`, `GEMINI_MODEL`) with local-dev defaults. Without `GEMINI_API_KEY`, nothing is embedded and adding occasions from links is off; run `embed_missing` after adding one. Never commit `.env`.

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
- Any indication of a chosen element (checked filter, current page, open toggle, selected option) uses `--secondary` (lilac), never `--primary`.
- `--danger` (red) is **only** for terminal actions: exit, log out, delete, and Decline on Explore (`.btn-danger`).
- `--confirm` (green) is **only** for apply and confirm actions (`.btn-confirm`).
- Never use danger or confirm colors for decoration or status. Status indicators stay neutral.
- The one exception to the two decorating colors is data that is itself a color key: the gender line on Explore cards (`GenderBar`) uses `--gender-man` (blue), `--gender-woman` (pink) and `--gender-undisclosed` (gray). Don't use them for anything else.

Every page must support dark mode, visible keyboard focus, `prefers-reduced-motion`, 44px minimum tap targets, and 4.5:1 text contrast.

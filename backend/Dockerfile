FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.20 /uv /uvx /bin/

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

WORKDIR /app

# Install dependencies first for better layer caching. No BuildKit cache mount: Railway only accepts one
# whose id names a single service, and backend and worker build from this same file
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-cache

COPY . .

EXPOSE 8000

# Production server; docker-compose overrides this with runserver for local dev.
# PORT is set by the host (Railway); 8000 locally. --timeout 60: adding an occasion from a link waits on Gemini,
# which can take 15-20 s (apps/ai/client.py GENERATE_TIMEOUT_MS). Several workers with threads, so one waiting
# import doesn't hold up everyone else; set WEB_CONCURRENCY to change the worker count.
CMD ["sh", "-c", "python manage.py collectstatic --noinput && python manage.py migrate --noinput && exec gunicorn config.wsgi --bind 0.0.0.0:${PORT:-8000} --workers ${WEB_CONCURRENCY:-3} --threads 4 --timeout 60"]

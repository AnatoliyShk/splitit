"""Splits the OpenAPI docs: the public docs leave out the staff-only admin API, which has its own docs."""

ADMIN_API_PREFIX = "/api/admin/"


def public_endpoints(endpoints):
    """Preprocessing hook for /api/schema/: everything except the admin API."""
    return [endpoint for endpoint in endpoints if not endpoint[0].startswith(ADMIN_API_PREFIX)]


def admin_endpoints(endpoints):
    """Preprocessing hook for /api/admin/schema/: only the admin API."""
    return [endpoint for endpoint in endpoints if endpoint[0].startswith(ADMIN_API_PREFIX)]

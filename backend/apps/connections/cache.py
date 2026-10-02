from django.core.cache import cache

# Bumped by a full rebuild to drop every user's list at once
VERSION_KEY = "connections:version"
# Backstop in case a write ever slips past invalidation
MY_CONNECTIONS_TTL = 300


def my_connections_key(user_id):
    version = cache.get_or_set(VERSION_KEY, 1, timeout=None)
    return f"connections:v{version}:user:{user_id}"


def invalidate_users(user_ids):
    cache.delete_many([my_connections_key(user_id) for user_id in set(user_ids)])


def invalidate_all():
    try:
        cache.incr(VERSION_KEY)
    except ValueError:
        # incr() raises on a missing key; any fresh version works
        cache.set(VERSION_KEY, 1, timeout=None)

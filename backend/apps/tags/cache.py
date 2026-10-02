import hashlib

from django.core.cache import cache

# Bumping the version orphans every cached page at once; old entries just expire
VERSION_KEY = "tags:list-version"
# Backstop in case a write ever slips past invalidation
LIST_TTL = 300


def list_version():
    return cache.get_or_set(VERSION_KEY, 1, timeout=None)


def invalidate_tag_list():
    try:
        cache.incr(VERSION_KEY)
    except ValueError:
        # incr() raises on a missing key; any fresh version works
        cache.set(VERSION_KEY, 1, timeout=None)


def list_cache_key(params):
    page = params.get("page", "1")
    # SearchFilter is case-insensitive, so "Jazz" and "jazz" share an entry
    search = hashlib.md5(params.get("search", "").strip().lower().encode()).hexdigest()
    return f"tags:list:v{list_version()}:{page}:{search}"

from django.core.cache import cache

# Backstop in case a write ever slips past invalidation
MY_CIRCLES_TTL = 300


def my_circles_key(user_id):
    return f"circles:user:{user_id}"


def invalidate_my_circles(user_ids):
    cache.delete_many([my_circles_key(user_id) for user_id in set(user_ids)])

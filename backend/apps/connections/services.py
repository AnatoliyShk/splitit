from functools import partial
from itertools import combinations, islice

from django.db import connection as db, transaction
from django.utils import timezone

from apps.events.models import Event

from .cache import invalidate_users
from .models import Connection

# Pairs per INSERT statement
BATCH_SIZE = 1000

# bulk_create(update_conflicts=...) can only overwrite values, so add to them in SQL
UPSERT = """
    INSERT INTO {table} (user_low_id, user_high_id, strength, shared_events, created_at, updated_at)
    VALUES {rows}
    ON CONFLICT (user_low_id, user_high_id) DO UPDATE SET
        strength = {table}.strength + EXCLUDED.strength,
        shared_events = {table}.shared_events + 1,
        updated_at = EXCLUDED.updated_at
"""


def apply_event(event_id):
    """Count an ended event once: every pair of its attendees gets 1 / (attendees - 1) more strength.

    Returns True if the event was applied now, False if it was missing, not over yet or already applied.
    """
    now = timezone.now()
    with transaction.atomic():
        event = Event.objects.select_for_update().filter(pk=event_id).first()
        if event is None or event.connections_applied_at is not None or event.ends_at > now:
            return False
        user_ids = sorted(event.users.values_list("id", flat=True))
        if len(user_ids) > 1:
            weight = 1 / (len(user_ids) - 1)
            pairs = combinations(user_ids, 2)  # sorted input, so each pair is (low, high)
            table = db.ops.quote_name(Connection._meta.db_table)
            with db.cursor() as cursor:
                while batch := list(islice(pairs, BATCH_SIZE)):
                    rows = ", ".join(["(%s, %s, %s, 1, %s, %s)"] * len(batch))
                    params = [v for low, high in batch for v in (low, high, weight, now, now)]
                    cursor.execute(UPSERT.format(table=table, rows=rows), params)
        # update() skips post_save, so marking doesn't reschedule the event or re-embed it
        Event.objects.filter(pk=event.pk).update(connections_applied_at=now)
        transaction.on_commit(partial(invalidate_users, user_ids))
    return True


def unapplied_ended_events():
    now = timezone.now()
    ended = Event.objects.filter(end_datetime__lte=now) | Event.objects.filter(
        end_datetime__isnull=True, start_datetime__lte=now
    )
    return ended.filter(connections_applied_at__isnull=True)

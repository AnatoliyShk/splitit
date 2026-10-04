from functools import partial
from itertools import combinations, islice

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from apps.occasions.models import Occasion

from .cache import invalidate_users
from .models import Connection

# Pairs per INSERT statement
BATCH_SIZE = 1000


def apply_occasion(occasion_id):
    """Count an ended occasion once: every pair of its attendees gets 1 / (attendees - 1) more strength.

    Returns True if the occasion was applied now, False if it was missing, cancelled, not over yet or
    already applied.
    """
    now = timezone.now()
    with transaction.atomic():
        occasion = Occasion.objects.select_for_update().filter(pk=occasion_id).first()
        if occasion is None or not occasion.is_applyable(now):
            return False
        user_ids = sorted(occasion.users.values_list("id", flat=True))
        if len(user_ids) > 1:
            weight = 1 / (len(user_ids) - 1)
            pairs = combinations(user_ids, 2)  # sorted input, so each pair is (low, high)
            # bulk_create(update_conflicts=...) can only overwrite values, so create missing pairs
            # empty, then add to all of them in one UPDATE
            while batch := list(islice(pairs, BATCH_SIZE)):
                Connection.objects.bulk_create(
                    [Connection(user_low_id=low, user_high_id=high) for low, high in batch],
                    ignore_conflicts=True,
                )
            # user_low < user_high, so this matches exactly the attendee pairs
            Connection.objects.filter(user_low_id__in=user_ids, user_high_id__in=user_ids).update(
                strength=F("strength") + weight,
                shared_occasions=F("shared_occasions") + 1,
                updated_at=now,  # update() skips auto_now
            )
        # update() skips post_save, so marking doesn't reschedule the occasion or re-embed it
        Occasion.objects.filter(pk=occasion.pk).update(connections_applied_at=now)
        transaction.on_commit(partial(invalidate_users, user_ids))
    return True


def unapplied_ended_occasions():
    now = timezone.now()
    ended = Occasion.objects.filter(end_datetime__lte=now) | Occasion.objects.filter(
        end_datetime__isnull=True, start_datetime__lte=now
    )
    return ended.filter(connections_applied_at__isnull=True, cancelled_at__isnull=True)

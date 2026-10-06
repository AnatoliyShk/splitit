from django.contrib.auth import get_user_model
from django.db import transaction

from .models import Occasion, OccasionUser


class AlreadyGoing(Exception):
    """The user is already going to another occasion that hasn't ended or been cancelled."""

    def __init__(self, occasion):
        super().__init__(occasion.name)
        self.occasion = occasion


def active_occasions(user):
    """The upcoming occasions `user` is actively going to; join() keeps this to at most one."""
    # The time check covers the gap between an occasion ending and its deactivate job running
    return Occasion.objects.upcoming().filter(
        id__in=OccasionUser.objects.filter(user=user, is_active=True).values("occasion_id")
    )


def join(occasion, user):
    """Add `user` to `occasion`, unless they're already going to a different active one (raises AlreadyGoing)."""
    with transaction.atomic():
        # Lock the user's row so two quick accepts can't both pass the check below
        get_user_model().objects.select_for_update().filter(pk=user.pk).first()
        other_occasion = active_occasions(user).exclude(pk=occasion.pk).order_by("start_datetime").first()
        if other_occasion is not None:
            raise AlreadyGoing(other_occasion)
        occasion.users.add(user)


def deactivate_finished():
    """Turn is_active off for everyone going to an occasion that has ended or was cancelled.

    Idempotent and cheap (one UPDATE), so it's safe to run as often as needed. Returns the rows changed.
    """
    return OccasionUser.objects.filter(is_active=True, occasion__in=Occasion.objects.finished()).update(
        is_active=False
    )

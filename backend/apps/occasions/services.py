from django.contrib.auth import get_user_model
from django.db import transaction

import logging
from datetime import timedelta
from pathlib import Path

from django.core.files.base import ContentFile

from .models import Occasion, OccasionImage, OccasionUser


logger = logging.getLogger(__name__)


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


def create_occasion(user, tags, **fields):
    """A regular user's occasion: created by `user`, who goes to it. Raises AlreadyGoing (and saves
    nothing) while they're going to another occasion."""
    with transaction.atomic():
        occasion = Occasion.objects.create(created_by=user, **fields)
        occasion.tags.set(tags)
        join(occasion, user)
    return occasion


def create_occasion_from_template(user, template, start):
    """A regular user's occasion made from `template` starting at `start` (see create_occasion): the template's
    name, description, tags and length, and a copy of each of its images, so deleting the occasion or the template
    never touches the other's files. Raises AlreadyGoing (and saves nothing) while they're going to another one."""
    end = None if template.duration_minutes is None else start + timedelta(minutes=template.duration_minutes)
    with transaction.atomic():
        occasion = create_occasion(
            user,
            template.tags.all(),
            name=template.name,
            description=template.description,
            start_datetime=start,
            end_datetime=end,
        )
        for template_image in template.images.all():
            try:
                with template_image.image.open("rb") as image_file:
                    image_bytes = image_file.read()
            except FileNotFoundError:
                # The file went missing from disk; the occasion is still worth making without it
                logger.warning("Template image %s has no file; skipped", template_image.pk)
                continue
            OccasionImage.objects.create(
                occasion=occasion,
                order=template_image.order,
                image=ContentFile(image_bytes, name=Path(template_image.image.name).name),
            )
    return occasion


def deactivate_finished():
    """Turn is_active off for everyone going to an occasion that has ended or was cancelled.

    Idempotent and cheap (one UPDATE), so it's safe to run as often as needed. Returns the rows changed.
    """
    return OccasionUser.objects.filter(is_active=True, occasion__in=Occasion.objects.finished()).update(
        is_active=False
    )

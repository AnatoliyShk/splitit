from functools import partial

from django.db import transaction
from django.db.models.signals import m2m_changed, post_delete, post_save

from .cache import invalidate_my_circles
from .models import Membership, SocialCircle


def invalidate_on_commit(user_ids):
    # Wait for the commit so a concurrent request can't re-cache the old rows
    transaction.on_commit(partial(invalidate_my_circles, list(user_ids)))


def membership_changed(sender, instance, **kwargs):
    invalidate_on_commit([instance.user_id])


def circle_saved(sender, instance, created, **kwargs):
    # A rename shows in every member's list; a new circle has no members yet
    if not created:
        invalidate_on_commit(instance.memberships.values_list("user_id", flat=True))


def links_changed(sender, instance, action, reverse, pk_set, **kwargs):
    # add()/remove()/set() and clear() bypass Membership's own save and delete signals
    if action not in ("post_add", "post_remove", "pre_clear"):
        return
    if reverse:
        # instance is a user; pk_set holds circle ids
        invalidate_on_commit([instance.pk])
    elif action == "pre_clear":
        # instance is a circle that's about to lose every member
        invalidate_on_commit(instance.memberships.values_list("user_id", flat=True))
    else:
        invalidate_on_commit(pk_set)


def connect():
    # Deleting a circle or user cascades through Membership, which sends post_delete per row
    post_save.connect(membership_changed, sender=Membership, dispatch_uid="circles-membership-save")
    post_delete.connect(membership_changed, sender=Membership, dispatch_uid="circles-membership-delete")
    post_save.connect(circle_saved, sender=SocialCircle, dispatch_uid="circles-circle-save")
    m2m_changed.connect(links_changed, sender=SocialCircle.users.through, dispatch_uid="circles-links")

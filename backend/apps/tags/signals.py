from django.db import transaction
from django.db.models.signals import m2m_changed, post_delete, post_save

from apps.ai.embedding import embedding_updated
from apps.events.models import Event

from .cache import invalidate_tag_list
from .models import Tag


def invalidate_on_commit(**kwargs):
    # Wait for the commit so a concurrent request can't re-cache the old rows
    transaction.on_commit(invalidate_tag_list)


def connect():
    post_save.connect(invalidate_on_commit, sender=Tag, dispatch_uid="tags-list-save")
    post_delete.connect(invalidate_on_commit, sender=Tag, dispatch_uid="tags-list-delete")
    # Linking or unlinking events changes events_count
    m2m_changed.connect(invalidate_on_commit, sender=Tag.events.through, dispatch_uid="tags-list-links")
    # Deleting an event cascades its links without sending m2m_changed
    post_delete.connect(invalidate_on_commit, sender=Event, dispatch_uid="tags-list-event-delete")
    # Embedding writes use update(), which skips post_save
    embedding_updated.connect(invalidate_on_commit, sender=Tag, dispatch_uid="tags-list-embedding")

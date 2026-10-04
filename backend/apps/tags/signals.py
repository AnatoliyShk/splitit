from django.db import transaction
from django.db.models.signals import m2m_changed, post_delete, post_save

from apps.ai.embedding import embedding_updated
from apps.occasions.models import Occasion

from .cache import invalidate_tag_list
from .models import Tag


def invalidate_on_commit(**kwargs):
    # Wait for the commit so a concurrent request can't re-cache the old rows
    transaction.on_commit(invalidate_tag_list)


def connect():
    post_save.connect(invalidate_on_commit, sender=Tag, dispatch_uid="tags-list-save")
    post_delete.connect(invalidate_on_commit, sender=Tag, dispatch_uid="tags-list-delete")
    # Linking or unlinking occasions changes occasions_count
    m2m_changed.connect(invalidate_on_commit, sender=Tag.occasions.through, dispatch_uid="tags-list-links")
    # Deleting an occasion cascades its links without sending m2m_changed
    post_delete.connect(invalidate_on_commit, sender=Occasion, dispatch_uid="tags-list-occasion-delete")
    # Embedding writes use update(), which skips post_save
    embedding_updated.connect(invalidate_on_commit, sender=Tag, dispatch_uid="tags-list-embedding")

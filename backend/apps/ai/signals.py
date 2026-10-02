from functools import partial

from django.conf import settings
from django.db import transaction
from django.db.models.signals import post_save

from .embedding import embedded_models, embedding_updated
from .tasks import embed_object


def queue_embedding(sender, instance, created, **kwargs):
    if not settings.GEMINI_API_KEY:
        return
    if not created and instance.embedding is not None:
        # Drop the old vector so a stale one never outlives a rename
        sender.objects.filter(pk=instance.pk).update(embedding=None)
        instance.embedding = None
        embedding_updated.send(sender=sender)
    transaction.on_commit(partial(embed_object.enqueue, sender._meta.label, instance.pk))


def connect():
    for model in embedded_models():
        post_save.connect(queue_embedding, sender=model, dispatch_uid=f"ai-embed-{model._meta.label}")

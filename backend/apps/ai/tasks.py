from django.apps import apps
from django.tasks import task

from .client import embed_texts
from .embedding import embedding_text, embedding_updated


@task
def embed_object(model_label, pk):
    model = apps.get_model(model_label)
    model_instance = model.objects.filter(pk=pk).first()
    if model_instance is None:
        return
    [vector] = embed_texts([embedding_text(model_instance)])
    # update() skips post_save, so this write doesn't enqueue another task
    model.objects.filter(pk=pk).update(embedding=vector)
    embedding_updated.send(sender=model)

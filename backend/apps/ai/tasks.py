from django.apps import apps
from django.tasks import task

from .client import embed_texts
from .embedding import embedding_text


@task
def embed_object(model_label, pk):
    model = apps.get_model(model_label)
    obj = model.objects.filter(pk=pk).first()
    if obj is None:
        return
    [vector] = embed_texts([embedding_text(obj)])
    # update() skips post_save, so this write doesn't enqueue another task
    model.objects.filter(pk=pk).update(embedding=vector)

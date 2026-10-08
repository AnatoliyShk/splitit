from django.apps import apps
from django.dispatch import Signal

# Sent with sender=<model> after embeddings are written with update(), which skips post_save
embedding_updated = Signal()


def tag_text(tag):
    return tag.name


def occasion_text(occasion):
    # The description gives the vector much more to go on than a short name
    return "\n\n".join(part for part in (occasion.name, occasion.description) if part)


# Models with an `embedding` field, and how to turn a row into the text to embed
EMBEDDED_MODELS = {
    "tags.Tag": tag_text,
    "occasions.Occasion": occasion_text,
}


def embedding_text(obj):
    return EMBEDDED_MODELS[obj._meta.label](obj)


def embedded_models():
    return [apps.get_model(label) for label in EMBEDDED_MODELS]

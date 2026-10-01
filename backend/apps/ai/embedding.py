from django.apps import apps


def tag_text(tag):
    return tag.name


def event_text(event):
    return event.name


# Models with an `embedding` field, and how to turn a row into the text to embed
EMBEDDED_MODELS = {
    "tags.Tag": tag_text,
    "events.Event": event_text,
}


def embedding_text(obj):
    return EMBEDDED_MODELS[obj._meta.label](obj)


def embedded_models():
    return [apps.get_model(label) for label in EMBEDDED_MODELS]

import math
from functools import cache

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from google import genai
from google.genai import types

from apps.occasions.models import EMBEDDING_DIMENSIONS

# Texts sent to Gemini per request
BATCH_SIZE = 100


@cache
def get_client():
    if not settings.GEMINI_API_KEY:
        raise ImproperlyConfigured("GEMINI_API_KEY is not set.")
    return genai.Client(api_key=settings.GEMINI_API_KEY)


def embed_texts(texts, task_type="RETRIEVAL_DOCUMENT"):
    """Embed texts with Gemini; returns one unit-length vector per text, in order."""
    config = types.EmbedContentConfig(
        task_type=task_type,
        output_dimensionality=EMBEDDING_DIMENSIONS,
    )
    vectors = []
    for start in range(0, len(texts), BATCH_SIZE):
        response = get_client().models.embed_content(
            model=settings.EMBEDDING_MODEL,
            contents=texts[start:start + BATCH_SIZE],
            config=config,
        )
        vectors.extend(normalize(embedding.values) for embedding in response.embeddings)
    return vectors


def embed_query(text):
    """Embed a search query, to compare against stored document embeddings."""
    return embed_texts([text], task_type="RETRIEVAL_QUERY")[0]


def normalize(values):
    # Gemini only normalizes full-size (3072) vectors; shortened ones need it here
    length = math.sqrt(sum(value * value for value in values))
    return [value / length for value in values] if length else list(values)

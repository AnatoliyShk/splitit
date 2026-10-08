import logging
import math
from functools import cache

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from apps.occasions.models import EMBEDDING_DIMENSIONS

logger = logging.getLogger(__name__)

# Texts sent to Gemini per request
BATCH_SIZE = 100
# How long a text reply may take, in milliseconds. Reading a page and searching the web can take 15-20 s;
# this stays under gunicorn's 60 s worker timeout (backend/Dockerfile)
GENERATE_TIMEOUT_MS = 45_000


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


def generate_text(prompt, read_urls=False, search_web=False):
    """Gemini's (GEMINI_MODEL) text reply to `prompt`. With `read_urls`, it may open URLs in the prompt and read
    their pages itself (the URL context tool), so our server never fetches them; with `search_web`, it may also
    search Google for what the pages leave out.

    Search isn't on every plan (the free tier of some models has no quota for it): when Gemini refuses the call
    for quota, it's asked again once without search.
    """
    try:
        return request_text(prompt, read_urls, search_web)
    except genai_errors.ClientError as client_error:
        if not (search_web and client_error.code == 429):
            raise
        logger.warning("Gemini refused web search (%s); asking again without it", client_error.status)
        return request_text(prompt, read_urls, search_web=False)


def request_text(prompt, read_urls, search_web):
    tools = []
    if read_urls:
        tools.append(types.Tool(url_context=types.UrlContext()))
    if search_web:
        tools.append(types.Tool(google_search=types.GoogleSearch()))
    config = types.GenerateContentConfig(
        tools=tools or None,
        # No Python functions are offered to the model, so the SDK's function-calling loop has nothing to do
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        # One attempt: a quota refusal is handled above, and retries would outlast the request timeout
        http_options=types.HttpOptions(timeout=GENERATE_TIMEOUT_MS, retry_options=types.HttpRetryOptions(attempts=1)),
    )
    response = get_client().models.generate_content(model=settings.GEMINI_MODEL, contents=prompt, config=config)
    return response.text or ""


def normalize(values):
    # Gemini only normalizes full-size (3072) vectors; shortened ones need it here
    length = math.sqrt(sum(value * value for value in values))
    return [value / length for value in values] if length else list(values)

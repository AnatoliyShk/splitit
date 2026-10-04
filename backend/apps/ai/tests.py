from io import StringIO
from types import SimpleNamespace
from unittest import mock

from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from apps.occasions.models import EMBEDDING_DIMENSIONS, Occasion
from apps.tags.models import Tag

from . import client

IMMEDIATE_TASKS = {"default": {"BACKEND": "django.tasks.backends.immediate.ImmediateBackend"}}
# Embedding writes invalidate the cached tag list; keep that out of the dev Redis
LOCMEM_CACHE = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


def fake_embed_content(*, model, contents, config):
    """Stand-in for Gemini: a vector of 2s per text, so normalizing is visible."""
    return SimpleNamespace(
        embeddings=[SimpleNamespace(values=[2.0] * config.output_dimensionality) for _ in contents]
    )


class FakeGeminiMixin:
    def setUp(self):
        super().setUp()
        self.enterContext(override_settings(CACHES=LOCMEM_CACHE))
        cache.clear()
        client.get_client.cache_clear()
        self.addCleanup(client.get_client.cache_clear)
        patcher = mock.patch.object(client, "get_client")
        self.embed_content = patcher.start().return_value.models.embed_content
        self.embed_content.side_effect = fake_embed_content
        self.addCleanup(patcher.stop)

    def embedded_texts(self):
        return [text for call in self.embed_content.call_args_list for text in call.kwargs["contents"]]


class EmbedTextsTests(FakeGeminiMixin, TestCase):
    def test_returns_unit_vectors_of_the_column_size(self):
        [vector] = client.embed_texts(["Jazz"])
        self.assertEqual(len(vector), EMBEDDING_DIMENSIONS)
        self.assertAlmostEqual(sum(v * v for v in vector), 1.0)

    def test_sends_large_inputs_in_batches(self):
        vectors = client.embed_texts([f"tag {i}" for i in range(client.BATCH_SIZE + 1)])
        self.assertEqual(len(vectors), client.BATCH_SIZE + 1)
        self.assertEqual([len(c.kwargs["contents"]) for c in self.embed_content.call_args_list], [client.BATCH_SIZE, 1])

    def test_query_uses_the_query_task_type(self):
        client.embed_query("live music")
        self.assertEqual(self.embed_content.call_args.kwargs["config"].task_type, "RETRIEVAL_QUERY")


class MissingKeyTests(TestCase):
    def setUp(self):
        client.get_client.cache_clear()
        self.addCleanup(client.get_client.cache_clear)

    @override_settings(GEMINI_API_KEY="")
    def test_client_needs_a_key(self):
        with self.assertRaises(ImproperlyConfigured):
            client.get_client()


@override_settings(TASKS=IMMEDIATE_TASKS, GEMINI_API_KEY="test-key")
class EmbedOnSaveTests(FakeGeminiMixin, TestCase):
    def save(self, obj):
        with self.captureOnCommitCallbacks(execute=True):
            obj.save()
        obj.refresh_from_db()
        return obj

    def test_new_tag_is_embedded(self):
        tag = self.save(Tag(name="Jazz"))
        self.assertEqual(len(tag.embedding), EMBEDDING_DIMENSIONS)
        self.assertEqual(self.embedded_texts(), ["Jazz"])

    def test_new_occasion_is_embedded(self):
        occasion = self.save(Occasion(name="Sunset jazz", start_datetime=timezone.now()))
        self.assertIsNotNone(occasion.embedding)
        self.assertEqual(self.embedded_texts(), ["Sunset jazz"])

    def test_rename_re_embeds_once(self):
        tag = self.save(Tag(name="Jazz"))
        tag.name = "Live jazz"
        self.save(tag)
        # One call per save: the task's own write doesn't queue another task
        self.assertEqual(self.embedded_texts(), ["Jazz", "Live jazz"])
        self.assertIsNotNone(tag.embedding)

    def test_failed_re_embed_leaves_no_stale_vector(self):
        tag = self.save(Tag(name="Jazz"))
        self.embed_content.side_effect = RuntimeError("Gemini is down")
        tag.name = "Live jazz"
        self.save(tag)
        self.assertIsNone(tag.embedding)

    @override_settings(GEMINI_API_KEY="")
    def test_nothing_is_queued_without_a_key(self):
        tag = self.save(Tag(name="Jazz"))
        self.assertIsNone(tag.embedding)
        self.embed_content.assert_not_called()


@override_settings(GEMINI_API_KEY="")
class EmbedMissingCommandTests(FakeGeminiMixin, TestCase):
    def test_fills_only_missing_embeddings(self):
        done = Tag.objects.create(name="Done", embedding=[1.0] * EMBEDDING_DIMENSIONS)
        Tag.objects.create(name="Jazz")
        Occasion.objects.create(name="Sunset jazz", start_datetime=timezone.now())

        out = StringIO()
        call_command("embed_missing", stdout=out)

        self.assertCountEqual(self.embedded_texts(), ["Jazz", "Sunset jazz"])
        self.assertFalse(Tag.objects.filter(embedding=None).exists())
        self.assertFalse(Occasion.objects.filter(embedding=None).exists())
        done.refresh_from_db()
        self.assertEqual(done.embedding[0], 1.0)

    def test_can_limit_to_one_model(self):
        Tag.objects.create(name="Jazz")
        Occasion.objects.create(name="Sunset jazz", start_datetime=timezone.now())
        call_command("embed_missing", "--model", "tags", stdout=StringIO())
        self.assertEqual(self.embedded_texts(), ["Jazz"])

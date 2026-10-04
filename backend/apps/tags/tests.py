from django.core.exceptions import ValidationError
from django.db import IntegrityError
from django.test import TestCase
from django.utils import timezone
from pgvector.django import CosineDistance

from apps.occasions.models import EMBEDDING_DIMENSIONS, Occasion
from apps.users.models import User

from .models import Tag


class TagModelTests(TestCase):
    def test_links_occasions_both_ways(self):
        tag = Tag.objects.create(name="Jazz")
        occasion = Occasion.objects.create(name="Sunset jazz", start_datetime=timezone.now())
        tag.occasions.add(occasion)
        self.assertEqual(list(occasion.tags.all()), [tag])
        self.assertEqual(list(tag.occasions.all()), [occasion])

    def test_name_is_unique_case_insensitively(self):
        Tag.objects.create(name="Jazz")
        with self.assertRaises(IntegrityError):
            Tag.objects.create(name="jazz")

    def test_validation_reports_duplicate_name(self):
        Tag.objects.create(name="Jazz")
        with self.assertRaisesMessage(ValidationError, "A tag with this name already exists."):
            Tag(name="JAZZ").full_clean()

    def test_deleting_occasion_keeps_tag(self):
        tag = Tag.objects.create(name="Hiking")
        occasion = Occasion.objects.create(name="Morning hike", start_datetime=timezone.now())
        tag.occasions.add(occasion)
        occasion.delete()
        self.assertTrue(Tag.objects.filter(pk=tag.pk).exists())
        self.assertEqual(tag.occasions.count(), 0)


class TagEmbeddingTests(TestCase):
    def test_finds_most_similar_tag(self):
        def vec(x, y):
            return [x, y] + [0.0] * (EMBEDDING_DIMENSIONS - 2)

        Tag.objects.create(name="Jazz", embedding=vec(1.0, 0.0))
        Tag.objects.create(name="Live music", embedding=vec(0.8, 0.2))
        Tag.objects.create(name="Hiking", embedding=vec(0.0, 1.0))
        Tag.objects.create(name="Untagged")

        closest = (
            Tag.objects.exclude(embedding=None)
            .order_by(CosineDistance("embedding", vec(1.0, 0.05)))
            .values_list("name", flat=True)
        )
        self.assertEqual(list(closest), ["Jazz", "Live music", "Hiking"])

    def test_admin_form_does_not_show_embedding(self):
        admin = User.objects.create_superuser("admin@example.com", "correct-horse-battery", name="Admin")
        self.client.force_login(admin)
        html = self.client.get("/django-admin/tags/tag/add/").content.decode()
        self.assertNotIn('name="embedding"', html)


class TagAdminTests(TestCase):
    def test_admin_pages_render(self):
        admin = User.objects.create_superuser("admin@example.com", "correct-horse-battery", name="Admin")
        self.client.force_login(admin)
        tag = Tag.objects.create(name="Jazz")
        for url in ("/django-admin/tags/tag/", "/django-admin/tags/tag/add/", f"/django-admin/tags/tag/{tag.pk}/change/"):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 200)

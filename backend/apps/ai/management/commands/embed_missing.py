from django.core.management.base import BaseCommand

from apps.ai.client import BATCH_SIZE, embed_texts
from apps.ai.embedding import embedded_models, embedding_text, embedding_updated


class Command(BaseCommand):
    help = "Embed every tag and occasion that has no embedding yet."

    def add_arguments(self, parser):
        parser.add_argument(
            "--model",
            choices=["tags", "occasions"],
            help="Only embed this app's model.",
        )

    def handle(self, *args, model=None, **options):
        for model_cls in embedded_models():
            if model and model_cls._meta.app_label != model:
                continue
            embedded_count = 0
            while batch := list(model_cls.objects.filter(embedding=None).order_by("pk")[:BATCH_SIZE]):
                vectors = embed_texts([embedding_text(model_instance) for model_instance in batch])
                for model_instance, vector in zip(batch, vectors):
                    model_cls.objects.filter(pk=model_instance.pk).update(embedding=vector)
                embedded_count += len(batch)
            if embedded_count:
                embedding_updated.send(sender=model_cls)
            self.stdout.write(f"{model_cls._meta.verbose_name_plural}: embedded {embedded_count}")

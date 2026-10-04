# Squashed history: this app used to be 'events' (model 'Event'); see git history for the
# step-by-step migrations that got there. For the dev database that already had the old
# 'events' app applied, this migration was recorded with `--fake` (the table already exists
# in exactly this shape); a fresh database applies it for real.

import pgvector.django
import pgvector.django.indexes
import pgvector.django.vector
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # CREATE EXTENSION vector; tags' embedding migration also depends on this app running first
        pgvector.django.VectorExtension(),
        migrations.CreateModel(
            name='Occasion',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=255)),
                ('start_datetime', models.DateTimeField(db_index=True)),
                ('end_datetime', models.DateTimeField(blank=True, null=True)),
                ('embedding', pgvector.django.vector.VectorField(blank=True, dimensions=768, editable=False, null=True)),
                ('connections_applied_at', models.DateTimeField(blank=True, editable=False, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('users', models.ManyToManyField(blank=True, related_name='occasions', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'indexes': [
                    pgvector.django.indexes.HnswIndex(ef_construction=64, fields=['embedding'], m=16, name='occasion_embedding_hnsw', opclasses=['vector_cosine_ops']),
                ],
                'constraints': [
                    models.CheckConstraint(condition=models.Q(('end_datetime__isnull', True), ('end_datetime__gt', models.F('start_datetime')), _connector='OR'), name='occasion_ends_after_start', violation_error_message='The end must be after the start.'),
                ],
            },
        ),
    ]

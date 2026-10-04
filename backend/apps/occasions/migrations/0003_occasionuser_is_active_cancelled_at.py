from django.conf import settings
from django.db import migrations, models
from django.db.models import Q
from django.utils import timezone


def deactivate_finished(apps, schema_editor):
    # Attendances of occasions that are already over start out inactive (nothing is cancelled yet)
    Occasion = apps.get_model("occasions", "Occasion")
    OccasionUser = apps.get_model("occasions", "OccasionUser")
    now = timezone.now()
    finished = Occasion.objects.filter(Q(end_datetime__lt=now) | Q(end_datetime=None, start_datetime__lt=now))
    OccasionUser.objects.filter(occasion__in=finished).update(is_active=False)


class Migration(migrations.Migration):

    dependencies = [
        ('occasions', '0002_short_table_names'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # Occasion.users gets an explicit through model over the table Django already made for it:
        # the columns and constraints are identical, so only the migration state changes
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.CreateModel(
                    name='OccasionUser',
                    fields=[
                        ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                        ('occasion', models.ForeignKey(on_delete=models.deletion.CASCADE, related_name='attendances', to='occasions.occasion')),
                        ('user', models.ForeignKey(on_delete=models.deletion.CASCADE, related_name='attendances', to=settings.AUTH_USER_MODEL)),
                    ],
                    options={
                        'db_table': 'occasion_users',
                        'unique_together': {('occasion', 'user')},
                    },
                ),
                migrations.AlterField(
                    model_name='occasion',
                    name='users',
                    field=models.ManyToManyField(blank=True, related_name='occasions', through='occasions.OccasionUser', to=settings.AUTH_USER_MODEL),
                ),
            ],
        ),
        migrations.AddField(
            model_name='occasionuser',
            name='is_active',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='occasion',
            name='cancelled_at',
            field=models.DateTimeField(blank=True, editable=False, null=True),
        ),
        migrations.RunPython(deactivate_finished, migrations.RunPython.noop),
    ]

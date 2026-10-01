from datetime import timedelta

from django.db import migrations, models


def end_of_inclusive_day(apps, schema_editor):
    # Old end dates were inclusive ("until the 14th"); converted to datetimes they land at
    # midnight at the start of that day, so move them to the end of it
    Event = apps.get_model("events", "Event")
    Event.objects.filter(end_datetime__isnull=False).update(
        end_datetime=models.F("end_datetime") + timedelta(days=1)
    )


def start_of_inclusive_day(apps, schema_editor):
    Event = apps.get_model("events", "Event")
    Event.objects.filter(end_datetime__isnull=False).update(
        end_datetime=models.F("end_datetime") - timedelta(days=1)
    )


class Migration(migrations.Migration):

    dependencies = [
        ("events", "0001_initial"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="event",
            name="event_end_date_not_before_start_date",
        ),
        migrations.RenameField(
            model_name="event",
            old_name="start_date",
            new_name="start_datetime",
        ),
        migrations.RenameField(
            model_name="event",
            old_name="end_date",
            new_name="end_datetime",
        ),
        # Existing dates become midnight UTC on the same day
        migrations.AlterField(
            model_name="event",
            name="start_datetime",
            field=models.DateTimeField(db_index=True),
        ),
        migrations.AlterField(
            model_name="event",
            name="end_datetime",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(end_of_inclusive_day, start_of_inclusive_day),
        migrations.AddConstraint(
            model_name="event",
            constraint=models.CheckConstraint(
                condition=models.Q(("end_datetime__isnull", True))
                | models.Q(("end_datetime__gt", models.F("start_datetime"))),
                name="event_ends_after_start",
                violation_error_message="The end must be after the start.",
            ),
        ),
    ]

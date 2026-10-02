import uuid6
from django.db import migrations, models


def fill_uuids(apps, schema_editor):
    # A field default is evaluated once for all existing rows, so give each user its own UUID
    User = apps.get_model("users", "User")
    for user in User.objects.filter(uuid__isnull=True).only("pk").order_by("date_joined", "pk"):
        user.uuid = uuid6.uuid7()
        user.save(update_fields=["uuid"])


class Migration(migrations.Migration):
    """Step 1 of 2: add the column as nullable and fill it. 0003 makes it required and unique."""

    dependencies = [
        ("users", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="uuid",
            field=models.UUIDField(editable=False, null=True),
        ),
        migrations.RunPython(fill_uuids, migrations.RunPython.noop),
    ]

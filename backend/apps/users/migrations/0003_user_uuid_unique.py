from django.db import migrations, models

import apps.users.models


class Migration(migrations.Migration):
    """Step 2 of 2: separate from the data fill, since Postgres can't alter a table it just updated in the same transaction."""

    dependencies = [
        ("users", "0002_user_uuid"),
    ]

    operations = [
        migrations.AlterField(
            model_name="user",
            name="uuid",
            field=models.UUIDField(default=apps.users.models.new_uuid, editable=False, unique=True),
        ),
    ]

import uuid6
from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models


def new_uuid():
    """A UUIDv7: time-ordered, so new rows land at the end of the index. Python 3.14+ has uuid.uuid7."""
    return uuid6.uuid7()


class UserManager(BaseUserManager):
    use_in_migrations = True

    def normalize_email(self, email):
        # Treat emails as case-insensitive so Ana@x.com and ana@x.com are one account
        return super().normalize_email(email).lower()

    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError("Users must have an email address.")
        user = self.model(email=self.normalize_email(email), **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        if not extra_fields["is_staff"] or not extra_fields["is_superuser"]:
            raise ValueError("Superuser must have is_staff=True and is_superuser=True.")
        return self._create_user(email, password, **extra_fields)


class User(AbstractUser):
    """Logs in with email; a single display name replaces first/last name."""

    username = None
    first_name = None
    last_name = None
    # Public identifier for API URLs (/api/users/<uuid>/...); the integer id stays internal
    uuid = models.UUIDField(default=new_uuid, unique=True, editable=False)
    email = models.EmailField("email address", unique=True)
    name = models.CharField(max_length=150)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["name"]

    objects = UserManager()

    class Meta(AbstractUser.Meta):
        db_table = "users"

    def __str__(self):
        return self.email

    def get_full_name(self):
        return self.name

    def get_short_name(self):
        return self.name


class FilterPreference(models.Model):
    """The Explore filters a user saved. Each kind of filter is its own table (tags, weekdays), so it stays in 5NF."""

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="filter_preference")
    # Only show occasions with any of these tags
    tags = models.ManyToManyField(
        "tags.Tag",
        related_name="filter_preferences",
        blank=True,
        db_table="filter_preference_tags",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "filter_preferences"

    def __str__(self):
        return f"Filters of {self.user}"


class Weekday(models.IntegerChoices):
    """ISO numbering, the same as Django's `__iso_week_day` lookup."""

    MONDAY = 1
    TUESDAY = 2
    WEDNESDAY = 3
    THURSDAY = 4
    FRIDAY = 5
    SATURDAY = 6
    SUNDAY = 7


class FilterPreferenceWeekday(models.Model):
    """One day of the week a user wants occasions on; one row per day."""

    filter_preference = models.ForeignKey(
        FilterPreference, on_delete=models.CASCADE, related_name="weekdays"
    )
    weekday = models.PositiveSmallIntegerField(choices=Weekday.choices)

    class Meta:
        db_table = "filter_preference_weekdays"
        ordering = ["weekday"]
        constraints = [
            models.UniqueConstraint(
                fields=["filter_preference", "weekday"],
                name="filter_preference_weekday_unique",
            ),
            models.CheckConstraint(
                condition=models.Q(weekday__gte=Weekday.MONDAY, weekday__lte=Weekday.SUNDAY),
                name="filter_preference_weekday_iso",
            ),
        ]

    def __str__(self):
        return Weekday(self.weekday).label

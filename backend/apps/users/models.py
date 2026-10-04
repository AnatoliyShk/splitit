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

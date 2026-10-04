from django.conf import settings
from django.db import models


class ConnectionQuerySet(models.QuerySet):
    def for_user(self, user):
        return self.filter(models.Q(user_low=user) | models.Q(user_high=user))


class Connection(models.Model):
    """Two users who went to the same occasions; one row per pair, smaller user id first.

    Derived from Occasion.users and stored for fast reads: `manage.py apply_connections --rebuild`
    recomputes it from scratch.
    """

    user_low = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="connections_low")
    user_high = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="connections_high")
    # Each shared occasion adds 1 / (attendees - 1), so small occasions bond people more
    strength = models.FloatField(default=0)
    shared_occasions = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = ConnectionQuerySet.as_manager()

    class Meta:
        db_table = "connections"
        constraints = [
            # One row per pair: (A, B) and (B, A) can't both exist
            models.CheckConstraint(
                condition=models.Q(user_low__lt=models.F("user_high")),
                name="connection_users_ordered",
            ),
            models.UniqueConstraint(fields=["user_low", "user_high"], name="connection_pair_unique"),
        ]
        indexes = [
            # "My connections, strongest first", from either side of the pair
            models.Index(fields=["user_low", "-strength"], name="connection_low_strength_idx"),
            models.Index(fields=["user_high", "-strength"], name="connection_high_strength_idx"),
        ]

    def __str__(self):
        return f"{self.user_low} – {self.user_high}"

    def other(self, user):
        return self.user_high if self.user_low_id == user.pk else self.user_low

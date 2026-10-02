from django.conf import settings
from django.db import models


class SocialCircle(models.Model):
    name = models.CharField(max_length=100)
    users = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        through="Membership",
        related_name="social_circles",
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name


class Membership(models.Model):
    """A user's place in a circle; `interest` is how interested they are in it."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships")
    circle = models.ForeignKey(SocialCircle, on_delete=models.CASCADE, related_name="memberships")
    interest = models.FloatField(default=0.0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "circle"], name="membership_user_circle_unique"),
        ]
        indexes = [
            # Serves "my circles, most interesting first"
            models.Index(fields=["user", "-interest"], name="membership_user_interest_idx"),
        ]

    def __str__(self):
        return f"{self.user} in {self.circle}"

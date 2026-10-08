import uuid
from pathlib import Path

from django.conf import settings
from django.db import models
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone
from pgvector.django import HnswIndex, VectorField

# Size of the vectors stored in `embedding` columns (shared with tags)
EMBEDDING_DIMENSIONS = 768


class OccasionQuerySet(models.QuerySet):
    def upcoming(self):
        """Not cancelled and not over yet: still ahead or running (one with no end is over once it starts)."""
        now = timezone.now()
        return self.filter(
            Q(end_datetime__gte=now) | Q(end_datetime=None, start_datetime__gte=now), cancelled_at=None
        )

    def visible_to(self, user):
        """The occasions `user` may see. Ones made by staff, or before creators were recorded, are public;
        one made by a regular user is visible to its creator, the people directly connected to them
        (a Connection row, not friends of friends) and anyone already going.
        """
        from apps.connections.models import Connection

        connected_to_creator = Connection.objects.filter(
            Q(user_low=OuterRef("created_by"), user_high=user) | Q(user_low=user, user_high=OuterRef("created_by"))
        )
        going = OccasionUser.objects.filter(occasion=OuterRef("pk"), user=user)
        return self.filter(
            Q(created_by=None)
            | Q(created_by__is_staff=True)
            | Q(created_by=user)
            | Exists(connected_to_creator)
            | Exists(going)
        )

    def finished(self):
        """Over or cancelled: the opposite of upcoming()."""
        now = timezone.now()
        return self.filter(
            Q(cancelled_at__isnull=False) | Q(end_datetime__lt=now) | Q(end_datetime=None, start_datetime__lt=now)
        )


class Occasion(models.Model):
    name = models.CharField(max_length=255)
    # What it is and what to expect; cards show the first 100 characters, the details and the page all of it
    description = models.TextField(blank=True, max_length=2000)
    start_datetime = models.DateTimeField(db_index=True)
    end_datetime = models.DateTimeField(null=True, blank=True)
    users = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        through="OccasionUser",
        related_name="occasions",
        blank=True,
    )
    # Filled by an embedding model, not by people, so it's hidden from forms and the API
    embedding = VectorField(dimensions=EMBEDDING_DIMENSIONS, null=True, blank=True, editable=False)
    # When attendees' connections were counted (see apps.connections); set once, after the occasion ends
    connections_applied_at = models.DateTimeField(null=True, blank=True, editable=False)
    # Set by the panel's Cancel action; a cancelled occasion can't be joined and isn't counted for connections
    cancelled_at = models.DateTimeField(null=True, blank=True, editable=False)
    # Staff (in the panel) or a regular user (POST /api/occasions/); null for occasions made before this was
    # recorded. Who it is decides who sees it (see visible_to). Deleted with its creator, so a private
    # occasion never turns public
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="created_occasions",
        editable=False,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = OccasionQuerySet.as_manager()

    class Meta:
        db_table = "occasions"
        indexes = [
            # Approximate nearest-neighbour search by cosine distance
            HnswIndex(
                name="occasion_embedding_hnsw",
                fields=["embedding"],
                m=16,
                ef_construction=64,
                opclasses=["vector_cosine_ops"],
            ),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(end_datetime__isnull=True)
                | models.Q(end_datetime__gt=models.F("start_datetime")),
                name="occasion_ends_after_start",
                violation_error_message="The end must be after the start.",
            ),
        ]

    def __str__(self):
        return self.name

    @property
    def ends_at(self):
        """When the occasion is over: its end, or its start when it has no end."""
        return self.end_datetime or self.start_datetime

    @property
    def duration(self):
        """How long the occasion runs (a timedelta), or None when it has no end."""
        if self.end_datetime is None:
            return None
        return self.end_datetime - self.start_datetime

    def is_applyable(self, now=None):
        """Whether its connections can be counted now: it is over, not cancelled and not applied yet."""
        return (
            self.cancelled_at is None
            and self.connections_applied_at is None
            and self.ends_at <= (now or timezone.now())
        )


class OccasionUser(models.Model):
    """One user going to one occasion: the row behind Occasion.users."""

    occasion = models.ForeignKey(Occasion, on_delete=models.CASCADE, related_name="attendances")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="attendances")
    # On while the occasion is ahead or running; a user can join only while none of theirs is active.
    # Turned off for every attendee once it ends or is cancelled (see services.deactivate_finished)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "occasion_users"
        # Matches the table Django created when this was an automatic many-to-many
        unique_together = [("occasion", "user")]

    def __str__(self):
        return f"{self.user} → {self.occasion}"


# Order 0 is the main image (shown on previews); 1..GALLERY_SIZE are the gallery on the occasion's page
MAIN_IMAGE_ORDER = 0
GALLERY_SIZE = 3
MAX_IMAGE_ORDER = MAIN_IMAGE_ORDER + GALLERY_SIZE


def image_path(image, filename):
    """occasions/<occasion id>/<random hex>.<ext>: random, so a replaced image never hits a stale cache."""
    ext = Path(filename).suffix.lower()
    return f"occasions/{image.occasion_id}/{uuid.uuid4().hex}{ext}"


class OccasionImage(models.Model):
    """One picture of an occasion, in a fixed slot: `order` 0 is the main image, 1-3 the gallery."""

    occasion = models.ForeignKey(Occasion, on_delete=models.CASCADE, related_name="images")
    image = models.ImageField(upload_to=image_path)
    order = models.PositiveSmallIntegerField(default=MAIN_IMAGE_ORDER)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "occasion_images"
        ordering = ["order"]
        constraints = [
            models.UniqueConstraint(fields=["occasion", "order"], name="occasion_image_order_unique"),
            models.CheckConstraint(
                condition=Q(order__lte=MAX_IMAGE_ORDER),
                name="occasion_image_order_range",
                violation_error_message=f"The order must be between 0 and {MAX_IMAGE_ORDER}.",
            ),
        ]

    def __str__(self):
        return f"{self.occasion} #{self.order}"

    @property
    def is_main(self):
        return self.order == MAIN_IMAGE_ORDER

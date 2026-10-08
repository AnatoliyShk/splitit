"""Turning an event's web page into an occasion: Gemini reads the page and replies with a JSON summary, and a
link-preview card built from it (preview.py) becomes the occasion's main image."""

import json
import logging
import re
from datetime import UTC, datetime, time
from urllib.parse import parse_qs, urlsplit

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from apps.ai.client import generate_text
from apps.tags.models import Tag

from .models import MAIN_IMAGE_ORDER, OccasionImage
from .preview import DEFAULT_THEME, THEMES, build_preview_svg, link_domain
from .services import AlreadyGoing, active_occasions, create_occasion

logger = logging.getLogger(__name__)

# The user's link, then what to pull out of the page. The paragraphs after "Give response in JSON" pin down the
# JSON so it can be parsed (including which preview.py theme suits the event) and send Gemini looking for dates a
# landing page leaves out (it can search the web)
EVENT_PROMPT = """{url}

Can you get summary of this event in format:
Title
Start date
End date
Descriptions
Tags (characteristics in 1-2 different tags)
Give response in JSON

Use exactly these keys: "title", "start_date", "end_date", "description", "tags" (a list of 1-2 short tag names)
and "icon": the picture that suits the event best, one of "sakura" (flowers, Japan, spring, calm), "star" (shows,
games, fandom, nightlife) or "wave" (sea, outdoors, sport, travel).
Give dates in ISO 8601 with the event's UTC offset, like 2026-10-12T19:00:00+03:00, and "end_date": null when the
page doesn't say.

If the page doesn't state the dates, find them: check the event's other pages, or search the web for this event.
Use the next upcoming edition (today is {today}).
{start_hint}
Reply with only the JSON object in a ```json block."""

# Added to the prompt when the link itself carries the start, so Gemini doesn't search for it
START_GIVEN_HINT = """
The start is already known: it is {start}. Use it as "start_date" and don't look for it; read the end date, if the
page has one, relative to that start.
"""

# Query parameters that may carry the start date, in order of preference
START_PARAMS = ("start_at", "at")

MAX_TAGS = 2
TAG_NAME_LENGTH = 50  # Tag.name max_length
NAME_LENGTH = 255  # Occasion.name max_length
DESCRIPTION_LENGTH = 2000  # Occasion.description max_length


class EventNotRead(Exception):
    """Gemini's reply had no usable event in it (no JSON, no title or no start)."""


class EventReadFailed(Exception):
    """Asking Gemini failed (an error, a timeout, an overloaded model); trying again later may work."""


class ImportUnavailable(Exception):
    """Adding occasions from links is off on this server (no GEMINI_API_KEY)."""


def ensure_free_to_add(user):
    """Raise AlreadyGoing while `user` is going to another occasion; checked before asking Gemini, so a doomed
    import doesn't spend a call."""
    active_occasion = active_occasions(user).order_by("start_datetime").first()
    if active_occasion is not None:
        raise AlreadyGoing(active_occasion)


def ensure_import_enabled():
    """Raise ImportUnavailable when there's no Gemini key to read pages with."""
    if not settings.GEMINI_API_KEY:
        raise ImportUnavailable


def fetch_event(url):
    """read_event(), with every failure but EventNotRead logged and raised as EventReadFailed."""
    try:
        return read_event(url)
    except EventNotRead:
        raise
    except Exception as read_error:
        logger.exception("Reading an event from a link failed")
        raise EventReadFailed from read_error


def save_imported_occasion(user, occasion_fields, tag_names, image_svg):
    """Upsert the tags, create the occasion (made by `user`, who goes to it) and attach its preview card.

    One transaction, so tags made for an occasion that then fails to save are rolled back with it.
    Raises AlreadyGoing (and saves nothing) when `user` went to another occasion meanwhile.
    """
    with transaction.atomic():
        tags = upsert_tags(tag_names)
        occasion = create_occasion(user, tags, **occasion_fields)
        attach_preview_image(occasion, image_svg)
    return occasion


def attach_preview_image(occasion, image_svg):
    """The link-preview card becomes the main image (cards, lists, the top of its page)."""
    OccasionImage.objects.create(
        occasion=occasion, order=MAIN_IMAGE_ORDER, image=ContentFile(image_svg, name="preview.svg")
    )


def read_event(url):
    """Ask Gemini to read the event at `url`; returns parse_event_summary()'s fields, with `image_svg` (the preview
    card for the occasion's main image) in place of `theme`. Raises EventNotRead."""
    url_start = start_from_url(url)
    start_hint = START_GIVEN_HINT.format(start=url_start.isoformat()) if url_start else ""
    prompt = EVENT_PROMPT.format(url=url, today=timezone.localdate().isoformat(), start_hint=start_hint)
    event = parse_event_summary(generate_text(prompt, read_urls=True, search_web=True), start=url_start)
    theme = event.pop("theme")
    event["image_svg"] = build_preview_svg(event["name"], event["description"], link_domain(url), theme).encode()
    return event


def start_from_url(url):
    """The start date in the link's `start_at` (or `at`) query parameter (after the "?" or after the "#"), or None when it's missing or not a date."""
    parts = urlsplit(url)
    # Single-page apps keep their parameters after the "#", like /films/x#/buy-tickets?at=2026-10-08
    query = parse_qs(parts.query)
    for name, values in parse_qs(parts.fragment.partition("?")[2]).items():
        query.setdefault(name, []).extend(values)
    for param in START_PARAMS:
        for value in query.get(param, []):
            # A "+" in a query string reads as a space, which breaks a UTC offset like +03:00
            value = re.sub(r" (\d{2}:?\d{2})$", r"+\1", value.strip())
            if (start := parse_moment(value)) is not None:
                return start
    return None


def parse_event_summary(reply, start=None):
    """The event in Gemini's reply, as Occasion fields plus `tag_names` and `theme` (a preview.py theme).

    Tolerates a ```json fence or a sentence around the object. Long text is cut to the model's limits, an end that
    isn't after the start is dropped rather than failing the import, and an unknown icon gets the default theme.
    A `start` (from the link) is used instead of the reply's "start_date".
    """
    match = re.search(r"\{.*\}", reply, re.DOTALL)
    if match is None:
        raise EventNotRead
    try:
        summary = json.loads(match.group())
    except json.JSONDecodeError as decode_error:
        raise EventNotRead from decode_error
    if not isinstance(summary, dict):
        raise EventNotRead

    title = str(summary.get("title") or "").strip()
    start = start or parse_moment(summary.get("start_date"))
    if not title or start is None:
        raise EventNotRead
    end = parse_moment(summary.get("end_date"))

    raw_tags = summary.get("tags") or []
    if isinstance(raw_tags, str):
        raw_tags = [raw_tags]
    tag_names = []
    for raw_tag in raw_tags if isinstance(raw_tags, list) else []:
        tag_name = str(raw_tag).strip()[:TAG_NAME_LENGTH].strip()
        if tag_name and tag_name.lower() not in (known_name.lower() for known_name in tag_names):
            tag_names.append(tag_name)

    return {
        "name": title[:NAME_LENGTH],
        "description": str(summary.get("description") or "").strip()[:DESCRIPTION_LENGTH],
        "start_datetime": start,
        "end_datetime": end if end and end > start else None,
        "tag_names": tag_names[:MAX_TAGS],
        "theme": icon if (icon := str(summary.get("icon") or "").strip().lower()) in THEMES else DEFAULT_THEME,
    }


def parse_moment(value):
    """An aware datetime from an ISO 8601 string; a date alone means its midnight, and no offset means UTC."""
    if not isinstance(value, str):
        return None
    moment = parse_datetime(value.strip())
    if moment is None:
        day = parse_date(value.strip())
        if day is None:
            return None
        moment = datetime.combine(day, time())
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def upsert_tags(tag_names):
    """The tags with these names, matched ignoring case, creating the ones that don't exist yet."""
    tags = []
    for tag_name in tag_names:
        tag = Tag.objects.filter(name__iexact=tag_name).first()
        if tag is None:
            try:
                with transaction.atomic():
                    tag = Tag.objects.create(name=tag_name)
            except IntegrityError:
                # Someone created it in the meantime (names are unique ignoring case)
                tag = Tag.objects.get(name__iexact=tag_name)
        tags.append(tag)
    return tags

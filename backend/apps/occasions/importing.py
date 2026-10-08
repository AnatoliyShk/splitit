"""Turning an event's web page into an occasion: Gemini reads the page and replies with a JSON summary, and a
link-preview card built from it (preview.py) becomes the occasion's main image."""

import json
import re
from datetime import UTC, datetime, time

from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from apps.ai.client import generate_text
from apps.tags.models import Tag

from .preview import DEFAULT_THEME, THEMES, build_preview_svg, link_domain

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

Reply with only the JSON object in a ```json block."""

MAX_TAGS = 2
TAG_NAME_LENGTH = 50  # Tag.name max_length
NAME_LENGTH = 255  # Occasion.name max_length
DESCRIPTION_LENGTH = 2000  # Occasion.description max_length


class EventNotRead(Exception):
    """Gemini's reply had no usable event in it (no JSON, no title or no start)."""


def read_event(url):
    """Ask Gemini to read the event at `url`; returns parse_event_summary()'s fields, with `image_svg` (the preview
    card for the occasion's main image) in place of `theme`. Raises EventNotRead."""
    prompt = EVENT_PROMPT.format(url=url, today=timezone.localdate().isoformat())
    event = parse_event_summary(generate_text(prompt, read_urls=True, search_web=True))
    theme = event.pop("theme")
    event["image_svg"] = build_preview_svg(event["name"], event["description"], link_domain(url), theme).encode()
    return event


def parse_event_summary(reply):
    """The event in Gemini's reply, as Occasion fields plus `tag_names` and `theme` (a preview.py theme).

    Tolerates a ```json fence or a sentence around the object. Long text is cut to the model's limits, an end that
    isn't after the start is dropped rather than failing the import, and an unknown icon gets the default theme.
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
    start = parse_moment(summary.get("start_date"))
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

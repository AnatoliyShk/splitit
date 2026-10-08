"""The main image of an occasion added from a link: a 1200x630 link-preview card, as SVG.

Ported from frontend/og-preview.js. The title and a two-line subtitle sit on the left with an accent bar above,
the link's domain at the bottom, and a large themed icon on a soft blob on the right. Every piece of text is
escaped, so the page's (or the model's) words can't add markup.
"""

from urllib.parse import urlsplit
from xml.sax.saxutils import escape

THEMES = {
    "sakura": {"bg": "#F3F7FC", "blob": "#FCE4EC", "main": "#F7A8C2", "accent": "#E8608A", "second": "#8B6CE0"},
    "star": {"bg": "#F5F3FF", "blob": "#E9E3FF", "main": "#A78BFA", "accent": "#7C3AED", "second": "#E8608A"},
    "wave": {"bg": "#F0F9FF", "blob": "#DDF0FB", "main": "#7DC4E8", "accent": "#1D8CC4", "second": "#E8608A"},
}
DEFAULT_THEME = "star"

PETAL = "M0,0 C-15,-10 -17,-30 -9,-40 L0,-33 L9,-40 C17,-30 15,-10 0,0 Z"


def sakura_icon(colors):
    # Five rotated copies of one petal, so the flower is always symmetric, plus three loose petals
    flower = "".join(f'<path d="{PETAL}" transform="rotate({angle})"/>' for angle in (0, 72, 144, 216, 288))
    loose = "".join(
        f'<path d="{PETAL}" transform="{transform}"/>'
        for transform in (
            "translate(690 140) rotate(-30) scale(0.9)",
            "translate(760 540) rotate(40) scale(0.7)",
            "translate(1130 110) rotate(160) scale(0.6)",
        )
    )
    return (
        f'<g transform="translate(930 315) scale(4.4)" fill="{colors["main"]}">{flower}'
        f'<circle r="6" fill="{colors["accent"]}"/></g>'
        f'<g fill="{colors["main"]}" opacity="0.8">{loose}</g>'
    )


def star_icon(colors):
    return (
        '<g transform="translate(930 315)">'
        f'<path d="M0,-150 L38,-38 L150,0 L38,38 L0,150 L-38,38 L-150,0 L-38,-38 Z" fill="{colors["main"]}"/>'
        f'<circle r="18" fill="{colors["accent"]}"/></g>'
    )


def wave_icon(colors):
    return (
        '<g transform="translate(930 315)" fill="none" stroke-linecap="round" stroke-width="22">'
        f'<path d="M-150,-40 q37.5,-45 75,0 t75,0 t75,0 t75,0" stroke="{colors["main"]}"/>'
        f'<path d="M-150,30 q37.5,-45 75,0 t75,0 t75,0 t75,0" stroke="{colors["accent"]}"/></g>'
    )


ICONS = {"sakura": sakura_icon, "star": star_icon, "wave": wave_icon}


def text(value):
    """Escaped for use inside an SVG <text> element."""
    return escape(str(value), {'"': "&quot;", "'": "&apos;"})


def wrap(value, max_chars, max_lines):
    """Words into at most `max_lines` lines of about `max_chars`; a cut-off last line ends in "…"."""
    lines = []
    line = ""
    for word in str(value).split():
        candidate = f"{line} {word}" if line else word
        if len(candidate) <= max_chars:
            line = candidate
        else:
            if line:
                lines.append(line)
            line = word
    if line:
        lines.append(line)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        last_words = lines[-1].rsplit(" ", 1)
        # Drop a short last word, so the ellipsis doesn't follow a stray "a" or "to"
        trimmed = last_words[0] if len(last_words) == 2 and len(last_words[1]) <= 3 else lines[-1]
        lines[-1] = f"{trimmed}…"
    return lines


def link_domain(url):
    """What the card shows for the link: host and path without "www." or a trailing slash, e.g. example.com/events."""
    parts = urlsplit(url)
    host = parts.netloc.removeprefix("www.")
    shown = f"{host}{parts.path}".rstrip("/")
    return shown if len(shown) <= 48 else f"{shown[:47]}…"


def build_preview_svg(title, subtitle="", domain="", icon=DEFAULT_THEME):
    """The card as SVG markup; an unknown `icon` falls back to the default theme."""
    theme = icon if icon in THEMES else DEFAULT_THEME
    colors = THEMES[theme]

    # The text area is the left ~560px; shorter titles get bigger type
    size = 76 if len(title) <= 20 else 60 if len(title) <= 40 else 50
    title_lines = wrap(title, int(560 / (size * 0.55)), 3)
    line_height = size * 1.12
    subtitle_lines = wrap(subtitle, 34, 2)
    block_height = len(title_lines) * line_height + (24 + len(subtitle_lines) * 40 if subtitle_lines else 0)
    top = 315 - block_height / 2 + size * 0.8

    title_svg = "".join(
        f'<text x="96" y="{top + index * line_height:g}" font-size="{size}" font-weight="700" fill="#1F2340">'
        f"{text(line)}</text>"
        for index, line in enumerate(title_lines)
    )
    subtitle_top = top + (len(title_lines) - 1) * line_height + 24 + 40
    subtitle_svg = "".join(
        f'<text x="96" y="{subtitle_top + index * 40:g}" font-size="32" fill="#5B6178">{text(line)}</text>'
        for index, line in enumerate(subtitle_lines)
    )
    domain_svg = (
        f'<text x="96" y="580" font-size="24" font-weight="600" fill="{colors["second"]}">{text(domain)}</text>'
        if domain
        else ""
    )

    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">'
        f'<rect width="1200" height="630" fill="{colors["bg"]}"/>'
        f'<circle cx="930" cy="315" r="230" fill="{colors["blob"]}"/>'
        f"{ICONS[theme](colors)}"
        '<g font-family="Inter, DejaVu Sans, sans-serif">'
        f'<rect x="96" y="{top - size - 20:g}" width="56" height="6" rx="3" fill="{colors["accent"]}"/>'
        f"{title_svg}{subtitle_svg}{domain_svg}"
        "</g></svg>"
    )

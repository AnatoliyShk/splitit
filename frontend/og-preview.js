// og-preview.js — generates a minimal 1200x630 link-preview image (PNG) for a URL.
// Usage in your admin "URL added" handler:
//   const { generatePreview } = require('./og-preview');
//   const png = generatePreview({ title, subtitle, domain, icon: 'sakura' });
//   fs.writeFileSync(`public/og/${slug}.png`, png);
//
// npm i @resvg/resvg-js

const { Resvg } = require('@resvg/resvg-js');
const path = require('path');

const THEMES = {
  sakura: { bg: '#F3F7FC', blob: '#FCE4EC', main: '#F7A8C2', accent: '#E8608A', second: '#8B6CE0' },
  star:   { bg: '#F5F3FF', blob: '#E9E3FF', main: '#A78BFA', accent: '#7C3AED', second: '#E8608A' },
  wave:   { bg: '#F0F9FF', blob: '#DDF0FB', main: '#7DC4E8', accent: '#1D8CC4', second: '#E8608A' },
};

const ICONS = {
  // five rotated copies of one petal => always symmetric
  sakura: (c) => `
    <defs><path id="p" d="M0,0 C-15,-10 -17,-30 -9,-40 L0,-33 L9,-40 C17,-30 15,-10 0,0 Z"/></defs>
    <g transform="translate(930 315) scale(4.4)" fill="${c.main}">
      ${[0, 72, 144, 216, 288].map((a) => `<use href="#p" transform="rotate(${a})"/>`).join('')}
      <circle r="6" fill="${c.accent}"/>
    </g>
    <g fill="${c.main}" opacity="0.8">
      <use href="#p" transform="translate(690 140) rotate(-30) scale(0.9)"/>
      <use href="#p" transform="translate(760 540) rotate(40) scale(0.7)"/>
      <use href="#p" transform="translate(1130 110) rotate(160) scale(0.6)"/>
    </g>`,
  star: (c) => `
    <g transform="translate(930 315)">
      <path d="M0,-150 L38,-38 L150,0 L38,38 L0,150 L-38,38 L-150,0 L-38,-38 Z" fill="${c.main}"/>
      <circle r="18" fill="${c.accent}"/>
    </g>`,
  wave: (c) => `
    <g transform="translate(930 315)" fill="none" stroke-linecap="round" stroke-width="22">
      <path d="M-150,-40 q37.5,-45 75,0 t75,0 t75,0 t75,0" stroke="${c.main}"/>
      <path d="M-150,30 q37.5,-45 75,0 t75,0 t75,0 t75,0" stroke="${c.accent}"/>
    </g>`,
};

const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));

// Simple word wrap into at most `maxLines` lines; adds "…" if text is too long.
function wrap(text, maxChars, maxLines) {
  const words = String(text).trim().split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length <= maxChars) line = next;
    else { if (line) lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = cut[maxLines - 1].replace(/\s*\S{0,3}$/, '') + '…';
    return cut;
  }
  return lines;
}

function buildSvg({ title, subtitle = '', domain = '', icon = 'sakura' }) {
  const c = THEMES[icon] || THEMES.sakura;
  const draw = ICONS[icon] || ICONS.sakura;

  // Text area is the left ~560px. Shorter titles get bigger type.
  const size = title.length <= 20 ? 76 : title.length <= 40 ? 60 : 50;
  const lines = wrap(title, Math.floor(560 / (size * 0.55)), 3);
  const lh = size * 1.12;
  const subLines = wrap(subtitle, 34, 2);
  const blockH = lines.length * lh + (subLines.length ? 24 + subLines.length * 40 : 0);
  const top = 315 - blockH / 2 + size * 0.8;

  const titleSvg = lines
    .map((l, i) => `<text x="96" y="${top + i * lh}" font-size="${size}" font-weight="700" fill="#1F2340">${esc(l)}</text>`)
    .join('');
  const subTop = top + (lines.length - 1) * lh + 24 + 40;
  const subSvg = subLines
    .map((l, i) => `<text x="96" y="${subTop + i * 40}" font-size="32" fill="#5B6178">${esc(l)}</text>`)
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${c.bg}"/>
  <circle cx="930" cy="315" r="230" fill="${c.blob}"/>
  ${draw(c)}
  <g font-family="Inter, DejaVu Sans, sans-serif">
    <rect x="96" y="${top - size - 20}" width="56" height="6" rx="3" fill="${c.accent}"/>
    ${titleSvg}
    ${subSvg}
    ${domain ? `<text x="96" y="580" font-size="24" font-weight="600" fill="${c.second}">${esc(domain)}</text>` : ''}
  </g>
</svg>`;
}

function generatePreview(opts) {
  const svg = buildSvg(opts);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    font: {
      // Put a Cyrillic-capable font (e.g. Inter or Montserrat .ttf) in ./fonts on your server
      fontDirs: [path.join(__dirname, 'fonts')],
      loadSystemFonts: true,
      defaultFontFamily: 'Inter',
    },
  });
  return resvg.render().asPng();
}

module.exports = { buildSvg, generatePreview };

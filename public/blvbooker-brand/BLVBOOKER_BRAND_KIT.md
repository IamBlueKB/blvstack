# BLVBooker — Brand Identity Kit

> Styling source of truth for the BLVBooker arm. Use for the artist intake page,
> intake/notification emails, and the `/admin/booker/*` UI. Dark-first. Editorial,
> technical, premium — never cheesy. One accent color, lots of negative space.

---

## 1. Logo

**Files — all built and ready** (place in `/public/brand/`):
- `blvbooker-logo-dark.svg` — full wordmark on near-black field. Primary. Use on dark surfaces (email header, intake page, admin nav).
- `blvbooker-logo-transparent.svg` — full wordmark, no background. Drops onto any dark color.
- `blvbooker-mark.svg` — the indigo infinity loop ALONE, transparent. For loading states, inline accents, and as favicon source.
- `blvbooker-mark-tile.svg` — the infinity loop centered on a dark rounded tile. For favicon, app icon, and social avatar.

**Optional, generate only if/when needed (Claude Code):**
- `favicon.svg` / `favicon-32.png` / `favicon-180.png` — from `blvbooker-mark-tile.svg`.
- `blvbooker-email-header.png` — `blvbooker-logo-dark.svg` rasterized ~600px wide for email (clients won't render SVG reliably).

**Usage rules:**
- Clear space on all sides = the height of the infinity mark. Never crowd it.
- Minimum display width ~120px digital.
- Never recolor, stretch, rotate, add shadow/glow/gradient, or place the dark-background version on a light or busy background.
- The wordmark is a fixed asset — never recreate it in CSS/HTML text.

---

## 2. Color

Dark-first system, anchored to the logo's own colors. The official brand indigo is `#5558DE`.

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#0E0E13` | Page canvas / base (matches logo field) |
| `--surface` | `#16161D` | Cards, panels (raised one step) |
| `--surface-2` | `#1E1E27` | Inputs, deeper wells, table rows |
| `--border` | `#2A2A36` | Hairlines, dividers (default) |
| `--border-strong` | `#3A3A48` | Hover/active borders, secondary buttons |
| `--text` | `#F5F4F6` | Primary text (matches logo letters) |
| `--text-muted` | `#9A9AAB` | Secondary text, labels |
| `--text-faint` | `#6A6A7A` | Placeholders, hints, disabled |
| `--indigo` | `#5558DE` | Brand accent — primary buttons, links, focus |
| `--indigo-hover` | `#6A6DEF` | Hover state of indigo |
| `--indigo-soft` | `rgba(85,88,222,0.12)` | Tint backgrounds, focus rings |
| `--success` | `#34D399` | Booked / positive (use sparingly) |
| `--warning` | `#F5B544` | Pending / in-progress |
| `--danger` | `#F2545B` | Error / passed / dead |

Rules: one accent (indigo) carries the brand. Greens/ambers/reds are status-only, never decorative. No second brand color.

---

## 3. Typography

Use **Geist Sans** (display + body) and **Geist Mono** (labels, eyebrows, meta) — already loaded in the stack, so no new dependency. The distinctive element is the logo, not the UI font.

**Roles:**
- Display / headings: Geist Sans, weight 500–600, letter-spacing −0.01em to −0.02em (tight).
- Body: Geist Sans, weight 400, line-height 1.6.
- Eyebrows / labels / status / meta: Geist Mono, UPPERCASE, letter-spacing 0.18em, weight 500.

**Scale:**
| Use | Size / line-height | Font · weight |
|---|---|---|
| Display | 40 / 1.1 | Sans · 600 |
| H1 | 28 / 1.2 | Sans · 600 |
| H2 | 22 / 1.3 | Sans · 500 |
| H3 | 18 / 1.4 | Sans · 500 |
| Body | 16 / 1.6 | Sans · 400 |
| Small | 14 / 1.5 | Sans · 400 |
| Eyebrow / label | 11 / 1.4 | Mono · 500, 0.18em, uppercase |
| Micro / meta | 12 / 1.4 | Mono · 400 |

Eyebrow convention (matches BLVSTACK): `// ROSTER INTAKE` in mono, indigo or muted, above section headers.

---

## 4. Spacing, radius, borders

- Base unit 4px. Scale: 4, 8, 12, 16, 24, 32, 48, 64, 96.
- Radius: `sm` 6px, `md` 10px, `lg` 14px, pill 999px.
- Borders: 1px hairline at `--border`. No single-sided rounded corners.
- No drop shadows anywhere. Depth comes from surface steps (`--bg` → `--surface` → `--surface-2`), not shadow.
- Content max-width: intake form ~560px centered; admin content ~1100px.

---

## 5. Components

### Buttons
- **Primary:** bg `--indigo`, text `#FFFFFF`, radius `md`, padding 12px 20px. Label: Geist Mono, 12px, UPPERCASE, letter-spacing 0.15em. Hover: bg `--indigo-hover`.
- **Secondary:** transparent bg, 1px `--border-strong`, text `--text`, same radius/padding/label. Hover: bg `--surface-2`.
- **Ghost / text:** text `--indigo`, no bg/border. Hover: `--indigo-hover`.
- Disabled: 40% opacity, no hover.

### Form fields (intake page — get these right)
- Input/textarea/select: bg `--surface-2`, 1px `--border`, radius `md`, padding 12–14px, text `--text`, placeholder `--text-faint`.
- Focus: border `--indigo` + 3px ring `--indigo-soft`. No browser default outline.
- Label: above field, Geist Mono, 11px, UPPERCASE, 0.18em, `--text-muted`.
- Helper text 12px `--text-faint`; error text 12px `--danger`.
- Multi-step intake: thin progress indicator in `--indigo`; steps labeled in mono.

### Cards / panels
- bg `--surface`, 1px `--border`, radius `lg`, padding 24px. No shadow.

### Status badges (admin pipeline)
Mono, 11px, UPPERCASE, 0.12em, padding 4px 10px, radius pill:
- `suggested` → `--text-muted` on `--surface-2`
- `sent_to_artist` → `--indigo` on `--indigo-soft`
- `pitched` → `--warning` on amber tint
- `interested` → `--indigo-hover`
- `booked` → `--success` on green tint
- `passed` / `dead` → `--text-faint`

### Links
`--indigo`, hover `--indigo-hover`, underline on hover only. Never default browser blue (fixes the intake email's blue link).

---

## 6. Voice & tagline

- Tagline: **"Bookings, handled."**
- Operator voice: quiet confidence, first person ("I'll start pitching you to venues and matching you to gigs that fit"). No hype, no scarcity, no emoji.
- Promise framing: "you'll only hear from me when there's real opportunity on the table. No spam, no fluff."

---

## 7. Do / Don't (anti-cheese rules)

**Do:** flat solid fills; one indigo accent; generous negative space; hairline borders; mono eyebrows; tight heading tracking; surface-step depth.

**Don't:** gradients, glows, neon, drop shadows; more than one accent color; default-blue links; emoji; clip-art or stock-photo energy; tight cramped layouts; bold everything.

---

## 8. Ready-to-paste tokens

### CSS `:root`
```css
:root {
  --bg: #0E0E13;
  --surface: #16161D;
  --surface-2: #1E1E27;
  --border: #2A2A36;
  --border-strong: #3A3A48;
  --text: #F5F4F6;
  --text-muted: #9A9AAB;
  --text-faint: #6A6A7A;
  --indigo: #5558DE;
  --indigo-hover: #6A6DEF;
  --indigo-soft: rgba(85, 88, 222, 0.12);
  --success: #34D399;
  --warning: #F5B544;
  --danger: #F2545B;

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;

  --font-sans: "Geist", system-ui, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, monospace;
}
```

### Tailwind v4 `@theme`
```css
@theme {
  --color-bg: #0E0E13;
  --color-surface: #16161D;
  --color-surface-2: #1E1E27;
  --color-border: #2A2A36;
  --color-border-strong: #3A3A48;
  --color-text: #F5F4F6;
  --color-text-muted: #9A9AAB;
  --color-text-faint: #6A6A7A;
  --color-indigo: #5558DE;
  --color-indigo-hover: #6A6DEF;
  --color-success: #34D399;
  --color-warning: #F5B544;
  --color-danger: #F2545B;
  --radius-md: 10px;
  --radius-lg: 14px;
}
```

---

## 9. Email-specific (intake / notifications)

Email clients strip web fonts and external SVG. So for emails only:
- Logo = `blvbooker-email-header.png` (not SVG), ~600px wide, on `#0E0E13`.
- Font: system stack fallback (Helvetica, Arial, sans-serif) — Geist won't load.
- All styles INLINE. Background `#0E0E13`, text `#F5F4F6`, muted `#9A9AAB`.
- Button: bulletproof table/anchor with inline bg `#5558DE`, white text, 12px uppercase mono-ish, padding 14px 24px.
- Links: `#5558DE` (never default blue).
- Eyebrow `// ROSTER INTAKE` in uppercase letter-spaced caps.
- Keep the existing copy/voice — it's on-brand.

---

## 10. Asset inventory

| Asset | Status | Use |
|---|---|---|
| `blvbooker-logo-dark.svg` | ✅ ready | Dark surfaces, primary |
| `blvbooker-logo-transparent.svg` | ✅ ready | Any dark surface |
| `blvbooker-mark.svg` (infinity only) | ✅ ready | Inline accent, loading, favicon source |
| `blvbooker-mark-tile.svg` (infinity on dark tile) | ✅ ready | Favicon, app icon, avatar |
| `favicon.svg` / `favicon-32.png` / `favicon-180.png` | generate if needed | Browser/app icons |
| `blvbooker-email-header.png` | generate if needed | Email header (~600px, on `#0E0E13`) |

---

**Brand indigo: `#5558DE`. Tagline: "Bookings, handled." Dark-first, one accent, flat, spacious.**

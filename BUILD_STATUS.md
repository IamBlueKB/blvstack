# BLVSTACK — Site State

**Live:** https://blvstack.com
**Repo:** github.com/IamBlueKB/blvstack (master branch auto-deploys to Vercel)

---

## Stack

| Layer | Tool |
|---|---|
| Framework | Astro 5 (server mode) + Vercel adapter |
| Styling | Tailwind v4 (`@tailwindcss/vite`) |
| 3D / WebGL | Three.js + React Three Fiber + `@react-three/drei` |
| React islands | React 18 via `@astrojs/react` |
| Hosting | Vercel (Project `prj_EaFXwzrv3KNuKIK6yIKmSqmRW4HJ`) |
| DB | Supabase Postgres + RLS + pg_cron (`krrezgghzooecufeghul`) |
| Email | Resend (`blvstack.com` domain verified, `noreply@blvstack.com` sender) |
| Auth | HMAC-signed session cookie + bcrypt password hashes |
| Registrar | GoDaddy (A `@` → `76.76.21.21`, CNAME `www` → `cname.vercel-dns.com`) |

---

## Public Pages

- `/` — Hero, Marquee, Pillars, Process, CaseStudiesPreview, FounderNote, FinalCTA
- `/services` — L1 Agents / L2 Systems / L3 Interfaces with overview, included, ideal client, timelines, outcomes
- `/about` — Origin, Approach, Principles (6 cards), Stack (vendor-neutral), Founder note with press contact
- `/work` — Case study index
- `/work/precise-aesthetics` — Full case study (Problem, Approach, Build, Outcome, Stack)
- `/contact` — Three direct channels + contact form
- `/start` — 7-step intake form
- `/start/thank-you` — Confirmation (noindexed)
- `/blog` — Phase 2 placeholder
- `/404` — Editorial 404

---

## Brand

- Wordmark uses **Λ** (Greek capital Lambda) as the stylized 'A' → renders as `BLVSTΛCK`. Applied via shared `Brand.astro` + `Brand.tsx`. Email addresses, meta tags, and aria-labels keep plain "BLVSTACK" for compatibility.

### Tailwind tokens
| Token | Hex | Use |
|---|---|---|
| `navy` | `#0A1628` | Primary background |
| `navy-mid` | `#0F1525` | Card surface |
| `cream` | `#FAF8F3` | Primary text |
| `slate` | `#94A3B8` | Secondary / muted |
| `electric` | `#2563EB` | Accent (eyebrows, CTAs, glow) |

### Typography
- **Sans:** Geist with system fallback
- **Mono:** Geist Mono with system fallback
- Mono eyebrows: `text-[10px] tracking-[0.25em] uppercase text-electric` with `// Label` convention

### Animation
- `--ease-out-expo` cubic-bezier(0.16, 1, 0.3, 1)
- `.animate-fade-up` keyframes opacity + translateY, used with `animation-delay` stagger
- `prefers-reduced-motion: reduce` silences `.animate-fade-up` and `.animate-scroll-line`

---

## Home page components

- **Hero** (`Hero.astro`) — Label eyebrow, h1 with electric span, subhead, two CTAs (Primary "Start a Project" + Ghost "Talk to BLVSTΛCK AI" with magnetic pull)
- **HeroScene** (`HeroScene.tsx`) — WebGL `<Canvas>`. 600 background particles (cursor-reactive repulsion + return-to-origin spring). 2,500 logo-formation particles (assemble from random scatter into B shape, then fade). Extruded 3D B mark via shared `B3D` component with float + spin + lighting. Canvas is gated behind `requestAnimationFrame` × 2 + `setTimeout(0)` so the page paints HTML/CSS first.
- **Marquee** (`Marquee.tsx`) — Horizontal scrolling capability strip, pause on hover
- **Pillars** (`Pillars.tsx`) — 3-card grid for L1 / L2 / L3, each with title, body, capability list, hover lift
- **Process** (`Process.tsx`) — Mini-simulators showing engagement phases
- **CaseStudiesPreview** (`CaseStudiesPreview.astro`) — Single-panel Precise Aesthetics feature. Left 60%: tilted browser-chrome screenshot with electric glow + mouse-follow parallax (falls back to inline mockup if image absent). Right 40%: client logo, layer code, headline, body, capability tags, CTA.
- **FounderNote** (`FounderNote.astro`) — Full-width pull quote with founder signature
- **FinalCTA** (`FinalCTA.astro`) — Closing section with radial gradient + primary CTA

---

## Layout chrome

- **Nav** (`Nav.astro`) — Top-left logo + gradient mask. Fixed on desktop (≥768px). Absolute on mobile (scrolls away with the page).
- **NavOverlay** (`NavOverlay.tsx`) — Fullscreen menu with `motion/react` animations. Numbered links 01-05 (Work, Services, About, Start, Contact). Right panel has lazy-loaded 3D B with "// Drag to rotate" caption. Hamburger toggle fixed top-right `z-[60]`.
- **Footer** (`Footer.astro`) — 5-column uniform grid: studio identity (logo + tagline + availability dot) + Studio nav + What We Build nav + Connect nav (Start/Contact) + Channels (hello/info/support emails). Massive `BLVST∧CK` wordmark divider. Bottom strip with email + hidden `©` link to `/admin` (rel=nofollow).
- **Cursor** (`Cursor.tsx`) — 12×12 cream dot following pointer with lerp 0.38. Hover scale 3× + `mix-blend-mode: difference`. Magnetic pull on `[data-magnetic]` elements via mousemove transform. Re-attaches on `astro:page-load`. Touch devices auto-skip via `hover: none` media query.
- **SmoothScroll** (`SmoothScroll.tsx`) — Lenis-style scroll easing
- **Grain** (`Grain.tsx`) — Fullscreen canvas film grain overlay, `mix-blend-mode: overlay`
- **AudioToggle** (`AudioToggle.tsx`) — Component exists but commented out in `Base.astro` (not currently rendered)
- **SimChatAgent** (`SimChatAgent.tsx`) — Homepage AI chat island, opens from "Talk to BLVSTΛCK AI" CTA. Currently uses canned responses; backend wiring is Phase 2.

---

## Email channels

| Address | Purpose | Surfaced where |
|---|---|---|
| `hello@blvstack.com` | General / inquiries | Contact page, footer, founder signature |
| `info@blvstack.com` | Press / partnerships | Contact page, About founder note |
| `support@blvstack.com` | Existing clients | Contact page |
| `billing@blvstack.com` | Invoice footers | Internal only |
| `noreply@blvstack.com` | Transactional sender | All Resend sends |

---

## Forms + API

### `/start`
- 7-step React form (`StartForm.tsx`): Name → Business + Website → Revenue → Problem → Timeline → Budget → Email + Phone
- `focusRef` with `preventScroll: true` on focus
- Honeypot anti-spam field
- Rate limit: 3 / 24h per IP
- POSTs to `/api/start` → inserts into `leads` table → sends 2 branded emails (founder notification + applicant auto-reply) → redirects to `/start/thank-you`

### `/contact`
- React form (`ContactForm.tsx`): name + email + message (10-char minimum)
- Honeypot + email shape validation
- Rate limit: 5 / 24h per IP
- POSTs to `/api/contact` → inserts into `contact_messages` table → 2 branded emails

### Branded email template (`src/lib/email-template.ts`)
- `wrapEmail({ preheader, eyebrow, title, body, cta?, signoff? })` shared shell
- Helpers: `dataTable()`, `quoteBlock()`, `metaLine()`, `escapeHtml()`
- Inline styles only, table-based layout (Gmail/Outlook compat)
- Brand: navy bg, electric accents, cream text, BLVSTΛCK header
- Used by: `/api/start`, `/api/contact`, `/api/admin/forgot`

---

## Admin Console

### Auth
- Credentials live in `admin_users` table (bcrypt hash). Seeds from `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars on first login, after which env vars are ignored.
- Session: HMAC-signed cookie `blvstack_admin`, HTTP-only, secure in prod, 7-day expiry
- Middleware (`src/middleware.ts`) gates `/admin/*` and `/api/admin/*`. Public paths: `/admin/login`, `/admin/forgot`, `/admin/reset/<token>`, `/api/admin/login`, `/api/admin/logout`, `/api/admin/forgot`, `/api/admin/reset`.
- Hidden entry: footer `©` symbol links to `/admin` (rel=nofollow)
- All admin pages send `noindex, nofollow, noarchive, nosnippet`
- `robots.txt` disallows `/admin/`. Sitemap excludes `/admin/*` and `/start/thank-you`.

### Password reset
- `/admin/forgot` requests reset link by email
- Rate-limited 3/hr/IP; "sent" message shown regardless of email match (no enumeration)
- Generates 30-min single-use token in `admin_reset_tokens` table
- Branded reset email via Resend
- `/admin/reset/[token]` sets new password (min 10 chars) → redirects to login with success banner

### Pages
- `/admin/login` — Email + password, eye toggle, "Forgot password?" link
- `/admin` — Stats (total leads, new this week, conversion %, open messages), status breakdown grid, recent activity for leads + messages
- `/admin/leads` — Filterable table by status (7 statuses: new, qualified, call_booked, proposal_sent, won, lost, disqualified)
- `/admin/leads/[id]` — Full submission detail, status dropdown + notes editor (PATCH on save), mailto reply, Danger zone delete-to-trash
- `/admin/messages` — Filterable list (all / new / resolved), per-row Resolve/Reopen + Delete-to-trash
- `/admin/trash` — Tabbed Leads / Messages, per-item "purge in N days" countdown, Restore / Delete now
- `/admin/settings?tab=account` — Identity (email, role) + Session sign-out
- `/admin/settings?tab=password` — Change password (current + new + confirm), eye toggles on all fields

### Sidebar nav
- 4 numbered items: 01 Overview / 02 Leads / 03 Messages / 04 Settings
- Trash nested under Messages as expandable child (auto-opens when on Messages or Trash, chevron rotates)
- Active state: electric dot + bg highlight
- Mobile: hamburger drawer with same nested structure
- Native cursor restored on all admin pages (the marketing custom cursor is hidden)

### API routes
- `POST /api/admin/login` / `POST /api/admin/logout`
- `POST /api/admin/forgot` (rate-limited) / `POST /api/admin/reset`
- `POST /api/admin/settings/password`
- `PATCH /api/admin/leads/[id]` (status, notes)
- `DELETE /api/admin/leads/[id]` (soft delete; `?permanent=true` for hard delete)
- `POST /api/admin/leads/[id]?restore=true`
- `PATCH /api/admin/messages/[id]` (status)
- `DELETE /api/admin/messages/[id]` + `POST ?restore=true`

### Trash behavior
- Soft delete sets `deleted_at` timestamp
- All non-trash list queries filter `deleted_at IS NULL`
- Supabase pg_cron job `purge-old-trash` runs daily at **03:00 UTC**, hard-deletes rows older than 30 days

---

## Database

### Tables
| Table | Purpose |
|---|---|
| `leads` | `/start` form submissions. 13 columns. Status enum. Soft-delete via `deleted_at`. |
| `contact_messages` | `/contact` form submissions. Status (new / resolved). Soft-delete. |
| `agent_conversations` | Reserved for Phase 2 homepage AI chat. |
| `admin_users` | Admin credentials (email + bcrypt hash + timestamps). |
| `admin_reset_tokens` | Password reset tokens (30-min expiry, single-use, `used_at` marker). |

### Security
- RLS enabled on every table
- Service-role full-access policies (server inserts via `supabaseAdmin` client)
- No public read policies — admin reads use service role
- `pg_cron` extension enabled for scheduled purge

---

## SEO + Assets

### Meta
- Per-page `<title>`, meta description, canonical, Open Graph, Twitter Card in `Base.astro`
- Schema.org JSON-LD `Organization` block (no `sameAs` URLs — added back when social accounts exist)
- `noindex, nofollow, noarchive, nosnippet` on all `/admin/*`
- `robots.txt`: allows AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, etc.), blocks SEO scrapers (SemrushBot, AhrefsBot, MJ12bot, DotBot), disallows `/api/`, `/admin/`, `/start/thank-you`
- `llms.txt` for AI search optimization
- Sitemap (auto-generated, filtered)

### Images
- `/public/favicon.svg` — Bold electric-blue B on rounded navy square (100×100 viewBox)
- `/public/favicon-256.png`, `/public/favicon-32.png` — PNG fallbacks
- `/public/apple-touch-icon.png` — 180×180 home-screen icon
- `/public/og/default.png` — 1200×630 OG card (BLVSTΛCK wordmark, tagline, status pill)
- `/public/logo.svg` — Wordmark with rotated V replacing 'A'
- `/public/b-mark.svg` — Hero 3D B vector source

---

## Performance (current Lighthouse Mobile scores)

| Page | Perf | A11y | BP | SEO |
|---|---|---|---|---|
| home | 55* | 91 | 96 | 100 |
| services | 94 | 91 | 100 | 100 |
| about | 94 | 90 | 100 | 100 |
| work | 96 | 90 | 100 | 100 |
| work/precise-aesthetics | 94 | 90 | 100 | 100 |
| contact | 94 | 92 | 100 | 100 |
| start | 96 | 91 | 100 | 100 |

*Home page perf reflects the WebGL hero. Hero Canvas mounts after first paint via deferred-mount strategy, so users see text + CTAs immediately; particles fade in after.

---

## Environment Variables

```
PUBLIC_SUPABASE_URL
PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
RESEND_API_KEY
FOUNDER_EMAIL
ADMIN_EMAIL
ADMIN_PASSWORD
ADMIN_SESSION_SECRET
PUBLIC_PLAUSIBLE_DOMAIN
ANTHROPIC_API_KEY            (placeholder for Phase 2 chat)
TURNSTILE_SECRET_KEY         (placeholder)
PUBLIC_TURNSTILE_SITE_KEY    (placeholder)
```

Set in both `.env.local` (gitignored) and Vercel production.

---

## Folder / Code Organization

```
src/
├─ components/
│   ├─ agent/          SimChatAgent.tsx
│   ├─ contact/        ContactForm.tsx
│   ├─ home/           Hero.astro, HeroScene.tsx, Marquee.tsx, Pillars.tsx,
│   │                   Process.tsx, CaseStudiesPreview.astro,
│   │                   FounderNote.astro, FinalCTA.astro, FounderVisual.tsx
│   ├─ layout/         Nav.astro, NavOverlay.tsx, Footer.astro, Cursor.tsx,
│   │                   SmoothScroll.tsx, Grain.tsx, AudioToggle.tsx
│   ├─ start/          StartForm.tsx
│   ├─ three/          B3D.tsx, MenuLogo3D.tsx
│   ├─ Brand.astro
│   └─ Brand.tsx
├─ layouts/
│   ├─ Base.astro
│   └─ AdminLayout.astro
├─ lib/
│   ├─ supabase.ts
│   ├─ resend.ts
│   ├─ rate-limit.ts
│   ├─ email-template.ts
│   └─ admin-session.ts
├─ middleware.ts
├─ env.d.ts
├─ pages/
│   ├─ index.astro, services.astro, about.astro, contact.astro,
│   │   start.astro, blog/index.astro, work/index.astro,
│   │   work/precise-aesthetics.astro, start/thank-you.astro, 404.astro
│   ├─ admin/
│   │   ├─ index.astro, login.astro, forgot.astro, settings.astro,
│   │   │   trash.astro, messages.astro
│   │   ├─ reset/[token].astro
│   │   └─ leads/index.astro, leads/[id].astro
│   └─ api/
│       ├─ start.ts, contact.ts
│       └─ admin/
│           ├─ login.ts, logout.ts, forgot.ts, reset.ts
│           ├─ settings/password.ts
│           ├─ leads/[id].ts
│           └─ messages/[id].ts
└─ styles/globals.css
public/
├─ favicon.svg, favicon-256.png, favicon-32.png, favicon.ico
├─ apple-touch-icon.png, logo.svg, b-mark.svg
├─ og/default.png
├─ case-studies/precise-aesthetics-logo.svg
├─ robots.txt, llms.txt
scripts/
└─ generate-og.mjs
astro.config.mjs
supabase-schema.sql
```

---

## Not Present in Final Site

- **Precise Aesthetics screenshot image** — case study uses an inline mockup fallback drawn in CSS
- **WCAG AA contrast compliance** — slate-on-navy and electric-on-navy are intentional brand language
- **Social profile links** (X, LinkedIn, GitHub) — no accounts yet
- **Audio toggle** — feature WIP; component exists in repo but commented out in `Base.astro`
- **Per-page OG image variants** — single default OG used for all pages
- **Plausible analytics snippet** — env var set, `<script>` not yet inserted
- **Founder photo** — `/about` is text-only
- **Working SimChatAgent backend** — opens but uses canned responses; no LLM call wired
- **Blog content** — `/blog` is a placeholder page
- **Turnstile / Cloudflare bot protection** — honeypot only

---

## Operational Reference

### Deploy
```
git push                    # GitHub → Vercel webhook → auto-deploy from master
```

### Sign in as admin
- `/admin/login` — credentials per `admin_users` row
- Forgot password: `/admin/forgot`

### View submissions
- Admin UI: `/admin/leads`, `/admin/messages`
- SQL: Supabase dashboard SQL editor (project `krrezgghzooecufeghul`)

### Check trash purge job
```sql
SELECT * FROM cron.job WHERE jobname = 'purge-old-trash';
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;
```

### Regenerate OG image
```
node scripts/generate-og.mjs
```

### Vercel project
- Project ID: `prj_EaFXwzrv3KNuKIK6yIKmSqmRW4HJ`
- Team ID: `team_OTSKSF9Pc8Ai2qhflAIhFFpE`

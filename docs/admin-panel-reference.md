# BLVSTACK Admin Panel — Build Reference

## Tech Stack

| Layer | Tool | Version |
|---|---|---|
| Framework | Astro (server mode) | 6.3.1 |
| Adapter | @astrojs/vercel | 10.0.6 |
| UI islands | React | 19.2.6 |
| Styling | Tailwind CSS | 4.3.0 |
| Database | Supabase (PostgreSQL + pg_cron) | client 2.105.4 |
| Auth | HMAC-signed session cookies + bcrypt | bcryptjs 3.0.3 |
| Transactional email | Resend SDK | 6.12.3 |
| AI | Anthropic SDK (Claude Sonnet 4.5) | 0.95.2 |
| Hosting | Vercel | — |
| Cron | Vercel Cron | — |
| Language | TypeScript | 6.0.3 |
| Node | — | >=22.12.0 |

---

## Supabase Schema

### `admin_users`
Admin authentication credentials.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK, default `gen_random_uuid()` |
| `email` | text | UNIQUE, NOT NULL |
| `password_hash` | text | NOT NULL, bcrypt 12 rounds |
| `created_at` | timestamptz | default `now()` |
| `updated_at` | timestamptz | default `now()` |

**RLS:** Enabled. Service role full access. No public policies.

---

### `admin_reset_tokens`
Single-use password reset tokens.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `email` | text | NOT NULL |
| `token_hash` | text | NOT NULL, bcrypt hash of plain token |
| `expires_at` | timestamptz | NOT NULL (30 min from creation) |
| `used_at` | timestamptz | nullable, marks consumed token |
| `created_at` | timestamptz | default `now()` |

**RLS:** Enabled. Service role only.

---

### `leads`
Submissions from `/start` intake form.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `created_at` | timestamptz | default `now()` |
| `name` | text | NOT NULL |
| `email` | text | NOT NULL |
| `phone` | text | nullable |
| `business_name` | text | nullable |
| `website_url` | text | nullable |
| `revenue_range` | text | nullable |
| `problem` | text | NOT NULL |
| `timeline` | text | nullable |
| `budget_tier` | text | nullable |
| `source` | text | nullable, e.g. 'intake_form' |
| `status` | text | default `'new'`, CHECK IN (new, qualified, call_booked, proposal_sent, won, lost, disqualified) |
| `notes` | text | nullable, freeform append-only log |
| `ai_analysis` | jsonb | nullable, output of triage agent |
| `ai_analyzed_at` | timestamptz | nullable |
| `deleted_at` | timestamptz | nullable, soft-delete marker |

**Indexes:** `status`, `deleted_at`, `created_at DESC`
**RLS:** Enabled. Service role only.

---

### `contact_messages`
Submissions from `/contact` form.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `created_at` | timestamptz | default `now()` |
| `name` | text | NOT NULL |
| `email` | text | NOT NULL |
| `message` | text | NOT NULL |
| `status` | text | default `'new'`, CHECK IN (new, resolved) |
| `deleted_at` | timestamptz | nullable, soft-delete marker |

**RLS:** Enabled. Service role only.

---

### `prospects`
Outbound lead pipeline.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `created_at` | timestamptz | default `now()` |
| `source_url` | text | URL prospect was extracted from |
| `company_name` | text | nullable |
| `company_url` | text | nullable |
| `contact_name` | text | nullable |
| `contact_email` | text | nullable, indexed |
| `pain_points` | text | nullable, summary |
| `ai_research` | jsonb | nullable, full research output |
| `draft_subject` | text | nullable |
| `draft_email` | text | nullable, plain text |
| `approved` | boolean | default `false` |
| `gmail_thread_id` | text | nullable (legacy name, used for Resend message threading) |
| `gmail_message_id` | text | nullable |
| `status` | text | default `'new'`, CHECK IN (new, researched, composed, queued, sent, follow_up_1, follow_up_2, follow_up_3, replied, booked, dead, suppressed) |
| `last_sent_at` | timestamptz | nullable |
| `next_follow_up_at` | timestamptz | nullable, indexed |
| `follow_up_count` | int | default `0` |
| `replied_at` | timestamptz | nullable |
| `notes` | text | nullable |

**Indexes:** `status`, `next_follow_up_at WHERE NOT NULL`, `contact_email`
**RLS:** Enabled. Service role only.

---

### `outbound_emails`
Log of every cold/follow-up email sent. FK cascade on prospect delete.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `prospect_id` | uuid | FK → prospects.id, ON DELETE CASCADE |
| `created_at` | timestamptz | default `now()` |
| `type` | text | CHECK IN (initial, follow_up_1, follow_up_2, follow_up_3) |
| `subject` | text | NOT NULL |
| `body` | text | NOT NULL |
| `gmail_message_id` | text | nullable, Resend message ID |
| `gmail_thread_id` | text | nullable |
| `status` | text | default `'sent'`, CHECK IN (sent, bounced, replied) |

**Indexes:** `prospect_id`
**RLS:** Enabled. Service role only.

---

### `suppression_list`
Permanent opt-outs. Checked at insert + send.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `email` | text | UNIQUE, NOT NULL |
| `reason` | text | CHECK IN (unsubscribed, bounced, manual) |
| `created_at` | timestamptz | default `now()` |

**Indexes:** `email`
**RLS:** Enabled. Service role only.

---

### `outbound_settings`
Key-value config for outbound system.

| Column | Type | Notes |
|---|---|---|
| `key` | text | PK |
| `value` | text | NOT NULL |

**Seeded keys:**
- `daily_cap` (default '10')
- `follow_up_days` (default '4,10,21')
- `outbound_from_email`
- `outbound_from_name` (default 'Blue')
- `outbound_calendar_link`
- `warmup_complete` (default 'false')

**RLS:** Enabled. Service role only.

---

### Database Extensions
- `pg_cron` — daily purge job `purge-old-trash` at 03:00 UTC, hard-deletes rows where `deleted_at < now() - INTERVAL '30 days'` from `leads` + `contact_messages`.

---

## Admin Routes

### Page Routes (`/src/pages/admin/`)

| Path | File | Auth | Purpose |
|---|---|---|---|
| `/admin` | `index.astro` | Required | Overview: stats (total leads, new this week, conversion %, open messages), recent activity |
| `/admin/login` | `login.astro` | Public | Email + password + eye toggle + forgot link |
| `/admin/forgot` | `forgot.astro` | Public | Request reset email (rate-limited 3/hr/IP) |
| `/admin/reset/[token]` | `reset/[token].astro` | Public | Set new password (min 10 chars) |
| `/admin/leads` | `leads/index.astro` | Required | Filterable lead table by status |
| `/admin/leads/[id]` | `leads/[id].astro` | Required | Lead detail + AI Triage + AI Draft Reply + status/notes edit + delete |
| `/admin/prospects` | `prospects/index.astro` | Required | Outbound prospects list; Find Prospects (Google Places) + Add URLs (manual scrape) modals |
| `/admin/prospects/[id]` | `prospects/[id].astro` | Required | Prospect detail + Research/Compose/Approve/Queue + sent history |
| `/admin/outbound` | `outbound.astro` | Required | Pipeline stats, health, recent replies, upcoming follow-ups, batch send/check buttons |
| `/admin/messages` | `messages.astro` | Required | Contact messages list, Resolve/Reopen/Delete |
| `/admin/trash` | `trash.astro` | Required | Soft-deleted leads + messages, Restore/Purge with countdown |
| `/admin/stack` | `stack.astro` | Required | Reference page listing all tools/services (internal) |
| `/admin/settings?tab=account` | `settings.astro` | Required | Identity + sign out |
| `/admin/settings?tab=password` | `settings.astro` | Required | Change password (current + new + confirm, eye toggles) |
| `/admin/settings?tab=outbound` | `settings.astro` | Required | Sender identity, daily cap, follow-up schedule, calendar link |

### API Routes (`/src/pages/api/admin/`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/admin/login` | Email + password → set session cookie |
| POST | `/api/admin/logout` | Clear session |
| POST | `/api/admin/forgot` | Send reset email (rate-limited) |
| POST | `/api/admin/reset` | Consume token, set new password |
| POST | `/api/admin/settings/password` | Change password (requires current) |
| PATCH | `/api/admin/leads/[id]` | Update status/notes |
| DELETE | `/api/admin/leads/[id]` | Soft delete (or `?permanent=true`) |
| POST | `/api/admin/leads/[id]?restore=true` | Restore from trash |
| POST | `/api/admin/leads/[id]/analyze` | AI triage → stores `ai_analysis` JSONB |
| POST | `/api/admin/leads/[id]/draft-reply` | AI generates founder-voice reply |
| POST | `/api/admin/leads/[id]/send-reply` | Send branded reply via Resend |
| PATCH | `/api/admin/messages/[id]` | Update status |
| DELETE | `/api/admin/messages/[id]` | Soft delete |
| POST | `/api/admin/messages/[id]?restore=true` | Restore |
| GET | `/api/admin/prospects` | List (filterable by status) |
| POST | `/api/admin/prospects` | Insert one or many |
| GET | `/api/admin/prospects/[id]` | Single prospect |
| PUT | `/api/admin/prospects/[id]` | Update allowed fields |
| DELETE | `/api/admin/prospects/[id]` | Hard delete |
| POST | `/api/admin/prospects/scrape` | Fetch URLs + scraper agent extraction |
| POST | `/api/admin/prospects/find` | Google Places search → insert prospects |
| POST | `/api/admin/prospects/[id]/research` | Researcher agent |
| POST | `/api/admin/prospects/[id]/compose` | Composer agent |
| POST | `/api/admin/outbound/send-batch` | Send queued, respect daily cap |
| POST | `/api/admin/outbound/process-followups` | Send due follow-ups |
| POST | `/api/admin/outbound/check-replies` | Reply activity summary |
| GET | `/api/admin/outbound/stats` | Pipeline + week/today metrics + health |
| GET/PUT | `/api/admin/outbound/settings` | CRUD on outbound_settings |

### Webhook Routes (`/src/pages/api/webhooks/`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/webhooks/resend-outbound` | Optional `svix-signature` | `email.bounced` → suppression + mark dead; `email.complained` → same; `email.delivered` → log |
| POST | `/api/webhooks/inbound-reply` | `INBOUND_WEBHOOK_SECRET` in body | Reply matched by sender email → mark replied or suppressed |

### Cron Routes (`/src/pages/api/cron/`)

| Method | Path | Auth | Schedule | Purpose |
|---|---|---|---|---|
| GET | `/api/cron/outbound` | `Bearer ${CRON_SECRET}` | `0 */6 * * *` | Run send batch + follow-ups |

---

## Auth / Session Pattern

### HMAC Session Cookies

**File:** `src/lib/admin-session.ts`

```typescript
// Cookie format: <base64url(payload)>.<base64url(hmac-sha256(payload, SECRET))>
// payload = JSON.stringify({ email, iat, exp })
// SECRET = ADMIN_SESSION_SECRET env var
```

**Cookie attributes:**
- Name: `blvstack_admin`
- HTTP-only: `true`
- Secure: `true` (production only)
- SameSite: `Lax`
- Max-Age: 7 days
- Path: `/`

**Functions:**
- `setAdminSession(cookies, email)` — sign + set cookie
- `clearAdminSession(cookies)` — delete cookie
- `readAdminSession(cookies)` — verify + return email or null
- `verifyLogin(email, password)` — bcrypt compare against `admin_users`
- `changePassword(email, current, next)` — verify current + update hash
- `setPasswordDirect(email, next)` — used by reset flow
- `getAdminEmail()` — fetch from DB
- `createResetToken(email)` — insert hashed token, return plain token
- `consumeResetToken(token, newPassword)` — validate + update

### Middleware Gate

**File:** `src/middleware.ts`

```typescript
// Gates: /admin/*, /api/admin/*
// Public exceptions:
//   - /admin/login, /admin/forgot, /admin/reset/<token>
//   - /api/admin/login, /api/admin/logout, /api/admin/forgot, /api/admin/reset
//   - /api/cron/*  (protected by CRON_SECRET instead of session)
//   - /api/webhooks/*  (protected by their own secrets)
//
// API requests without session → 401 JSON
// Page requests without session → redirect to /admin/login
// Adds `locals.adminEmail` for downstream use
```

### Seed Account Flow
- First login attempts `verifyLogin(ADMIN_EMAIL, ADMIN_PASSWORD)` from env vars
- If `admin_users` empty AND env values match → insert hashed row, succeed
- After first successful login, env vars are ignored — DB is source of truth

### Password Reset Flow
1. POST `/api/admin/forgot { email }` (rate-limited 3/hr/IP)
2. Server generates 32-byte token, bcrypt-hashes it, inserts `admin_reset_tokens` row (30-min expiry)
3. Resend email contains `/admin/reset/<plain-token>` link
4. User submits new password to POST `/api/admin/reset { token, password }`
5. Server validates token, sets `used_at`, calls `setPasswordDirect`
6. Redirect to `/admin/login?reset=success`

---

## Modules

### Leads Module

**Tables:** `leads`
**Pages:** `/admin/leads`, `/admin/leads/[id]`
**API:** `/api/admin/leads/[id]` (PATCH, DELETE), `/api/admin/leads/[id]/analyze`, `/draft-reply`, `/send-reply`

**AI Triage (analyze):**
- Calls Claude with `BLVSTACK_SYSTEM` prompt from `src/lib/anthropic.ts`
- Returns structured JSON: `fit`, `fit_reason`, `tier`, `tier_reason`, `scope_estimate`, `discovery_questions[]`, `red_flags[]`, `summary`
- Stored in `leads.ai_analysis` JSONB column
- Discovery questions must be lead-specific (5-7 questions, no generic openers)

**AI Draft Reply:**
- Calls Claude with `DRAFT_SYSTEM` prompt (`/api/admin/leads/[id]/draft-reply.ts`)
- Returns 80-150 word founder-voice plain text email
- User edits in modal, then sends via Resend (branded template)

### Messages Module

**Tables:** `contact_messages`
**Pages:** `/admin/messages`
**API:** `/api/admin/messages/[id]`

Simple list + resolve/reopen + soft-delete to trash.

### Trash Module

**Tables:** `leads`, `contact_messages` (filtered to `deleted_at IS NOT NULL`)
**Pages:** `/admin/trash`
**API:** `?restore=true` on lead/message DELETE endpoints, `?permanent=true` for hard delete

**Soft delete:** `UPDATE … SET deleted_at = now()`
**Restore:** `UPDATE … SET deleted_at = NULL`
**Auto-purge:** `pg_cron` job `purge-old-trash` runs daily 03:00 UTC, deletes rows where `deleted_at < now() - INTERVAL '30 days'`
**UI:** per-item countdown shows days until auto-purge

### Outbound System

**Tables:** `prospects`, `outbound_emails`, `suppression_list`, `outbound_settings`
**Pages:** `/admin/prospects`, `/admin/prospects/[id]`, `/admin/outbound`
**Settings tab:** `/admin/settings?tab=outbound`

**Lib files (`src/lib/outbound/`):**
- `scraper.ts` — Claude agent: extracts prospects from a URL's text content. Accepts `alreadyExtracted` for pagination.
- `researcher.ts` — Claude agent: reads company website, returns pain points + outreach angle + contact hints.
- `composer.ts` — Claude agent: writes cold email (60-100 words) + follow-ups (30-60 words). Plain text only.
- `engine.ts` — Orchestration. `runSendBatch()`, `runFollowUps()`, `processInboundReply()`, `processBounce()`.
- `places.ts` — Google Places API (New) text search client.

**Sender lib:** `src/lib/outbound-email.ts`
- Uses second Resend account (`RESEND_OUTBOUND_API_KEY`) for cold sends from `tryblvstack.com`
- Plain text only
- Auto-appends calendar link line + unsubscribe footer

**Pipeline:** `new → researched → composed → queued → sent → follow_up_1 → follow_up_2 → follow_up_3 → replied | booked | dead | suppressed`

**Cron:** `/api/cron/outbound` runs send batch + follow-ups every 6 hours.

**Reply detection:** webhook-driven (`/api/webhooks/inbound-reply`), not polling. Match by sender email against `prospects.contact_email` for active statuses.

**Sequence days:** 4 / 10 / 21 (configurable via `follow_up_days` setting).

**Daily send cap:** combined across initial + follow-ups (`daily_cap` setting, default 10).

---

## Email Pattern

### Transactional Sender
**File:** `src/lib/resend.ts`

```typescript
export const resend = new Resend(import.meta.env.RESEND_API_KEY);
export const FOUNDER_EMAIL = import.meta.env.FOUNDER_EMAIL ?? 'hello@blvstack.com';
export const FROM_EMAIL = 'BLVSTACK <noreply@blvstack.com>';
```

### Outbound (Cold) Sender
**File:** `src/lib/outbound-email.ts`

```typescript
const outboundKey = import.meta.env.RESEND_OUTBOUND_API_KEY;
const resend = new Resend(outboundKey);
// From: <outbound_from_name> <outbound_from_email>
// Plain text only. Auto-appends calendar link + unsubscribe.
```

### Branded HTML Template
**File:** `src/lib/email-template.ts`

```typescript
wrapEmail({
  preheader: string,   // hidden preview text
  eyebrow: string,     // e.g. "// New Lead"
  title: string,       // headline
  body: string,        // HTML body (use helpers)
  cta?: { label, url },
  signoff?: string,
}): string  // returns full HTML doc

// Helpers:
dataTable(rows: [string, string][]): string  // label/value rows
quoteBlock(text: string): string             // styled <blockquote>
metaLine(text: string): string               // small muted footer line
escapeHtml(text: string): string             // safe interpolation
```

**Design:**
- Inline styles only (Gmail/Outlook compat)
- Table-based layout
- Brand: navy `#0A0E1A` bg, electric `#2563EB` accents, cream `#FAF8F3` text
- BLVSTΛCK header wordmark

**Used by:**
- `POST /api/start` — applicant auto-reply + founder notification
- `POST /api/contact` — confirmation + founder notification
- `POST /api/admin/forgot` — reset email
- `POST /api/admin/leads/[id]/send-reply` — manual reply

**Never used by cold outbound** (plain text only for deliverability).

### Rate Limiting
**File:** `src/lib/rate-limit.ts`

In-memory rate limiter keyed by IP. Used by `/api/start` (3/24h), `/api/contact` (5/24h), `/api/admin/forgot` (3/hr).

---

## Shared Components / UI Patterns

### `AdminLayout.astro`
**Path:** `src/layouts/AdminLayout.astro`

**Props:**
```typescript
interface Props {
  title: string;
  adminEmail?: string;
  hideNav?: boolean;
  active?: 'overview' | 'leads' | 'prospects' | 'outbound' | 'messages' | 'trash' | 'stack' | 'settings';
}
```

**Structure:**
- Fixed left sidebar (`w-60` md, `w-64` lg), hidden on mobile
- Mobile: top bar + hamburger drawer
- Numbered nav items (`01–07`), electric active dot, chevron-expandable children (Trash under Messages)
- Auto-detects active item from `Astro.url.pathname` if not passed
- Footer block: signed-in email + sign out form
- Global style override restores native cursor (overrides marketing custom cursor)
- `<title>` becomes `${title} — BLVSTACK Console`
- `<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">` always

### Common Form UI Patterns

**Eye-toggle on password inputs:**
- Wrap input in `.pw-field` div
- Add `[data-pw-toggle]` button containing `[data-eye-show]` + `[data-eye-hide]` SVGs
- Script in `settings.astro` wires up toggle (input type swap + svg visibility)

**Form submit + status feedback:**
- `<p id="…-msg" class="font-mono text-[11px] tracking-wide hidden">`
- States: text-slate/60 (loading), text-red-400 (error), text-electric (success)
- `e.preventDefault()` → fetch → toggle classes

**Modal pattern:**
- Fixed overlay: `class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/70"`
- Inner card: `bg-navy border border-white/10 w-full max-w-xl mx-4 p-6`
- Click outside dismisses (`if (e.target === modal) modal.classList.add('hidden')`)
- Cancel button dismisses
- Open via `modal.classList.remove('hidden')`

### Status Badges

```typescript
// Pattern for colored status pills
function statusColor(s: string): string {
  switch (s) {
    case 'replied': case 'booked': return 'text-emerald-400 border-emerald-400/40';
    case 'sent': case 'follow_up_1': case 'follow_up_2': case 'follow_up_3': return 'text-amber-400 border-amber-400/40';
    case 'dead': case 'suppressed': return 'text-red-400 border-red-400/40';
    case 'queued': case 'composed': return 'text-electric border-electric/40';
    default: return 'text-slate/80 border-white/10';
  }
}
// Applied to: <span class={`font-mono text-[10px] tracking-widest uppercase border px-2 py-1 ${statusColor(...)}`}>
```

### Card Pattern

```html
<div class="border border-white/5 bg-navy p-6">
  <p class="font-mono text-[10px] tracking-widest uppercase text-electric mb-4">// Card Title</p>
  <!-- content -->
</div>
```

### Brand Tokens

```typescript
// tailwind.config.js (configured via @tailwindcss/vite)
colors: {
  navy:     '#0A1628',
  'navy-mid': '#0F1525',
  cream:    '#FAF8F3',
  slate:    '#94A3B8',
  electric: '#2563EB',
}
```

### Typography
- Sans: Geist (`geist` npm package)
- Mono: Geist Mono
- Mono eyebrows: `text-[10px] tracking-[0.25em] uppercase text-electric` with `// Label` convention

---

## File Structure

```
src/
├─ components/
│  ├─ agent/
│  ├─ contact/
│  ├─ home/
│  ├─ layout/
│  ├─ start/
│  ├─ three/
│  ├─ Brand.astro
│  └─ Brand.tsx
├─ layouts/
│  ├─ Base.astro
│  └─ AdminLayout.astro
├─ lib/
│  ├─ supabase.ts                 # 2 clients: public + service-role
│  ├─ resend.ts                   # transactional sender (account #1)
│  ├─ outbound-email.ts           # cold outbound sender (account #2)
│  ├─ anthropic.ts                # Claude SDK + system prompts
│  ├─ rate-limit.ts               # in-memory IP rate limiter
│  ├─ email-template.ts           # wrapEmail + helpers
│  ├─ admin-session.ts            # HMAC cookies + bcrypt + reset tokens
│  └─ outbound/
│     ├─ scraper.ts
│     ├─ researcher.ts
│     ├─ composer.ts
│     ├─ engine.ts
│     └─ places.ts
├─ middleware.ts                  # auth gate
├─ env.d.ts
├─ pages/
│  ├─ index.astro, services.astro, about.astro, contact.astro,
│  │   start.astro, work/, blog/, call.ts, 404.astro,
│  │   privacy.astro, terms.astro
│  ├─ admin/
│  │  ├─ index.astro
│  │  ├─ login.astro
│  │  ├─ forgot.astro
│  │  ├─ reset/[token].astro
│  │  ├─ leads/index.astro
│  │  ├─ leads/[id].astro
│  │  ├─ prospects/index.astro
│  │  ├─ prospects/[id].astro
│  │  ├─ outbound.astro
│  │  ├─ messages.astro
│  │  ├─ trash.astro
│  │  ├─ stack.astro
│  │  └─ settings.astro
│  └─ api/
│     ├─ start.ts, contact.ts
│     ├─ admin/
│     │  ├─ login.ts, logout.ts, forgot.ts, reset.ts
│     │  ├─ settings/password.ts
│     │  ├─ leads/[id].ts
│     │  ├─ leads/[id]/analyze.ts, draft-reply.ts, send-reply.ts
│     │  ├─ messages/[id].ts
│     │  ├─ outbound/send-batch.ts, process-followups.ts,
│     │  │            check-replies.ts, stats.ts, settings.ts
│     │  └─ prospects/index.ts, [id].ts, scrape.ts, find.ts,
│     │                [id]/research.ts, [id]/compose.ts
│     ├─ cron/outbound.ts
│     └─ webhooks/resend-outbound.ts, inbound-reply.ts
└─ styles/globals.css

public/
sql/
scripts/
docs/
astro.config.mjs
vercel.json
supabase-schema.sql
```

---

## Environment Variables

```
# Supabase
PUBLIC_SUPABASE_URL
PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY

# Email
RESEND_API_KEY               # transactional sends from blvstack.com
RESEND_OUTBOUND_API_KEY      # cold outbound from tryblvstack.com (separate account)
FOUNDER_EMAIL

# Admin auth
ADMIN_EMAIL
ADMIN_PASSWORD
ADMIN_SESSION_SECRET

# AI
ANTHROPIC_API_KEY

# Outbound
CRON_SECRET                  # Vercel Cron Authorization Bearer
INBOUND_WEBHOOK_SECRET       # Inbound reply webhook auth
GOOGLE_PLACES_API_KEY        # Places API (New) text search

# Analytics
PUBLIC_PLAUSIBLE_DOMAIN
TURNSTILE_SECRET_KEY
PUBLIC_TURNSTILE_SITE_KEY
```

---

## Conventions

### File Naming
- Astro pages: lowercase + dashes (`forgot.astro`, `messages.astro`)
- Dynamic routes: bracket syntax (`[id].astro`, `[token].astro`)
- React components: PascalCase (`StartForm.tsx`, `ContactForm.tsx`)
- Astro components: PascalCase (`Hero.astro`, `Footer.astro`)
- Lib files: kebab-case or single-word (`admin-session.ts`, `supabase.ts`)
- Folders: lowercase singular (`agent/`, `home/`, `start/`)

### Code Style
- All API routes export `prerender = false`
- All API routes use a local `j(body, status = 200)` helper for JSON responses
- Allowed-field whitelist on PUT endpoints (never spread request body into DB updates)
- Service-role Supabase client (`supabaseAdmin`) used for all admin-side reads/writes
- Public client (`supabase`) only on browser/anon-safe paths
- Use `import.meta.env.X` for env vars (Astro convention, not `process.env.X`)
- Soft delete via `deleted_at IS NULL` filter on all list queries

### Astro Page Conventions
- Frontmatter imports → `Astro.props` / `Astro.url` / `Astro.locals` access → data fetch → render
- Server-rendered (`prerender = false`) for all admin pages
- Admin pages always wrap in `<AdminLayout title=… adminEmail={Astro.locals.adminEmail}>`
- Always send `<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">` for `/admin/*` (set in `AdminLayout`)

### UI Conventions
- Mono eyebrow above every section header: `// Section Name` in electric color, 10px, 0.25em tracking
- Card containers: `border border-white/5 bg-navy p-6`
- Status badges: `font-mono text-[10px] tracking-widest uppercase border px-2 py-1`
- CTA primary: `bg-electric hover:bg-electric/90 text-cream font-mono text-[10px] tracking-[0.25em] uppercase px-4 py-2.5 transition-colors`
- CTA secondary: `bg-white/5 hover:bg-white/10 border border-white/10 text-cream …`
- Danger zone buttons: red-tinted hover states, never primary styling

### Database Conventions
- Every table has `id uuid PK DEFAULT gen_random_uuid()` and `created_at timestamptz DEFAULT now()`
- Soft-delete columns are always `deleted_at timestamptz` (nullable)
- Status enums are CHECK constraints on text columns (not Postgres enums)
- RLS enabled on every table; service role bypasses; no public policies
- Index pattern: `CREATE INDEX idx_<table>_<col> ON <table>(<col>)`

### Security
- Never expose service role key to client
- All admin API routes are gated by middleware (don't re-check auth in each route)
- Cron + webhook endpoints use shared secrets (`Bearer ${SECRET}` or body field)
- HMAC signing uses SHA-256, base64url encoding, no padding
- Sessions are 7 days max, regenerated on every login (no rotation needed mid-session)
- Reset tokens are bcrypt-hashed at rest, single-use, 30-min expiry
- Rate limits on all public-facing form endpoints

### Email Conventions
- Transactional = HTML branded template via Resend account #1
- Cold outbound = plain text only via Resend account #2
- Cold outbound auto-appends: calendar link line + unsubscribe footer
- Use `escapeHtml()` on any user input rendered in HTML email
- Never use the branded template for cold outbound (deliverability)

### AI Agent Conventions
- All agents output JSON with strict schema (no markdown fences)
- System prompts live in `src/lib/anthropic.ts` (shared) or inline in route file (route-specific)
- Always strip markdown fences before `JSON.parse()` (model occasionally wraps despite instruction)
- Errors logged with `[<agent-name>] error:` prefix for easy log filtering
- `MODEL` constant in `anthropic.ts` is single source of truth for Claude version

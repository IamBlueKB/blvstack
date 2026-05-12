# BLVSTACK — Master Build Spec

> Paste this entire file into Claude Code as the project brief. Build phase 1 (launch site) first. Phase 2 items are flagged and built after launch.

---

## 1. Mission

Build the marketing site for **BLVSTACK**, a solo-operator AI systems studio. The site sells AI agents and automations to businesses. The site's only job is to convert qualified prospects into discovery calls.

**Visual benchmark:** basement.studio, lusion.io, studiofreight.com, rauno.me, resend.com, linear.app.
**Tone:** Quiet, technical, confident, premium, sparse. Editorial, not corporate.

---

## 2. Stack

- **Framework:** Astro (latest), TypeScript strict mode
- **Styling:** Tailwind CSS v4
- **3D:** Three.js + React Three Fiber + Drei (hydrated islands only — keep most of the site static)
- **Animation:** GSAP + ScrollTrigger, Motion (Framer Motion), Lenis smooth scroll
- **Database / Auth:** Supabase
- **Email:** Resend
- **AI:** Anthropic API (Claude Sonnet) for chat agent and automated workflows
- **Analytics:** Plausible (privacy-friendly, no cookie banner needed)
- **Deploy:** Vercel
- **Version control:** GitHub
- **Domain:** blvstack.com
- **Node version:** Latest LTS

---

## 3. Brand System

### Logo
- Existing logo provided (royal blue ribbon-form "B")
- Use SVG version everywhere
- Create animated variant for hero (particle reconstruction, see Hero spec)

### Colors (define as Tailwind theme tokens)
- `--color-royal: #1E40AF` (primary)
- `--color-electric: #2563EB` (accent)
- `--color-navy: #0A1628` (background)
- `--color-cream: #FAF8F3` (text on dark, light bg)
- `--color-slate: #64748B` (muted text)
- Default mode: **dark** (navy bg, cream text). Blues used sparingly as accents.

### Typography
- **Display + body:** Geist Sans (variable)
- **Mono:** Geist Mono (for labels, tags, code)
- Type scale: editorial. Hero headlines should hit 8-12rem on desktop.
- Use variable font axes for animated weight reveals.

### Spacing
- Generous. Sections should breathe. Minimum 8rem vertical padding between major sections on desktop.

---

## 4. Global UI Elements

### Navigation
- **No traditional top bar.**
- Fixed corner element (top-right): a small button with an icon, expands into a full-screen overlay menu on click.
- Overlay menu: deep navy bg, page links in massive editorial type, hover micro-interactions (slight skew + color shift), one-line tagline at bottom.
- Logo fixed top-left, always visible, returns to home on click.

### Custom cursor
- Replace native cursor with a small cream-colored dot.
- Scales 3x and inverts on hover over interactive elements.
- Magnetic pull effect on buttons (cursor and button slightly attract).
- Disable entirely on touch devices.

### Smooth scroll
- Lenis on every page. Duration ~1.2s, ease subtle.
- Scroll-linked animations via GSAP ScrollTrigger.

### Page transitions
- Astro View Transitions API.
- Cross-fade with subtle scale (0.98 → 1).
- Logo persists across routes (same-element transition).

### Film grain overlay
- Subtle animated grain layer on entire site via shader or animated SVG noise.
- 3-5% opacity. Adds premium texture.

---

## 5. Pages

### `/` — Home

**Sections in order:**

#### 5.1 Hero
- Full viewport, deep navy background
- WebGL scene: BLVSTACK logo ribbon reconstructing from a particle cloud on page load, then idling with subtle organic motion. Royal blue ribbon, electric blue particle accents.
- Headline (massive, animated character-by-character reveal): **"Systems that work while you don't."**
- Subhead: "BLVSTACK builds AI agents and automations for businesses ready to scale without hiring."
- Primary CTA: `"Start a Project"` → `/apply`
- Secondary CTA: `"Talk to BLVSTACK AI"` → opens chat agent overlay
- Small scroll indicator at bottom (animated)

#### 5.2 Capability marquee
- Horizontal scrolling text band: `"AI Agents · Automation Systems · Custom Integrations · Lead Pipelines · AI-Native Websites · Voice Agents · Workflow Automation ·"`
- Slow drift, pauses on hover
- Cream text on navy

#### 5.3 What we build (3 pillars)
- Asymmetric editorial grid (NOT 3 equal cards)
- Pillars:
  1. **AI Agents** — chat, voice, booking, qualification, follow-up
  2. **Automation Systems** — workflows that replace manual tasks
  3. **AI-Native Websites** — sites with agents built in, not bolted on
- Each pillar: short copy (max 2 sentences), one demo canvas/GIF, hover state reveals expanded detail
- Vary card sizes and positions intentionally

#### 5.4 Live proof
- Embedded interactive demo: real working AI agent that visitors can talk to in a styled chat interface
- Powered by Anthropic API, logged to Supabase
- Rate-limited per IP (10 messages per session, then prompt to apply)
- Framed: **"This is one of ours. Try it."**

#### 5.5 How we work (process)
- 4 steps: **Audit → Design → Build → Deploy**
- Horizontal scroll-snap on desktop, vertical stack on mobile
- Each step: kinetic type label, one short paragraph, one illustrative animation/visual
- Animations should communicate, not decorate

#### 5.6 Case studies preview
- 2-3 cards linking to `/work`
- Large imagery, minimal copy
- Hover reveals key metric (e.g., "+340% qualified leads")

#### 5.7 Founder note
- Half-width abstract visual, half-width short quote from founder
- Builds trust for solo operator selling premium
- Personal, confident, max 3 sentences

#### 5.8 Final CTA
- Full-bleed section
- Massive type: **"Ready to build?"**
- Single button: `"Start a Project"`
- Background: animated gradient mesh shader in brand colors

#### 5.9 Footer
- Minimal: logo, contact email, social links (X, LinkedIn, GitHub), copyright
- No nav repetition

---

### `/services` — What We Build

Detailed breakdown of all 3 pillars. Each section includes:
- What's included (bulleted list, max 5 items)
- Ideal client profile
- Timeline (e.g., "2-4 week build")
- Example outcomes (metrics)
- CTA: `"Start a project like this"` → `/apply?service=<slug>`

**No pricing displayed anywhere.** Pricing is revealed only on discovery call after qualification.

---

### `/work` — Case Studies

- Index page lists 2-3 spec case studies at launch (hypothetical, fully-documented builds — replaced with real ones as they close)
- Each case study has its own page: `/work/[slug]`
- Format: editorial long-form, image-led
- Structure per case study:
  - Hero image
  - Problem
  - Approach
  - Build
  - Result (with primary metric featured prominently)
  - Stack used
  - CTA to apply

---

### `/about` — Founder + Philosophy

Sections:
- Origin (why BLVSTACK exists)
- Approach (how we work differently)
- Principles (3-5 short statements, large type)
- Stack we live in (tech logos grid)
- One CTA at bottom

---

### `/apply` — Gated Application Form

Multi-step form, one question per screen (Typeform-style, custom built — NOT a Typeform embed).

**Steps:**
1. Your name
2. Your business name + website URL
3. Annual revenue range (`Under $250k` / `$250k–$1M` / `$1M–$5M` / `$5M+`)
4. What problem are you trying to solve? (textarea)
5. Timeline (`This month` / `1–3 months` / `3–6 months` / `Just exploring`)
6. Budget tier (`$5k–$15k` / `$15k–$50k` / `$50k+` / `Not sure yet`)
7. Email + phone

**On submit:**
- Insert into Supabase `leads` table with status `new`
- Trigger Resend email to founder with full submission details
- Trigger Resend auto-reply to applicant: "Thanks. We review every application within 24 hours and respond if it's a fit."
- Redirect to `/apply/thank-you`

**Anti-spam:**
- Cloudflare Turnstile (free) on final step
- Honeypot field
- Rate limit by IP (max 3 submissions per 24h)

---

### `/contact` — Direct Contact

- Short form (name, email, message) for non-applicants
- Founder email displayed
- Calendly embed (optional, for warm referrals only)
- Response time promise

---

### `/blog` — Phase 2

- Scaffold only at launch (route exists, "Coming soon" state)
- Astro content collections with MDX
- Will host SEO + AI search content

---

## 6. Backend / Data

### Supabase tables

```sql
-- leads
create table leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  name text not null,
  email text not null,
  phone text,
  business_name text,
  website_url text,
  revenue_range text,
  problem text,
  timeline text,
  budget_tier text,
  source text default 'apply_form',
  status text default 'new', -- new | qualified | call_booked | proposal_sent | won | lost | disqualified
  notes text,
  ip_address text
);

-- agent_conversations
create table agent_conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  session_id text not null,
  messages jsonb not null default '[]',
  lead_id uuid references leads(id),
  ip_address text,
  message_count int default 0
);

-- contact_messages (for /contact form)
create table contact_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  name text not null,
  email text not null,
  message text not null,
  status text default 'new'
);
```

### Row-level security
- Enable RLS on all tables
- Service role only for inserts from the site
- No public read access

### Environment variables (`.env`)
```
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
ANTHROPIC_API_KEY=
PUBLIC_PLAUSIBLE_DOMAIN=blvstack.com
TURNSTILE_SECRET_KEY=
PUBLIC_TURNSTILE_SITE_KEY=
FOUNDER_EMAIL=
```

---

## 7. AI Chat Agent (homepage live proof)

- Floating button (bottom-right) labeled "Talk to BLVSTACK AI"
- Expands into a chat panel (not full-screen)
- Powered by Anthropic API (Claude Sonnet)
- System prompt: Knowledgeable about BLVSTACK services. Qualifies leads conversationally. Routes serious prospects to `/apply`. Polite but does not give free consulting.
- Stores conversation in Supabase `agent_conversations`
- Rate limit: 10 messages per session, then prompts to apply
- Streams responses for that premium feel

---

## 8. SEO + AI Search Foundation

- `sitemap.xml` auto-generated by Astro
- `robots.txt` explicitly allowing `GPTBot`, `ClaudeBot`, `PerplexityBot`, `Google-Extended`, `CCBot`
- `llms.txt` at root describing the site for AI crawlers
- Schema.org JSON-LD on every page: `Organization`, `Service`, `FAQPage` (where relevant), `BreadcrumbList`
- Open Graph + Twitter Card meta on every page
- Per-page OG images generated via Vercel OG (`@vercel/og`)
- Canonical URLs
- Semantic HTML throughout (real `<article>`, `<section>`, `<nav>` etc.)
- All Core Web Vitals green on launch

---

## 9. Performance Requirements

- Lighthouse score 95+ on all categories
- LCP < 1.5s
- All 3D/heavy components are hydrated islands, lazy-loaded on intersection
- Images: AVIF/WebP via Astro's `<Image>`, responsive srcsets
- Fonts: self-hosted, subset, `font-display: swap`
- No client-side router fetching on initial load
- Total JS budget per route: under 100kb gzipped (excluding Three.js scenes)

---

## 10. Accessibility

- Keyboard nav works everywhere (custom cursor doesn't break focus rings)
- Reduced motion media query respected — disable Lenis, GSAP scroll effects, particle systems
- WCAG AA contrast minimum (verify cream-on-navy)
- All form fields properly labeled
- Skip-to-content link
- aria-live for chat agent responses

---

## 11. Build Order

**Day 1 — Foundation**
- Initialize Astro + TS + Tailwind v4 project
- GitHub repo, Vercel deploy hooked up
- Set up Supabase project, create tables, generate types
- Install all deps (Three.js, R3F, Drei, GSAP, Lenis, Motion, Resend SDK, Anthropic SDK)
- Brand tokens (colors, fonts) in Tailwind config
- Base layout: navigation overlay, custom cursor, Lenis, grain overlay, footer

**Day 2 — Home page**
- Hero with WebGL particle logo scene
- Capability marquee
- 3 pillars section (asymmetric grid)
- Founder note + final CTA + gradient mesh background

**Day 3 — Home page continued + live agent**
- Process section (4-step scroll-snap)
- Case studies preview cards
- AI chat agent (Anthropic API integration, Supabase logging, rate limiting)

**Day 4 — Inner pages**
- `/services` with all 3 pillars detailed
- `/about` with founder content
- `/work` index + 2-3 spec case study pages

**Day 5 — Apply flow + contact**
- `/apply` multi-step form, Supabase insert, Resend email triggers, Turnstile, thank-you page
- `/contact` form
- `/blog` scaffold (empty state)

**Day 6 — SEO, polish, launch prep**
- Sitemap, robots, llms.txt, schema, OG images
- Plausible analytics installed
- Reduced-motion testing, accessibility audit
- Performance audit (Lighthouse)
- All meta tags, favicon set
- Final QA on mobile

**Day 7 — Launch**
- Domain pointed, SSL verified
- Production deploy
- Submit sitemap to Google Search Console, Bing
- Smoke test all forms and agent

---

## 12. Visual Direction Principles

When generating any component, animation, or layout, follow these rules:

1. **Nothing moves unless it communicates.** No decoration motion.
2. **Negative space is a feature.** When in doubt, add more.
3. **Asymmetry over symmetry.** Editorial layouts, not grids.
4. **Type is the hero.** Massive headlines, confident hierarchy.
5. **Color is rationed.** 90% navy + cream. Blues are accents on what matters.
6. **Motion has weight.** Eases should feel physical, never linear.
7. **Every interaction has feedback.** Hover, focus, click — all acknowledged.
8. **Speed is luxury.** If it's slow, it's broken. Optimize relentlessly.

---

## 13. What We're NOT Building (Phase 1)

These are deferred to phase 2 to keep launch fast. Build the site so these can be added later without refactoring.

- Full blog with posts and content engine
- A/B testing infrastructure
- Lead nurture email sequences (just the initial auto-reply for now)
- Partner / referral tracking
- Multi-language support
- Client portal / login area
- Automated AI audit tool
- "Traffic-generating" AI agent (concept for later)

---

## 14. Repo Structure

```
/
├── astro.config.mjs
├── tailwind.config.ts
├── tsconfig.json
├── package.json
├── .env.example
├── public/
│   ├── fonts/
│   ├── logo.svg
│   ├── robots.txt
│   └── llms.txt
├── src/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Nav.astro
│   │   │   ├── NavOverlay.tsx
│   │   │   ├── Footer.astro
│   │   │   ├── Cursor.tsx
│   │   │   ├── SmoothScroll.tsx
│   │   │   └── Grain.tsx
│   │   ├── home/
│   │   │   ├── Hero.astro
│   │   │   ├── HeroScene.tsx (R3F)
│   │   │   ├── Marquee.tsx
│   │   │   ├── Pillars.astro
│   │   │   ├── LiveProof.tsx
│   │   │   ├── Process.tsx
│   │   │   ├── CaseStudiesPreview.astro
│   │   │   ├── FounderNote.astro
│   │   │   └── FinalCTA.tsx
│   │   ├── apply/
│   │   │   └── ApplyForm.tsx
│   │   ├── agent/
│   │   │   ├── ChatAgent.tsx
│   │   │   └── ChatBubble.tsx
│   │   └── ui/
│   │       ├── Button.tsx
│   │       ├── MagneticButton.tsx
│   │       └── KineticText.tsx
│   ├── layouts/
│   │   └── Base.astro
│   ├── pages/
│   │   ├── index.astro
│   │   ├── services.astro
│   │   ├── about.astro
│   │   ├── apply.astro
│   │   ├── apply/thank-you.astro
│   │   ├── contact.astro
│   │   ├── work/index.astro
│   │   ├── work/[slug].astro
│   │   ├── blog/index.astro
│   │   └── api/
│   │       ├── apply.ts
│   │       ├── contact.ts
│   │       └── agent.ts
│   ├── lib/
│   │   ├── supabase.ts
│   │   ├── resend.ts
│   │   ├── anthropic.ts
│   │   └── rate-limit.ts
│   ├── content/
│   │   ├── config.ts
│   │   ├── work/
│   │   │   ├── case-1.mdx
│   │   │   ├── case-2.mdx
│   │   │   └── case-3.mdx
│   │   └── blog/
│   └── styles/
│       └── globals.css
```

---

## 15. First Command to Run

```bash
npm create astro@latest blvstack -- --template minimal --typescript strict --no-install --no-git
cd blvstack
git init
git remote add origin <your-repo-url>
```

Then install everything in one shot:

```bash
npm i @astrojs/react @astrojs/sitemap @astrojs/vercel react react-dom three @react-three/fiber @react-three/drei gsap lenis motion @supabase/supabase-js resend @anthropic-ai/sdk @vercel/og
npm i -D tailwindcss @tailwindcss/vite typescript @types/react @types/react-dom @types/three
```

---

## 16. Definition of Done (Phase 1)

- [ ] All 7 pages live and responsive
- [ ] Apply form writes to Supabase, sends both emails
- [ ] Chat agent works, logs to Supabase, rate-limited
- [ ] Lighthouse 95+ all categories
- [ ] Reduced-motion fully respected
- [ ] No console errors
- [ ] Deployed to blvstack.com with SSL
- [ ] Plausible tracking confirmed
- [ ] Sitemap submitted to Google + Bing
- [ ] All copy proofread and locked

---

**End of spec. Build phase 1 in order. Ask for clarification only on blockers, not preferences. Make confident creative decisions within the principles above.**

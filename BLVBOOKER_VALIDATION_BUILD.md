# BLVBooker — Validation Build Instruction (for Claude Code)

> Goal: prove the core hypothesis before building anything else —
> **does a personalized cold pitch to a venue convert into a gig for one DJ?**
> Until we have that number, no new APIs, no roster-scale features.

---

## Do NOT build yet
- No new third-party APIs (Bandsintown, Songkick, Spotify, Apollo, Hunter, SerpAPI, etc.). Zero new cost.
- No monthly pitch cron (that's a roster-scale feature; with 1 DJ it's spam).
- No buyer-graph / "licensable database" system.
- No Discord/Telegram/TikTok/permit scraping.
- No EPK generation (noted as a future paid per-artist add-on — see bottom).

Reason: targeting intelligence is worthless if the pitch itself doesn't convert. We test the pitch first with the venue list we can already build for free.

---

## Build this week

### 1. DJ venue-list seeding (free)
Seed `booker_venues` for the one DJ's city using sources that match where a DJ actually plays — NOT concert/touring APIs (those skew to ticketed live music and miss DJ venues).

- **Google Places** (key already in env) — query by DJ-relevant venue types: nightclubs, lounges, bars, wedding venues, event/private-event restaurants, breweries/wineries with events, hotels with event space, banquet halls.
- **Yelp Fusion API** (free, 5000/day) — same venue categories, fills gaps + adds rating/review signal.
- Target ~75–150 venues in the DJ's city + travel radius. Tag each with `verticals` including `dj`, set `venue_type`, `city`, `source`.

### 2. Researcher (reuse existing)
For each seeded venue, the existing researcher pulls:
- Booking/contact email (and contact name if findable)
- A personalization hook → store in `booker_venues.ai_research` (e.g. the venue's vibe, the kind of nights they run, anything specific we'd only know from looking at their site/socials).

### 3. Profile-aware + venue-aware pitch composer (the key change)
Make `composer.ts` generate a pitch that uses the FULL artist profile, tailored to the SPECIFIC venue. The pitch must be a function of **(artist profile) × (this venue's data)** — not a template with a name swapped in.

**Artist profile fields to draw on** (from `booker_artists`): stage_name, performer_type, genres, city, travel_radius_mi, rate_floor/rate_notes (do NOT state price in a cold pitch — use it to self-qualify fit only), gig_types, availability_notes, bio, demo_url, social_links, hard_nos.

**Venue fields to tailor to** (from `booker_venues`): name, venue_type, genres_pref, capacity, and the `ai_research` hook.

**Composer logic:**
- Match the artist's relevant gig_types/genres to this venue_type. A wedding venue pitch leads with wedding/private-event fit; a nightclub pitch leads with club/genre fit; a brunch/restaurant pitch leads with the recurring-slot angle. Same profile, different emphasis per venue.
- Open with something specific to THIS venue (from `ai_research`) so it's obviously not a blast.
- 3–5 sentences max. One link only — the artist's best demo/social for that context.
- Operator voice from the brand kit: quiet confidence, no hype, no scarcity, no emoji. Sign as BLVBooker.
- Output `draft_subject` + `draft_body` into the `booker_matches` row (`kind='venue'`), status `drafted`.

### 4. Send + track (reuse existing outbound plumbing)
- Send from `blvbooker@tryblvstack.com`. Reply-to routes back into BLVBooker (so venue replies come to us, not around us — attribution).
- Log every send to `booker_outreach` (`direction='to_venue'`).
- I review/approve drafts before send (approval queue, not auto-send).
- Track the funnel on `booker_matches`: `drafted → pitched → interested → booked`.

### 5. What I'm measuring
Run ~100 personalized pitches for the one DJ and report:
- Delivery/bounce rate (deliverability sanity check)
- Reply rate
- Positive-reply rate
- Bookings

**That number decides everything.** ≥2–3 positive replies and ≥1 booking from 100 = the model works, then we add targeting intelligence. If ~0, the fix is the pitch/offer/artist marketability — not more data sources.

---

## Note for the roadmap (do NOT build now): per-artist EPK / hosted artist page
Once a buyer is interested (not at cold-pitch stage), serve a real press kit as a **hosted, on-brand artist page** at `/booker/artist/[slug]` — pulls the artist's profile into a clean branded layout with bio, genres, demo/track embeds, socials, and past gigs. Dynamic (always current), reusable as the artist's link-in-bio. This is a **paid per-artist add-on** I'll charge for — treat it as a distinct future feature, not part of the validation build. Auto-generated PDF EPKs are not the move; the hosted page is.

---

## The one thing to confirm
Build the venue seeding (Google Places + Yelp) + the profile-aware/venue-aware composer, wire through the existing researcher and outbound, and let me run 100 pitches for the DJ. Validate reply→booking before anything else gets built.

// SunResponse — TCPA-compliant speed-to-lead infrastructure for residential
// solar installers. The only LIVE niche in v1.

import type { NicheConfig } from './types';

export const solar: NicheConfig = {
  slug: 'solar',
  label: 'Residential Solar',
  status: 'live',

  detection: {
    keywords: [
      'solar', 'photovoltaic', 'pv system', 'solar panels', 'solar installation',
      'rooftop solar', 'residential solar', 'kilowatt', 'kw system',
      'net metering', 'inverter', 'tesla powerwall', 'enphase', 'sunrun',
    ],
    domainHints: ['solar', 'pv', 'sun', 'photovoltaic'],
    // Empty by design. Places API (New) Text Search doesn't accept
    // 'solar_panel_installer' (was OLD-API only, not carried over). The valid
    // alternatives — 'electrician', 'roofing_contractor' — are too broad and
    // would surface regular electricians/roofers as false positives. Text query
    // ("solar installers in X") is specific enough; find.ts skips includedType
    // when this array is empty.
    googlePlacesTypes: [],
  },

  research: {
    painPointFocus: `
      Speed-to-lead failure is the #1 pain. Look for:
      - Slow / no live chat on website
      - Generic "Request a Quote" form with no instant response promise
      - No visible chatbot or AI qualification
      - Public reviews mentioning slow response times
      - Heavy reliance on shared lead vendors (Angi, ModernizeFollowup, etc.)
      - State: note if AZ, TX, FL, CA, NV — high-competition markets where speed-to-lead is most acute
    `.trim(),
    qualifyingSignals: [
      'Independent regional installer (10-50 employees, sub-50 ideal)',
      'Active Google Ads / Facebook Ads presence',
      'Multiple "request a quote" CTAs on homepage',
      'Reviews mention response time as a complaint or praise',
      'Lists service area covering one of: AZ, TX, FL, CA, NV',
    ],
    disqualifyingSignals: [
      'National door-knocker operation (Sunrun, Sunnova, Trinity, Freedom Forever)',
      'Solar lead reseller / lead vendor (not an installer)',
      'Commercial / utility-scale only (not residential)',
      'Defunct site / no recent content',
      'Already has visible AI chatbot or sub-1-minute response automation',
    ],
  },

  offer: {
    name: 'SunResponse',
    oneLiner: 'TCPA-compliant speed-to-lead infrastructure for residential solar installers',
    problemFraming: `
      A homeowner who requests a solar quote usually contacts several installers
      the same afternoon. The one who responds first almost always gets the
      appointment. Most installers respond in hours. By then the homeowner is
      already on the phone with someone else — not because the closers are weak,
      but because nobody reached out in time.
    `.trim(),
    buildPrice: 4500,
    monthlyPrice: 2500,
    buildTimeline: '30 days standard, 14-day rush available for peak-season crunch',
    pilotTerms: '60-day pilot. No verified appointments on your calendar by day 45, you stop paying — no long-term contract.',
    keyDifferentiators: [
      'Sub-60-second TCPA-compliant text response, 24/7 (A2P 10DLC registered, opt-out auto-handled, full audit log)',
      'Pre-appointment verification: county property records + satellite imagery, so $80 electric bills don\'t show up as "$250"',
      'Hot lead → live bridge: AI asks permission, then bridges your closer and the homeowner in under 30 seconds',
      'After-hours tone shift so the AI never reads aggressive at midnight',
      'Compliance monitoring built in — when TCPA / carrier rules change, we update before you get filtered',
    ],
  },

  composer: {
    bannedPhrases: [
      'leverage', 'synergize', 'AI-powered solutions', 'cutting-edge',
      'revolutionary', 'game-changer', 'best-in-class', 'world-class',
      'hope this finds you well', 'just checking in', 'circling back',
      'I hope you\'re doing well', 'I came across your website',
      'I wanted to reach out', 'let me know if you\'re interested',
    ],
    requiredElements: [
      "Anchor the opening on a SPECIFIC pain point pulled from this prospect's research.pain_points — name the actual failure you observed on their site or in their reviews (e.g. 'your contact form has no instant-response promise', 'three of your last 10 Google reviews mention slow callback'). Do NOT open with a generic industry stat if a prospect-specific anchor exists in the research.",
      "Frame the speed-to-lead problem as an INDUSTRY pattern (homeowners contact several installers the same afternoon; the first responder usually wins the appointment) — never as a claim about this prospect's own numbers, spend, or losses. We do not know their numbers.",
      "Reference one AZ-specific dynamic ONLY if it fits naturally (APS/SRP rate hikes, NEM 3.0 fallout) — do not force it.",
      "State the pilot terms once, plainly: no verified appointments by day 45, they stop paying — no long-term contract.",
      "End with a soft 15-minute ask. Do not push to book.",
      "Sign 'Blue' on its own line. No em-dash before it, no title.",
    ],
    forbiddenClaims: [
      "Any dollar amount describing what slow response costs the prospect or the industry — no lead-cost math, no lost-revenue figures, no '$14k/month walking out the door'",
      "Inventing specific dollar amounts the prospect spent on leads, marketing, or ads",
      "Inventing the prospect's close count, close rate, lead volume, or revenue",
      "Claiming other clients exist when they do not — NEVER reference 'three AZ shops', 'other installers using this', '5 solar companies in your market', or any specific count of existing customers",
      "Numeric counts of competitors that could read as BLVSTACK clients ('three other shops already have them on the phone') — describe competition for the lead without a number",
      "Claiming case-study results we have not delivered",
      "Manufacturing scarcity ('only 2 spots left', 'closing the cohort Friday')",
      "Implying we have data on this prospect we do not have (foot traffic, conversion rate, ad spend, CRM data)",
    ],
    voiceNotes: `
Voice: founder-to-founder. Direct, plain, competent.
Standard sentence capitalization and proper grammar throughout the body. Complete sentences with subjects and verbs — no run-ons, no comma splices, no missing words. Fragments only when deliberate, never more than one per email.
Structure: paragraph 1 is the prospect-specific observation. Paragraph 2 is the industry pattern and what SunResponse does about it. One line of pilot terms. One line ask. Nothing else.
Maximum ONE em-dash in the entire email. Em-dash overuse reads as AI-written.
No marketing adjectives. No exclamation points. No emoji.
Read like a forwarded internal note from someone who looked at this prospect's site, not like a pitch.
    `.trim(),
    subjectLineStyle: 'lowercase, 4-8 words, specific to this prospect, reads like a forwarded internal email',
    bodyWordCount: [80, 140],
  },
};

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
    googlePlacesTypes: ['solar_panel_installer', 'electrician', 'roofing_contractor'],
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
      You buy 100 leads at ~$150 each. You close ~5.
      The other 95 — $14,250 — went to whoever texted them first.
      Not because your closers are bad. By the time your CRM pinged,
      the homeowner was already on the phone with someone else.
    `.trim(),
    buildPrice: 4500,
    monthlyPrice: 2500,
    buildTimeline: '30 days standard, 14-day rush available for peak-season crunch',
    pilotTerms: '60-day pilot. If no verified appointments on your calendar by day 45, we part ways and you keep what we built.',
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
      'Open with a specific dollar amount or hard number — not a greeting',
      'Reference the speed-to-lead problem in their language (homeowner shopping 3-4 installers same afternoon)',
      'Name one state-specific dynamic if AZ/TX/FL/CA/NV (e.g. APS/SRP rate hikes in AZ, PG&E rates in CA)',
      'Mention the founding cohort terms once (no verified appointments by day 45 = part ways)',
      'End with a soft 15-minute ask, not a hard "book a discovery call" CTA',
      'Sign as Blue, single line, no title',
    ],
    voiceNotes: `
      Solar installer owners are blue-collar-adjacent operators who hate marketing-speak and respect numbers.
      Read like a forwarded internal email from someone who's looked at their P&L, not like a sales pitch.
      Lowercase subject. No emoji. No exclamation points. No marketing adjectives.
      One paragraph of math, one paragraph of what we do, one line of terms, one line ask.
    `.trim(),
    subjectLineStyle: 'lowercase, 4-8 words, includes a specific number or dollar amount, reads like a forwarded email',
    bodyWordCount: [80, 140],
  },
};

// Shared shape for every niche config in this directory.
//
// Slugs (e.g. 'solar', 'medspa') are the source of truth — they're what
// gets written to `prospects.niche` and what looks up a config via getNiche().
//
// `status: 'live'` = sales-ready, composer routes the niche prompt.
// `status: 'scaffold'` = stub, composer falls back to the generic prompt.

export type NicheConfig = {
  slug: string;                    // e.g. 'solar' — matches prospects.niche
  label: string;                   // e.g. 'Residential Solar' — UI display
  status: 'live' | 'scaffold';     // 'live' = sales-ready, 'scaffold' = stub

  // For auto-detection during research
  detection: {
    keywords: string[];            // strong signals in website text
    domainHints: string[];         // common URL patterns (e.g. 'solar', 'pv')
    googlePlacesTypes?: string[];  // optional: Places API category strings
  };

  // For the researcher prompt
  research: {
    painPointFocus: string;        // what pain points to extract for this niche
    qualifyingSignals: string[];   // signals that mark a strong fit
    disqualifyingSignals: string[]; // red flags (e.g. 'national door-knocker' for solar)
  };

  // For the composer prompt — the actual offer
  offer: {
    name: string;                  // e.g. 'SunResponse'
    oneLiner: string;              // one-sentence positioning
    problemFraming: string;        // cost-of-inaction in their language
    buildPrice: number;            // USD, e.g. 4500
    monthlyPrice: number;          // USD, e.g. 2500
    buildTimeline: string;         // e.g. '30 days, 14-day rush available'
    pilotTerms: string;            // e.g. '60-day pilot. No verified appointments by day 45, we part ways.'
    keyDifferentiators: string[];  // 3-5 bullets the email can pull from
  };

  composer: {
    bannedPhrases: string[];       // never use these
    requiredElements: string[];    // every email must include all of these
    voiceNotes: string;            // tone guidance specific to this audience
    subjectLineStyle: string;      // e.g. 'lowercase, inbox-native, includes a specific number or dollar amount'
    bodyWordCount: [number, number]; // [min, max], e.g. [80, 140]
  };
};

// SCAFFOLD — composer falls back to the generic prompt until status='live'.
// To activate: fill in offer + research + voiceNotes, flip status to 'live'.

import type { NicheConfig } from './types';

export const realEstate: NicheConfig = {
  slug: 'real-estate',
  label: 'Real Estate Brokerage',
  status: 'scaffold',

  detection: {
    keywords: ['realty', 'brokerage', 'real estate', 'realtor' /* TODO expand */],
    domainHints: ['realty', 'realestate', 'homes', 'broker'],
    googlePlacesTypes: ['real_estate_agency'],
  },

  research: {
    painPointFocus: 'TODO: scope before activating',
    qualifyingSignals: ['TODO'],
    disqualifyingSignals: ['TODO'],
  },

  offer: {
    name: 'TODO',
    oneLiner: 'TODO',
    problemFraming: 'TODO',
    buildPrice: 0,
    monthlyPrice: 0,
    buildTimeline: 'TODO',
    pilotTerms: 'TODO',
    keyDifferentiators: ['TODO'],
  },

  composer: {
    bannedPhrases: [
      'leverage', 'synergize', 'AI-powered solutions',
      'hope this finds you well', 'just checking in',
    ],
    requiredElements: ['TODO'],
    voiceNotes: 'TODO: define when activating',
    subjectLineStyle: 'lowercase, inbox-native, includes a specific number or dollar amount',
    bodyWordCount: [80, 140],
  },
};

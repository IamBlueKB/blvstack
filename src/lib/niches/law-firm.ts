// SCAFFOLD — composer falls back to the generic prompt until status='live'.
// To activate: fill in offer + research + voiceNotes, flip status to 'live'.

import type { NicheConfig } from './types';

export const lawFirm: NicheConfig = {
  slug: 'law-firm',
  label: 'Plaintiff Law Firm',
  status: 'scaffold',

  detection: {
    keywords: ['personal injury', 'attorney', 'law firm', 'lawyer' /* TODO expand */],
    domainHints: ['law', 'attorney', 'legal', 'injury'],
    googlePlacesTypes: ['lawyer'],
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

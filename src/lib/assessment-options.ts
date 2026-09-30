// Project assessment — the questions and shared types. Browser-safe: the form
// imports this directly; the server logic lives in ./assessment.ts.

export const NEEDS = {
  new: 'A brand-new site',
  refresh: 'A refresh of my current site',
  ai: 'AI or automation for my business',
  it: 'IT or infrastructure for my business',
  unsure: 'Not sure yet',
} as const;

export const GOALS = {
  credible: 'Look credible and professional',
  leads: 'Bring in new leads',
  bookings: 'Take bookings or appointments',
  sell: 'Sell products or tickets',
  showcase: 'Show my work',
  retain: 'Keep clients coming back',
  automate: 'Automate admin or add an AI agent',
  secure: 'Secure email, accounts, and devices',
  network: 'Reliable Wi-Fi and office network',
  backups: 'Backups I can count on',
  migrate: 'Move off an old server',
} as const;

/** The goals step shows two groups; the brief rules read the same split. */
export const SITE_GOALS = ['credible', 'leads', 'bookings', 'sell', 'showcase', 'retain'] as const;
export const TECH_GOALS = ['automate', 'secure', 'network', 'backups', 'migrate'] as const;
/** The IT & infrastructure goals (the tech group minus AI). */
export const IT_GOALS = ['secure', 'network', 'backups', 'migrate'] as const;

export const TIMELINES = {
  month: 'Within a month',
  quarter: '1–3 months',
  later: '3+ months',
  exploring: 'Just exploring',
} as const;

export type NeedKey = keyof typeof NEEDS;
export type GoalKey = keyof typeof GOALS;
export type TimelineKey = keyof typeof TIMELINES;
export type Approach = 'focused' | 'capture_booking' | 'managed' | 'ai_automation' | 'it_managed' | 'web_it';

export const MAX_GOALS = 3;

export type Brief = {
  name: string;
  goals: string;
  approach: { key: Approach; title: string; why: string };
  timeline: string;
  next_step: { text: string; url: string };
};

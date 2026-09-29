// Project assessment — the questions and shared types. Browser-safe: the form
// imports this directly; the server logic lives in ./assessment.ts.

export const NEEDS = {
  new: 'A brand-new site',
  refresh: 'A refresh of my current site',
  ai: 'AI or automation for my business',
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
} as const;

export const TIMELINES = {
  month: 'Within a month',
  quarter: '1–3 months',
  later: '3+ months',
  exploring: 'Just exploring',
} as const;

export type NeedKey = keyof typeof NEEDS;
export type GoalKey = keyof typeof GOALS;
export type TimelineKey = keyof typeof TIMELINES;
export type Approach = 'focused' | 'capture_booking' | 'managed' | 'ai_automation';

export const MAX_GOALS = 3;

export type Brief = {
  name: string;
  goals: string;
  approach: { key: Approach; title: string; why: string };
  timeline: string;
  next_step: { text: string; url: string };
};

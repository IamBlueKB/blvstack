// Niche registry — loads every niche config and exposes lookup helpers.
//
// Adding a new niche: create a sibling file in this folder, add the import +
// registry entry below. No DB migration needed — `prospects.niche` is a free-form
// text column validated against the slugs registered here.

import type { NicheConfig } from './types';
import { solar } from './solar';
import { medspa } from './medspa';
import { dental } from './dental';
import { hvac } from './hvac';
import { plumbing } from './plumbing';
import { roofing } from './roofing';
import { lawFirm } from './law-firm';
import { realEstate } from './real-estate';
import { insurance } from './insurance';
import { chiropractor } from './chiropractor';

const NICHES: Record<string, NicheConfig> = {
  solar,
  medspa,
  dental,
  hvac,
  plumbing,
  roofing,
  'law-firm': lawFirm,
  'real-estate': realEstate,
  insurance,
  chiropractor,
};

export function getNiche(slug: string | null | undefined): NicheConfig | null {
  if (!slug) return null;
  return NICHES[slug] ?? null;
}

export function listNiches(): NicheConfig[] {
  return Object.values(NICHES);
}

export function listLiveNiches(): NicheConfig[] {
  return Object.values(NICHES).filter((n) => n.status === 'live');
}

export function listScaffoldNiches(): NicheConfig[] {
  return Object.values(NICHES).filter((n) => n.status === 'scaffold');
}

export type { NicheConfig } from './types';

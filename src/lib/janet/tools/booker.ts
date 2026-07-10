// JANET v1 — BLVBooker tools. Thin wrappers over BLVBooker's real functions in
// src/lib/booker/* + direct booker_* reads. No new BLVBooker logic, no changes
// to BLVBooker, no self-HTTP. Rings confirmed with Blue 2026-07-09:
//   Ring 1 — reads (roster, gigs, venues, matches, scores, drafts, status)
//   Ring 2 — internal acts (scrape/match/research/draft), always logged
//   Ring 3 — anything that emails a real inbox, confirms a booking, or touches
//            money → approval-gated (send pitch, email artist, send intake,
//            mark booked). gigs/clear is deliberately NOT exposed (destructive
//            bulk delete). Staff/settings/sources/payment-edit are admin config.

import { supabaseAdmin } from '../../supabase';
import {
  runScrape,
  runScrapeForArtist,
  runVenuesForArtist,
  runMatch,
  researchVenueAndSave,
  pitchVenueForMatch,
  sendMatchToArtist,
} from '../../booker/engine';
import { composeVenuePitch } from '../../booker/composer';
import { sendArtistEmail } from '../../booker/booker-email';
import type { BookerArtist, BookerVenue } from '../../booker/types';
import type { JanetTool } from '../types';

function reqString(input: unknown, key: string): string {
  const v = (input as any)?.[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Missing required input: ${key}`);
  return v;
}
function optString(input: unknown, key: string): string | undefined {
  const v = (input as any)?.[key];
  return typeof v === 'string' && v.trim() ? v : undefined;
}
function optNumber(input: unknown, key: string): number | undefined {
  const v = (input as any)?.[key];
  return typeof v === 'number' && isFinite(v) ? v : undefined;
}

const VERTICALS = ['dj', 'rapper', 'singer', 'band', 'musician', 'poet', 'any'];
const MATCH_STATUSES = ['suggested', 'drafted', 'sent_to_artist', 'artist_approved', 'pitched', 'interested', 'booked', 'passed'];

// ─── Ring 1 — reads ────────────────────────────────────────────────
const ring1: JanetTool[] = [
  {
    name: 'booker_get_artists',
    description: 'List the BLVBooker roster (artists). Use to answer anything about who is on the roster.',
    ring: 1,
    input_schema: { type: 'object', properties: { status: { type: 'string', description: 'Filter by artist status' } } },
    handler: async (input) => {
      let q = supabaseAdmin
        .from('booker_artists')
        .select('id, name, stage_name, email, performer_type, performer_types, city, status, created_at')
        .order('created_at', { ascending: false })
        .limit(100);
      const status = optString(input, 'status');
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { count: data.length, artists: data };
    },
  },
  {
    name: 'booker_get_artist',
    description: 'Full detail for one roster artist by id (profile, performer types, rate, status, intake state).',
    ring: 1,
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    handler: async (input) => {
      const { data, error } = await supabaseAdmin.from('booker_artists').select('*').eq('id', reqString(input, 'id')).single();
      if (error) throw new Error(error.message);
      return data;
    },
  },
  {
    name: 'booker_get_gigs',
    description: 'List scraped gig opportunities. Filter by vertical or status.',
    ring: 1,
    input_schema: {
      type: 'object',
      properties: { vertical: { type: 'string', enum: VERTICALS }, status: { type: 'string' } },
    },
    handler: async (input) => {
      let q = supabaseAdmin.from('booker_gigs').select('*').order('created_at', { ascending: false }).limit(60);
      const v = optString(input, 'vertical');
      if (v) q = q.eq('vertical', v);
      const s = optString(input, 'status');
      if (s) q = q.eq('status', s);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { count: data.length, gigs: data };
    },
  },
  {
    name: 'booker_get_venues',
    description: 'List venues (with research fields — books_live_talent, submission info, contact). Filter by status.',
    ring: 1,
    input_schema: { type: 'object', properties: { status: { type: 'string' } } },
    handler: async (input) => {
      let q = supabaseAdmin.from('booker_venues').select('*').order('created_at', { ascending: false }).limit(60);
      const s = optString(input, 'status');
      if (s) q = q.eq('status', s);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { count: data.length, venues: data };
    },
  },
  {
    name: 'booker_get_matches',
    description: 'List artist↔gig / artist↔venue matches with scores, existing pitch drafts, and status. Filter by artist, kind, or status.',
    ring: 1,
    input_schema: {
      type: 'object',
      properties: {
        artist_id: { type: 'string' },
        kind: { type: 'string', enum: ['gig', 'venue'] },
        status: { type: 'string', enum: MATCH_STATUSES },
      },
    },
    handler: async (input) => {
      let q = supabaseAdmin
        .from('booker_matches')
        .select('id, artist_id, kind, gig_id, venue_id, score, status, draft_subject, pitched_at, booked_at, booked_amount, created_at')
        .order('score', { ascending: false, nullsFirst: false })
        .limit(80);
      const a = optString(input, 'artist_id');
      if (a) q = q.eq('artist_id', a);
      const k = optString(input, 'kind');
      if (k) q = q.eq('kind', k);
      const s = optString(input, 'status');
      if (s) q = q.eq('status', s);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { count: data.length, matches: data };
    },
  },
  {
    name: 'booker_get_match',
    description: 'Full detail for one match — score, reasoning, the drafted pitch (subject + body), outreach + booking status, joined artist/venue/gig.',
    ring: 1,
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    handler: async (input) => {
      const { data, error } = await supabaseAdmin
        .from('booker_matches')
        .select('*, artist:booker_artists(*), venue:booker_venues(*), gig:booker_gigs(*)')
        .eq('id', reqString(input, 'id'))
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
  },
  {
    name: 'booker_get_sources',
    description: 'List the scrape sources BLVBooker pulls gig opportunities from.',
    ring: 1,
    input_schema: { type: 'object', properties: {} },
    handler: async () => {
      const { data, error } = await supabaseAdmin.from('booker_sources').select('*').order('vertical').limit(400);
      if (error) throw new Error(error.message);
      return { count: data.length, sources: data };
    },
  },
  {
    name: 'booker_get_payments',
    description: 'List BLVBooker booking payments (success fees). Read-only — creating/editing payments is not exposed.',
    ring: 1,
    input_schema: { type: 'object', properties: { artist_id: { type: 'string' } } },
    handler: async (input) => {
      let q = supabaseAdmin.from('booker_payments').select('*').order('created_at', { ascending: false }).limit(80);
      const a = optString(input, 'artist_id');
      if (a) q = q.eq('artist_id', a);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { count: data.length, payments: data };
    },
  },
];

// ─── Ring 2 — internal acts (logged) ───────────────────────────────
const ring2: JanetTool[] = [
  {
    name: 'booker_find_gigs',
    description: "Find gig opportunities for a roster artist: scrapes the artist's verticals and matches them. Internal — no outreach.",
    ring: 2,
    input_schema: {
      type: 'object',
      properties: { artist_id: { type: 'string' }, max_gigs_per_vertical: { type: 'number' } },
      required: ['artist_id'],
    },
    handler: async (input) =>
      runScrapeForArtist(reqString(input, 'artist_id'), { maxGigsPerVertical: optNumber(input, 'max_gigs_per_vertical') }),
  },
  {
    name: 'booker_find_venues',
    description: 'Find and research venues for a roster artist (Google Places + Yelp → research → match). Internal — no outreach.',
    ring: 2,
    input_schema: {
      type: 'object',
      properties: { artist_id: { type: 'string' }, max_venues_per_query: { type: 'number' } },
      required: ['artist_id'],
    },
    handler: async (input) =>
      runVenuesForArtist(reqString(input, 'artist_id'), { maxVenuesPerQuery: optNumber(input, 'max_venues_per_query') }),
  },
  {
    name: 'booker_scrape_gigs',
    description: 'Run a global gig scrape for one vertical across all sources. Internal.',
    ring: 2,
    input_schema: {
      type: 'object',
      properties: { vertical: { type: 'string', enum: VERTICALS }, max_gigs: { type: 'number' } },
      required: ['vertical'],
    },
    handler: async (input) => runScrape(reqString(input, 'vertical') as any, { maxGigs: optNumber(input, 'max_gigs') }),
  },
  {
    name: 'booker_research_venue',
    description: "Research a venue and save findings (crawls its site for booking info, contact, submission policy). Promotes contact email to the venue record. Internal.",
    ring: 2,
    input_schema: { type: 'object', properties: { venue_id: { type: 'string' } }, required: ['venue_id'] },
    handler: async (input) => researchVenueAndSave(reqString(input, 'venue_id')),
  },
  {
    name: 'booker_run_match',
    description: 'Run a fresh scoring/matching pass across the roster (re-scores artist↔gig and artist↔venue). Internal.',
    ring: 2,
    input_schema: { type: 'object', properties: {} },
    handler: async () => runMatch(),
  },
  {
    name: 'booker_draft_venue_pitch',
    description: 'Compose the venue pitch for a match and SAVE it as the match draft (draft ≠ send). Lets Blue review/edit before a pitch is ever sent. Returns the drafted subject + body.',
    ring: 2,
    input_schema: { type: 'object', properties: { match_id: { type: 'string' } }, required: ['match_id'] },
    handler: async (input) => {
      const id = reqString(input, 'match_id');
      const { data: match, error } = await supabaseAdmin
        .from('booker_matches')
        .select('*, artist:booker_artists(*), venue:booker_venues(*)')
        .eq('id', id)
        .single();
      if (error) throw new Error(error.message);
      if (match.kind !== 'venue') throw new Error('Not a venue match');
      const artist = (match as any).artist as BookerArtist | null;
      const venue = (match as any).venue as BookerVenue | null;
      if (!artist || !venue) throw new Error('Match is missing its artist or venue');
      const { subject, body } = await composeVenuePitch(artist, venue);
      const { error: upErr } = await supabaseAdmin
        .from('booker_matches')
        .update({ draft_subject: subject, draft_body: body, status: match.status === 'suggested' ? 'drafted' : match.status })
        .eq('id', id);
      if (upErr) throw new Error(upErr.message);
      return { match_id: id, subject, body };
    },
  },
];

// ─── Ring 3 — external / irreversible (approval required) ───────────
const ring3: JanetTool[] = [
  {
    name: 'booker_pitch_venue',
    description: "SEND the drafted pitch email to a venue on the artist's behalf. Leaves the building — always requires Blue's approval. Draft the pitch first (booker_draft_venue_pitch) so there's something to review.",
    ring: 3,
    input_schema: { type: 'object', properties: { match_id: { type: 'string' } }, required: ['match_id'] },
    handler: async (input) => {
      const r = await pitchVenueForMatch(reqString(input, 'match_id'));
      if (!r.ok) throw new Error(r.error ?? 'pitch failed');
      return r;
    },
  },
  {
    name: 'booker_send_to_artist',
    description: "Email a roster artist their matched opportunities. Fires a real email to the artist's inbox — always requires Blue's approval.",
    ring: 3,
    input_schema: { type: 'object', properties: { match_id: { type: 'string' } }, required: ['match_id'] },
    handler: async (input) => {
      const r = await sendMatchToArtist(reqString(input, 'match_id'));
      if (!r.ok) throw new Error(r.error ?? 'send failed');
      return r;
    },
  },
  {
    name: 'booker_send_intake',
    description: "Email a roster artist their intake link to set up their booking profile. Fires a real email — always requires Blue's approval. (Copy mirrors the send-intake endpoint.)",
    ring: 3,
    input_schema: { type: 'object', properties: { artist_id: { type: 'string' } }, required: ['artist_id'] },
    handler: async (input) => {
      const id = reqString(input, 'artist_id');
      const { data: artist, error } = await supabaseAdmin.from('booker_artists').select('*').eq('id', id).single();
      if (error) throw new Error(error.message);
      if (!artist?.email) throw new Error('Artist has no email');
      const base = import.meta.env.SITE ?? 'https://blvstack.com';
      const intakeUrl = `${base}/i/${artist.intake_token}`;
      const firstName = artist.stage_name?.split(' ')[0] ?? artist.name?.split(' ')[0] ?? 'there';
      const send = await sendArtistEmail({
        to: artist.email,
        subject: `${firstName} — let's get your booking profile set up`,
        eyebrow: '// Roster intake',
        title: `Hey ${firstName} — ready to start booking you.`,
        body: `Quick intake form so I can start pitching you to venues and matching you to gigs that fit. Takes about 5 minutes — covers your style, rates, travel range, and gig types you want.\n\nOnce it's in, you'll only hear from me when there's real opportunity on the table. No spam, no fluff.\n\nLink expires in 14 days. Reply if you need a fresh one or have questions before filling it out.`,
        cta: { label: 'Complete intake', url: intakeUrl },
      });
      const now = new Date();
      const expiresAt = new Date(now);
      expiresAt.setDate(expiresAt.getDate() + 14);
      await supabaseAdmin.from('booker_artists').update({ intake_sent_at: now.toISOString(), intake_expires_at: expiresAt.toISOString() }).eq('id', id);
      return { sent: true, intake_url: intakeUrl, message_id: send.messageId };
    },
  },
  {
    name: 'booker_mark_booked',
    description: 'Confirm a booking: marks the match booked and creates the success-fee payment record. Touches money — always requires Blue approval.',
    ring: 3,
    input_schema: {
      type: 'object',
      properties: { match_id: { type: 'string' }, booked_amount: { type: 'number', description: 'Booking value in USD' } },
      required: ['match_id', 'booked_amount'],
    },
    handler: async (input) => {
      const id = reqString(input, 'match_id');
      const amount = optNumber(input, 'booked_amount');
      if (!amount || amount <= 0) throw new Error('booked_amount required (> 0)');
      const { data: match, error } = await supabaseAdmin
        .from('booker_matches')
        .select('*, artist:booker_artists(id, success_fee_pct)')
        .eq('id', id)
        .single();
      if (error) throw new Error(error.message);
      if (!match) throw new Error('Match not found');

      await supabaseAdmin.from('booker_matches').update({ status: 'booked', booked_at: new Date().toISOString(), booked_amount: amount }).eq('id', id);
      if (match.kind === 'venue' && match.venue_id) {
        await supabaseAdmin.from('booker_venues').update({ status: 'booked' }).eq('id', match.venue_id);
      }
      const artist = (match as any).artist;
      let fee: number | null = null;
      if (artist?.success_fee_pct) {
        fee = Math.round(amount * (artist.success_fee_pct / 100));
        await supabaseAdmin.from('booker_payments').insert({
          artist_id: match.artist_id,
          match_id: id,
          type: 'success_fee',
          amount: fee,
          status: 'pending',
          method: 'manual',
          notes: `${artist.success_fee_pct}% of $${amount} booking`,
        });
      }
      return { booked: true, match_id: id, booked_amount: amount, success_fee: fee };
    },
  },
];

export const bookerTools: JanetTool[] = [...ring1, ...ring2, ...ring3];

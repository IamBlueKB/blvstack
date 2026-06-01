// =============================================================================
// BLVBooker — Shared Types
// Drop at: src/lib/booker/types.ts
// Mirrors booker-schema.sql exactly. No DB schema change touches existing code.
// =============================================================================

export type Vertical =
  | 'dj'
  | 'musician'
  | 'poet'
  | 'visual_artist'
  | 'band'
  | 'other';

// gigs/sources allow 'any' as a catch-all vertical; artists do not.
export type GigVertical = Exclude<Vertical, 'other'> | 'any';

export type GigType =
  | 'weddings'
  | 'clubs'
  | 'corporate'
  | 'private'
  | 'festivals'
  | 'open_mics'
  | 'college'
  | 'restaurants';

export type ArtistStatus =
  | 'prospect'
  | 'onboarding'
  | 'active'
  | 'paused'
  | 'churned';

export type VenueType =
  | 'bar'
  | 'club'
  | 'festival'
  | 'library'
  | 'college'
  | 'coffeehouse'
  | 'theater'
  | 'restaurant'
  | 'private_events'
  | 'corporate'
  | 'gallery'
  | 'other';

export type VenueStatus =
  | 'new'
  | 'researched'
  | 'contacted'
  | 'responsive'
  | 'booked'
  | 'dead'
  | 'suppressed';

export type GigStatus =
  | 'new'
  | 'normalized'
  | 'matched'
  | 'sent'
  | 'expired'
  | 'dead';

export type MatchKind = 'gig' | 'venue';

export type MatchStatus =
  | 'suggested'        // AI surfaced it, awaiting your review
  | 'drafted'          // draft written
  | 'sent_to_artist'   // emailed the artist the opportunity (Build A)
  | 'artist_approved'  // artist said yes, go pitch
  | 'pitched'          // pitched to the venue/poster on artist's behalf (Build B)
  | 'interested'       // venue/poster responded positively
  | 'booked'           // confirmed gig
  | 'passed'           // you or artist declined
  | 'dead';            // no response / fell through

export type OutreachDirection = 'to_artist' | 'to_venue';
export type OutreachStatus = 'sent' | 'bounced' | 'replied';

export type PaymentType = 'retainer' | 'success_fee' | 'setup';
export type PaymentStatus = 'pending' | 'paid' | 'overdue' | 'void';
export type PaymentMethod = 'manual' | 'stripe';

export type SourceType = 'craigslist' | 'eventbrite' | 'patch' | 'calendar' | 'other';
export type GigSource = SourceType | 'manual' | 'venue';
export type VenueSourceKind = 'google_places' | 'indie_on_the_move' | 'manual' | 'scrape';

// -----------------------------------------------------------------------------

export interface SocialLinks {
  instagram?: string;
  tiktok?: string;
  soundcloud?: string;
  spotify?: string;
  youtube?: string;
  website?: string;
  [k: string]: string | undefined;
}

export interface BookerArtist {
  id: string;
  created_at: string;
  intake_token: string;
  intake_sent_at: string | null;
  intake_completed_at: string | null;
  name: string | null;
  stage_name: string | null;
  email: string | null;
  phone: string | null;
  performer_type: Vertical | null;
  genres: string | null;
  city: string | null;
  region: string | null;
  travel_radius_mi: number | null;
  rate_floor: number | null;
  rate_notes: string | null;
  gig_types: GigType[] | null;
  availability_notes: string | null;
  bio: string | null;
  press_kit_url: string | null;
  demo_url: string | null;
  social_links: SocialLinks | null;
  hard_nos: string | null;
  status: ArtistStatus;
  monthly_rate: number | null;
  success_fee_pct: number | null;
  notes: string | null;
  deleted_at: string | null;
}

export interface BookerSource {
  id: string;
  created_at: string;
  vertical: GigVertical;
  source_type: SourceType;
  label: string;
  url: string;
  city: string | null;
  region: string | null;
  active: boolean;
  last_scraped_at: string | null;
  last_result_count: number | null;
  notes: string | null;
}

export interface BookerVenue {
  id: string;
  created_at: string;
  name: string;
  venue_type: VenueType | null;
  city: string | null;
  region: string | null;
  address: string | null;
  website_url: string | null;
  booking_url: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  verticals: Vertical[] | null;
  genres_pref: string | null;
  capacity: number | null;
  source: VenueSourceKind | null;
  source_url: string | null;
  ai_research: VenueResearch | null;
  status: VenueStatus;
  notes: string | null;
  deleted_at: string | null;
}

export interface VenueResearch {
  pain_points?: string;
  booking_angle?: string;
  contact_hint?: string;
  fit_genres?: string[];
  summary?: string;
}

export interface BookerGig {
  id: string;
  created_at: string;
  source: GigSource | null;
  source_url: string | null;
  source_id: string | null;
  vertical: GigVertical | null;
  title: string | null;
  venue_name: string | null;
  city: string | null;
  region: string | null;
  gig_date: string | null;
  pay_text: string | null;
  pay_amount: number | null;
  requirements: string | null;
  contact_email: string | null;
  contact_method: string | null;
  raw_text: string;
  ai_normalized: GigNormalized | null;
  status: GigStatus;
  deleted_at: string | null;
}

export interface GigNormalized {
  title?: string;
  vertical?: GigVertical;
  city?: string;
  region?: string;
  gig_date?: string;
  pay_amount?: number;
  pay_text?: string;
  requirements?: string;
  contact_email?: string;
  contact_method?: string;
  is_real_gig?: boolean;     // filters out spam / non-gig noise
  confidence?: number;
}

export interface BookerMatch {
  id: string;
  created_at: string;
  artist_id: string;
  kind: MatchKind;
  gig_id: string | null;
  venue_id: string | null;
  score: number | null;
  reasoning: string | null;
  draft_subject: string | null;
  draft_body: string | null;
  status: MatchStatus;
  sent_to_artist_at: string | null;
  pitched_at: string | null;
  booked_at: string | null;
  booked_amount: number | null;
  notes: string | null;
}

export interface BookerOutreach {
  id: string;
  created_at: string;
  match_id: string | null;
  artist_id: string | null;
  direction: OutreachDirection;
  to_email: string;
  subject: string;
  body: string;
  resend_message_id: string | null;
  resend_thread_id: string | null;
  status: OutreachStatus;
}

export interface BookerPayment {
  id: string;
  created_at: string;
  artist_id: string;
  match_id: string | null;
  type: PaymentType;
  amount: number;
  period: string | null;
  status: PaymentStatus;
  method: PaymentMethod;
  paid_at: string | null;
  notes: string | null;
}

export type BookerSettingKey =
  | 'booker_from_email'
  | 'booker_from_name'
  | 'default_monthly_rate'
  | 'default_success_fee_pct'
  | 'match_threshold'
  | 'venue_daily_cap'
  | 'artist_send_signature';

// Convenience: a match joined with its artist + opportunity, for admin views.
export interface MatchEnriched extends BookerMatch {
  artist?: BookerArtist;
  gig?: BookerGig;
  venue?: BookerVenue;
}

// -----------------------------------------------------------------------------
// RBAC
// -----------------------------------------------------------------------------

export type StaffRole = 'owner' | 'manager' | 'agent';

export interface StaffPermissions {
  can_view_payments?: boolean;
  can_edit_sources?: boolean;
  can_manage_staff?: boolean;
  [k: string]: boolean | undefined;
}

export interface BookerStaff {
  id: string;
  created_at: string;
  email: string;
  name: string | null;
  role: StaffRole;
  permissions: StaffPermissions | null;
  active: boolean;
  last_login_at: string | null;
  deleted_at: string | null;
  // password_hash intentionally omitted — never sent to client
}

export interface BookerStaffAssignment {
  id: string;
  created_at: string;
  staff_id: string;
  artist_id: string;
}

/**
 * Authenticated actor in BLVBooker.
 * Owner = founder admin_users session OR booker_staff with role='owner'.
 * Manager/agent = booker_staff session with that role.
 */
export interface BookerActor {
  role: StaffRole;
  staffId: string | null; // null when actor is the founder (admin_users session)
  email: string;
}

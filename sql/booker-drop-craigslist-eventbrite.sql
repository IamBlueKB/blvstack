-- =============================================================================
-- BLVBooker — Drop Craigslist + Eventbrite sources
-- Reason: Craigslist TOS explicitly prohibits automated access.
-- Eventbrite removed per operator decision (low signal for talent calls).
-- =============================================================================

-- Hard delete (these are scrape sources, not user data).
-- Any gigs already scraped from them stay in booker_gigs (source_id will FK-null
-- only if you have ON DELETE CASCADE; otherwise source_id keeps the value but
-- the join returns nothing — that's fine).

DELETE FROM booker_sources
WHERE source_type IN ('craigslist', 'eventbrite');

-- Sanity check
SELECT source_type, COUNT(*) FROM booker_sources GROUP BY source_type;

-- Allowlist of Google Sheets JANET may read/update/append. Any sheet not on this
-- list (enabled) is refused by the sheet tools — so she can't touch arbitrary or
-- client sheets she wasn't given. Sheets JANET creates are auto-added; existing
-- sheets are added via the Ring-3 (Blue-approved) register_google_sheet tool.
create table if not exists janet_sheets (
  id uuid primary key default gen_random_uuid(),
  sheet_id text unique not null,
  label text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

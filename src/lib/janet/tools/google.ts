// Google Workspace tools — JANET creates real Sheets and Docs in Blue's Drive.
//
// Ring 2 (reversible: a created file can be deleted). Idempotent through the write
// executor: the same title on the same day returns the same file, never a second —
// so a retry or an uncertain model never litters Blue's Drive with duplicates.

import { createHash } from 'node:crypto';
import type { JanetTool } from '../types';
import { createSheet, createDoc, appendRows, extractSheetId, getFileMeta, googleConfigured, impersonatedUser } from '../google-workspace';
import { guardedCreate, naturalKey } from '../write-executor';

function reqString(input: unknown, key: string): string {
  const v = (input as any)?.[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Missing required input: ${key}`);
  return v.trim();
}
function optString(input: unknown, key: string): string | undefined {
  const v = (input as any)?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function dayKey(kind: string, title: string): string {
  return naturalKey(kind, [impersonatedUser(), title, new Date().toISOString().slice(0, 10)]);
}

export const googleTools: JanetTool[] = [
  {
    name: 'create_google_sheet',
    description:
      "Create a real Google Sheet in Blue's Workspace Drive (he owns it). Use when Blue asks for a spreadsheet or tracker — a call tracker, prospect list, simple table. Give a title; optionally `columns` (a header row — it's frozen + styled automatically) and `rows` (data, as an array of arrays). For a TRACKER, pass `status_column` = the exact header name that should become a dropdown (e.g. 'Status'); its cells get a picker of `status_options` (defaults to New/Contacted/Callback/Pending/Not Interested/Won/Lost) and auto color-code by value. Optionally `share_with` an email (default access reader; set share_role writer to let them edit) — omit to keep it private to Blue. Returns the sheet URL. This creates a REAL file (not a link to a template): idempotent per title per day, so calling twice returns the same sheet. Prefer this over pasting a Google Sheets link into a doc when Blue wants an actual sheet made.",
    ring: 2,
    mutates: true,
    idempotent: true,
    reversal: 'compensating', // a created Drive file is reversed by deleting it / recording a correction
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        columns: { type: 'array', items: { type: 'string' }, description: 'Header row (optional; frozen + styled)' },
        rows: { type: 'array', items: { type: 'array' }, description: 'Data rows, each an array of cell values (optional)' },
        status_column: { type: 'string', description: 'Header name to turn into a color-coded status dropdown (e.g. "Status")' },
        status_options: { type: 'array', items: { type: 'string' }, description: 'Dropdown values for status_column (default: New/Contacted/Callback/Pending/Not Interested/Won/Lost)' },
        share_with: { type: 'string', description: 'Email to share the sheet with (optional)' },
        share_role: { type: 'string', enum: ['reader', 'writer', 'commenter'], description: 'Access for share_with (default reader)' },
      },
      required: ['title'],
    },
    handler: async (input) => {
      if (!googleConfigured()) throw new Error('Google Workspace is not configured on this environment.');
      const i = input as any;
      const title = reqString(input, 'title');
      const { row, dedup } = await guardedCreate<any>({
        actionType: 'create_google_sheet',
        idempotencyKey: dayKey('google_sheet', title),
        payload: { title },
        create: async () => await createSheet({ title, columns: i.columns, rows: i.rows, statusColumn: optString(input, 'status_column') ?? null, statusOptions: Array.isArray(i.status_options) ? i.status_options : null, shareWith: optString(input, 'share_with') ?? null, shareRole: i.share_role }),
        reread: async (id) => await getFileMeta(id),
      });
      return { created: !dedup, dedup, sheet: row };
    },
  },
  {
    name: 'create_google_doc',
    description:
      "Create a real Google Doc in Blue's Workspace Drive (he owns it). Use when Blue asks for a document — a brief, outreach script, one-pager. Give a title; optional `content` as MARKDOWN (headings, **bold**, lists — it's converted to real Google Docs formatting, not shown raw). Optionally `share_with` an email (default reader; share_role writer to allow edits). Returns the doc URL. Creates a REAL file; idempotent per title per day. Note: this is a Google Doc in Drive, separate from JANET's own internal docs (create_doc) — use THIS when Blue specifically wants a Google Doc.",
    ring: 2,
    mutates: true,
    idempotent: true,
    reversal: 'compensating',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string', description: 'Body as markdown (optional; converted to Google Docs formatting)' },
        share_with: { type: 'string', description: 'Email to share the doc with (optional)' },
        share_role: { type: 'string', enum: ['reader', 'writer', 'commenter'], description: 'Access for share_with (default reader)' },
      },
      required: ['title'],
    },
    handler: async (input) => {
      if (!googleConfigured()) throw new Error('Google Workspace is not configured on this environment.');
      const i = input as any;
      const title = reqString(input, 'title');
      const { row, dedup } = await guardedCreate<any>({
        actionType: 'create_google_doc',
        idempotencyKey: dayKey('google_doc', title),
        payload: { title },
        create: async () => await createDoc({ title, content: optString(input, 'content') ?? null, shareWith: optString(input, 'share_with') ?? null, shareRole: i.share_role }),
        reread: async (id) => await getFileMeta(id),
      });
      return { created: !dedup, dedup, doc: row };
    },
  },
  {
    name: 'add_rows_to_google_sheet',
    description:
      "Append rows to an EXISTING Google Sheet — e.g. add more prospects to a tracker Blue already has. Give the sheet's `sheet_url` (or id) and `rows` (array of arrays, cell values in the sheet's column order, left to right). Rows are added below the existing data; the header, status dropdown, and formatting are preserved. Idempotent: appending the exact same rows to the same sheet twice is a no-op (never duplicates). Use THIS to add to an existing sheet — use create_google_sheet only for a brand-new one. The DFW grease-trap prospect tracker (columns: Business Name, Contact Person, Phone, Email, City/Area, Website, Status, Last Contacted, Next Follow-Up, Attempts, Notes) is at https://docs.google.com/spreadsheets/d/1sAbBdQm_XWrv0Z34GTzc7JJ0bmsRLFX25uw67koTlb4/edit.",
    ring: 2,
    mutates: true,
    idempotent: true,
    reversal: 'compensating', // appended rows are removed manually / by a recorded correction
    input_schema: {
      type: 'object',
      properties: {
        sheet_url: { type: 'string', description: 'URL (or id) of the sheet to append to' },
        rows: { type: 'array', items: { type: 'array' }, description: 'Rows to append, each an array of cell values in column order' },
      },
      required: ['sheet_url', 'rows'],
    },
    handler: async (input) => {
      if (!googleConfigured()) throw new Error('Google Workspace is not configured on this environment.');
      const i = input as any;
      const sheetId = extractSheetId(reqString(input, 'sheet_url'));
      const rows = Array.isArray(i.rows) ? i.rows : [];
      if (!rows.length) throw new Error('Provide at least one row to append.');
      const sig = createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
      const { row, dedup } = await guardedCreate<any>({
        actionType: 'add_rows_to_google_sheet',
        idempotencyKey: naturalKey('sheet_append', [sheetId, sig]),
        payload: { sheetId, row_count: rows.length },
        create: async () => {
          const r = await appendRows({ sheetId, rows });
          return { ...r, id: `${sheetId}:${r.updatedRange ?? 'appended'}` };
        },
        reread: async (id) => ({ id }),
      });
      return { appended: !dedup, dedup, result: row };
    },
  },
];

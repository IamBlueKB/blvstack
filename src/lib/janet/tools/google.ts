// Google Workspace tools — JANET creates real Sheets and Docs in Blue's Drive.
//
// Ring 2 (reversible: a created file can be deleted). Idempotent through the write
// executor: the same title on the same day returns the same file, never a second —
// so a retry or an uncertain model never litters Blue's Drive with duplicates.

import type { JanetTool } from '../types';
import { createSheet, createDoc, getFileMeta, googleConfigured, impersonatedUser } from '../google-workspace';
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
];

// Google Workspace — JANET creates Sheets and Docs in Blue's Workspace Drive.
//
// Auth is a service account with DOMAIN-WIDE DELEGATION, impersonating a Workspace
// user (GOOGLE_WORKSPACE_IMPERSONATE, default blue@blvstack.com) so every file is
// owned by that user — Blue keeps them, shares with clients as he chooses. The SA
// key JSON is GOOGLE_WORKSPACE_SA_KEY. Nothing here is public; sharing is explicit.

import { google } from 'googleapis';

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/documents',
];

function env(name: string): string | undefined {
  return (import.meta as any).env?.[name] ?? process.env[name];
}

export function googleConfigured(): boolean {
  return !!env('GOOGLE_WORKSPACE_SA_KEY');
}

export function impersonatedUser(): string {
  return env('GOOGLE_WORKSPACE_IMPERSONATE') || 'blue@blvstack.com';
}

function authClient() {
  const raw = env('GOOGLE_WORKSPACE_SA_KEY');
  if (!raw) throw new Error('Google Workspace is not configured — GOOGLE_WORKSPACE_SA_KEY is missing.');
  const key = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return new google.auth.JWT({ email: key.client_email, key: key.private_key, scopes: SCOPES, subject: impersonatedUser() });
}

export type ShareRole = 'reader' | 'writer' | 'commenter';
export type CreatedFile = { id: string; url: string; title: string; shared_with?: string | null };

async function shareFile(auth: any, fileId: string, email: string, role: ShareRole): Promise<void> {
  const drive = google.drive({ version: 'v3', auth });
  await drive.permissions.create({ fileId, requestBody: { type: 'user', role, emailAddress: email }, sendNotificationEmail: false });
}

const DEFAULT_STATUSES = ['New', 'Contacted', 'Callback', 'Pending', 'Not Interested', 'Won', 'Lost'];
const rgb = (r: number, g: number, b: number) => ({ red: r / 255, green: g / 255, blue: b / 255 });
// Semantic colors for common status words; anything else cycles a soft palette.
const STATUS_COLOR: Record<string, { red: number; green: number; blue: number }> = {
  new: rgb(230, 232, 235), contacted: rgb(197, 224, 247), callback: rgb(255, 224, 178),
  pending: rgb(255, 245, 180), 'not interested': rgb(245, 205, 205), declined: rgb(245, 205, 205),
  won: rgb(200, 235, 205), closed: rgb(200, 235, 205), lost: rgb(235, 210, 210),
};
const FALLBACK = [rgb(230, 232, 235), rgb(197, 224, 247), rgb(255, 224, 178), rgb(255, 245, 180), rgb(200, 235, 205), rgb(235, 210, 210)];
const colorFor = (status: string, idx: number) => STATUS_COLOR[status.trim().toLowerCase()] ?? FALLBACK[idx % FALLBACK.length];

/** Create a Google Sheet owned by the impersonated user. With `columns`, the header
 *  is frozen + styled. With `statusColumn` (a header name), that column becomes a
 *  dropdown of `statusOptions` (default a prospect-tracker set) whose cells auto
 *  color-code by value. Optional data rows + share. Returns the live URL. */
export async function createSheet(input: {
  title: string;
  columns?: string[];
  rows?: (string | number)[][];
  statusColumn?: string | null;
  statusOptions?: string[] | null;
  shareWith?: string | null;
  shareRole?: ShareRole;
}): Promise<CreatedFile> {
  const auth = authClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const created = await sheets.spreadsheets.create({ requestBody: { properties: { title: input.title } } });
  const id = created.data.spreadsheetId!;
  const url = created.data.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${id}/edit`;
  const sheetId = created.data.sheets?.[0]?.properties?.sheetId ?? 0;

  const values: (string | number)[][] = [];
  if (input.columns?.length) values.push(input.columns);
  if (input.rows?.length) values.push(...input.rows);
  if (values.length) {
    await sheets.spreadsheets.values.update({ spreadsheetId: id, range: 'A1', valueInputOption: 'USER_ENTERED', requestBody: { values } });
  }

  // Formatting — only when there's a header row to anchor on.
  if (input.columns?.length) {
    const cols = input.columns;
    const LASTROW = 1000;
    const requests: any[] = [
      { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
      { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: cols.length },
          cell: { userEnteredFormat: { backgroundColor: rgb(10, 22, 40), verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', textFormat: { foregroundColor: rgb(250, 248, 243), bold: true, fontSize: 10 } } },
          fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy)' } },
      { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 34 }, fields: 'pixelSize' } },
      { autoResizeDimensions: { dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: cols.length } } },
    ];
    const statusIdx = input.statusColumn ? cols.findIndex((c) => c.trim().toLowerCase() === input.statusColumn!.trim().toLowerCase()) : -1;
    if (statusIdx >= 0) {
      const opts = (input.statusOptions?.length ? input.statusOptions : DEFAULT_STATUSES).map((s) => String(s).trim()).filter(Boolean);
      const range = { sheetId, startRowIndex: 1, endRowIndex: LASTROW, startColumnIndex: statusIdx, endColumnIndex: statusIdx + 1 };
      requests.push({ setDataValidation: { range, rule: { condition: { type: 'ONE_OF_LIST', values: opts.map((v) => ({ userEnteredValue: v })) }, strict: false, showCustomUi: true } } });
      opts.forEach((v, i) => requests.push({ addConditionalFormatRule: { rule: { ranges: [range], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: v }] }, format: { backgroundColor: colorFor(v, i) } } }, index: 0 } }));
    }
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests } });
  }

  let shared_with: string | null = null;
  if (input.shareWith) { await shareFile(auth, id, input.shareWith, input.shareRole ?? 'reader'); shared_with = input.shareWith; }
  return { id, url, title: input.title, shared_with };
}

/** Create a Google Doc owned by the impersonated user. When `content` is given it's
 *  imported as MARKDOWN (Drive converts it to real formatting — headings, bold, lists).
 *  Empty content makes a blank doc. Optional share. */
export async function createDoc(input: {
  title: string;
  content?: string | null;
  shareWith?: string | null;
  shareRole?: ShareRole;
}): Promise<CreatedFile> {
  const auth = authClient();
  let id: string;
  const body = input.content?.trim();
  if (body) {
    // Markdown → Google Doc via Drive import conversion (real formatting, not raw **).
    const drive = google.drive({ version: 'v3', auth });
    const res = await drive.files.create({
      requestBody: { name: input.title, mimeType: 'application/vnd.google-apps.document' },
      media: { mimeType: 'text/markdown', body },
      fields: 'id',
    });
    id = res.data.id!;
  } else {
    const docs = google.docs({ version: 'v1', auth });
    const res = await docs.documents.create({ requestBody: { title: input.title } });
    id = res.data.documentId!;
  }
  let shared_with: string | null = null;
  if (input.shareWith) { await shareFile(auth, id, input.shareWith, input.shareRole ?? 'reader'); shared_with = input.shareWith; }
  return { id, url: `https://docs.google.com/document/d/${id}/edit`, title: input.title, shared_with };
}

/** Pull a spreadsheet id out of a full Sheets URL, or accept a bare id. */
export function extractSheetId(urlOrId: string): string {
  const s = (urlOrId || '').trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9\-_]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9\-_]{20,}$/.test(s)) return s;
  throw new Error(`Could not read a Google Sheet id from: ${urlOrId}`);
}

/** Append rows to the bottom of an existing sheet's data — header, dropdown, and
 *  formatting are untouched. Returns how many rows landed + the range written. */
export async function appendRows(input: { sheetId?: string; sheetUrl?: string; rows: (string | number)[][] }): Promise<{ id: string; url: string; appended: number; updatedRange: string | null }> {
  const id = input.sheetId ?? extractSheetId(input.sheetUrl ?? '');
  const auth = authClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: id,
    range: 'A1',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: input.rows },
  });
  return { id, url: `https://docs.google.com/spreadsheets/d/${id}/edit`, appended: res.data.updates?.updatedRows ?? input.rows.length, updatedRange: res.data.updates?.updatedRange ?? null };
}

/** Re-read a created file's metadata by id (the dedup path for the write executor). */
export async function getFileMeta(fileId: string): Promise<CreatedFile | null> {
  try {
    const auth = authClient();
    const drive = google.drive({ version: 'v3', auth });
    const f = await drive.files.get({ fileId, fields: 'id, name, webViewLink' });
    return { id: f.data.id!, url: f.data.webViewLink ?? '', title: f.data.name ?? '' };
  } catch {
    return null;
  }
}

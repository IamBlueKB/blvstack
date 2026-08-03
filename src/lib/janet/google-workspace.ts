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

/** Create a Google Sheet owned by the impersonated user. Optional header row + data
 *  rows, optional share. Returns the live URL. */
export async function createSheet(input: {
  title: string;
  columns?: string[];
  rows?: (string | number)[][];
  shareWith?: string | null;
  shareRole?: ShareRole;
}): Promise<CreatedFile> {
  const auth = authClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const created = await sheets.spreadsheets.create({ requestBody: { properties: { title: input.title } } });
  const id = created.data.spreadsheetId!;
  const url = created.data.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${id}/edit`;

  const values: (string | number)[][] = [];
  if (input.columns?.length) values.push(input.columns);
  if (input.rows?.length) values.push(...input.rows);
  if (values.length) {
    await sheets.spreadsheets.values.update({ spreadsheetId: id, range: 'A1', valueInputOption: 'USER_ENTERED', requestBody: { values } });
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

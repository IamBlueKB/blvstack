/**
 * BLVBooker branded email template.
 * Follows the brand kit spec for emails:
 *   - bg #0E0E13, text #F5F4F6, muted #9A9AAB
 *   - Indigo #5558DE for buttons + links (NEVER default blue)
 *   - System font fallback (Helvetica/Arial) — Geist won't load in email
 *   - All styles INLINE, table layout (Gmail/Outlook compat)
 *   - Logo = the email-header PNG hosted on the site (SVG doesn't render in most clients)
 *   - Eyebrows: UPPERCASE, letter-spaced caps
 */

const SITE_URL = (typeof process !== 'undefined' && (process.env as any)?.SITE) || 'https://blvstack.com';
const LOGO_URL = `${SITE_URL}/blvbooker-brand/blvbooker-email-header.png`;

export interface BookerEmailOpts {
  preheader?: string;
  eyebrow?: string;
  title: string;
  body: string;             // text (or HTML); plain text gets paragraph-wrapped
  cta?: { label: string; url: string };
  signoff?: string;
}

export function wrapBookerEmail(opts: BookerEmailOpts): string {
  const preheader = opts.preheader ? escapeHtml(opts.preheader) : '';
  const eyebrow = opts.eyebrow ?? '';
  const title = escapeHtml(opts.title);

  const hasTags = /<\/?[a-z][\s\S]*?>/i.test(opts.body);
  const body = hasTags
    ? opts.body
    : opts.body
        .split(/\n\n+/)
        .map(
          (p) =>
            `<p style="margin:0 0 16px 0; color:#F5F4F6; font-family:Helvetica,Arial,sans-serif; font-size:15px; line-height:1.6;">${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`
        )
        .join('');

  const cta = opts.cta
    ? `
      <tr>
        <td align="left" style="padding:8px 32px 32px 32px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="border-radius:10px; background:#5558DE;">
                <a href="${escapeAttr(opts.cta.url)}"
                   style="display:inline-block; padding:14px 24px; font-family:Helvetica,Arial,sans-serif; font-size:12px; font-weight:600; letter-spacing:0.15em; text-transform:uppercase; color:#FFFFFF; text-decoration:none;">
                  ${escapeHtml(opts.cta.label)}
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    : '';

  const signoff = opts.signoff
    ? `<p style="margin:24px 0 0 0; color:#9A9AAB; font-family:Helvetica,Arial,sans-serif; font-size:14px; line-height:1.6;">${escapeHtml(opts.signoff)}</p>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="dark light" />
<title>${title}</title>
</head>
<body style="margin:0; padding:0; background:#0E0E13; font-family:Helvetica,Arial,sans-serif;">
  <span style="display:none !important; visibility:hidden; opacity:0; height:0; width:0; overflow:hidden;">${preheader}</span>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0E0E13;">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px; width:100%; background:#16161D; border:1px solid #2A2A36; border-radius:14px;">

          <!-- Header: hosted PNG logo -->
          <tr>
            <td align="center" style="padding:32px 32px 8px 32px;">
              <a href="${SITE_URL}" style="text-decoration:none; color:#F5F4F6;">
                <img src="${LOGO_URL}" alt="BLVBooker" width="200" style="display:block; border:0; outline:none; text-decoration:none; max-width:200px; height:auto;" />
              </a>
            </td>
          </tr>

          ${eyebrow ? `
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <p style="margin:0; font-family:Helvetica,Arial,sans-serif; font-size:11px; font-weight:600; letter-spacing:0.18em; text-transform:uppercase; color:#5558DE;">
                ${escapeHtml(eyebrow)}
              </p>
            </td>
          </tr>` : ''}

          <tr>
            <td style="padding:14px 32px 24px 32px;">
              <h1 style="margin:0; font-family:Helvetica,Arial,sans-serif; font-size:24px; line-height:1.25; color:#F5F4F6; font-weight:600; letter-spacing:-0.01em;">
                ${title}
              </h1>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 16px 32px;">
              ${body}
              ${signoff}
            </td>
          </tr>

          ${cta}

          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px; border-top:1px solid #2A2A36;">
              <p style="margin:0; font-family:Helvetica,Arial,sans-serif; font-size:11px; line-height:1.6; color:#6A6A7A;">
                BLVBooker — Bookings, handled.<br/>
                Reply directly to this email to reach me.
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

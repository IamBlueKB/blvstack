/**
 * BLVBooker branded email template.
 * Separate identity from BLVSTACK — booking-agent feel, not AI-studio.
 * Inline styles + table layout for Gmail/Outlook compatibility.
 *
 * Visual identity:
 *   - Wordmark: BLVBOOKER (no Λ stylization — keeps it utilitarian)
 *   - Tagline: "Bookings, handled."
 *   - Palette: same navy/cream base for consistency, but accent shifted to
 *     amber (#F59E0B) to visually distance from BLVSTACK's electric blue.
 *   - Eyebrow rail: amber instead of electric.
 */

export interface BookerEmailOpts {
  preheader?: string;        // hidden inbox preview
  eyebrow?: string;          // small label above the title (e.g., "// New gig")
  title: string;             // h1
  body: string;              // HTML body (pre-wrapped paragraphs OK, or plain text — we'll auto-wrap if no tags)
  cta?: { label: string; url: string };
  signoff?: string;          // bottom signature line
}

export function wrapBookerEmail(opts: BookerEmailOpts): string {
  const preheader = opts.preheader ? escapeHtml(opts.preheader) : '';
  const eyebrow = opts.eyebrow ?? '';
  const title = escapeHtml(opts.title);

  // If body contains no HTML tags, auto-wrap each paragraph in <p>
  const hasTags = /<\/?[a-z][\s\S]*?>/i.test(opts.body);
  const body = hasTags
    ? opts.body
    : opts.body
        .split(/\n\n+/)
        .map((p) => `<p style="margin:0 0 16px 0; color:#E2E8F0; font-size:15px; line-height:1.65;">${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
        .join('');

  const cta = opts.cta
    ? `
      <tr>
        <td style="padding:8px 32px 28px 32px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="border-radius:2px; background:#F59E0B;">
                <a href="${escapeAttr(opts.cta.url)}"
                   style="display:inline-block; padding:14px 28px; font-family:'SF Mono','Monaco','Courier New',monospace; font-size:11px; letter-spacing:0.25em; text-transform:uppercase; color:#0A0E1A; text-decoration:none; font-weight:600;">
                  ${escapeHtml(opts.cta.label)}
                </a>
              </td>
            </tr>
          </table>
          <p style="margin:14px 0 0 0; font-family:'SF Mono','Monaco','Courier New',monospace; font-size:10px; color:#64748B; word-break:break-all;">
            Or paste: ${escapeHtml(opts.cta.url)}
          </p>
        </td>
      </tr>`
    : '';

  const signoff = opts.signoff
    ? `<p style="margin:24px 0 0 0; color:#94A3B8; font-size:14px; line-height:1.6; font-style:italic;">${escapeHtml(opts.signoff)}</p>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="dark light" />
<title>${title}</title>
</head>
<body style="margin:0; padding:0; background:#06080F; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <span style="display:none !important; visibility:hidden; opacity:0; height:0; width:0; overflow:hidden;">${preheader}</span>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#06080F;">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px; width:100%; background:#0F1525; border:1px solid rgba(255,255,255,0.06);">

          <!-- Header: BLVBOOKER wordmark + tagline -->
          <tr>
            <td style="padding:28px 32px 20px 32px; border-bottom:1px solid rgba(255,255,255,0.05);">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td>
                    <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; font-size:20px; font-weight:800; letter-spacing:0.04em; color:#FAF8F3;">
                      BLV<span style="color:#F59E0B;">BOOKER</span>
                    </p>
                    <p style="margin:4px 0 0 0; font-family:'SF Mono','Monaco','Courier New',monospace; font-size:9px; letter-spacing:0.3em; text-transform:uppercase; color:#F59E0B;">
                      Bookings, handled.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${eyebrow ? `
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <p style="margin:0; font-family:'SF Mono','Monaco','Courier New',monospace; font-size:10px; letter-spacing:0.3em; text-transform:uppercase; color:#F59E0B;">
                ${escapeHtml(eyebrow)}
              </p>
            </td>
          </tr>` : ''}

          <tr>
            <td style="padding:14px 32px 24px 32px;">
              <h1 style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; font-size:24px; line-height:1.25; color:#FAF8F3; font-weight:700;">
                ${title}
              </h1>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 24px 32px;">
              ${body}
              ${signoff}
            </td>
          </tr>

          ${cta}

          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px; border-top:1px solid rgba(255,255,255,0.05);">
              <p style="margin:0; font-family:'SF Mono','Monaco','Courier New',monospace; font-size:10px; line-height:1.6; color:#475569;">
                BLVBooker — a booking agent service.<br/>
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

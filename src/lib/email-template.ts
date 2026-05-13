// Branded email shell for all BLVSTACK transactional sends.
// Inline styles only — Gmail / Outlook strip <style> tags.
// Table-based layout — modern flex/grid is unreliable in email clients.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Brand palette
const C = {
  bg: '#0A0E1A',         // page background (navy)
  card: '#0F1525',       // inner card
  border: 'rgba(255,255,255,0.06)',
  electric: '#2563EB',
  cream: '#FAF8F3',
  slate: '#94A3B8',
  slateDim: '#64748B',
} as const;

const MONO = "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";

type WrapOpts = {
  /** Preheader text — shows in inbox preview, hidden in body */
  preheader: string;
  /** Eyebrow label rendered above the title in mono — e.g. "// New application" */
  eyebrow: string;
  /** Main email title — bold, large */
  title: string;
  /** Body HTML — paragraphs, tables, etc. */
  body: string;
  /** Optional CTA at the end of the body — { label, href } */
  cta?: { label: string; href: string };
  /** Footer signoff — defaults to founder signature */
  signoff?: string;
};

export function wrapEmail({ preheader, eyebrow, title, body, cta, signoff }: WrapOpts): string {
  const ctaHtml = cta
    ? `
      <tr>
        <td style="padding: 32px 32px 8px 32px;">
          <a href="${cta.href}" style="display:inline-block; background:${C.electric}; color:${C.cream}; font-family:${MONO}; font-size:11px; letter-spacing:0.2em; text-transform:uppercase; text-decoration:none; padding:14px 28px; border:1px solid ${C.electric};">
            ${escapeHtml(cta.label)} &rarr;
          </a>
        </td>
      </tr>
    `
    : '';

  const signoffHtml = signoff ?? `
    <p style="margin:0; color:${C.cream}; font-family:${SANS}; font-size:15px; line-height:1.65;">
      &mdash; Blue
    </p>
    <p style="margin:4px 0 0 0; color:${C.slate}; font-family:${MONO}; font-size:11px; letter-spacing:0.2em; text-transform:uppercase;">
      Founder, BLVST<span style="display:inline-block;">&#923;</span>CK
    </p>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>BLVSTACK</title>
</head>
<body style="margin:0; padding:0; background:${C.bg}; color:${C.cream};">
  <!-- Preheader (inbox preview) -->
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; visibility:hidden; mso-hide:all;">
    ${escapeHtml(preheader)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%;">

          <!-- Brand bar -->
          <tr>
            <td style="padding:0 32px 24px 32px; border-bottom:1px solid ${C.border};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:${SANS}; font-size:22px; font-weight:700; letter-spacing:-0.02em; color:${C.cream};">
                    BLVST<span style="display:inline-block;">&#923;</span>CK
                  </td>
                  <td align="right" style="font-family:${MONO}; font-size:10px; letter-spacing:0.25em; text-transform:uppercase; color:${C.slateDim};">
                    AI Systems Studio
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:${C.card}; border:1px solid ${C.border}; border-top:none;">

              <!-- Eyebrow + title -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:36px 32px 8px 32px;">
                    <p style="margin:0; font-family:${MONO}; font-size:10px; letter-spacing:0.25em; text-transform:uppercase; color:${C.electric};">
                      ${escapeHtml(eyebrow)}
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 32px 20px 32px;">
                    <h1 style="margin:0; font-family:${SANS}; font-size:26px; font-weight:700; letter-spacing:-0.01em; line-height:1.2; color:${C.cream};">
                      ${escapeHtml(title)}
                    </h1>
                  </td>
                </tr>
              </table>

              <!-- Body -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:0 32px 12px 32px; font-family:${SANS}; font-size:15px; line-height:1.65; color:${C.cream};">
                    ${body}
                  </td>
                </tr>
                ${ctaHtml}
              </table>

              <!-- Signoff -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:24px 32px 36px 32px; border-top:1px solid ${C.border};">
                    ${signoffHtml}
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Outer footer -->
          <tr>
            <td style="padding:24px 32px 8px 32px;">
              <p style="margin:0; font-family:${MONO}; font-size:10px; letter-spacing:0.25em; text-transform:uppercase; color:${C.slateDim};">
                <a href="https://blvstack.com" style="color:${C.slate}; text-decoration:none;">blvstack.com</a>
                <span style="color:${C.slateDim}; padding:0 8px;">&middot;</span>
                <a href="mailto:hello@blvstack.com" style="color:${C.slate}; text-decoration:none;">hello@blvstack.com</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 16px 32px;">
              <p style="margin:0; font-family:${MONO}; font-size:10px; letter-spacing:0.2em; color:${C.slateDim};">
                &copy; ${new Date().getFullYear()} BLVSTACK &middot; Built like infrastructure.
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

// ---------- Helpers for building common body sections ----------

/** Render a label/value table — used in founder notifications */
export function dataTable(rows: Array<{ label: string; value: string; isLink?: boolean }>): string {
  const cells = rows
    .map((r) => {
      const val = r.isLink
        ? `<a href="${r.value}" style="color:${C.electric}; text-decoration:none;">${escapeHtml(r.value)}</a>`
        : escapeHtml(r.value);
      return `
        <tr>
          <td style="padding:10px 16px 10px 0; vertical-align:top; width:140px; font-family:${MONO}; font-size:10px; letter-spacing:0.2em; text-transform:uppercase; color:${C.slate}; border-bottom:1px solid ${C.border};">
            ${escapeHtml(r.label)}
          </td>
          <td style="padding:10px 0; vertical-align:top; font-family:${SANS}; font-size:14px; line-height:1.5; color:${C.cream}; border-bottom:1px solid ${C.border};">
            ${val}
          </td>
        </tr>
      `;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px 0;">${cells}</table>`;
}

/** Render a quoted block — used for the "problem" or "message" field */
export function quoteBlock(label: string, content: string): string {
  return `
    <p style="margin:24px 0 8px 0; font-family:${MONO}; font-size:10px; letter-spacing:0.25em; text-transform:uppercase; color:${C.electric};">
      // ${escapeHtml(label)}
    </p>
    <div style="padding:16px 20px; background:${C.bg}; border-left:2px solid ${C.electric}; font-family:${SANS}; font-size:14px; line-height:1.65; color:${C.cream}; white-space:pre-wrap;">${escapeHtml(content)}</div>
  `;
}

/** Render a system-detail line at the very bottom of admin emails */
export function metaLine(text: string): string {
  return `<p style="margin:24px 0 0 0; font-family:${MONO}; font-size:10px; letter-spacing:0.15em; color:${C.slateDim};">${escapeHtml(text)}</p>`;
}

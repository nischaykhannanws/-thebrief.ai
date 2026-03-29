// scripts/send-email.js
// Fetches issue HTML, inlines all styles for email client compatibility,
// and sends to subscribers via Gmail SMTP using Nodemailer.

const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const GMAIL_USER         = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const ISSUE_DATE         = process.env.ISSUE_DATE;     // e.g. "27-03-2026"
const ISSUE_NUMBER       = process.env.ISSUE_NUMBER;   // e.g. "008"
const SUBJECT_LINE       = process.env.SUBJECT_LINE;

const SENDER_NAME = "The Brief";
const SITE_URL    = "https://nischaykhannanws.github.io/-thebrief.ai";

if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  console.error("❌ GMAIL_USER and GMAIL_APP_PASSWORD must be set as GitHub secrets.");
  process.exit(1);
}

// ─── Gmail SMTP transporter ───────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
});

// ─── Load files ───────────────────────────────────────────────────────────────
const subscribers = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../subscribers.json"), "utf-8")
);
const rawHtml = fs.readFileSync(path.join(__dirname, "../issue.html"), "utf-8");

// ─── Extract <body> content ───────────────────────────────────────────────────
function extractBody(html) {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return match ? match[1] : html;
}

// ─── Inline critical styles onto known element patterns ──────────────────────
// Email clients (Gmail, Outlook) block <style> tags and external CSS.
// We apply inline styles directly to elements via string replacement.
function inlineEmailStyles(html) {
  return html
    // ── Remove external <link> stylesheets and <script> tags ──
    .replace(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")

    // ── Top nav bar (the "The Brief · 9:30 PM" header bar) ──
    .replace(
      /(<(?:header|div)[^>]+class="[^"]*(?:site-header|nav-bar|top-bar)[^"]*"[^>]*>)/gi,
      '$1'
    )

    // ── Ticker / live data row ──
    .replace(
      /(<(?:div|section)[^>]+class="[^"]*ticker[^"]*"[^>]*>)/gi,
      '<div style="background:#0f172a;color:#f8fafc;padding:12px 20px;font-family:\'Courier New\',monospace;font-size:12px;overflow:hidden;">'
    )

    // ── Section headings (##) rendered as <h2> ──
    .replace(
      /<h2([^>]*)>/gi,
      '<h2$1 style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;font-size:20px;font-weight:700;color:#0f172a;line-height:1.3;margin:32px 0 8px 0;padding:0;">'
    )

    // ── Story headings (###) rendered as <h3> ──
    .replace(
      /<h3([^>]*)>/gi,
      '<h3$1 style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;font-size:16px;font-weight:700;color:#1e293b;line-height:1.4;margin:20px 0 6px 0;padding:0;">'
    )

    // ── H1 (issue title) ──
    .replace(
      /<h1([^>]*)>/gi,
      '<h1$1 style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;font-size:28px;font-weight:800;color:#0f172a;line-height:1.2;margin:0 0 12px 0;padding:0;">'
    )

    // ── Body paragraphs ──
    .replace(
      /<p([^>]*)>/gi,
      '<p$1 style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;font-size:15px;line-height:1.7;color:#334155;margin:0 0 16px 0;padding:0;">'
    )

    // ── Source/category labels (small caps label above stories) ──
    .replace(
      /(<(?:div|span|p)[^>]+class="[^"]*(?:source-label|category|tag|label)[^"]*"[^>]*>)/gi,
      '$1'
    )

    // ── Blockquotes (pull quotes) ──
    .replace(
      /<blockquote([^>]*)>/gi,
      '<blockquote$1 style="border-left:4px solid #3b82f6;margin:24px 0;padding:12px 20px;background:#f0f9ff;font-style:italic;font-size:15px;color:#1e40af;">'
    )

    // ── Links ──
    .replace(
      /<a([^>]+)>/gi,
      (match, attrs) => {
        // Don't double-style if already has style
        if (/style=/i.test(attrs)) return match;
        return `<a${attrs} style="color:#2563eb;text-decoration:none;font-weight:500;">`;
      }
    )

    // ── "Read more" / source links ──
    .replace(
      /(<a[^>]+class="[^"]*(?:read-more|source-link|cta)[^"]*"[^>]*>)/gi,
      '$1'
    )

    // ── Strong/bold ──
    .replace(
      /<strong([^>]*)>/gi,
      '<strong$1 style="font-weight:700;color:#0f172a;">'
    )

    // ── Horizontal rules ──
    .replace(
      /<hr([^>]*)>/gi,
      '<hr$1 style="border:none;border-top:1px solid #e2e8f0;margin:32px 0;">'
    )

    // ── Lists ──
    .replace(
      /<ul([^>]*)>/gi,
      '<ul$1 style="padding-left:20px;margin:0 0 16px 0;">'
    )
    .replace(
      /<li([^>]*)>/gi,
      '<li$1 style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;font-size:15px;line-height:1.7;color:#334155;margin-bottom:6px;">'
    );
}

// ─── Build the full email HTML ────────────────────────────────────────────────
function buildEmailHtml(issueHtml, subscriberEmail) {
  const bodyContent  = extractBody(issueHtml);
  const styledBody   = inlineEmailStyles(bodyContent);
  const issueUrl     = `${SITE_URL}/issues/${ISSUE_DATE}.html`;
  const unsubscribeUrl = `${SITE_URL}/unsubscribe?email=${encodeURIComponent(subscriberEmail)}`;

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${SUBJECT_LINE}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;">
    <tr>
      <td align="center" style="padding:24px 12px;">

        <!-- Email card -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:660px;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

          <!-- ── HEADER BANNER ── -->
          <tr>
            <td style="background-color:#0f172a;padding:20px 32px;text-align:left;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <a href="${SITE_URL}" style="color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:22px;font-weight:800;text-decoration:none;letter-spacing:-0.5px;">The Brief</a>
                    <div style="color:#64748b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;margin-top:4px;letter-spacing:0.3px;">
                      Issue #${ISSUE_NUMBER} &nbsp;·&nbsp; Markets, auto, business &amp; the world &nbsp;·&nbsp; 9:30 PM
                    </div>
                  </td>
                  <td align="right" valign="middle">
                    <a href="${issueUrl}" style="color:#94a3b8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;text-decoration:none;">View in browser →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── ISSUE CONTENT ── -->
          <tr>
            <td style="padding:32px 32px 24px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.7;color:#334155;">
              ${styledBody}
            </td>
          </tr>

          <!-- ── DIVIDER ── -->
          <tr>
            <td style="padding:0 32px;">
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:0;" />
            </td>
          </tr>

          <!-- ── FOOTER ── -->
          <tr>
            <td style="background-color:#f8fafc;padding:20px 32px;text-align:center;">
              <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;color:#94a3b8;margin:0 0 6px 0;line-height:1.6;">
                You're receiving this because you subscribed to <strong style="color:#64748b;">The Brief</strong> by Nischay Khanna.
              </p>
              <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;color:#94a3b8;margin:0 0 6px 0;">
                <a href="${issueUrl}" style="color:#64748b;text-decoration:underline;">View in browser</a>
                &nbsp;·&nbsp;
                <a href="${unsubscribeUrl}" style="color:#64748b;text-decoration:underline;">Unsubscribe</a>
              </p>
              <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;color:#cbd5e1;margin:0;">
                Not a replacement for original journalism.
              </p>
            </td>
          </tr>

        </table>
        <!-- /Email card -->

      </td>
    </tr>
  </table>

</body>
</html>`;
}

// ─── Send a single email ──────────────────────────────────────────────────────
async function sendEmail(subscriber) {
  const { name, email } = subscriber;
  const htmlBody = buildEmailHtml(rawHtml, email);

  try {
    const info = await transporter.sendMail({
      from: `"${SENDER_NAME}" <${GMAIL_USER}>`,
      to: `"${name}" <${email}>`,
      subject: SUBJECT_LINE,
      html: htmlBody,
    });
    console.log(`✅ Sent to ${name} <${email}> — ID: ${info.messageId}`);
    return { email, success: true };
  } catch (err) {
    console.error(`❌ Failed: ${email} — ${err.message}`);
    return { email, success: false, error: err.message };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n📬 The Brief #${ISSUE_NUMBER} — Sending to ${subscribers.length} subscriber(s) via Gmail...\n`);

  try {
    await transporter.verify();
    console.log("✅ Gmail SMTP connection verified\n");
  } catch (err) {
    console.error("❌ Gmail SMTP failed:", err.message);
    process.exit(1);
  }

  const results = [];
  for (const subscriber of subscribers) {
    const result = await sendEmail(subscriber);
    results.push(result);
    await new Promise((r) => setTimeout(r, 500));
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed    = results.filter((r) => !r.success).length;
  console.log(`\n📊 Done — ${succeeded} sent, ${failed} failed`);

  if (failed > 0) {
    results.filter((r) => !r.success).forEach((r) =>
      console.error(` - ${r.email}: ${r.error}`)
    );
    process.exit(1);
  }
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });

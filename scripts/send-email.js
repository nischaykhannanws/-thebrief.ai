// scripts/send-email.js
// Reads issue HTML from the fetched file, wraps it in an email shell,
// and sends to all subscribers via Gmail SMTP using Nodemailer.

const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const GMAIL_USER = process.env.GMAIL_USER;             // e.g. yourname@gmail.com
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const ISSUE_DATE = process.env.ISSUE_DATE;             // e.g. "27-03-2026"
const ISSUE_NUMBER = process.env.ISSUE_NUMBER;         // e.g. "008"
const SUBJECT_LINE = process.env.SUBJECT_LINE;

const SENDER_NAME = "The Brief";
const SITE_URL = "https://nischaykhannanws.github.io/-thebrief.ai";

// ─── Validate env ─────────────────────────────────────────────────────────────
if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  console.error("❌ GMAIL_USER and GMAIL_APP_PASSWORD must be set as GitHub secrets.");
  process.exit(1);
}

// ─── Gmail SMTP transporter ───────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_APP_PASSWORD,   // App Password, not your Gmail login password
  },
});

// ─── Load subscribers ─────────────────────────────────────────────────────────
const subscribers = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../subscribers.json"), "utf-8")
);

// ─── Load issue HTML ──────────────────────────────────────────────────────────
const rawHtml = fs.readFileSync(path.join(__dirname, "../issue.html"), "utf-8");

// ─── Build email-safe HTML wrapper ───────────────────────────────────────────
function buildEmailHtml(issueHtml, subscriberEmail) {
  // Use body content only if a <body> tag exists, else use full HTML
  const bodyMatch = issueHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : issueHtml;

  const issueUrl = `${SITE_URL}/issues/${ISSUE_DATE}.html`;
  const unsubscribeUrl = `${SITE_URL}/unsubscribe?email=${encodeURIComponent(subscriberEmail)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${SUBJECT_LINE}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f4f4f5; }
    .email-wrapper {
      max-width: 680px;
      margin: 0 auto;
      background-color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .email-banner {
      background-color: #0f172a;
      padding: 16px 24px;
      text-align: center;
    }
    .email-banner a {
      color: #f8fafc;
      font-size: 18px;
      font-weight: 700;
      text-decoration: none;
    }
    .email-banner span {
      color: #94a3b8;
      font-size: 13px;
      display: block;
      margin-top: 4px;
    }
    .email-footer {
      background-color: #f8fafc;
      border-top: 1px solid #e2e8f0;
      padding: 20px 24px;
      text-align: center;
      font-size: 12px;
      color: #94a3b8;
      line-height: 1.6;
    }
    .email-footer a { color: #64748b; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div class="email-banner">
      <a href="${SITE_URL}">The Brief</a>
      <span>Issue #${ISSUE_NUMBER} · Markets, auto, business and the world</span>
    </div>

    <div class="email-body">
      ${bodyContent}
    </div>

    <div class="email-footer">
      <p>
        You're receiving this because you subscribed to <strong>The Brief</strong> by Nischay Khanna.<br />
        <a href="${issueUrl}">View in browser</a> &nbsp;·&nbsp;
        <a href="${unsubscribeUrl}">Unsubscribe</a>
      </p>
      <p style="margin-top: 8px; color: #cbd5e1;">Not a replacement for original journalism.</p>
    </div>
  </div>
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
    console.log(`✅ Sent to ${name} <${email}> — Message ID: ${info.messageId}`);
    return { email, success: true };
  } catch (err) {
    console.error(`❌ Failed to send to ${email}:`, err.message);
    return { email, success: false, error: err.message };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n📬 The Brief #${ISSUE_NUMBER} — Sending to ${subscribers.length} subscriber(s) via Gmail...\n`);

  // Verify SMTP connection before attempting sends
  try {
    await transporter.verify();
    console.log("✅ Gmail SMTP connection verified\n");
  } catch (err) {
    console.error("❌ Gmail SMTP connection failed:", err.message);
    console.error("   → Check that GMAIL_USER and GMAIL_APP_PASSWORD are correct.");
    process.exit(1);
  }

  const results = [];

  for (const subscriber of subscribers) {
    const result = await sendEmail(subscriber);
    results.push(result);
    // 500ms delay between sends — avoids Gmail's per-second rate limit
    await new Promise((r) => setTimeout(r, 500));
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`\n📊 Done — ${succeeded} sent, ${failed} failed`);

  if (failed > 0) {
    console.error("\nFailed recipients:");
    results.filter((r) => !r.success).forEach((r) =>
      console.error(` - ${r.email}: ${r.error}`)
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

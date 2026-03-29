// scripts/send-email.js
// Parses the issue HTML and rebuilds it as a proper email-safe layout.
// The website uses CSS grid, custom properties, JS tabs, and animations —
// none of which work in email clients. This script extracts the content
// and re-renders it using table-based, fully inline-styled HTML.

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

// ── Color palette matching the website ───────────────────────────────────────
const C = {
  ink:        "#1c1a17",
  ink60:      "#5c5852",
  ink30:      "#a8a49e",
  offWhite:   "#f9f8f5",
  cream:      "#f3f0ea",
  white:      "#ffffff",
  border:     "#e8e3da",
  red:        "#c0292e",
  redLight:   "#fdf2f2",
  amber:      "#b86b00",
  amberLight: "#fdf7ee",
  green:      "#1a6640",
  greenLight: "#f0f8f3",
  blue:       "#1a4a80",
  blueLight:  "#f0f4fb",
  teal:       "#0a6060",
  tealLight:  "#f0f8f8",
};

// ── Tag colour mapping ────────────────────────────────────────────────────────
function tagColors(className) {
  if (!className) return { bg: C.cream,       fg: C.ink60 };
  if (className.includes("red"))     return { bg: C.redLight,   fg: C.red   };
  if (className.includes("green"))   return { bg: C.greenLight, fg: C.green };
  if (className.includes("blue"))    return { bg: C.blueLight,  fg: C.blue  };
  if (className.includes("amber"))   return { bg: C.amberLight, fg: C.amber };
  if (className.includes("teal"))    return { bg: C.tealLight,  fg: C.teal  };
  return { bg: C.cream, fg: C.ink60 };
}

// ── Minimal HTML parser helpers ───────────────────────────────────────────────
function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return m ? m[1] : "";
}

function innerText(html) {
  return html.replace(/<[^>]+>/g, "").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").trim();
}

function innerHtml(html, tag) {
  const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

// Converts simple HTML (p, strong, a, br) to email-safe inline version
function safeBody(html) {
  return html
    .replace(/<p[^>]*class="lead-summary"[^>]*>([\s\S]*?)<\/p>/gi,
      (_, c) => `<p style="margin:0 0 14px 0;font-size:14px;line-height:1.75;color:${C.ink60};">${c.trim()}</p>`)
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi,
      (_, c) => `<p style="margin:0 0 14px 0;font-size:14px;line-height:1.75;color:${C.ink60};">${c.trim()}</p>`)
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi,
      (_, c) => `<strong style="font-weight:600;color:${C.ink};">${c}</strong>`)
    .replace(/<a\s+([^>]*)>([\s\S]*?)<\/a>/gi, (_, attrs, c) => {
      const href = attr(`<a ${attrs}>`, "href");
      return `<a href="${href}" style="color:${C.red};text-decoration:none;">${c}</a>`;
    })
    .replace(/<br\s*\/?>/gi, "<br>");
}

// ── Parse ticker items from HTML ──────────────────────────────────────────────
function parseTicker(html) {
  const items = [];
  const matches = html.matchAll(/<span class="ti">([\s\S]*?)<\/span>\s*(?=<span class="ti">|<\/div>)/g);
  let count = 0;
  for (const m of matches) {
    if (count++ >= 9) break; // deduplicate — show only first set
    const nameMatch = m[1].match(/<span class="ti-n">(.*?)<\/span>/);
    const name = nameMatch ? innerText(nameMatch[1]) : "";
    const rest = m[1].replace(/<span class="ti-n">.*?<\/span>/, "");
    const spans = [...rest.matchAll(/<span[^>]*>(.*?)<\/span>/g)].map(s => innerText(s[1]));
    if (name) items.push({ name, value: spans.join(" · ") });
  }
  return items;
}

// ── Parse all sections ────────────────────────────────────────────────────────
function parseSections(html) {
  const sections = [];
  const secMatches = html.matchAll(/<section[^>]+id="sec-([^"]+)"[^>]*>([\s\S]*?)<\/section>/g);

  for (const sec of secMatches) {
    const id      = sec[1];
    const content = sec[2];
    if (id === "feedback") continue; // skip feedback form in email

    const srcEl    = content.match(/<div class="sec-src">(.*?)<\/div>/);
    const titleEl  = content.match(/<h2[^>]*class="sec-title"[^>]*>([\s\S]*?)<\/h2>/);
    const countEl  = content.match(/<span class="sec-count">(.*?)<\/span>/);

    const section = {
      id,
      src:   srcEl   ? innerText(srcEl[1])   : "",
      title: titleEl ? innerText(titleEl[1]) : "",
      count: countEl ? innerText(countEl[1]) : "",
      lead:  null,
      cards: [],
    };

    // Parse lead card
    const leadMatch = content.match(/<div class="lead-card"[^>]*>([\s\S]*?)<\/div>\s*(?=<div class="card-grid"|<div class="story-list"|$)/);
    if (leadMatch) {
      const leadHtml = leadMatch[1];
      const tagEl   = leadHtml.match(/<div class="lead-tag">(.*?)<\/div>/);
      const hlEl    = leadHtml.match(/<h3[^>]*class="lead-hl"[^>]*>([\s\S]*?)<\/h3>/);
      const sumEls  = [...leadHtml.matchAll(/<p[^>]*class="lead-summary"[^>]*>([\s\S]*?)<\/p>/g)];
      const btnEl   = leadHtml.match(/<a class="src-btn"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      const quoteEl = leadHtml.match(/<div class="pull-quote">([\s\S]*?)<\/div>/);
      const attrEl  = leadHtml.match(/<div class="pull-attr">([\s\S]*?)<\/div>/);
      const asideStatsEl = leadHtml.match(/<div style="font-size:13px[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/);

      section.lead = {
        tag:    tagEl   ? innerText(tagEl[1])   : "",
        hl:     hlEl    ? innerText(hlEl[1])    : "",
        summaries: sumEls.map(s => s[1].trim()),
        btnUrl: btnEl   ? btnEl[1]              : "",
        btnTxt: btnEl   ? innerText(btnEl[2])   : "Read more",
        quote:  quoteEl ? innerText(quoteEl[1]) : "",
        attr:   attrEl  ? innerText(attrEl[1])  : "",
        stats:  asideStatsEl ? asideStatsEl[1]  : "",
      };
    }

    // Parse cards
    const cardMatches = content.matchAll(/<div class="card"[^>]*>([\s\S]*?)<\/div>\s*(?=<div class="card"|<\/div>\s*<\/div>\s*<\/section>)/g);
    for (const card of cardMatches) {
      const cardHtml = card[1];
      const tagEl  = cardHtml.match(/<span class="ctag([^"]*)">(.*?)<\/span>/);
      const hlEl   = cardHtml.match(/<div class="card-hl">([\s\S]*?)<\/div>/);
      const deckEl = cardHtml.match(/<div class="card-deck">([\s\S]*?)<\/div>/);
      const srcEl2 = cardHtml.match(/<div class="card-src">([\s\S]*?)<\/div>/);
      const linkEl = cardHtml.match(/href="([^"]+)"[^>]*>(?:Read\s+\w+|Read\s+\w+\s+\w+)/i);

      section.cards.push({
        tagClass: tagEl ? tagEl[1].trim() : "",
        tag:      tagEl ? innerText(tagEl[2]) : "",
        hl:       hlEl  ? innerText(hlEl[1])  : "",
        deck:     deckEl? deckEl[1].trim()    : "",
        src:      srcEl2? innerText(srcEl2[1]): "",
        url:      linkEl? linkEl[1]           : "",
      });
    }

    sections.push(section);
  }
  return sections;
}

// ── Email HTML builder ────────────────────────────────────────────────────────
function buildEmailHtml(rawHtml, subscriberEmail) {
  const issueUrl       = `${SITE_URL}/issues/${ISSUE_DATE}.html`;
  const unsubscribeUrl = `${SITE_URL}/unsubscribe?email=${encodeURIComponent(subscriberEmail)}`;

  // Parse hero content
  const heroLabel = rawHtml.match(/<div class="hero-label">(.*?)<\/div>/);
  const heroDesc  = rawHtml.match(/<div class="hero-desc">([\s\S]*?)<\/div>/);
  const heroDate  = rawHtml.match(/<div class="hero-date">(.*?)<\/div>/);

  const tickerItems = parseTicker(rawHtml);
  const sections    = parseSections(rawHtml);

  // ── Shared style snippets ─────────────────────────────────────────────────
  const monoFont = `'Courier New', Courier, monospace`;
  const serifFont = `Georgia, 'Times New Roman', serif`;
  const sansFont  = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif`;

  // ── Build section HTML ────────────────────────────────────────────────────
  function renderSection(sec) {
    let html = `
      <!-- ── SECTION DIVIDER ── -->
      <tr><td style="padding:0 0 0 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="background:${C.offWhite};padding:28px 32px 0 32px;">

              <!-- Section header -->
              <p style="margin:0 0 4px 0;font-family:${monoFont};font-size:9px;letter-spacing:2.5px;text-transform:uppercase;color:${C.ink30};">${sec.src}</p>
              <h2 style="margin:0 0 20px 0;font-family:${serifFont};font-size:20px;font-weight:700;line-height:1.25;color:${C.ink};border-bottom:2px solid ${C.ink};padding-bottom:10px;">${sec.title}</h2>
    `;

    // Lead card
    if (sec.lead && sec.lead.hl) {
      const lead = sec.lead;
      html += `
              <!-- Lead story -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.white};border:1px solid ${C.border};border-radius:6px;margin-bottom:20px;">
                <tr>
                  <td style="padding:20px 22px;">
                    <p style="margin:0 0 8px 0;font-family:${monoFont};font-size:9px;letter-spacing:2px;text-transform:uppercase;color:${C.red};">${lead.tag}</p>
                    <h3 style="margin:0 0 14px 0;font-family:${serifFont};font-size:17px;font-weight:700;line-height:1.3;color:${C.ink};">${lead.hl}</h3>
                    ${lead.summaries.map(s => `<p style="margin:0 0 12px 0;font-size:14px;line-height:1.75;color:${C.ink60};">${innerText(s)}</p>`).join("")}
                    ${lead.quote ? `
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0;">
                      <tr>
                        <td style="border-left:3px solid ${C.red};padding:8px 14px;background:${C.offWhite};">
                          <p style="margin:0 0 4px 0;font-family:${serifFont};font-style:italic;font-size:14px;line-height:1.6;color:${C.ink};">${lead.quote}</p>
                          <p style="margin:0;font-family:${monoFont};font-size:9px;color:${C.ink30};letter-spacing:1px;">${lead.attr}</p>
                        </td>
                      </tr>
                    </table>` : ""}
                    ${lead.btnUrl ? `
                    <a href="${lead.btnUrl}" style="display:inline-block;margin-top:8px;font-family:${monoFont};font-size:9.5px;letter-spacing:1.5px;text-transform:uppercase;color:${C.red};text-decoration:none;border:1px solid ${C.red};padding:6px 14px;border-radius:2px;">${lead.btnTxt} ↗</a>` : ""}
                  </td>
                </tr>
              </table>
      `;
    }

    // Cards grid — rendered as stacked single-column for email compatibility
    if (sec.cards.length > 0) {
      html += `<!-- Story cards -->`;
      for (const card of sec.cards) {
        const tc = tagColors(card.tagClass);
        // Truncate deck to ~300 chars for email readability
        const deckText = innerText(card.deck);
        const shortDeck = deckText.length > 320 ? deckText.slice(0, 317) + "…" : deckText;

        html += `
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.white};border:1px solid ${C.border};border-radius:6px;margin-bottom:12px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <span style="display:inline-block;margin-bottom:8px;font-family:${monoFont};font-size:8px;letter-spacing:1.5px;text-transform:uppercase;padding:2px 8px;border-radius:2px;background:${tc.bg};color:${tc.fg};">${card.tag}</span>
                    <p style="margin:0 0 8px 0;font-family:${serifFont};font-size:15px;font-weight:700;line-height:1.3;color:${C.ink};">${card.hl}</p>
                    <p style="margin:0 0 10px 0;font-size:13px;line-height:1.65;color:${C.ink60};">${shortDeck}</p>
                    ${card.url ? `<p style="margin:0;font-family:${monoFont};font-size:9px;letter-spacing:1px;text-transform:uppercase;color:${C.ink30};">${card.src.split("→")[0].trim()} → <a href="${card.url}" style="color:${C.red};text-decoration:none;">Read more ↗</a></p>` : `<p style="margin:0;font-family:${monoFont};font-size:9px;color:${C.ink30};">${card.src}</p>`}
                  </td>
                </tr>
              </table>
        `;
      }
    }

    html += `
            </td>
          </tr>
        </table>
      </td></tr>
    `;
    return html;
  }

  // ── Assemble full email ───────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <title>${SUBJECT_LINE}</title>
</head>
<body style="margin:0;padding:0;background:${C.offWhite};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.offWhite};">
  <tr><td align="center" style="padding:20px 12px;">

    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:${C.white};border:1px solid ${C.border};border-radius:6px;overflow:hidden;">

      <!-- ── TOP BAR ── -->
      <tr>
        <td style="background:${C.white};border-bottom:1px solid ${C.border};padding:10px 22px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-family:${serifFont};font-size:15px;font-weight:700;color:${C.ink};">The <span style="color:${C.red};">Brief</span></td>
              <td align="right" style="font-family:${monoFont};font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:${C.ink30};">${heroDate ? innerText(heroDate[1]) : ""}</td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- ── HERO ── -->
      <tr>
        <td style="background:${C.white};border-bottom:1px solid ${C.border};padding:36px 32px 28px;text-align:center;">
          <p style="margin:0 0 10px 0;font-family:${monoFont};font-size:9px;letter-spacing:3px;text-transform:uppercase;color:${C.ink30};">${heroLabel ? innerText(heroLabel[1]) : ""}</p>
          <h1 style="margin:0 0 10px 0;font-family:${serifFont};font-size:48px;font-weight:700;letter-spacing:-1.5px;color:${C.ink};line-height:1;">The <em style="color:${C.red};font-style:normal;">Brief</em></h1>
          <p style="margin:0 0 14px 0;font-family:${serifFont};font-style:italic;font-size:15px;line-height:1.6;color:${C.ink60};max-width:480px;margin-left:auto;margin-right:auto;">${heroDesc ? innerText(heroDesc[1]) : ""}</p>
          <a href="${issueUrl}" style="display:inline-block;font-family:${monoFont};font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:${C.red};text-decoration:none;border:1px solid ${C.red};padding:6px 16px;border-radius:2px;">View full issue online ↗</a>
          <div style="width:36px;height:2px;background:${C.red};margin:18px auto 0;"></div>
        </td>
      </tr>

      <!-- ── TICKER (static table in email) ── -->
      ${tickerItems.length > 0 ? `
      <tr>
        <td style="background:${C.cream};border-bottom:1px solid ${C.border};padding:10px 22px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            ${tickerItems.map((t, i) => i % 2 === 0 && i + 1 < tickerItems.length ? `
            <tr>
              <td width="50%" style="padding:3px 0;">
                <span style="font-family:${monoFont};font-size:10px;font-weight:600;color:${C.ink};">${t.name}</span>
                <span style="font-family:${monoFont};font-size:10px;color:${C.ink60};"> ${t.value}</span>
              </td>
              <td width="50%" style="padding:3px 0;">
                <span style="font-family:${monoFont};font-size:10px;font-weight:600;color:${C.ink};">${tickerItems[i+1].name}</span>
                <span style="font-family:${monoFont};font-size:10px;color:${C.ink60};"> ${tickerItems[i+1].value}</span>
              </td>
            </tr>` : "").join("")}
          </table>
        </td>
      </tr>` : ""}

      <!-- ── SECTIONS ── -->
      ${sections.map(renderSection).join("")}

      <!-- ── FOOTER ── -->
      <tr>
        <td style="background:${C.white};border-top:1px solid ${C.border};padding:20px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td>
                <p style="margin:0 0 3px 0;font-family:${serifFont};font-size:14px;font-weight:700;color:${C.ink};">The <span style="color:${C.red};">Brief</span></p>
                <p style="margin:0;font-family:${monoFont};font-size:8px;letter-spacing:1px;color:${C.ink30};text-transform:uppercase;">Curated by Nischay · Not a replacement for original journalism</p>
              </td>
              <td align="right" valign="top">
                <p style="margin:0;font-family:${monoFont};font-size:9px;color:${C.ink30};">
                  <a href="${issueUrl}" style="color:${C.ink60};text-decoration:underline;">View in browser</a> &nbsp;·&nbsp;
                  <a href="${unsubscribeUrl}" style="color:${C.ink60};text-decoration:underline;">Unsubscribe</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

    </table>

  </td></tr>
</table>
</body>
</html>`;
}

// ── Gmail transporter ─────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
});

const subscribers = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../subscribers.json"), "utf-8")
);
const rawHtml = fs.readFileSync(path.join(__dirname, "../issue.html"), "utf-8");

async function sendEmail(subscriber) {
  const { name, email } = subscriber;
  const html = buildEmailHtml(rawHtml, email);
  try {
    const info = await transporter.sendMail({
      from: `"${SENDER_NAME}" <${GMAIL_USER}>`,
      to: `"${name}" <${email}>`,
      subject: SUBJECT_LINE,
      html,
    });
    console.log(`✅ Sent to ${name} <${email}> — ${info.messageId}`);
    return { email, success: true };
  } catch (err) {
    console.error(`❌ Failed: ${email} — ${err.message}`);
    return { email, success: false, error: err.message };
  }
}

async function main() {
  console.log(`\n📬 The Brief #${ISSUE_NUMBER} — Sending to ${subscribers.length} subscriber(s)...\n`);
  try {
    await transporter.verify();
    console.log("✅ Gmail SMTP verified\n");
  } catch (err) {
    console.error("❌ Gmail SMTP failed:", err.message);
    process.exit(1);
  }

  const results = [];
  for (const sub of subscribers) {
    results.push(await sendEmail(sub));
    await new Promise(r => setTimeout(r, 500));
  }

  const ok   = results.filter(r => r.success).length;
  const fail = results.filter(r => !r.success).length;
  console.log(`\n📊 Done — ${ok} sent, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });

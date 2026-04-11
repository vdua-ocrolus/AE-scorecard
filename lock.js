#!/usr/bin/env node
/**
 * AE Scorecard — Sunday Lock
 *
 * Runs Sunday at 5am ET via GitHub Actions.
 * 1. Archives current week's data (reps, calls, coaching) to weeklyHistory
 * 2. Clears live dashboard for the new week
 * 3. Updates currentWeekLabel to the upcoming week
 * 4. Sends Slack summary of the locked week
 *
 * Required env vars:
 *   SLACK_WEBHOOK_URL (optional — for notifications)
 */

const fs = require("fs");
const https = require("https");

const DATA_START = "// @@DATA_START@@";
const DATA_END = "// @@DATA_END@@";

const REPS = [
  { id: "sam", name: "Sam Loomis", title: "Enterprise AE" },
  { id: "kyle", name: "Kyle Swikoski", title: "Dir. Strategic Sales" },
  { id: "charlie", name: "Charlie Allen", title: "Enterprise AE" },
  { id: "spencer", name: "Spencer Sobczak", title: "Account Executive" },
];

// ─── Dashboard Data I/O ─────────────────────────────────────────────────────

function readDashboard() {
  const html = fs.readFileSync("index.html", "utf8");
  const startIdx = html.indexOf(DATA_START);
  const endIdx = html.indexOf(DATA_END);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error("Data markers not found in index.html");
  }
  const dataSection = html.slice(startIdx + DATA_START.length, endIdx);
  const fn = new Function(
    dataSection + "\nreturn {reps, calls, coaching, weeklyHistory, currentWeekLabel};"
  );
  return { html, data: fn(), startIdx, endIdx };
}

function writeDashboard(html, startIdx, endIdx, data) {
  const newData = `
const reps=${JSON.stringify(data.reps)};
const MK=["M","E","DC","DP","IP","Ch","Co"];
const ML={M:"Metrics",E:"Econ Buyer",DC:"Decision Criteria",DP:"Decision Process",IP:"Identify Pain",Ch:"Champion",Co:"Competition"};
const DK=["r","d","v","a","c","e"];
const DL={r:"Rapport",d:"Discovery",v:"Value",a:"Advancement",c:"Control",e:"Engagement"};
const DW={r:"10%",d:"30%",v:"15%",a:"20%",c:"10%",e:"15%"};
const calls=${JSON.stringify(data.calls)};
const coaching=${JSON.stringify(data.coaching)};
const weeklyHistory=${JSON.stringify(data.weeklyHistory)};
const currentWeekLabel=${JSON.stringify(data.currentWeekLabel)};
`;
  const newHtml =
    html.slice(0, startIdx + DATA_START.length) + newData + html.slice(endIdx);
  fs.writeFileSync("index.html", newHtml);
}

// ─── Slack ──────────────────────────────────────────────────────────────────

function postToWebhook(webhookUrl, message) {
  const url = new URL(webhookUrl);
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ text: message });
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve(body));
      }
    );
    req.on("error", (e) => { console.error(`Webhook error: ${e.message}`); resolve("error"); });
    req.write(data);
    req.end();
  });
}

function postSlackDM(botToken, channel, message) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ channel, text: message });
    const req = https.request(
      {
        hostname: "slack.com",
        path: "/api/chat.postMessage",
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Authorization": `Bearer ${botToken}`,
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const resp = JSON.parse(body);
            if (!resp.ok) console.error(`Slack DM error (${channel}): ${resp.error}`);
          } catch (e) { /* ignore parse errors */ }
          resolve(body);
        });
      }
    );
    req.on("error", (e) => { console.error(`Slack DM error: ${e.message}`); resolve("error"); });
    req.write(data);
    req.end();
  });
}

async function sendSlack(message) {
  const promises = [];

  // Webhook for Vik
  if (process.env.SLACK_WEBHOOK_URL) {
    promises.push(postToWebhook(process.env.SLACK_WEBHOOK_URL, message));
  }

  // Bot token DMs for Andrew Rains and John Lowenthal
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (botToken) {
    promises.push(postSlackDM(botToken, "U045N7073UM", message)); // Andrew Rains
    promises.push(postSlackDM(botToken, "UE6HYHFJ8", message));   // John Lowenthal
  }

  if (promises.length === 0) {
    console.log("⚠️ No Slack credentials set, skipping Slack");
    return;
  }

  console.log(`   📨 Sending Slack to ${promises.length} recipient(s)...`);
  await Promise.all(promises);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getNextWeekLabel() {
  // Calculate next Monday–Friday label
  const now = new Date();
  const day = now.getUTCDay();
  // Next Monday
  const monday = new Date(now);
  monday.setUTCDate(monday.getUTCDate() + (day === 0 ? 1 : 8 - day));
  // Next Friday
  const friday = new Date(monday);
  friday.setUTCDate(friday.getUTCDate() + 4);

  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  const monStr = `${months[monday.getUTCMonth()]} ${monday.getUTCDate()}`;
  const friStr = `${months[friday.getUTCMonth()]} ${friday.getUTCDate()}, ${friday.getUTCFullYear()}`;

  return `${monStr} – ${friStr}`;
}

function getCurrentWeekOf() {
  // Get the Monday of the current week as YYYY-MM-DD
  const now = new Date();
  const day = now.getUTCDay();
  const monday = new Date(now);
  monday.setUTCDate(monday.getUTCDate() - (day === 0 ? 6 : day - 1));
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const d = String(monday.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("🔒 AE Scorecard — Sunday Lock");

  const { html, data, startIdx, endIdx } = readDashboard();
  const { reps, calls, coaching, weeklyHistory, currentWeekLabel } = data;

  const totalCalls = calls.length;

  if (totalCalls === 0) {
    console.log("📭 No calls this week. Nothing to archive.");
    await sendSlack(
      `🔒 *Sunday Lock* — No calls scored this week. Dashboard cleared for ${getNextWeekLabel()}.`
    );

    // Still update the week label for the new week
    writeDashboard(html, startIdx, endIdx, {
      reps: REPS.map((r) => {
        const existing = reps.find((er) => er.id === r.id);
        return {
          id: r.id,
          name: r.name,
          title: r.title,
          profile: existing?.profile || "Unknown",
          avg: 0,
          n: 0,
        };
      }),
      calls: [],
      coaching: Object.fromEntries(
        REPS.map((r) => [
          r.id,
          { narrative: "", keep: "", start: "", stop: "", frameworkCoaching: "" },
        ])
      ),
      weeklyHistory,
      currentWeekLabel: getNextWeekLabel(),
    });
    console.log("   ✅ Week label updated to: " + getNextWeekLabel());
    return;
  }

  // Archive current week
  const weekOf = getCurrentWeekOf();
  console.log(`📦 Archiving week: ${currentWeekLabel} (${weekOf})`);
  console.log(`   ${totalCalls} calls, ${reps.length} reps`);

  const archivedWeek = {
    weekOf,
    weekLabel: currentWeekLabel,
    reps: JSON.parse(JSON.stringify(reps)),
    calls: JSON.parse(JSON.stringify(calls)),
    coaching: JSON.parse(JSON.stringify(coaching)),
  };

  const updatedHistory = [...weeklyHistory, archivedWeek];

  // Clear dashboard for new week
  const nextWeekLabel = getNextWeekLabel();
  const clearedReps = REPS.map((r) => {
    const existing = reps.find((er) => er.id === r.id);
    return {
      id: r.id,
      name: r.name,
      title: r.title,
      profile: existing?.profile || "Unknown",
      avg: 0,
      n: 0,
    };
  });

  const clearedCoaching = Object.fromEntries(
    REPS.map((r) => [
      r.id,
      { narrative: "", keep: "", start: "", stop: "", frameworkCoaching: "" },
    ])
  );

  writeDashboard(html, startIdx, endIdx, {
    reps: clearedReps,
    calls: [],
    coaching: clearedCoaching,
    weeklyHistory: updatedHistory,
    currentWeekLabel: nextWeekLabel,
  });

  console.log("   ✅ Week archived and dashboard cleared");
  console.log("   📅 New week: " + nextWeekLabel);

  // Slack summary
  const sorted = [...reps].sort((a, b) => b.avg - a.avg);
  const medals = ["🥇", "🥈", "🥉", "4️⃣"];
  let msg = `🔒 *Week Locked: ${currentWeekLabel}*\n`;
  msg += `_${totalCalls} calls archived to history_\n\n`;
  sorted.forEach((r, i) => {
    msg += `${medals[i] || ""} *${r.name}*: ${r.avg} avg (${r.n} calls)\n`;
  });
  msg += `\n📅 New week starts: ${nextWeekLabel}`;
  msg += `\n🔗 <https://vdua-ocrolus.github.io/AE-scorecard/|Open Dashboard>`;

  await sendSlack(msg);
  console.log("\n🎉 Sunday lock complete!");
}

main().catch(async (e) => {
  console.error("❌ Fatal error:", e);
  try {
    await sendSlack(
      `🚨 *Sunday Lock FAILED*\n\`\`\`${e.message}\`\`\`\nCheck GitHub Actions logs for details.`
    );
  } catch (slackErr) {
    console.error("Failed to send Slack error notification:", slackErr.message);
  }
  process.exit(1);
});

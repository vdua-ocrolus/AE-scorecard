#!/usr/bin/env node
/**
 * One-time rescore of historical calls with deal history context.
 *
 * Usage:
 *   node rescore.js [repId]
 *   node rescore.js kyle          # rescore just Kyle
 *   node rescore.js                # rescore all reps
 *
 * Requires: GONG_ACCESS_KEY, GONG_ACCESS_KEY_SECRET, ANTHROPIC_API_KEY
 */

const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const https = require("https");

// Import shared config from score.js by re-declaring (keep self-contained)
const REPS = [
  { id: "sam", name: "Sam Loomis", gongId: "4650582472500753433" },
  { id: "kyle", name: "Kyle Swikoski", gongId: "9148979612777403937" },
  { id: "charlie", name: "Charlie Allen", gongId: "5653125606847862163" },
  { id: "spencer", name: "Spencer Sobczak", gongId: "1407227189165675721" },
];

const INTERNAL_NAMES = new Set([
  "vik dua", "vikas dua", "vikdua",
  "andrew rains", "andrew barnes", "matt bronen", "adam hanson",
  "david gipson", "rebecca seward", "stef mcnabb", "stephanie mcnabb",
  "amanda burgos", "puru kalia", "anthony macko",
]);

const FREE_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com",
  "icloud.com", "mail.com", "protonmail.com", "live.com", "msn.com",
  "comcast.net", "verizon.net", "att.net", "ymail.com",
]);

const DATA_START = "// @@DATA_START@@";
const DATA_END = "// @@DATA_END@@";
const MK = ["M", "E", "DC", "DP", "IP", "Ch", "Co"];

// ─── Scoring Prompt (same as score.js) ─────────────────────────────────────

const SCORING_PROMPT = `You are an elite sales coach and call evaluator. Score this call transcript using these four frameworks:
- MEDDPICC (30% weight): Discovery depth, qualification rigor, deal mechanics
- Gap Selling (30% weight): Problem diagnosis, current/future state, business impact
- Challenger Sale (25% weight): Value delivery, commercial teaching, process control
- Never Split the Difference (15% weight): Tactical empathy, rapport, engagement, negotiation

Score on these 6 dimensions (1-10 scale):
- Rapport (10%): Opening quality, tactical empathy, mirroring, labeling
- Discovery (30%): MEDDPICC coverage, Gap Selling diagnosis, calibrated questions
- Value (15%): Challenger teach/tailor, ROI framing, proof points
- Advancement (20%): Next steps, mutual action plan, take control behaviors
- Control (10%): Agenda, transitions, talk ratio, redirection
- Engagement (15%): Buying signals, "that's right" moments, voluntary elaboration

Also evaluate MEDDPICC coverage (M, E, DC, DP, IP, Ch, Co - 1 for covered, 0 for not).

MEDDPICC is a multi-call framework, not a single-call checklist. Score depth on 2-4 elements, not surface coverage of all 7.

CRITICAL RULES:
- IGNORE all pre-call chatter, internal side conversations, and waiting-room banter between colleagues. Only evaluate the rep's interactions with the PROSPECT/CLIENT.
- Never criticize demo length — long demos are driven by customer engagement
- Do not penalize AE for SE presence on POV/demo calls — score AE on orchestration
- Apply epistemic humility — use "the transcript shows" not "the rep felt"
- Exclude non-prospect calls (kickoffs, existing customers, partner calls)

MULTI-CALL DEAL AWARENESS:
- MEDDPICC and discovery are multi-call frameworks. Reps do NOT need to re-discover pain, metrics, decision process, etc. on every call.
- If DEAL HISTORY is provided below, this is a follow-up call. The rep has already had prior conversations with this account. Adjust your expectations accordingly:
  * On follow-up calls (2nd+), do NOT penalize low discovery scores just because the rep didn't ask foundational questions. Those were likely covered in earlier calls.
  * Instead, score discovery on whether the rep validated, deepened, or progressed prior understanding.
  * Later-stage calls (Pricing, POV, Sync, Contract, Proposal) should be scored primarily on Value, Advancement, and Control, not on foundational discovery.
  * Only flag discovery gaps if the transcript shows the rep is clearly missing critical info they should have by this stage.

COACHING TONE:
- You are a supportive coach, not a critic.
- Lead with what went well, then offer 1-3 focused improvement points max.
- Frame feedback as opportunities, not failures. Use "consider" and "try" not "failed to" or "missed."
- Be concise.

The "coaching" field: 2-4 sentences with a coaching tone. Highlight the top 1-3 actionable takeaways.
The "prep" field: 2-3 specific, actionable next steps for the rep.

Respond ONLY with valid JSON, no markdown, no backticks:
{
  "scores": {"rapport": N, "discovery": N, "value": N, "advancement": N, "control": N, "engagement": N},
  "weighted": N.NN,
  "talkRatio": N,
  "meddpicc": {"M": 0or1, "E": 0or1, "DC": 0or1, "DP": 0or1, "IP": 0or1, "Ch": 0or1, "Co": 0or1},
  "profile": "Challenger|Relationship Builder|Hard Worker|Problem Solver|Lone Wolf",
  "strengths": ["specific strength with evidence", "second strength"],
  "opportunities": ["specific gap with coaching suggestion", "second gap"],
  "keyQuote": "notable quote from the call",
  "narrative": "2-3 sentence factual summary",
  "coaching": "4-6 sentence qualitative coaching paragraph",
  "prep": ["action item 1", "action item 2", "action item 3"],
  "stage": "Initial Demo|POV Active|Pricing|Closing|etc"
}`;

// ─── Gong API ──────────────────────────────────────────────────────────────

function gongRequest(path, body) {
  const auth = Buffer.from(
    `${process.env.GONG_ACCESS_KEY}:${process.env.GONG_ACCESS_KEY_SECRET}`
  ).toString("base64");

  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: "us-29990.api.gong.io",
        path: `/v2${path}`,
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(new Error(`Parse error: ${body.slice(0, 200)}`)); }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function getTranscript(callId) {
  try {
    const res = await gongRequest("/calls/transcript", { filter: { callIds: [callId] } });
    return res.callTranscripts?.[0]?.transcript || null;
  } catch (e) {
    console.error(`   Transcript error: ${e.message}`);
    return null;
  }
}

async function getCallParties(callId) {
  try {
    const res = await gongRequest("/calls/extensive", {
      filter: { callIds: [callId] },
      contentSelector: { exposedFields: { parties: true } },
    });
    const call = res.calls?.[0];
    if (!call?.parties) return {};
    const partyMap = {};
    for (const p of call.parties) {
      if (p.speakerId) {
        const name = p.name || "Unknown";
        const email = p.emailAddress || "";
        const isInternal = p.affiliation === "internal" ||
          email.endsWith("@ocrolus.com") ||
          INTERNAL_NAMES.has(name.toLowerCase().trim());
        partyMap[p.speakerId] = {
          name,
          affiliation: isInternal ? "internal" : (p.affiliation || "unknown"),
          email,
        };
      }
    }
    return partyMap;
  } catch (e) {
    console.error(`   Party fetch error: ${e.message}`);
    return {};
  }
}

// ─── Transcript Processing ─────────────────────────────────────────────────

function processTranscript(transcript, partyMap) {
  if (!transcript || !transcript.length) return null;

  const speakers = {};
  const fullText = [];

  for (const segment of transcript) {
    const id = segment.speakerId || "unknown";
    if (!speakers[id]) speakers[id] = { words: 0 };
    for (const sent of segment.sentences || []) {
      const words = (sent.text || "").split(/\s+/).length;
      speakers[id].words += words;
      fullText.push({ speaker: id, text: sent.text });
    }
  }

  // Build speaker labels from party data (keyed by speakerId)
  const speakerLabels = {};
  if (partyMap) {
    for (const [spkId, info] of Object.entries(partyMap)) {
      const isInternal = info.affiliation === "internal";
      speakerLabels[spkId] = `${info.name} (${isInternal ? "INTERNAL" : "EXTERNAL"})`;
    }
  }

  const totalWords = Object.values(speakers).reduce((a, s) => a + s.words, 0);
  const totalSentences = fullText.length;

  const formatExcerpt = (entries) => entries.map((s) => {
    const label = speakerLabels[s.speaker] || `Speaker ${s.speaker}`;
    return `[${label}]: ${s.text}`;
  }).join("\n");

  const opening = formatExcerpt(fullText.slice(0, Math.min(30, totalSentences)));
  const middleStart = Math.floor(totalSentences * 0.3);
  const middleEnd = Math.floor(totalSentences * 0.6);
  const middle = formatExcerpt(fullText.slice(middleStart, middleEnd));
  const closing = formatExcerpt(fullText.slice(-Math.min(30, totalSentences)));

  const questions = fullText
    .filter((s) => s.text && s.text.includes("?"))
    .slice(0, 15)
    .map((s) => {
      const label = speakerLabels[s.speaker] || `Speaker ${s.speaker}`;
      return `[${label}]: ${s.text}`;
    });

  const speakerSummary = Object.keys(speakerLabels).length > 0
    ? Object.entries(speakerLabels).map(([id, label]) => {
        const w = speakers[id]?.words || 0;
        return `${label}: ${w} words (${totalWords > 0 ? Math.round((w / totalWords) * 100) : 0}%)`;
      }).join("; ")
    : null;

  const sorted = Object.entries(speakers).sort((a, b) => b[1].words - a[1].words);
  const topSpeakerRatio = totalWords > 0 ? Math.round((sorted[0]?.[1].words / totalWords) * 100) : 0;

  return {
    speakerCount: sorted.length,
    topSpeakerRatio,
    totalWords,
    opening: opening.slice(0, 2000),
    middle: middle.slice(0, 2500),
    closing: closing.slice(0, 2000),
    questions,
    speakerSummary,
  };
}

// ─── Account Name Extraction ───────────────────────────────────────────────

function extractAccountName(title) {
  const separators = /\s*(?:<>|\+|[xX](?=\s)|\||\/)\s*/;
  const parts = title.split(separators).map(s => s.trim()).filter(Boolean);

  for (const part of parts) {
    if (part.toLowerCase().includes("ocrolus")) continue;
    if (part.length < 2) continue;
    const cleaned = part
      .replace(/\s*\(.*\)\s*/g, "")
      .replace(/\s*[—–-]\s*.*/g, "")
      .replace(/\s*(POV|Demo|Pricing|Sync|Review|Kickoff|Contract|Proposal|Discussion|Debrief|Planning|Test-Drive|Test|Tutorial|Conditions|Summary|ROI|Evaluation|Results|Weekly|Automated|Encompass|Discovery|Tech|AI|Architecture|Next Steps|Final Alignment|Approval|Refresher|Implementation).*$/i, "")
      .replace(/^(Demo|for)\s+/i, "")
      .trim();
    if (cleaned.length >= 2) return cleaned;
  }
  return null;
}

function extractDomainFromParties(partyMap) {
  if (!partyMap) return null;
  const domains = [];
  for (const [, info] of Object.entries(partyMap)) {
    if (info.affiliation === "internal" || !info.email) continue;
    const domain = info.email.split("@")[1]?.toLowerCase();
    if (domain && !domain.includes("ocrolus") && !FREE_DOMAINS.has(domain)) {
      domains.push(domain);
    }
  }
  if (domains.length === 0) return null;
  const counts = {};
  for (const d of domains) counts[d] = (counts[d] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function resolveAccount(title, partyMap) {
  const fromTitle = extractAccountName(title);
  const domain = extractDomainFromParties(partyMap);
  let fromDomain = null;
  if (domain) {
    const base = domain.split(".")[0];
    fromDomain = base.charAt(0).toUpperCase() + base.slice(1);
  }
  return { acct: fromTitle || fromDomain, dom: domain };
}

function callsMatchAccount(c, accountLower, domain) {
  const domBase = domain ? domain.split(".")[0].toLowerCase() : null;
  // Match by stored domain (most reliable)
  if (domain && c.dom && c.dom === domain) return true;
  // Match by stored account name
  if (accountLower && c.acct && c.acct.toLowerCase() === accountLower) return true;
  // Cross-match: domain base appears in title
  if (domBase && c.title && c.title.toLowerCase().includes(domBase)) return true;
  // Cross-match: account name appears in title
  if (accountLower && c.title && c.title.toLowerCase().includes(accountLower)) return true;
  // Cross-match: other call's domain base matches this account name
  if (c.dom && accountLower) {
    const otherBase = c.dom.split(".")[0].toLowerCase();
    if (accountLower.includes(otherBase) || otherBase.includes(accountLower)) return true;
  }
  return false;
}

// ─── Deal History Builder ──────────────────────────────────────────────────

function buildDealHistory(call, repId, allScoredCalls) {
  const account = call.acct || extractAccountName(call.title);
  const domain = call.dom || null;
  if (!account && !domain) return null;

  const accountLower = account ? account.toLowerCase() : null;
  const priorCalls = allScoredCalls.filter(c =>
    c.rep === repId &&
    c.url !== call.url &&
    callsMatchAccount(c, accountLower, domain)
  );

  if (priorCalls.length === 0) return null;

  priorCalls.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  // Cumulative MEDDPICC
  const cumulativeMeddpicc = {};
  const meddpiccLabels = { M: "Metrics", E: "Econ Buyer", DC: "Decision Criteria", DP: "Decision Process", IP: "Identify Pain", Ch: "Champion", Co: "Competition" };
  for (const key of MK) {
    cumulativeMeddpicc[key] = { covered: false, coveredOn: null };
  }
  for (const c of priorCalls) {
    if (!c.m) continue;
    for (const [key, val] of Object.entries(c.m)) {
      if (val && !cumulativeMeddpicc[key].covered) {
        cumulativeMeddpicc[key] = { covered: true, coveredOn: `${c.date} (${c.title})` };
      }
    }
  }

  const displayName = account || (domain ? domain.split(".")[0] : "Unknown");
  return { account: displayName, callNumber: priorCalls.length + 1, priorCalls, cumulativeMeddpicc, meddpiccLabels };
}

function buildCumulativeMeddpicc(thisCallMeddpicc, dealHistory) {
  const cumulative = { M: 0, E: 0, DC: 0, DP: 0, IP: 0, Ch: 0, Co: 0 };
  if (dealHistory && dealHistory.cumulativeMeddpicc) {
    for (const [key, val] of Object.entries(dealHistory.cumulativeMeddpicc)) {
      if (val.covered) cumulative[key] = 1;
    }
  }
  if (thisCallMeddpicc) {
    for (const [key, val] of Object.entries(thisCallMeddpicc)) {
      if (val) cumulative[key] = 1;
    }
  }
  return cumulative;
}

// ─── Scoring ───────────────────────────────────────────────────────────────

async function scoreCall(client, callTitle, duration, processedTranscript, dealHistory) {
  const speakerInfo = processedTranscript.speakerSummary
    ? `\n- Speaker Breakdown: ${processedTranscript.speakerSummary}\n\nIMPORTANT: Speakers labeled INTERNAL are Ocrolus employees. Speakers labeled EXTERNAL are prospects/clients. ONLY score the rep's interactions with EXTERNAL speakers.`
    : "";

  let dealContext = "";
  if (dealHistory) {
    const priorDetails = dealHistory.priorCalls
      .map((c) => {
        let detail = `  CALL: "${c.title}" — ${c.date} — Score: ${c.w} — Stage: ${c.stage || c.type}`;
        if (c.s) {
          detail += `\n    Dimensions: Rapport=${c.s.r} Discovery=${c.s.d} Value=${c.s.v} Advancement=${c.s.a} Control=${c.s.c} Engagement=${c.s.e}`;
        }
        if (c.m) {
          const covered = Object.entries(c.m).filter(([, v]) => v).map(([k]) => k);
          detail += `\n    MEDDPICC covered: ${covered.length > 0 ? covered.join(", ") : "none"}`;
        }
        if (c.str && c.str.length > 0) detail += `\n    Strengths: ${c.str.join("; ")}`;
        if (c.opp && c.opp.length > 0) detail += `\n    Opportunities: ${c.opp.join("; ")}`;
        if (c.coach) detail += `\n    Coaching: ${c.coach}`;
        return detail;
      })
      .join("\n\n");

    const meddpiccStatus = Object.entries(dealHistory.cumulativeMeddpicc)
      .map(([key, val]) => {
        const label = dealHistory.meddpiccLabels[key];
        return val.covered ? `  ✅ ${key} (${label}): Covered on ${val.coveredOn}` : `  ⬜ ${key} (${label}): Not yet covered`;
      })
      .join("\n");

    dealContext = `\n\nDEAL HISTORY — This is call #${dealHistory.callNumber} with ${dealHistory.account}.\n\nPRIOR CALLS:\n${priorDetails}\n\nCUMULATIVE MEDDPICC:\n${meddpiccStatus}\n\nThis is a FOLLOW-UP call. Use the prior call context above. MEDDPICC elements already covered should NOT be penalized as missing. Score discovery on validation and progression.\n`;
  }

  const prompt = `${SCORING_PROMPT}${dealContext}

Call Info:
- Title: ${callTitle}
- Duration: ${Math.round(duration / 60)} minutes
- Speakers: ${processedTranscript.speakerCount}
- Top speaker talk ratio: ${processedTranscript.topSpeakerRatio}%${speakerInfo}

Transcript Summary:
OPENING: ${processedTranscript.opening}

MIDDLE: ${processedTranscript.middle}

CLOSING: ${processedTranscript.closing}

KEY QUESTIONS ASKED:
${processedTranscript.questions.join("\n")}`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content[0]?.text || "";
    const cleaned = text.replace(/```json\n?/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error(`Scoring error: ${e.message}`);
    return null;
  }
}

// ─── Dashboard I/O ─────────────────────────────────────────────────────────

function readDashboard() {
  const html = fs.readFileSync("index.html", "utf8");
  const startIdx = html.indexOf(DATA_START);
  const endIdx = html.indexOf(DATA_END);
  if (startIdx === -1 || endIdx === -1) throw new Error("Data markers not found");
  const dataSection = html.slice(startIdx + DATA_START.length, endIdx);
  const fn = new Function(dataSection + "\nreturn {reps, calls, coaching, weeklyHistory, currentWeekLabel};");
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
  const newHtml = html.slice(0, startIdx + DATA_START.length) + newData + html.slice(endIdx);
  fs.writeFileSync("index.html", newHtml);
}

// ─── Extract Gong Call ID from URL ─────────────────────────────────────────

function callIdFromUrl(url) {
  if (!url) return null;
  const match = url.match(/id=(\d+)/);
  return match ? match[1] : null;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const targetRep = process.argv[2] || null;
  console.log(`🔄 Rescore — ${targetRep ? `rep: ${targetRep}` : "all reps"}`);

  const { html, data, startIdx, endIdx } = readDashboard();
  const client = new Anthropic();

  // Collect ALL calls across all weeks (for deal history lookups)
  const allCallsFlat = [];
  if (data.weeklyHistory) {
    for (const week of data.weeklyHistory) {
      (week.calls || []).forEach(c => allCallsFlat.push(c));
    }
  }
  data.calls.forEach(c => allCallsFlat.push(c));

  // Process each week's calls
  let totalRescored = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  // Rescore history weeks
  for (let wi = 0; wi < (data.weeklyHistory || []).length; wi++) {
    const week = data.weeklyHistory[wi];
    if (!week.calls || week.calls.length === 0) continue;

    console.log(`\n📅 Week: ${week.weekLabel} (${week.calls.length} calls)`);

    for (let ci = 0; ci < week.calls.length; ci++) {
      const call = week.calls[ci];
      if (targetRep && call.rep !== targetRep) {
        totalSkipped++;
        continue;
      }

      const callId = callIdFromUrl(call.url);
      if (!callId) {
        console.log(`   ⚠️ No call ID: ${call.title}`);
        totalSkipped++;
        continue;
      }

      console.log(`   📝 [${ci+1}/${week.calls.length}] ${call.title}`);

      // Fetch transcript and parties
      const [transcript, partyMap] = await Promise.all([
        getTranscript(callId),
        getCallParties(callId),
      ]);
      if (!transcript) {
        console.log(`      ⚠️ No transcript, keeping existing score`);
        totalSkipped++;
        continue;
      }

      const processed = processTranscript(transcript, partyMap);
      if (!processed) {
        console.log(`      ⚠️ Processing failed, keeping existing score`);
        totalSkipped++;
        continue;
      }

      // Resolve account from title + attendee emails
      const { acct, dom } = resolveAccount(call.title, partyMap);
      call.acct = acct;
      call.dom = dom;
      if (dom) console.log(`      🏢 Account: ${acct || "?"} (domain: ${dom})`);

      // Build deal history from ALL prior calls (not just this week)
      const dealHistory = buildDealHistory(call, call.rep, allCallsFlat);
      if (dealHistory) {
        console.log(`      📋 Deal #${dealHistory.callNumber} with ${dealHistory.account} (${dealHistory.priorCalls.length} prior)`);
      }

      // Estimate duration from dur field (e.g., "30m")
      const durMin = parseInt(call.dur) || 30;
      const score = await scoreCall(client, call.title, durMin * 60, processed, dealHistory);
      if (!score) {
        console.log(`      ⚠️ Scoring failed, keeping existing`);
        totalFailed++;
        continue;
      }

      // Update the call in place
      call.s = {
        r: score.scores.rapport,
        d: score.scores.discovery,
        v: score.scores.value,
        a: score.scores.advancement,
        c: score.scores.control,
        e: score.scores.engagement,
      };
      call.w = score.weighted;
      call.tr = score.talkRatio;
      call.m = score.meddpicc;
      call.mc = buildCumulativeMeddpicc(score.meddpicc, dealHistory);
      call.str = score.strengths || [];
      call.opp = score.opportunities || [];
      call.q = score.keyQuote || "";
      call.coach = score.coaching || "";
      call.prep = score.prep || [];
      call.stage = score.stage || call.stage;
      call.type = score.stage || call.type;
      if (score.profile) call.profile = score.profile;

      totalRescored++;
      console.log(`      ✅ ${score.weighted} (was ${call.w || "?"}) MEDDPICC: ${MK.filter(k => score.meddpicc[k]).join(",") || "none"}`);

      await new Promise(r => setTimeout(r, 1000)); // rate limit
    }

    // Update rep averages for this week
    if (week.reps) {
      for (const rep of week.reps) {
        const repCalls = week.calls.filter(c => c.rep === rep.id);
        if (repCalls.length > 0) {
          rep.avg = parseFloat((repCalls.reduce((a, c) => a + c.w, 0) / repCalls.length).toFixed(2));
          rep.n = repCalls.length;
        }
      }
    }
  }

  // Rescore current week calls
  if (data.calls.length > 0) {
    console.log(`\n📅 Current week (${data.calls.length} calls)`);
    for (let ci = 0; ci < data.calls.length; ci++) {
      const call = data.calls[ci];
      if (targetRep && call.rep !== targetRep) {
        totalSkipped++;
        continue;
      }

      const callId = callIdFromUrl(call.url);
      if (!callId) { totalSkipped++; continue; }

      console.log(`   📝 [${ci+1}/${data.calls.length}] ${call.title}`);

      const [transcript, partyMap] = await Promise.all([
        getTranscript(callId),
        getCallParties(callId),
      ]);
      if (!transcript) { totalSkipped++; continue; }

      const processed = processTranscript(transcript, partyMap);
      if (!processed) { totalSkipped++; continue; }

      // Resolve account from title + attendee emails
      const { acct, dom } = resolveAccount(call.title, partyMap);
      call.acct = acct;
      call.dom = dom;
      if (dom) console.log(`      🏢 Account: ${acct || "?"} (domain: ${dom})`);

      const dealHistory = buildDealHistory(call, call.rep, allCallsFlat);
      if (dealHistory) {
        console.log(`      📋 Deal #${dealHistory.callNumber} with ${dealHistory.account}`);
      }

      const durMin = parseInt(call.dur) || 30;
      const score = await scoreCall(client, call.title, durMin * 60, processed, dealHistory);
      if (!score) { totalFailed++; continue; }

      call.s = { r: score.scores.rapport, d: score.scores.discovery, v: score.scores.value, a: score.scores.advancement, c: score.scores.control, e: score.scores.engagement };
      call.w = score.weighted;
      call.tr = score.talkRatio;
      call.m = score.meddpicc;
      call.mc = buildCumulativeMeddpicc(score.meddpicc, dealHistory);
      call.str = score.strengths || [];
      call.opp = score.opportunities || [];
      call.q = score.keyQuote || "";
      call.coach = score.coaching || "";
      call.prep = score.prep || [];
      call.stage = score.stage || call.stage;
      call.type = score.stage || call.type;

      totalRescored++;
      console.log(`      ✅ ${score.weighted} MEDDPICC: ${MK.filter(k => score.meddpicc[k]).join(",") || "none"}`);
      await new Promise(r => setTimeout(r, 1000));
    }

    // Update current week rep averages
    for (const rep of data.reps) {
      const repCalls = data.calls.filter(c => c.rep === rep.id);
      if (repCalls.length > 0) {
        rep.avg = parseFloat((repCalls.reduce((a, c) => a + c.w, 0) / repCalls.length).toFixed(2));
        rep.n = repCalls.length;
      }
    }
  }

  console.log(`\n📊 Summary: ${totalRescored} rescored, ${totalSkipped} skipped, ${totalFailed} failed`);

  // Write updated dashboard
  writeDashboard(html, startIdx, endIdx, data);
  console.log("✅ index.html updated");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });

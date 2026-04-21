#!/usr/bin/env node
/**
 * AE Scorecard — Daily Scoring Pipeline (v10)
 *
 * Runs Mon-Fri at 5am ET via GitHub Actions.
 * 1. Reads existing index.html and extracts cached calls
 * 2. Pulls current week's Gong calls for 4 reps
 * 3. Skips already-scored calls (cache by Gong URL)
 * 4. Scores new calls via Claude API
 * 5. Generates weekly coaching summaries per rep
 * 6. Updates index.html data section (preserves HTML template)
 * 7. Sends Slack summary
 *
 * On failure: sends Slack error notification
 *
 * Required env vars:
 *   GONG_ACCESS_KEY, GONG_ACCESS_KEY_SECRET, ANTHROPIC_API_KEY, SLACK_WEBHOOK_URL
 */

const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const https = require("https");

// ─── Configuration ───────────────────────────────────────────────────────────

const REPS = [
  { id: "sam", name: "Sam Loomis", title: "Enterprise AE", gongId: "4650582472500753433" },
  { id: "kyle", name: "Kyle Swikoski", title: "Dir. Strategic Sales", gongId: "9148979612777403937" },
  { id: "charlie", name: "Charlie Allen", title: "Enterprise AE", gongId: "5653125606847862163" },
  { id: "spencer", name: "Spencer Sobczak", title: "Account Executive", gongId: "1407227189165675721" },
];

const WORKSPACE_ID = "509723422617923879";
const MIN_DURATION = 600;

// Known Ocrolus employees — force INTERNAL even if Gong marks them external
const INTERNAL_NAMES = new Set([
  "vik dua", "vikas dua", "vikdua",
  "andrew rains", "andrew barnes", "matt bronen", "adam hanson",
  "david gipson", "rebecca seward", "stef mcnabb", "stephanie mcnabb",
  "amanda burgos", "puru kalia", "anthony macko",
]);
const DATA_START = "// @@DATA_START@@";
const DATA_END = "// @@DATA_END@@";

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
- IGNORE all pre-call chatter, internal side conversations, and waiting-room banter between colleagues. Only evaluate the rep's interactions with the PROSPECT/CLIENT. Signs of pre-call internal chat: casual personal topics (skiing, travel, hotels) between only 2 speakers before a 3rd speaker joins and says something like "hey" or gets introduced. Once the prospect/client joins (often signaled by introductions, "let me introduce", or a new speaker entering), THAT is when the scoreable call begins. Do NOT credit or penalize rapport, small talk, or any behavior from the pre-call portion.
- Never criticize demo length — long demos are driven by customer engagement
- Do not penalize AE for SE presence on POV/demo calls — score AE on orchestration
- Apply epistemic humility — use "the transcript shows" not "the rep felt"
- Exclude non-prospect calls (kickoffs, existing customers, partner calls)

MULTI-CALL DEAL AWARENESS:
- MEDDPICC and discovery are multi-call frameworks. Reps do NOT need to re-discover pain, metrics, decision process, etc. on every call.
- If DEAL HISTORY is provided below, this is a follow-up call. The rep has already had prior conversations with this account. Adjust your expectations accordingly:
  * On follow-up calls (2nd+), do NOT penalize low discovery scores just because the rep didn't ask foundational questions. Those were likely covered in earlier calls.
  * Instead, score discovery on whether the rep validated, deepened, or progressed prior understanding (e.g., confirming timeline, checking for changes, surfacing new stakeholders).
  * Later-stage calls (Pricing, POV, Sync, Contract, Proposal) should be scored primarily on Value, Advancement, and Control, not on foundational discovery.
  * Only flag discovery gaps if the transcript shows the rep is clearly missing critical info they should have by this stage.

COACHING TONE:
- You are a supportive coach, not a critic. These reps are busy professionals.
- Lead with what went well, then offer 1-3 focused improvement points max.
- Frame feedback as opportunities, not failures. Use "consider" and "try" not "failed to" or "missed."
- Be concise — no one reads long paragraphs of criticism.

The "coaching" field: 2-4 sentences with a coaching tone. Highlight the top 1-3 actionable takeaways from the call. Reference specific moments. Frame as "next time, try X" not "you failed to X."

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

const COACHING_PROMPT = `You are a CRO (Chief Revenue Officer) writing a weekly coaching summary for a sales rep. You have scoring data and coaching notes from their calls this week.

Write coaching that reads as if from a supportive executive coach — direct but encouraging, concise, actionable.

RULES:
- Never open with the rep's name — lead with the insight
- Keep/Start/Stop = exactly ONE item each — highest impact only
- Each item: bold one-sentence headline + 1-2 sentences of evidence from specific calls
- Framework coaching: flowing prose weaving real call examples into teaching, not bullet points
- Apply epistemic humility — only coach on what the transcripts clearly show
- IGNORE all pre-call chatter and internal side conversations — only evaluate prospect interactions
- Never criticize demo length
- Tone: supportive coach, not critic. Frame gaps as opportunities. Use "consider" and "try" not "failed to" or "missed."
- Be concise — busy reps need the top 1-3 points, not exhaustive lists
- Use HTML: <strong> for bold, <br><br> for paragraph breaks

Respond ONLY with valid JSON:
{
  "narrative": "2-4 sentence week overview mentioning specific calls and scores",
  "keep": "<strong>Bold headline.</strong> 2-3 sentences of evidence from specific calls.",
  "start": "<strong>Bold headline.</strong> 2-3 sentences of evidence from specific calls.",
  "stop": "<strong>Bold headline.</strong> 2-3 sentences of evidence from specific calls.",
  "frameworkCoaching": "2-3 paragraphs of flowing prose weaving call examples into framework teaching. Use <br><br> between paragraphs. Use <strong> for emphasis."
}`;

// ─── Gong API ────────────────────────────────────────────────────────────────

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
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`Gong API parse error: ${body.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function getCalls(fromDate, toDate) {
  // Use /calls as a GET request with query params
  const auth = Buffer.from(
    `${process.env.GONG_ACCESS_KEY}:${process.env.GONG_ACCESS_KEY_SECRET}`
  ).toString("base64");

  const params = new URLSearchParams({
    fromDateTime: fromDate,
    toDateTime: toDate,
    workspaceId: WORKSPACE_ID,
  });

  const url = `/v2/calls?${params.toString()}`;
  console.log("   Gong GET:", url);

  const result = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "us-29990.api.gong.io",
        path: url,
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`Gong API parse error: ${body.slice(0, 500)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });

  console.log("   Gong response keys:", Object.keys(result));
  console.log("   Gong totalRecords:", result.records?.totalRecords);
  if (result.errors) console.log("   Gong errors:", JSON.stringify(result.errors));
  if (!result.calls) console.log("   Gong raw response (first 500):", JSON.stringify(result).slice(0, 500));

  // Paginate if needed
  let allCalls = result.calls || [];
  let cursor = result.records?.cursor;
  while (cursor) {
    console.log(`   Fetching next page (${allCalls.length} calls so far)...`);
    const nextParams = new URLSearchParams({
      fromDateTime: fromDate,
      toDateTime: toDate,
      workspaceId: WORKSPACE_ID,
      cursor,
    });
    const nextResult = await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: "us-29990.api.gong.io",
          path: `/v2/calls?${nextParams.toString()}`,
          method: "GET",
          headers: {
            Authorization: `Basic ${auth}`,
          },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(new Error(`Gong API parse error: ${body.slice(0, 500)}`));
            }
          });
        }
      );
      req.on("error", reject);
      req.end();
    });
    allCalls = allCalls.concat(nextResult.calls || []);
    cursor = nextResult.records?.cursor;
  }

  return allCalls;
}

async function getTranscript(callId) {
  const result = await gongRequest("/calls/transcript", {
    filter: { callIds: [callId] },
  });
  return result.callTranscripts?.[0] || null;
}

async function getCallParties(callId) {
  // Fetch detailed call data including party info (names, emails, affiliation)
  const result = await gongRequest("/calls/extensive", {
    filter: { callIds: [callId] },
    contentSelector: { exposedFields: { parties: true } },
  });
  const call = result.calls?.[0];
  if (!call?.parties) return null;
  // Build speakerId → { name, affiliation, email } map
  const partyMap = {};
  for (const p of call.parties) {
    if (p.speakerId) {
      const name = p.name || "Unknown";
      const email = p.emailAddress || "";
      // Determine if internal: Gong affiliation, @ocrolus.com email, or known employee name
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
}

// ─── Transcript Processing ──────────────────────────────────────────────────

function processTranscript(transcript, partyMap) {
  if (!transcript?.transcript) return null;

  const speakers = {};
  let fullText = [];

  for (const segment of transcript.transcript) {
    const id = segment.speakerId;
    if (!speakers[id]) speakers[id] = { words: 0, sentences: [] };

    for (const sent of segment.sentences || []) {
      speakers[id].words += sent.text.split(/\s+/).length;
      speakers[id].sentences.push(sent.text);
      fullText.push({ speaker: id, text: sent.text, start: sent.start });
    }
  }

  // Build speaker labels from Gong party data
  const speakerLabels = {};
  const internalIds = new Set();
  const externalIds = new Set();
  if (partyMap) {
    for (const [spkId, info] of Object.entries(partyMap)) {
      const isInternal = info.affiliation === "internal" ||
        (info.email && info.email.endsWith("@ocrolus.com"));
      speakerLabels[spkId] = `${info.name} (${isInternal ? "INTERNAL" : "EXTERNAL"})`;
      if (isInternal) internalIds.add(spkId);
      else externalIds.add(spkId);
    }
    console.log(`   👥 Speakers: ${Object.values(speakerLabels).join(", ")}`);
  }

  // Filter: only include sentences where at least one external speaker is present on the call
  // Mark internal-only segments so the scorer can see who's talking
  const labeledText = fullText.map((s) => {
    const label = speakerLabels[s.speaker] || `Speaker ${s.speaker}`;
    return { ...s, label };
  });

  const sorted = Object.entries(speakers).sort((a, b) => b[1].words - a[1].words);
  const totalWords = sorted.reduce((a, [, v]) => a + v.words, 0);

  const totalSentences = fullText.length;
  // Include speaker labels in the text excerpts so scorer knows who's internal vs external
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
    .filter((s) => s.text.includes("?"))
    .slice(0, 15)
    .map((s) => {
      const label = speakerLabels[s.speaker] || `Speaker ${s.speaker}`;
      return `[${label}]: ${s.text}`;
    });

  // Build speaker summary for context
  const speakerSummary = Object.entries(speakerLabels).length > 0
    ? Object.entries(speakerLabels).map(([id, label]) => {
        const w = speakers[id]?.words || 0;
        return `${label}: ${w} words (${Math.round((w / totalWords) * 100)}%)`;
      }).join("; ")
    : null;

  return {
    speakerCount: sorted.length,
    topSpeakerRatio: Math.round((sorted[0]?.[1].words / totalWords) * 100),
    totalWords,
    opening: opening.slice(0, 2000),
    middle: middle.slice(0, 2500),
    closing: closing.slice(0, 2000),
    questions,
    speakerSummary,
  };
}

// ─── Deal History ──────────────────────────────────────────────────────────

function extractAccountName(title) {
  // Common patterns: "Company X Ocrolus", "Ocrolus <> Company", "Ocrolus + Company", "Company + Ocrolus"
  // Remove common Ocrolus-side terms and extract the other party
  const cleaned = title
    .replace(/\s*[\|—–-]\s*(Demo|Pricing|POV|Sync|Review|Kickoff|Contract|Proposal|Discussion|Debrief|Planning|Test|Architecture|Integration|Tutorial|Conditions|Summary|ROI|Evaluation).*/i, "")
    .replace(/\s*(Demo|Pricing|POV|Sync|Review|Contract|Proposal)$/i, "")
    .trim();

  // Try "X <> Y", "X + Y", "X x Y", "X / Y" patterns
  const separators = /\s*(?:<>|\+|[xX](?=\s)|\|)\s*/;
  const parts = cleaned.split(separators).map(s => s.trim()).filter(Boolean);

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (!lower.includes("ocrolus") && lower.length > 2) {
      return part.replace(/^(Demo|for)\s+/i, "").trim();
    }
  }
  return null;
}

function getAccountHistory(callTitle, repId, currentCalls, weeklyHistory) {
  const account = extractAccountName(callTitle);
  if (!account) return null;

  const accountLower = account.toLowerCase();
  const priorCalls = [];

  // Search weekly history (older weeks)
  if (weeklyHistory) {
    for (const week of weeklyHistory) {
      if (!week.calls) continue;
      for (const c of week.calls) {
        if (c.rep === repId && c.title && c.title.toLowerCase().includes(accountLower)) {
          priorCalls.push({
            title: c.title, date: c.date, score: c.w,
            stage: c.stage || c.type,
            meddpicc: c.m || null,
            coaching: c.coach || null,
            strengths: c.str || [],
            opportunities: c.opp || [],
            prep: c.prep || [],
            scores: c.s || null,
          });
        }
      }
    }
  }

  // Search current week's existing calls
  for (const c of currentCalls) {
    if (c.rep === repId && c.title && c.title.toLowerCase().includes(accountLower)) {
      priorCalls.push({
        title: c.title, date: c.date, score: c.w,
        stage: c.stage || c.type,
        meddpicc: c.m || null,
        coaching: c.coach || null,
        strengths: c.str || [],
        opportunities: c.opp || [],
        prep: c.prep || [],
        scores: c.s || null,
      });
    }
  }

  if (priorCalls.length === 0) return null;

  // Sort by date
  priorCalls.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  // Build cumulative MEDDPICC map — which elements were covered and when
  const meddpiccLabels = { M: "Metrics", E: "Econ Buyer", DC: "Decision Criteria", DP: "Decision Process", IP: "Identify Pain", Ch: "Champion", Co: "Competition" };
  const cumulativeMeddpicc = {};
  for (const key of Object.keys(meddpiccLabels)) {
    cumulativeMeddpicc[key] = { covered: false, coveredOn: null };
  }
  for (const c of priorCalls) {
    if (!c.meddpicc) continue;
    for (const [key, val] of Object.entries(c.meddpicc)) {
      if (val && !cumulativeMeddpicc[key].covered) {
        cumulativeMeddpicc[key] = { covered: true, coveredOn: `${c.date} (${c.title})` };
      }
    }
  }

  return {
    account,
    callNumber: priorCalls.length + 1,
    priorCalls,
    cumulativeMeddpicc,
    meddpiccLabels,
  };
}

function buildCumulativeMeddpicc(thisCallMeddpicc, dealHistory) {
  // Merge this call's MEDDPICC with cumulative from prior calls
  const cumulative = { M: 0, E: 0, DC: 0, DP: 0, IP: 0, Ch: 0, Co: 0 };

  // Layer in prior coverage
  if (dealHistory && dealHistory.cumulativeMeddpicc) {
    for (const [key, val] of Object.entries(dealHistory.cumulativeMeddpicc)) {
      if (val.covered) cumulative[key] = 1;
    }
  }

  // Layer in this call's coverage
  if (thisCallMeddpicc) {
    for (const [key, val] of Object.entries(thisCallMeddpicc)) {
      if (val) cumulative[key] = 1;
    }
  }

  return cumulative;
}

// ─── Claude API ─────────────────────────────────────────────────────────────

async function scoreCall(client, callInfo, processedTranscript, dealHistory) {
  const speakerInfo = processedTranscript.speakerSummary
    ? `\n- Speaker Breakdown: ${processedTranscript.speakerSummary}\n\nIMPORTANT: Speakers labeled INTERNAL are Ocrolus employees. Speakers labeled EXTERNAL are prospects/clients. ONLY score the rep's interactions with EXTERNAL speakers. Internal-only conversations (e.g., two INTERNAL speakers chatting before the client joins) should be completely ignored for scoring purposes.`
    : "";

  let dealContext = "";
  if (dealHistory) {
    // Build detailed prior call summaries with full context
    const priorDetails = dealHistory.priorCalls
      .map((c) => {
        let detail = `  CALL: "${c.title}" — ${c.date} — Score: ${c.score} — Stage: ${c.stage || "Unknown"}`;
        if (c.scores) {
          detail += `\n    Dimensions: Rapport=${c.scores.r} Discovery=${c.scores.d} Value=${c.scores.v} Advancement=${c.scores.a} Control=${c.scores.c} Engagement=${c.scores.e}`;
        }
        if (c.meddpicc) {
          const covered = Object.entries(c.meddpicc).filter(([, v]) => v).map(([k]) => k);
          detail += `\n    MEDDPICC covered: ${covered.length > 0 ? covered.join(", ") : "none"}`;
        }
        if (c.strengths && c.strengths.length > 0) {
          detail += `\n    Strengths: ${c.strengths.join("; ")}`;
        }
        if (c.opportunities && c.opportunities.length > 0) {
          detail += `\n    Opportunities: ${c.opportunities.join("; ")}`;
        }
        if (c.coaching) {
          detail += `\n    Coaching: ${c.coaching}`;
        }
        if (c.prep && c.prep.length > 0) {
          detail += `\n    Prep/Next steps: ${c.prep.join("; ")}`;
        }
        return detail;
      })
      .join("\n\n");

    // Build cumulative MEDDPICC status
    const meddpiccStatus = Object.entries(dealHistory.cumulativeMeddpicc)
      .map(([key, val]) => {
        const label = dealHistory.meddpiccLabels[key];
        return val.covered
          ? `  ✅ ${key} (${label}): Covered on ${val.coveredOn}`
          : `  ⬜ ${key} (${label}): Not yet covered`;
      })
      .join("\n");

    dealContext = `\n\nDEAL HISTORY — This is call #${dealHistory.callNumber} with ${dealHistory.account}.\n\nPRIOR CALLS (full context from previous scoring):\n${priorDetails}\n\nCUMULATIVE MEDDPICC STATUS (across all prior calls with this account):\n${meddpiccStatus}\n\nThis is a FOLLOW-UP call. Use the prior call context above to understand what has already been established in this deal. MEDDPICC elements already covered in prior calls should NOT be penalized as missing. For the MEDDPICC coverage output, score ONLY what was newly covered or validated on THIS call. But understand that the deal's overall MEDDPICC health includes all prior coverage shown above. Score discovery on validation and progression of prior understanding, not on re-doing foundational work. Reference prior coaching notes to assess whether the rep acted on previous feedback.\n`;
  }

  const prompt = `${SCORING_PROMPT}${dealContext}

Call Info:
- Title: ${callInfo.title}
- Duration: ${Math.round(callInfo.duration / 60)} minutes
- Type: ${callInfo.direction}
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
    console.error(`Scoring error for ${callInfo.title}:`, e.message);
    return null;
  }
}

async function generateWeeklyCoaching(client, repName, scoredCalls) {
  if (!scoredCalls.length) return null;

  const callScores = scoredCalls
    .map(
      (c) =>
        `- ${c.title} (${c.w}): R${c.s.r} D${c.s.d} V${c.s.v} A${c.s.a} C${c.s.c} E${c.s.e} | Talk:${c.tr}% | MEDDPICC:${Object.entries(c.m).filter(([, v]) => v).map(([k]) => k).join(",") || "none"}`
    )
    .join("\n");

  const callCoaching = scoredCalls.map((c) => `- ${c.title}: ${c.coach}`).join("\n");

  const prompt = `${COACHING_PROMPT}

Rep: ${repName}
Calls this week (${scoredCalls.length}):

SCORES:
${callScores}

PER-CALL COACHING:
${callCoaching}`;

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
    console.error(`Coaching error for ${repName}:`, e.message);
    return null;
  }
}

// ─── Dashboard Data I/O ─────────────────────────────────────────────────────

function readDashboard() {
  const html = fs.readFileSync("index.html", "utf8");
  const startIdx = html.indexOf(DATA_START);
  const endIdx = html.indexOf(DATA_END);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error("Data markers (@@DATA_START@@/@@DATA_END@@) not found in index.html");
  }

  const dataSection = html.slice(startIdx + DATA_START.length, endIdx);

  // Parse the JS data declarations using Function constructor
  const fn = new Function(
    dataSection + "\nreturn {reps, calls, coaching, weeklyHistory, currentWeekLabel};"
  );
  const data = fn();

  return { html, data, startIdx, endIdx };
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

function slackAPI(botToken, method, payload) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: "slack.com",
        path: `/api/${method}`,
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
          try { resolve(JSON.parse(body)); } catch (e) { resolve({ ok: false, error: "parse_error" }); }
        });
      }
    );
    req.on("error", (e) => { console.error(`Slack API error: ${e.message}`); resolve({ ok: false, error: e.message }); });
    req.write(data);
    req.end();
  });
}

async function postSlackDM(botToken, userId, message) {
  // Step 1: Open a DM channel with the user
  const openRes = await slackAPI(botToken, "conversations.open", { users: userId });
  if (!openRes.ok) {
    console.error(`   ❌ Slack conversations.open failed for ${userId}: ${openRes.error}`);
    return;
  }
  const dmChannelId = openRes.channel.id;
  // Step 2: Post the message to the DM channel
  const postRes = await slackAPI(botToken, "chat.postMessage", { channel: dmChannelId, text: message });
  if (!postRes.ok) {
    console.error(`   ❌ Slack chat.postMessage failed for ${userId}: ${postRes.error}`);
  } else {
    console.log(`   ✅ Slack DM sent to ${userId}`);
  }
}

async function sendSlack(message) {
  const promises = [];

  // Webhook for Vik
  if (process.env.SLACK_WEBHOOK_URL) {
    promises.push(postToWebhook(process.env.SLACK_WEBHOOK_URL, message));
  }

  // Bot token DM for Vik only (Andrew & John get weekly lock only)
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (botToken) {
    promises.push(postSlackDM(botToken, "U7K3SBGFR", message));   // Vik Dua
  }

  if (promises.length === 0) {
    console.log("⚠️ No Slack credentials set, skipping Slack");
    return;
  }

  console.log(`   📨 Sending Slack to ${promises.length} recipient(s)...`);
  await Promise.all(promises);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toET(date) {
  // Format as ISO 8601 with ET offset (Gong requires timezone offset, not Z)
  const est = new Date(date.getTime() - 5 * 60 * 60 * 1000); // UTC-5 (EST)
  const iso = est.toISOString().replace("Z", "-05:00");
  return iso;
}

function getWeekRange() {
  const now = new Date();
  const day = now.getUTCDay();
  const monday = new Date(now);
  // Go back to Monday
  monday.setUTCDate(monday.getUTCDate() - (day === 0 ? 6 : day - 1));
  monday.setUTCHours(5, 0, 0, 0); // 5am UTC = midnight ET

  return {
    from: toET(monday),
    to: toET(now),
  };
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}

function getProspectNames(call) {
  if (!call.parties) return "Multiple stakeholders";
  const external = call.parties
    .filter((p) => p.affiliation === "External" && p.name)
    .map((p) => p.name);
  return external.length > 0 ? external.join(", ") : "Multiple stakeholders";
}

// ─── Main Pipeline ──────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 AE Scorecard — Daily Run");

  // 1. Read existing dashboard
  console.log("📖 Reading existing dashboard...");
  const { html, data, startIdx, endIdx } = readDashboard();
  const existingCalls = data.calls;
  const cachedUrls = new Set(existingCalls.map((c) => c.url));
  console.log(`   ${existingCalls.length} existing calls cached`);

  // 2. Get date range (Monday of current week to now)
  const { from, to } = getWeekRange();
  console.log(`📅 Date range: ${from} to ${to}`);

  // 3. Fetch calls from Gong
  console.log("📞 Fetching calls from Gong...");
  const allGongCalls = await getCalls(from, to);
  console.log(`   Found ${allGongCalls.length} total calls`);

  // 4. Score new calls per rep
  const client = new Anthropic();
  let newCallCount = 0;
  let nextId =
    existingCalls.length > 0 ? Math.max(...existingCalls.map((c) => c.id)) + 1 : 1;
  const allCalls = [...existingCalls];
  const repProfiles = {};

  for (const rep of REPS) {
    const repGongCalls = allGongCalls.filter(
      (c) =>
        c.primaryUserId === rep.gongId &&
        c.scope === "External" &&
        c.direction === "Conference" &&
        c.duration >= MIN_DURATION
    );

    // Filter out non-sales calls (implementation, kickoff, onboarding, training, support)
    const NON_SALES_PATTERNS = /\b(implementation|kickoff|kick-off|kick off|onboarding|on-boarding|training|go.?live|integration call|support call|check.?in call|check.?in|status update|partnership|partner call|lunch)\b/i;
    const salesCalls = repGongCalls.filter((c) => {
      if (NON_SALES_PATTERNS.test(c.title)) {
        console.log(`   ⏭️  Non-sales call, skipping: ${c.title}`);
        return false;
      }
      return true;
    });

    console.log(`\n👤 ${rep.name}: ${salesCalls.length} qualifying sales calls (${repGongCalls.length - salesCalls.length} non-sales skipped)`);

    for (const call of salesCalls) {
      if (cachedUrls.has(call.url)) {
        console.log(`   ⏭️  Cached: ${call.title}`);
        continue;
      }

      console.log(`   📝 Scoring: ${call.title} (${Math.round(call.duration / 60)}m)`);

      const [transcript, partyMap] = await Promise.all([
        getTranscript(call.id),
        getCallParties(call.id),
      ]);
      if (!transcript) {
        console.log(`      ⚠️ No transcript, skipping`);
        continue;
      }

      const processed = processTranscript(transcript, partyMap);
      if (!processed) {
        console.log(`      ⚠️ Processing failed, skipping`);
        continue;
      }

      const dealHistory = getAccountHistory(call.title, rep.id, allCalls, data.weeklyHistory);
      if (dealHistory) {
        console.log(`      📋 Deal history: call #${dealHistory.callNumber} with ${dealHistory.account} (${dealHistory.priorCalls.length} prior)`);
      }

      const score = await scoreCall(client, call, processed, dealHistory);
      if (!score) {
        console.log(`      ⚠️ Scoring failed, skipping`);
        continue;
      }

      if (score.profile) repProfiles[rep.id] = score.profile;

      allCalls.push({
        id: nextId++,
        rep: rep.id,
        title: call.title,
        prospect: getProspectNames(call),
        date: formatDate(call.started),
        dur: `${Math.round(call.duration / 60)}m`,
        type: score.stage || "Call",
        stage: score.stage || "Unknown",
        s: {
          r: score.scores.rapport,
          d: score.scores.discovery,
          v: score.scores.value,
          a: score.scores.advancement,
          c: score.scores.control,
          e: score.scores.engagement,
        },
        w: score.weighted,
        tr: score.talkRatio,
        m: score.meddpicc,
        mc: buildCumulativeMeddpicc(score.meddpicc, dealHistory),
        str: score.strengths || [],
        opp: score.opportunities || [],
        q: score.keyQuote || "",
        coach: score.coaching || "",
        prep: score.prep || [],
        url: call.url,
      });

      newCallCount++;
      console.log(`      ✅ Score: ${score.weighted}`);
      await new Promise((r) => setTimeout(r, 1000)); // rate limit
    }
  }

  if (newCallCount === 0) {
    console.log("\n📭 No new calls to score. Dashboard unchanged.");
    await sendSlack(
      `📊 *Daily Scorecard Run* — No new calls found today.\n_${existingCalls.length} calls cached for this week._`
    );
    return;
  }

  console.log(`\n🆕 ${newCallCount} new calls scored`);

  // 5. Update rep averages and profiles
  const updatedReps = REPS.map((rep) => {
    const repCalls = allCalls.filter((c) => c.rep === rep.id);
    const existingRep = data.reps.find((r) => r.id === rep.id);
    const avg =
      repCalls.length > 0
        ? parseFloat((repCalls.reduce((a, c) => a + c.w, 0) / repCalls.length).toFixed(2))
        : 0;
    return {
      id: rep.id,
      name: rep.name,
      title: rep.title,
      profile: repProfiles[rep.id] || existingRep?.profile || "Unknown",
      avg,
      n: repCalls.length,
    };
  });

  // 6. Generate weekly coaching per rep (only for reps with calls)
  console.log("\n🎓 Generating weekly coaching...");
  const updatedCoaching = {};
  for (const rep of REPS) {
    const repCalls = allCalls.filter((c) => c.rep === rep.id);
    if (repCalls.length === 0) {
      updatedCoaching[rep.id] = {
        narrative: "",
        keep: "",
        start: "",
        stop: "",
        frameworkCoaching: "",
      };
      continue;
    }

    console.log(`   🎓 ${rep.name} (${repCalls.length} calls)...`);
    const weeklyCoaching = await generateWeeklyCoaching(client, rep.name, repCalls);
    if (weeklyCoaching) {
      updatedCoaching[rep.id] = weeklyCoaching;
    } else {
      // Fallback: use existing coaching or empty
      const existing = data.coaching[rep.id];
      updatedCoaching[rep.id] = existing || {
        narrative: "",
        keep: "",
        start: "",
        stop: "",
        frameworkCoaching: "",
      };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  // 7. Write updated dashboard
  console.log("\n📊 Updating dashboard...");
  writeDashboard(html, startIdx, endIdx, {
    reps: updatedReps,
    calls: allCalls,
    coaching: updatedCoaching,
    weeklyHistory: data.weeklyHistory,
    currentWeekLabel: data.currentWeekLabel,
  });
  console.log("   ✅ index.html updated");

  // 8. Send Slack summary
  const sorted = [...updatedReps].sort((a, b) => b.avg - a.avg);
  const medals = ["🥇", "🥈", "🥉", "4️⃣"];
  let msg = `📊 *Daily Scorecard Update* — ${newCallCount} new call${newCallCount > 1 ? "s" : ""} scored\n`;
  msg += `_${allCalls.length} total calls this week_\n\n`;
  sorted.forEach((r, i) => {
    msg += `${medals[i] || ""} *${r.name}*: ${r.avg} avg (${r.n} calls)\n`;
  });
  msg += `\n🔗 <https://vdua-ocrolus.github.io/AE-scorecard/|Open Dashboard>`;

  await sendSlack(msg);
  console.log("\n🎉 Daily scorecard run complete!");
}

main().catch(async (e) => {
  console.error("❌ Fatal error:", e);
  try {
    await sendSlack(
      `🚨 *AE Scorecard FAILED*\n\`\`\`${e.message}\`\`\`\nCheck GitHub Actions logs for details.`
    );
  } catch (slackErr) {
    console.error("Failed to send Slack error notification:", slackErr.message);
  }
  process.exit(1);
});

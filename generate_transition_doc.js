const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak, ExternalHyperlink, LevelFormat
} = require("docx");

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

function headerCell(text, width) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: "1F3864", type: ShadingType.CLEAR },
    margins: cellMargins,
    verticalAlign: "center",
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: "FFFFFF", font: "Arial", size: 20 })] })]
  });
}

function cell(text, width, opts = {}) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: opts.shade ? { fill: opts.shade, type: ShadingType.CLEAR } : undefined,
    margins: cellMargins,
    children: [new Paragraph({ children: [new TextRun({ text, font: "Arial", size: 20, bold: opts.bold })] })]
  });
}

function heading(text, level) {
  return new Paragraph({ heading: level, children: [new TextRun({ text, font: "Arial", bold: true })] });
}

function para(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, font: "Arial", size: 20, bold: opts.bold, italics: opts.italic })]
  });
}

function bullet(text, ref) {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, font: "Arial", size: 20 })]
  });
}

function richBullet(runs, ref) {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 60 },
    children: runs.map(r => new TextRun({ font: "Arial", size: 20, ...r }))
  });
}

function linkPara(label, url) {
  return new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({ text: label + ": ", font: "Arial", size: 20, bold: true }),
      new ExternalHyperlink({
        children: [new TextRun({ text: url, style: "Hyperlink", font: "Arial", size: 20 })],
        link: url,
      })
    ]
  });
}

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 20 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "Arial", color: "1F3864" },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Arial", color: "2E75B6" },
        paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 22, bold: true, font: "Arial", color: "1F3864" },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 } },
    ]
  },
  numbering: {
    config: [
      { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "bullets2", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "bullets3", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "bullets4", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "bullets5", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "numbered", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "numbered2", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ]
  },
  sections: [
    // --- PAGE 1: TITLE ---
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
        }
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [new TextRun({ text: "CONFIDENTIAL", font: "Arial", size: 16, color: "999999", italics: true })],
            alignment: AlignmentType.RIGHT
          })]
        })
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              new TextRun({ text: "AE Scorecard Transition Document  |  Page ", font: "Arial", size: 16, color: "999999" }),
              new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 16, color: "999999" })
            ],
            alignment: AlignmentType.CENTER
          })]
        })
      },
      children: [
        new Paragraph({ spacing: { before: 3600 } }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({ text: "AE Scorecard", font: "Arial", size: 52, bold: true, color: "1F3864" })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
          children: [new TextRun({ text: "Operations Transition Document", font: "Arial", size: 36, color: "2E75B6" })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [new TextRun({ text: "Prepared by: Vikas Dua", font: "Arial", size: 22, color: "666666" })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [new TextRun({ text: "For: Matt Bronen (Rev Ops) & Andrew Barnes", font: "Arial", size: 22, color: "666666" })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [new TextRun({ text: "Date: March 19, 2026", font: "Arial", size: 22, color: "666666" })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [new TextRun({ text: "Version: v9", font: "Arial", size: 22, color: "666666" })]
        }),
      ]
    },

    // --- PAGE 2+: CONTENT ---
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
        }
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [new TextRun({ text: "CONFIDENTIAL", font: "Arial", size: 16, color: "999999", italics: true })],
            alignment: AlignmentType.RIGHT
          })]
        })
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              new TextRun({ text: "AE Scorecard Transition Document  |  Page ", font: "Arial", size: 16, color: "999999" }),
              new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 16, color: "999999" })
            ],
            alignment: AlignmentType.CENTER
          })]
        })
      },
      children: [
        // === SECTION 1: OVERVIEW ===
        heading("1. What This Is", HeadingLevel.HEADING_1),
        para("The AE Scorecard is a weekly HTML dashboard that scores Gong sales calls for four Ocrolus AE reps. It uses AI-powered transcript analysis against four enterprise sales frameworks (MEDDPICC, Gap Selling, Challenger Sale, and Never Split the Difference) to generate per-call scores, coaching notes, and cross-rep comparisons."),
        para("The scorecard is hosted on GitHub Pages and updated weekly via an automated scheduled task. After each run, a Slack summary is sent to the designated recipient."),

        // === KEY LINKS ===
        heading("2. Key Links & Access", HeadingLevel.HEADING_1),
        linkPara("Live Dashboard", "https://vdua-ocrolus.github.io/AE-scorecard/"),
        linkPara("GitHub Repo", "https://github.com/vdua-ocrolus/AE-Scorecard"),
        linkPara("Access Log (Google Sheet)", "https://docs.google.com/spreadsheets/d/1npiJimPNf7iwfB7bYtbuQImvRo8TBToGADwfm0TmWFU/edit"),
        para(""),
        para("Dashboard Access: Users must enter an @ocrolus.com email to view the dashboard. Access events (logins, return visits) are logged to the Google Sheet above via a Google Apps Script webhook.", { italic: true }),

        // === REPS ===
        heading("3. The Reps", HeadingLevel.HEADING_1),
        para("Four reps are currently tracked. Their Gong User IDs are required for API calls:"),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [2800, 3760, 2800],
          rows: [
            new TableRow({ children: [headerCell("Rep", 2800), headerCell("Title", 3760), headerCell("Gong User ID", 2800)] }),
            new TableRow({ children: [cell("Sam Loomis", 2800), cell("Enterprise AE", 3760), cell("4650582472500753433", 2800)] }),
            new TableRow({ children: [cell("Kyle Swikoski", 2800), cell("Dir, Strategic Sales & Partnerships", 3760), cell("9148979612777403937", 2800)] }),
            new TableRow({ children: [cell("Charlie Allen", 2800), cell("Enterprise AE", 3760), cell("5653125606847862163", 2800)] }),
            new TableRow({ children: [cell("Spencer Sobczak", 2800), cell("AE", 3760), cell("1407227189165675721", 2800)] }),
          ]
        }),

        // === SCORING ===
        heading("4. Scoring Framework (v9)", HeadingLevel.HEADING_1),

        heading("4.1 Four Frameworks", HeadingLevel.HEADING_2),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [3120, 1560, 4680],
          rows: [
            new TableRow({ children: [headerCell("Framework", 3120), headerCell("Weight", 1560), headerCell("Primary Influence", 4680)] }),
            new TableRow({ children: [cell("MEDDPICC", 3120), cell("30%", 1560), cell("Discovery depth, qualification rigor, deal mechanics", 4680)] }),
            new TableRow({ children: [cell("Gap Selling", 3120), cell("30%", 1560), cell("Problem diagnosis, current/future state, business impact", 4680)] }),
            new TableRow({ children: [cell("Challenger Sale", 3120), cell("25%", 1560), cell("Value delivery, commercial teaching, process control", 4680)] }),
            new TableRow({ children: [cell("Never Split the Difference", 3120), cell("15%", 1560), cell("Tactical empathy, rapport, engagement, negotiation", 4680)] }),
          ]
        }),

        heading("4.2 Six Scoring Dimensions (1-10 scale)", HeadingLevel.HEADING_2),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [2800, 1040, 5520],
          rows: [
            new TableRow({ children: [headerCell("Dimension", 2800), headerCell("Weight", 1040), headerCell("What It Measures", 5520)] }),
            new TableRow({ children: [cell("Rapport & Connection", 2800), cell("10%", 1040), cell("Opening quality, tactical empathy, mirroring, labeling", 5520)] }),
            new TableRow({ children: [cell("Discovery & Qualification", 2800), cell("30%", 1040), cell("MEDDPICC coverage, Gap Selling diagnosis, calibrated questions", 5520)] }),
            new TableRow({ children: [cell("Value Articulation", 2800), cell("15%", 1040), cell("Challenger teach/tailor, ROI framing, proof points", 5520)] }),
            new TableRow({ children: [cell("Deal Advancement", 2800), cell("20%", 1040), cell("Next steps, mutual action plan, take control behaviors", 5520)] }),
            new TableRow({ children: [cell("Call Control & Structure", 2800), cell("10%", 1040), cell("Agenda, transitions, talk ratio, redirection", 5520)] }),
            new TableRow({ children: [cell("Prospect Engagement", 2800), cell("15%", 1040), cell("Buying signals, 'that's right' moments, voluntary elaboration", 5520)] }),
          ]
        }),

        heading("4.3 Weighted Score Formula", HeadingLevel.HEADING_2),
        new Paragraph({
          spacing: { after: 120 },
          shading: { fill: "F2F2F2", type: ShadingType.CLEAR },
          children: [new TextRun({ text: "Score = (Rapport x 0.10) + (Discovery x 0.30) + (Value x 0.15) + (Advancement x 0.20) + (Control x 0.10) + (Engagement x 0.15)", font: "Courier New", size: 18 })]
        }),

        // === CRITICAL RULES ===
        heading("5. Critical Coaching Rules", HeadingLevel.HEADING_1),
        para("These rules were established through multiple iterations and are non-negotiable for maintaining credibility with the sales team:"),

        heading("5.1 Prospect-Only Scope", HeadingLevel.HEADING_2),
        para("Only score prospect calls. Exclude kickoffs, existing customer calls, partner calls, and expansion/upsell calls. This is a sales performance tool, not a general call review."),

        heading("5.2 Epistemic Humility", HeadingLevel.HEADING_2),
        para("The AI only has transcripts. No tone, body language, deal history, or relationship context. If feedback requires interpreting humor, sarcasm, or intent, exclude it. The 5% that misses makes reps discount the 95% that lands."),

        heading("5.3 Never Criticize Demo Length", HeadingLevel.HEADING_2),
        para("Long demos are driven by customer engagement, not poor structure. A prospect on a 45-minute demo is buying. If talk ratio is a concern, address talk ratio directly, not duration."),

        heading("5.4 SE/POV Call Handling", HeadingLevel.HEADING_2),
        para("Do not penalize the AE for SE presence on POV/demo calls. The SE is doing their job. Score the AE on orchestration, business context, qualification, and deal advancement."),

        heading("5.5 MEDDPICC Multi-Call Philosophy", HeadingLevel.HEADING_2),
        para("MEDDPICC is a multi-call framework, not a single-call checklist. Reps should cover 2-4 elements per call based on stage. Never praise covering all 7 on one call. Score depth over breadth."),

        heading("5.6 Coaching Voice", HeadingLevel.HEADING_2),
        bullet("Never open coaching with the rep's name. Lead with the insight.", "bullets"),
        bullet("Keep / Start / Stop = exactly ONE item each. Highest impact only.", "bullets"),
        bullet("Each item: bold one-sentence headline + 2-3 sentences of evidence from specific calls.", "bullets"),
        bullet("Framework coaching written as oratory with real call examples woven in.", "bullets"),
        bullet("CRO-level executive gravitas throughout. No filler.", "bullets"),

        // === AUTOMATION ===
        new Paragraph({ children: [new PageBreak()] }),
        heading("6. Weekly Automation", HeadingLevel.HEADING_1),
        para("A scheduled task runs every Sunday at 5:00 AM ET. It performs the following:"),

        new Paragraph({
          numbering: { reference: "numbered", level: 0 },
          spacing: { after: 60 },
          children: [new TextRun({ text: "Pull the last 7 days of calls from Gong API (workspace ID: 509723422617923879)", font: "Arial", size: 20 })]
        }),
        new Paragraph({
          numbering: { reference: "numbered", level: 0 },
          spacing: { after: 60 },
          children: [new TextRun({ text: "Filter by the 4 rep user IDs, external scope, conference direction, >10 min duration", font: "Arial", size: 20 })]
        }),
        new Paragraph({
          numbering: { reference: "numbered", level: 0 },
          spacing: { after: 60 },
          children: [new TextRun({ text: "Pull transcripts one at a time (bulk fetches exceed size limits)", font: "Arial", size: 20 })]
        }),
        new Paragraph({
          numbering: { reference: "numbered", level: 0 },
          spacing: { after: 60 },
          children: [new TextRun({ text: "Process each transcript through scripts/process_transcript.py", font: "Arial", size: 20 })]
        }),
        new Paragraph({
          numbering: { reference: "numbered", level: 0 },
          spacing: { after: 60 },
          children: [new TextRun({ text: "Score each call against the 6 dimensions using the v9 framework", font: "Arial", size: 20 })]
        }),
        new Paragraph({
          numbering: { reference: "numbered", level: 0 },
          spacing: { after: 60 },
          children: [new TextRun({ text: "Update index.html with new call data, coaching, and MEDDPICC heatmaps", font: "Arial", size: 20 })]
        }),
        new Paragraph({
          numbering: { reference: "numbered", level: 0 },
          spacing: { after: 60 },
          children: [new TextRun({ text: "Git commit and push to GitHub (auto-deploys to GitHub Pages)", font: "Arial", size: 20 })]
        }),
        new Paragraph({
          numbering: { reference: "numbered", level: 0 },
          spacing: { after: 120 },
          children: [new TextRun({ text: "Send Slack DM summary with scores and dashboard link", font: "Arial", size: 20 })]
        }),

        heading("6.1 Gong API Details", HeadingLevel.HEADING_2),
        bullet("getCalls requires workspace ID and date range in ISO 8601 with timezone offset (e.g., 2026-03-09T00:00:00-05:00)", "bullets2"),
        bullet("getCallTranscripts must be fetched ONE call at a time (bulk fetches exceed size limits)", "bullets2"),
        bullet("Filter defaults: scope = 'External', direction = 'Conference', duration > 600 seconds", "bullets2"),

        heading("6.2 Slack Distribution", HeadingLevel.HEADING_2),
        para("The weekly Slack summary is currently sent to:"),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [3120, 3120, 3120],
          rows: [
            new TableRow({ children: [headerCell("Name", 3120), headerCell("Slack User ID", 3120), headerCell("Email", 3120)] }),
            new TableRow({ children: [cell("Vikas Dua", 3120), cell("U7K3SBGFR", 3120), cell("vdua@ocrolus.com", 3120)] }),
          ]
        }),
        para(""),
        para("Additional Slack IDs for distribution if needed:", { bold: true }),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [3120, 3120, 3120],
          rows: [
            new TableRow({ children: [headerCell("Name", 3120), headerCell("Slack User ID", 3120), headerCell("Role", 3120)] }),
            new TableRow({ children: [cell("Matt Bronen", 3120), cell("U042XCUG8BE", 3120), cell("Revenue Operations Manager", 3120)] }),
            new TableRow({ children: [cell("Andrew Barnes", 3120), cell("U0239947F6J", 3120), cell("", 3120)] }),
            new TableRow({ children: [cell("Adam Hanson", 3120), cell("U0239947F6J", 3120), cell("", 3120)] }),
            new TableRow({ children: [cell("Andrew Rains (CRO)", 3120), cell("U045N7073UM", 3120), cell("", 3120)] }),
          ]
        }),

        // === ACCESS LOGGING ===
        heading("7. Access Logging", HeadingLevel.HEADING_1),
        para("The dashboard requires an @ocrolus.com email to view. Each login and return visit is logged to a Google Sheet via a Google Apps Script webhook."),
        linkPara("Access Log Sheet", "https://docs.google.com/spreadsheets/d/1npiJimPNf7iwfB7bYtbuQImvRo8TBToGADwfm0TmWFU/edit"),
        para(""),
        para("The Apps Script is bound to the spreadsheet (Extensions > Apps Script). It receives GET requests with email, action, and user agent parameters. The script code is also saved in the repo as access-log-script.gs."),

        // === FILE STRUCTURE ===
        heading("8. Repository Structure", HeadingLevel.HEADING_1),
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: [
            "AE-Scorecard/",
            "  CLAUDE.md              - Project context for Claude Code",
            "  index.html             - The HTML dashboard (main deliverable)",
            "  access-log-script.gs   - Google Apps Script for access logging",
            "  CHANGELOG.md           - Version history (v7 > v8 > v9)",
            "  AE-Scorer_v9.skill     - Current skill file (ZIP archive)",
            "  .gitignore             - Excludes Old/, node_modules/, .DS_Store",
            "  scripts/",
            "    process_transcript.py    - Mandatory transcript processor",
            "    generate_docx_template.js - DOCX report generator",
            "  references/",
            "    docx_format.md           - DOCX formatting specification",
          ].join("\n"), font: "Courier New", size: 16 })]
        }),

        // === WHAT TO DO ===
        heading("9. Your Responsibilities", HeadingLevel.HEADING_1),

        heading("9.1 Weekly Check (Mondays)", HeadingLevel.HEADING_2),
        bullet("Verify the Sunday automation ran: check the dashboard for updated date range in the header", "bullets3"),
        bullet("Spot-check 2-3 call scores for reasonableness", "bullets3"),
        bullet("Confirm the Slack summary was delivered", "bullets3"),

        heading("9.2 If the Automation Fails", HeadingLevel.HEADING_2),
        para("The scheduled task runs on Anthropic cloud infrastructure. If it fails:"),
        bullet("Check if Gong API is returning calls for the date range (API outages happen)", "bullets4"),
        bullet("The task can be manually triggered from Claude Code by running the scheduled task", "bullets4"),
        bullet("If the task repeatedly fails, check the task prompt in the scheduled tasks list", "bullets4"),

        heading("9.3 Adding or Removing Reps", HeadingLevel.HEADING_2),
        para("To change the tracked reps, update the Gong User IDs in CLAUDE.md and in the scheduled task prompt. Rep User IDs can be found via the Gong Users API."),

        heading("9.4 Changing Slack Recipients", HeadingLevel.HEADING_2),
        para("Update the Slack User ID in the scheduled task prompt. User IDs are listed in Section 6.2 above."),

        // === CONTACTS ===
        heading("10. Contacts", HeadingLevel.HEADING_1),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [2340, 3510, 3510],
          rows: [
            new TableRow({ children: [headerCell("Person", 2340), headerCell("Role", 3510), headerCell("Contact", 3510)] }),
            new TableRow({ children: [cell("Vikas Dua", 2340), cell("Created the scorecard, available for questions", 3510), cell("vdua@ocrolus.com", 3510)] }),
            new TableRow({ children: [cell("Andrew Rains", 2340), cell("CRO, primary stakeholder for scoring output", 3510), cell("Slack: U045N7073UM", 3510)] }),
            new TableRow({ children: [cell("John Lowenthal", 2340), cell("VP Sales, receives DOCX reports when requested", 3510), cell("", 3510)] }),
          ]
        }),
      ]
    }
  ]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("/Users/vikdua/Documents/Claude/Rep scorer/AE-Scorecard-Transition-Doc.docx", buffer);
  console.log("Transition document created: AE-Scorecard-Transition-Doc.docx");
});

# AE Scorer — Version Changelog

## v10.1 (2026-04-01)
**File**: `AE-Scorer_v10.1.skill`

### New: Cloud Automation via GitHub Actions
- Daily scoring runs Mon–Fri at 5am ET — fully automated, no manual trigger needed
- Sunday lock job archives the week and clears the dashboard automatically
- Slack notifications sent after each run with scoring summary
- `score.js` and `lock.js` handle the full pipeline: Gong → transcript → score → coaching → dashboard update → git push

### New: Google SSO Auth Gate
- Dashboard secured behind Google OAuth — only @ocrolus.com accounts can access
- Session cached in localStorage until token expires
- User bar shows avatar, name, and Sign Out button
- Access logging to Google Sheet (login, return visit, sign out)

### Improved: Speaker-Aware Scoring (Internal vs External)
- Fetches Gong party data for each call to identify speakers as INTERNAL (Ocrolus) or EXTERNAL (prospect/client)
- Every transcript excerpt sent to the scorer is labeled with speaker name and affiliation
- Scorer explicitly instructed to only evaluate rep↔EXTERNAL interactions
- Internal-only conversations (pre-call banter, sidebar discussions) are ignored for scoring
- Replaces blunt heuristics with proper speaker identification from Gong metadata

### Improved: Coaching Tone & Conciseness
- Shifted from critical evaluator to supportive coach tone
- Feedback limited to top 1-3 actionable points per call
- Framed as opportunities ("consider", "try") not failures ("failed to", "missed")
- Weekly coaching summaries also updated with same tone guidelines

### Fixed: History Drill-In Shows All Calls
- Archived weeks now show all calls grouped by rep, not just the selected rep's calls

---

## v10 (2026-03-30)
**File**: `AE-Scorer_v10.skill`

### New: Weekly History with Drill-In
- Dashboard stores full weekly snapshots in `weeklyHistory` array
- Each archived week contains complete `reps`, `calls`, and `coaching` data
- History tab shows week list with per-rep scores, clickable drill-in to any past week
- Drill-in renders full dashboard (overview, meddpicc, compare, call detail) for archived weeks
- `activeData()` helper routes all views to current or archived data seamlessly
- Weeks with `summaryOnly: true` show a banner indicating full call detail unavailable

### New: Call Caching
- Mon-Fri daily runs skip previously scored call IDs — only fetch transcripts and score new calls
- Dramatically reduces daily run time (from ~60min to minutes on most days)
- Cache key is the call ID in the `calls` array

### New: Sunday Lock
- Sunday 5am ET job archives current week to `weeklyHistory`, clears live dashboard
- Archived weeks are immutable — never modified after lock
- Dashboard shows empty "No calls scored yet" state until Monday's run

### New: Score Trends
- History tab includes week-over-week trends table with Team average column
- Visual trend bar charts per rep across all archived weeks + current
- Coaching history section per rep showing Keep/Start/Stop across all weeks

### New: Empty Week State
- Monday mornings show "No calls scored yet this week" placeholder
- Links to history tab for previous week's data
- Header updates dynamically for current/archived context

### Enhanced: Mobile Responsive
- History tab week cards, trend bars, and drill-in all render cleanly on mobile (375px)
- Archived week banner and back button accessible on small screens

---

## v9 (2026-03-14)
**Renamed**: `gong-call-scorer` → `AE-Scorer`

### New: Prospect-Only Scope
- Analysis now explicitly excludes non-prospect calls: kickoffs, existing customer calls, partner calls, expansion/upsell calls
- Excluded calls are noted for transparency (e.g., "Excluded: Staunton Kickoff — existing customer")
- Filtering guidance added to Step 1 (call finding) and a new dedicated "Call Scope" section

### New: Coaching Voice & Tone Section
- Coaching must read as if written by a CRO — executive gravitas, no filler
- **Never open coaching sections with the rep's name** — lead with the insight
- **Keep / Start / Stop = exactly ONE item each** — highest impact only, forces prioritization
- Each item: bold one-sentence headline + 2-3 sentences of evidence from specific calls
- **Framework coaching written as oratory** — flowing prose weaving real call examples into teaching, not bullet points

### New: Epistemic Humility Principle
- AI has transcripts only — no tone, body language, deal history, or relationship context
- **Low-confidence feedback must be excluded** — if interpreting humor, sarcasm, or intent would be required, leave it out
- The 5% that's wrong makes reps discount the 95% that's right
- Use "the transcript shows" not "the rep felt"

### New: Demo Length Rule
- **Never criticize demo length** — long demos are driven by customer engagement, not poor structure
- A prospect on a 45-minute demo is buying, not suffering
- If talk ratio is problematic, address talk ratio directly — not duration

### New: SE/POV Call Handling
- **Do not penalize AE for SE presence on POV/demo calls** — the SE is doing their job
- Score AE on orchestration, business context, qualification, stakeholder management, and deal advancement
- Do not ding talk ratio or technical depth when SE is present

### Enhanced: MEDDPICC Multi-Call Philosophy
- Added explicit rule: **Never praise covering all 7 elements on a single call** — that's not how the framework works
- Depth on 2-3 elements is always superior to surface-level mention of all 7
- (Multi-call philosophy was in v8 but this makes the anti-pattern explicit)

### Enhanced: Writing Guidelines
- Added "Do not penalize team selling" section
- Added "Do not criticize demo length" section
- Added "Apply epistemic humility" section
- Strengthened "Look for patterns" guidance

### Enhanced: Critical Implementation Notes
- Added note 10: Prospect-only scope
- Added note 11: One Keep, one Start, one Stop
- Added note 12: Epistemic humility is non-negotiable

---

## v8 (2026-03-09)
**File**: `gong-call-scorer_v8.skill`

### Added: Never Split the Difference (Voss) Framework
- Added as 4th framework at 15% weight
- Tactical empathy, mirroring, labeling, calibrated questions, accusation audit, "that's right" moments
- Integrated into Rapport (10%), Discovery (30%), Advancement (20%), and Engagement (15%) dimensions
- Added Voss lens to Step 4 framework overlays
- Added vossColor() to DOCX formatting spec

### Added: MEDDPICC Multi-Call Philosophy
- MEDDPICC treated as multi-call framework, not single-call checklist
- 2-4 elements per call based on stage (early/mid/late)
- Pattern-level gaps across calls matter more than single-call gaps
- Do not penalize for elements not covered on a single call

### Changed: Framework Weights
- MEDDPICC: 30% (unchanged)
- Gap Selling: 30% (unchanged)
- Challenger: 25% (was 30%)
- Voss: 15% (new)

### Enhanced: Scoring Dimensions
- Rapport: Now includes Voss tactical empathy, mirroring, labeling, accusation audit
- Discovery: Now includes Voss calibrated questions alongside MEDDPICC and Gap Selling
- Advancement: Now includes Voss loss aversion, anchoring, "no"-oriented questions
- Engagement: Now includes "that's right" moments and voluntary elaboration

### Added: Mandatory Top-of-Report Summary
- Overall Assessment, What This Means, Best Examples Observed, Coaching Priority
- Required before all detailed scorecards

---

## v7 (2026-03-02)
**File**: `gong-call-AE-scorer_v7.skill`

### Core Framework
- Three frameworks: MEDDPICC (30%), Gap Selling (30%), Challenger Sale (30%)
- Six scoring dimensions with weighted formula
- Transcript processor requirement (process_transcript.py)
- DOCX output support with full formatting spec

### Scoring Dimensions
- Rapport & Connection (10%)
- Discovery & Qualification (30%)
- Value Articulation (15%)
- Deal Advancement (20%)
- Call Control & Structure (10%)
- Prospect Engagement (15%)

### Features
- Single call, small batch (2-5), and full batch (6-11) output formats
- Per-call scorecards with dimension breakdowns
- MEDDPICC coverage heatmaps
- Challenger Sale lens analysis
- Gap Selling lens analysis
- Keep / Start / Stop coaching action plans
- Cross-rep comparison for multi-rep batches

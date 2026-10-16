# Rapport

**Your email, as a board that moves itself.**

Rapport shows an inbox as people and work in progress instead of a list of messages.
Each email thread becomes a card ("Q4 quote", "Login error") on a three-column board:
**Your move / Waiting on them / Done**. Gemini reads every email, decides which piece of
work it belongs to and how far that work has come, and writes the next email that moves
it forward. The person only approves.

Entry for the AI Builder Cup 2026, theme *Future of Work & Enterprise Productivity*. Team Zillinks.

> Status (2026-10-16): skeleton. The board and card panel run on hand-labelled placeholder
> data. The Gemini processing run and the Cloud Run deployment come next.

## What a visitor sees

- A board already filled with six weeks of a fictional company's email (41 emails, 8 people, 6 pieces of work). No sign-in, no setup.
- A card that has waited on the other side for more than 7 days is marked **Stuck · N days** and carries a short follow-up draft (**Nudge**).
- Clicking a card opens a panel: who it is, where the work stands, their latest email, the draft, and a folded **How Rapport decided** with the full record of the AI steps.
- **Send** moves the card to *Waiting on them*. Everything a visitor does stays in their own browser tab. A refresh or **Reset demo** brings back the starting board, so visitors never see each other's clicks.

## How it works

```
data/seed.json ──► scripts/process-seed.mjs ──► data/processed.json ──► server.mjs ──► browser
 (fictional mail)    five Gemini steps, run once      saved results          static files    board + panel
```

The page never calls Gemini. The AI work is done once, ahead of time, and saved with a
full record of every step (model, input summary, tool calls, output, checks). Opening the
demo costs nothing and cannot fail because of a model outage. The server logs
`gemini_calls: 0` on every request.

### The five AI steps (per email)

| Step | Shown as | What it does |
|---|---|---|
| identify | Who is it | Matches the sender to a person and company, extracts facts worth remembering (promises, deadlines, preferences) with the sentence that supports each one |
| track | Which work | Decides whether a reply is needed, which piece of work the email belongs to, its kind, its new stage and whose turn it is. Stages come from a fixed list per kind and only move forward |
| prepare | What's needed | Finds what blocks the reply (a decision only the person can make, a value to look up, an attachment) and looks things up with tools: contact, history, the work item, and the knowledge base (price list, FAQ, manual) |
| draft | Write the reply | Writes the email that moves the work to its next stage. Prices may only come from the price list. A decision the person must make becomes one question with 2–3 answers, each with its own draft |
| judge | Check it | A separate call grades the draft against 10 rules (8 writing rules, every cited source was actually looked up, every price has a source). Failures are shown, never silently rewritten |

Rules that must not drift are plain code, not AI (`public/lib/rules.js`): when a card is
stuck (their turn for more than 7 days), which column it sits in, card order, and the
relationship word (New / Ongoing / Close / Going quiet / Quiet).

| Kind | Stages |
|---|---|
| deal | Requested → Proposal sent → Negotiating → Agreed |
| issue | Reported → Investigating → Fix proposed → Resolved |
| question | Asked → Answered → Confirmed |
| meeting | Proposed → Time agreed → Held |
| document | Requested → Sent → Received |
| other | Open → Done |

## Stack and why

| Choice | Why |
|---|---|
| Node.js 22, no web framework (`node:http`) | One small service, one command to run, no runtime dependencies to patch during judging |
| Plain HTML, CSS and ES modules, no build step | The board is one screen. Nothing to compile means what is in the repo is what runs |
| Saved JSON instead of a database | The demo is read-only on the server. Each visitor's clicks live in their own tab, so there is nothing to store and nothing to mix up between judges |
| Gemini through the official `@google/genai` SDK, only in `scripts/process-seed.mjs` | The model does the real work (classification, lookup with tools, drafting, self-check) once, with a full record, instead of on every page view |
| Cloud Run, one service, built from the `Dockerfile` | Required by the contest. Scales to zero, stays up through judging, costs close to nothing for static responses |
| `node:test` for tests | Built into Node. No extra install |

### Gemini settings (from the official docs, read 2026-10-16)

| Item | Value | Source |
|---|---|---|
| SDK | `@google/genai` (npm, latest 2.30.0) | https://ai.google.dev/gemini-api/docs/structured-output |
| Models recommended for new projects | `gemini-3.8-flash` (most capable Flash), `gemini-3.5-flash-lite` (fastest, lowest cost) | https://ai.google.dev/gemini-api/docs/models |
| Planned split | heavy steps (track, draft) on `gemini-3.8-flash`, light steps (identify, judge) on `gemini-3.5-flash-lite`. Confirmed on the first real run | same |
| Structured output | JSON Schema through `response_format` (`mime_type: application/json`) | https://ai.google.dev/gemini-api/docs/structured-output |
| Tool use | function declarations in `tools`, results returned as `function_result` steps | https://ai.google.dev/gemini-api/docs/function-calling |
| API key | environment variable `GEMINI_API_KEY`, read from `.env`, never committed | same |
| Billing | paid tier, so prompts are not used to improve Google products | https://ai.google.dev/gemini-api/terms |

### Cloud Run (from the official docs, read 2026-10-16)

Sources: https://docs.cloud.google.com/run/docs/quickstarts/build-and-deploy/deploy-nodejs-service and https://docs.cloud.google.com/sdk/gcloud/reference/run/deploy

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com
gcloud config set project PROJECT_ID
gcloud run deploy rapport --source . --region asia-northeast3 --allow-unauthenticated --max-instances 3
```

`--source .` builds with the `Dockerfile` when one is present. `--max-instances 3` caps cost.
The server listens on `PORT` (Cloud Run sets it; default 8080).

### Google AI Studio

Prompts and response schemas for the five steps are drafted and tried in Google AI Studio
before they go into `scripts/process-seed.mjs`. The record of that work will be added here.

## Run it locally

```bash
node scripts/process-seed.mjs --placeholder
npm start
```

Open http://localhost:8080. Run the tests with `npm test`.

To run the Gemini step (needs a paid-tier key):

```bash
cp .env.example .env
```

Put your key in `.env` yourself. Never paste it into a chat, an issue, or a commit.

## Keeping private data out

This repository will be made public for judging, so every commit and push is checked first.

- `scripts/leak-guard.mjs` scans every tracked and untracked file, every staged change and every commit message for a list of private terms, plus API-key shapes and a tracked `.env`. Before a push it also scans every file version in history.
- The term list lives outside the repository and is never copied in. If it is missing, the check fails instead of skipping. Findings print the list's line number only, never the term.
- `npm install` installs the git hooks (`pre-commit`, `commit-msg`, `pre-push`) through `scripts/install-hooks.mjs`.
- All demo data is invented. Domains use the reserved `.example` suffix.

## Decisions

Short calls made to keep the two-day scope simple.

- Scope is the demo board and Cloud Run only. Pasting new emails, per-visitor server storage, a database, the person page, drag and drop, and Gmail connection are left out.
- The starting board puts Jane's "Q4 quote" in *Your move* (her latest email asks for 10% off), so the one-question-and-draft flow is visible without pasting anything. Counts stay as planned: 2 your move, 1 waiting, 1 stuck, 2 done.
- Relationship stages use internal ids `new / active / trusted / cooling / dormant` and show as **New / Ongoing / Close / Going quiet / Quiet**.
- One fictional contact (Ken) has a single email from 96 days ago so that the *Quiet* stage appears. Everything else falls inside six weeks.
- No **Skip** button in the panel. Closing the panel does the same thing, and one fewer button is easier.
- Card buttons open the panel rather than sending straight away, so the draft is always seen before **Send**.
- The "N done this week" and "N emails didn't need a reply" toggles are styled as links, not buttons.
- No browser storage. A refresh is the simplest possible reset.

## License

MIT. See [LICENSE](LICENSE).

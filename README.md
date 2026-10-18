# Rapport

**Your email, as a board that moves itself.**

**Live demo:** https://rapport-535962174680.asia-northeast3.run.app (no sign-in)

Rapport is an assistant that reads your work email and turns it into **people, pieces of work and a dated plan**.
Gemini groups related emails into one piece of work ("Q4 quote", "Login error"), works out what has happened
and what still has to happen, by when and by whom, notices when the other side misses a promise, and writes the
next email that moves the work forward. The person only approves.

Entry for the AI Builder Cup 2026, theme *Future of Work & Enterprise Productivity*. Team Zillinks.

## The problem

The inbox is still a list of messages. What people actually manage is **work with other people**: a quote, an
NDA, a bug, a kickoff call. That work is spread over many emails, and the state of it lives in someone's head:
whose turn it is, what was promised, by when, and what is late. Gmail can summarise one thread or draft one
reply, but it does not tell you "you owe Jane an answer on the discount today, Tom's signed NDA is three days
late, and the pilot starts in ten days".

## What a visitor sees

The demo opens on a fictional company's last six weeks of email (41 emails, 8 people, 5 companies).

- **My schedule** at the top: every open step across all work, grouped as *Date passed / Today / This week / Next week / Later*. Steps you own are bold. A late promise from the other side carries a **Nudge** button.
- **Board** below: *Your move / Waiting on them / Done*. A card waiting more than 7 days on the other side is marked **Stuck**. Each card shows its next step and date.
- **Timeline** (switch at the top right): one row per piece of work, six weeks back to four weeks ahead, with a line for today.
- **Card panel**: the plan with done, next, planned and date-passed steps; dates Gemini had to estimate are marked *expected*. Every step has a **Source** link that shows the email sentence it came from. Below it: their latest email, one question when a decision is yours (for example a discount), the draft that changes with your answer, **Send**, and a folded **How Rapport decided** with the full record of every AI step.
- **Send** moves the card, ticks off the step and can be undone for a few seconds. Everything stays in the visitor's own tab: a refresh or **Reset demo** brings back the start, so visitors never see each other's clicks.

## How Gemini is used

```
data/seed.json ──► scripts/process-seed.mjs ──► data/processed.json ──► server.mjs ──► browser
 (fictional mail)    six Gemini steps, run once      saved results + records   static files    board, schedule, panel
```

| Step | Shown as | What Gemini does | Model |
|---|---|---|---|
| track | Which work | For each email in date order: does it need a reply, which piece of work it belongs to (or a new one), kind, stage (from a fixed list per kind, forward only), whose turn | `gemini-3.8-flash` |
| identify | Who is it | Per contact: facts worth remembering (promises, deadlines, preferences). A fact is kept only if its evidence sentence appears word for word in an email | `gemini-3.5-flash-lite` |
| plan | Plan | Per piece of work: a dated plan of 3 to 8 steps with owner, done or not, the date written in the emails or an estimate marked *expected*, and the sentence that supports it | `gemini-3.8-flash` |
| prepare | What's needed | Function calling over four tools (`get_contact`, `get_history`, `get_goal`, `search_knowledge` on the price list, FAQ, manual and terms) to find what blocks the reply; a decision only the person can make becomes one question | `gemini-3.8-flash` |
| draft | Write the reply | The email that moves the work to its next step, one version per answer to the question; prices only from the price list | `gemini-3.8-flash` |
| judge | Check it | A separate call grades the draft on 10 rules (writing rules, every cited source was looked up, every price has a source). Failures are shown, never silently rewritten | `gemini-3.5-flash-lite` |

All steps use structured output (JSON Schema). The last run made about 64 calls in 6 minutes. Every call is
saved with model, input summary, tool calls and output, and shown under **How Rapport decided**.

Rules that must not drift are plain code, not AI (`public/lib/rules.js`): stuck after 7 days, column and order
of cards, plan status (done, next, planned, date passed), schedule groups and the relationship word.

### How well it works

The seed carries a hand-made answer key. `node scripts/score.mjs` grades the saved Gemini result against it:

| Check | Result |
|---|---|
| Emails sorted into the right piece of work (or correctly left out) | **41 of 41** |
| Pieces of work found | **6 of 6** (kind right 6 of 6, column right 6 of 6) |
| Dated steps from the emails found in the plan | **20 of 21** |
| Draft self-checks passed | 20 pass, 2 fail (shown in the panel), 8 not applicable |

### Why the page never calls Gemini

The AI work is done once, ahead of time. Opening the demo costs nothing, cannot fail because of a model
outage during judging, and every visitor sees the same, checkable result. Dates are stored as day offsets from
the run (`{{d:+7}}`) and shown as real dates counted from the day the page is opened, so the demo reads the
same whenever it is opened.

### Beyond the demo

The same pipeline runs per email, so a real inbox would process each new message as it arrives (a Cloud Run job
or a Pub/Sub push per message) and update one work item at a time. The six steps and their records stay the same.

## Stack

| Choice | Why |
|---|---|
| Node.js 22, no web framework (`node:http`) | One small service, one command to run, no runtime dependencies |
| Plain HTML, CSS and ES modules, no build step | What is in the repo is what runs |
| Saved JSON instead of a database | The demo is read-only on the server; each visitor's clicks stay in their tab |
| `@google/genai` 2.30.0, only in `scripts/` | The official Gemini SDK; not shipped in the container |
| Cloud Run, one service, built from the `Dockerfile` | Required by the contest; scales to zero; capped at 3 instances |
| `node:test` | Built into Node |

Sources read on 2026-10-16: Gemini models https://ai.google.dev/gemini-api/docs/models, structured output
https://ai.google.dev/gemini-api/docs/structured-output, function calling
https://ai.google.dev/gemini-api/docs/function-calling, paid-tier data use https://ai.google.dev/gemini-api/terms,
Cloud Run https://docs.cloud.google.com/run/docs/quickstarts/build-and-deploy/deploy-nodejs-service.
The API key comes from Google AI Studio.

## Run it locally

```bash
npm install
npm start
```

Open http://localhost:8080. Tests: `npm test`.

To run the Gemini step yourself, copy `.env.example` to `.env`, put a Gemini API key in it, then:

```bash
node scripts/gemini-smoke.mjs
node scripts/process-seed.mjs
node scripts/score.mjs
```

`node scripts/process-seed.mjs --placeholder` rebuilds the data from the hand labels without any AI.

## Deploy

```bash
gcloud run deploy rapport --source . --region asia-northeast3 --allow-unauthenticated --max-instances 3
```

## Keeping private data out

- All demo data is invented. Domains use the reserved `.example` suffix.
- `scripts/leak-guard.mjs` runs before every commit and push (installed by `npm install`). It scans files, staged changes, commit messages and, before a push, every file version in history, for a private term list kept outside the repository and for API-key shapes. A missing list is a failure, not a skip, and findings print only a line number. Outside the team, point `LEAK_GUARD_FILE` at your own list (one term per line).
- `.env` is never committed or uploaded.

## Decisions

- Two-day scope: the demo board and Cloud Run. Pasting new emails, a database, a person page, drag and drop and Gmail sign-in are left out.
- The plan replaces fixed stage chips on screen. Stages still exist underneath to keep the board consistent.
- When an email gives no date, Gemini estimates one and the step is marked *expected* with a reason.
- One fictional contact has a single email from 96 days ago so the *Quiet* relationship appears.
- No Skip button; closing the panel does the same.

## License

MIT. See [LICENSE](LICENSE).

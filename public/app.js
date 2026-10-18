// Rapport demo board. Everything a visitor does stays in this browser tab's memory:
// a refresh or "Reset demo" brings back the starting board. Nothing is written to the server.

import { STAGES, arrangeBoard, isStuck, isFresh, daysLabel, spanLabel, applySend, planView, nextStep, agenda, AGENDA_GROUPS } from './lib/rules.js';
import { renderDates, fmtShort, fmtRange } from './lib/dates.js';

const STEP_NAMES = { identify: 'Who is it', track: 'Which work', prepare: "What's needed", draft: 'Write the reply', judge: 'Check it' };

const el = {
  board: document.getElementById('board'),
  view: document.getElementById('view'),
  agenda: document.getElementById('agenda'),
  noreply: document.getElementById('noreply'),
  panel: document.getElementById('panel'),
  scrim: document.getElementById('scrim'),
  toast: document.getElementById('toast'),
};

let data = null; // pristine copy from the server
let state = null; // what the visitor sees now

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const firstName = (p) => (p?.name || '').split(' ')[0];

function freshState() {
  return {
    goals: structuredClone(data.goals),
    opened: new Set(),
    openId: null,
    view: state?.view || 'board', // board | timeline
    showDone: false,
    showNoReply: false,
    answers: {}, // goal id -> chosen option index
    edits: {}, // goal id -> edited draft text
    expanded: {}, // goal id -> "How Rapport decided" open
    justSent: new Set(), // goal ids sent or nudged and not opened since
    undo: null, // { goal, edits, answers } snapshot of the last sent card
  };
}

const person = (id) => data.people.find((p) => p.id === id);
const company = (id) => data.companies.find((c) => c.id === id);
const mail = (id) => data.mails.find((m) => m.id === id);
const goal = (id) => state.goals.find((g) => g.id === id);

async function load() {
  const res = await fetch('/data/processed.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`demo data: ${res.status}`);
  data = await res.json();
  fillDates(data);
  state = freshState();
  render();
}

// Turn {{d:N}} markers in everything the page shows into real dates, counted from today.
// The AI records under "How Rapport decided" stay exactly as Gemini wrote them.
function fillDates(d) {
  const walk = (v, skip) => {
    if (typeof v === 'string') return renderDates(v);
    if (Array.isArray(v)) return v.map((x) => walk(x, skip));
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) if (!skip.has(k)) v[k] = walk(v[k], skip);
      return v;
    }
    return v;
  };
  const skip = new Set(['runs', 'body_raw']);
  d.goals = walk(d.goals, skip);
  d.people = walk(d.people, skip);
}

// ---------------- board ----------------

function stageDots(g) {
  const list = STAGES[g.kind];
  const at = list.indexOf(g.stage);
  return `<span class="dots" aria-hidden="true">${list.map((_, i) => `<span class="dot${i <= at ? ' on' : ''}"></span>`).join('')}</span>`;
}

// Small dots: one per step of the plan. Filled = done, amber = date passed.
function planDots(g) {
  const steps = planView(g.plan, { closed: g.status === 'done' });
  if (!steps.length) return stageDots(g);
  return `<span class="dots" aria-hidden="true">${steps.map((s) => `<span class="dot${s.status === 'done' ? ' on' : s.status === 'overdue' ? ' late' : ''}"></span>`).join('')}</span>`;
}

function whenLabel(s) {
  if (s.end !== undefined && Math.round(s.end) !== Math.round(s.start)) return fmtRange(s.start, s.end);
  const d = Math.round(s.start);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  return fmtShort(d);
}

function ownerLabel(s, g) {
  if (s.owner === 'me') return 'You';
  if (s.owner === 'both') return 'Both';
  return firstName(person(g.person_id));
}

function nextLabel(g) {
  if (g.status === 'done') return 'Done';
  const late = planView(g.plan).find((s) => s.status === 'overdue' && s.owner !== 'me');
  if (late) return `Late: ${late.title} · due ${whenLabel(late)}`;
  const n = nextStep(g.plan);
  if (!n) return g.stage;
  return `Next: ${n.title} · ${whenLabel(n)}`;
}

function cardHtml(g) {
  const p = person(g.person_id);
  const stuck = isStuck(g);
  const fresh = isFresh(g, state.opened);
  const yourMove = g.status === 'open' && g.turn === 'me';
  const button = yourMove
    ? `<button type="button" class="btn" data-action="open" data-id="${g.id}" data-testid="card-button">Reply</button>`
    : stuck
      ? `<button type="button" class="btn btn-stuck" data-action="open" data-id="${g.id}" data-testid="card-button">Nudge</button>`
      : '';
  const since = stuck ? `<span class="since is-stuck">Stuck · ${Math.floor(g.last_moved_days_ago)} days</span>` : `<span class="since">${g.sent ? 'just now' : daysLabel(g.last_moved_days_ago)}</span>`;
  const justSent = state.justSent.has(g.id);
  const reason = fresh
    ? `<div class="reason">${esc(g.moved_reason || `${firstName(p)} sent a new email, so it's your move.`)}</div>`
    : justSent
      ? `<div class="reason reason-sent" data-testid="sent-reason">${g.last_action === 'nudge' ? `You nudged ${esc(firstName(p))} just now.` : `You replied to ${esc(firstName(p))} just now.`}</div>`
      : '';
  return `<article class="card${stuck ? ' stuck' : ''}${fresh ? ' fresh' : ''}${justSent ? ' just-sent' : ''}" data-action="open" data-id="${g.id}" data-testid="card" data-goal="${g.id}" tabindex="0">
    <h3 class="card-title">${esc(g.title)}</h3>
    <div class="card-who">${esc(p.name)} · ${esc(company(p.company_id).name)}</div>
    <div class="stage">${planDots(g)}<span data-testid="next-step">${esc(nextLabel(g))}</span></div>
    ${reason}
    <div class="card-foot">${since}${button}</div>
  </article>`;
}

function columnHtml(key, title, pip, cards) {
  return `<section class="column" data-testid="column-${key}" aria-label="${title}">
    <div class="column-head"><span class="pip ${pip}"></span>${title}<span class="count">${cards.length}</span></div>
    <div class="cards">${cards.length ? cards.map(cardHtml).join('') : '<div class="empty">Nothing here.</div>'}</div>
  </section>`;
}

function render() {
  const cols = arrangeBoard(state.goals, state.opened);
  const doneWeek = cols.done.filter((g) => g.last_moved_days_ago <= 7).length;
  const doneBody = state.showDone
    ? `<div class="cards done-list" data-testid="done-list">${cols.done.map((g) => `<article class="card done-card" data-action="open" data-id="${g.id}" data-testid="card" data-goal="${g.id}" tabindex="0"><h3 class="card-title">${esc(g.title)}</h3><div class="card-who">${esc(person(g.person_id).name)}</div></article>`).join('')}</div>`
    : '';
  el.view.innerHTML = ['board', 'timeline']
    .map((v) => `<button type="button" data-action="view" data-view="${v}" aria-pressed="${state.view === v}" data-testid="view-${v}">${v === 'board' ? 'Board' : 'Timeline'}</button>`)
    .join('');
  el.board.className = state.view === 'timeline' ? 'timeline' : 'board';
  if (state.view === 'timeline') {
    el.agenda.innerHTML = '';
    el.board.innerHTML = timelineHtml(cols);
    layoutTags();
    el.noreply.innerHTML = '';
    renderPanel();
    return;
  }
  el.agenda.innerHTML = agendaHtml();
  el.board.innerHTML =
    columnHtml('your_move', 'Your move', '', cols.your_move) +
    columnHtml('waiting', 'Waiting on them', 'pip-waiting', cols.waiting) +
    `<section class="column" data-testid="column-done" aria-label="Done">
      <div class="column-head"><span class="pip pip-done"></span>Done<span class="count">${cols.done.length}</span></div>
      <button type="button" class="link done-toggle" data-action="toggle-done" data-testid="done-toggle" aria-expanded="${state.showDone}">${doneWeek} done this week ${state.showDone ? '▾' : '▸'}</button>
      ${doneBody}
    </section>`;

  const nr = data.no_reply_mail_ids.map(mail);
  el.noreply.innerHTML = `<button type="button" class="link" data-action="toggle-noreply" data-testid="noreply-toggle" aria-expanded="${state.showNoReply}">${nr.length} emails didn't need a reply</button>
    ${state.showNoReply ? `<ul data-testid="noreply-list">${nr.map((m) => `<li><span class="from">${esc(m.from?.name || person(m.person_id)?.name)}</span><span>${esc(m.subject)}</span></li>`).join('')}</ul>` : ''}`;

  renderScore();
  renderPanel();
}

// One line of proof under the board: how Gemini's sorting compares with a hand-made answer key.
function renderScore() {
  const el2 = document.getElementById('score');
  const sc = data.generator === 'gemini' ? data.score : null;
  el2.hidden = !sc;
  if (!sc) return;
  el2.textContent = `Gemini sorted these ${sc.emails.total} emails before you opened the page. Checked against a hand-made answer key: ${sc.emails.right} of ${sc.emails.total} emails in the right place, ${sc.items.found} of ${sc.items.total} pieces of work found, ${sc.dated_steps.found} of ${sc.dated_steps.total} dated steps found.`;
}

// ---------------- my schedule ----------------

const GROUP_TITLE = { overdue: 'Date passed', today: 'Today', this_week: 'Next 7 days', next_week: 'The week after', later: 'Later' };
const FOLDED = ['next_week', 'later'];

function agendaHtml() {
  const groups = agenda(state.goals);
  // The far future is folded so the board stays in view.
  const shown = AGENDA_GROUPS.filter((k) => groups[k].length && (state.showLater || !FOLDED.includes(k)));
  const hidden = FOLDED.reduce((n, k) => n + groups[k].length, 0);
  const body = shown
    .map((k) => `<div class="ag-group ag-${k}" data-testid="ag-${k}"><div class="ag-head">${GROUP_TITLE[k]}</div>${groups[k].map(agendaRow).join('')}</div>`)
    .join('');
  const more = hidden ? `<button type="button" class="link ag-more" data-action="toggle-later" data-testid="ag-more" aria-expanded="${Boolean(state.showLater)}">${state.showLater ? 'Show less ▴' : `${hidden} more later ▾`}</button>` : '';
  return `<div class="ag-title">My schedule <span class="ag-sample">Sample inbox. Nothing you send leaves this page.</span></div>${body || '<div class="empty">Nothing planned.</div>'}${more}`;
}

function agendaRow(s) {
  const g = goal(s.goal_id);
  const p = person(g.person_id);
  const who = s.owner === 'me' ? 'You' : s.owner === 'both' ? `You and ${firstName(p)}` : `${p.name} · ${company(p.company_id).name}`;
  // The row's button is the card's own action: reply when it is your move today, nudge when they are late.
  const btn = !s.act_now ? ''
    : g.turn === 'me'
      ? `<button type="button" class="btn" data-action="open" data-id="${g.id}" data-testid="ag-button">Reply</button>`
      : `<button type="button" class="btn btn-stuck" data-action="open" data-id="${g.id}" data-testid="ag-button">Nudge</button>`;
  return `<div class="ag-row${s.owner === 'me' ? ' mine' : ''}" data-action="open" data-id="${g.id}" data-testid="ag-row" tabindex="0">
    <span class="ag-when">${s.act_now ? 'Now' : esc(whenLabel(s))}</span>
    <span class="ag-what"><span class="ag-step">${esc(s.title)}${s.date_kind === 'estimated' ? ' <span class="badge-est">expected</span>' : ''}</span>
      <span class="ag-ctx">${esc(g.title)} · ${esc(who)}</span>${s.group === 'overdue' && s.note ? `<span class="ag-note">${esc(s.note)}</span>` : ''}</span>
    <span class="ag-act">${btn}</span>
  </div>`;
}

// ---------------- timeline ----------------

const TL_MIN = -42;
const TL_MAX = 28;
const pos = (o) => ((Math.min(TL_MAX, Math.max(TL_MIN, o)) - TL_MIN) / (TL_MAX - TL_MIN)) * 100;

function timelineHtml(cols) {
  const order = [...cols.your_move, ...cols.waiting, ...cols.done];
  const ticks = [];
  for (let o = TL_MIN; o <= TL_MAX; o += 7) ticks.push(o);
  const head = `<div class="tl-row tl-head"><div class="tl-label"></div><div class="tl-track">${ticks
    .map((o) => `<span class="tl-tick" style="left:${pos(o)}%">${o === 0 ? 'Today' : esc(fmtShort(o))}</span>`)
    .join('')}</div></div>`;
  const rows = order.map((g) => {
    const p = person(g.person_id);
    const steps = planView(g.plan, { closed: g.status === 'done' });
    const marks = steps.map((st) => {
      const tip = esc(`${st.title} · ${whenLabel(st)} · ${ownerLabel(st, g)}${st.date_kind === 'estimated' ? ' · expected' : ''}`);
      const cls = `${st.status}${st.date_kind === 'estimated' ? ' est' : ''}`;
      const range = Math.round(st.end) !== Math.round(st.start);
      const shape = range
        ? `<span class="tl-bar ${cls}" style="left:${pos(st.start)}%;width:${Math.max(0.8, pos(st.end) - pos(st.start))}%" title="${tip}"></span>`
        : `<span class="tl-dot ${cls}" style="left:${pos(st.start)}%" title="${tip}"></span>`;
      const tag = st.status !== 'done'
        ? `<span class="tl-tag ${st.status}" style="left:${pos(st.start)}%" data-testid="tl-${st.status}">${st.status === 'overdue' ? '⚠ ' : ''}${esc(st.title)} · ${esc(whenLabel(st))}</span>`
        : '';
      return shape + tag;
    }).join('');
    return `<div class="tl-row${g.status === 'done' ? ' tl-done' : ''}" data-action="open" data-id="${g.id}" data-testid="tl-row" data-goal="${g.id}" tabindex="0">
      <div class="tl-label"><strong>${esc(g.title)}</strong><span>${esc(p.name)}</span></div>
      <div class="tl-track"><span class="tl-today" style="left:${pos(0)}%"></span>${marks}</div>
    </div>`;
  }).join('');
  return `<div class="tl-legend"><span><i class="lg done"></i>Done</span><span><i class="lg next"></i>Next</span><span><i class="lg upcoming"></i>Planned</span><span><i class="lg overdue"></i>Date passed</span><span><i class="lg est"></i>Expected</span></div>
    <div class="tl-scroll"><div class="tl-inner">${head}${rows}</div></div>`;
}

// Step names under the timeline go on as many lines as needed so they never overlap,
// and a name near the right edge is drawn to the left of its marker.
function layoutTags() {
  const LINE = 16;
  for (const track of el.board.querySelectorAll('.tl-row:not(.tl-head) .tl-track')) {
    const box = track.getBoundingClientRect();
    const lanes = [];
    const tags = [...track.querySelectorAll('.tl-tag')].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    for (const tag of tags) {
      let r = tag.getBoundingClientRect();
      if (r.right > box.right) { tag.classList.add('flip'); r = tag.getBoundingClientRect(); }
      let lane = lanes.findIndex((end) => r.left > end + 8);
      if (lane === -1) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = r.right;
      tag.style.top = `${34 + lane * LINE}px`;
    }
    track.style.height = `${44 + Math.max(1, lanes.length) * LINE}px`;
  }
}

// ---------------- panel ----------------

function planHtml(g) {
  const steps = planView(g.plan, { closed: g.status === 'done' });
  if (!steps.length) return stageChips(g);
  const icon = { done: '✓', next: '●', upcoming: '○', overdue: '!' };
  return `<ol class="plan" data-testid="plan">${steps
    .map((st) => `<li class="step ${st.status}" data-testid="plan-step" data-status="${st.status}">
      <span class="step-icon" aria-hidden="true">${icon[st.status]}</span>
      <span class="step-when">${esc(whenLabel(st))}</span>
      <span class="step-body"><span class="step-title">${esc(st.title)}</span>
        <span class="step-meta">${esc(ownerLabel(st, g))}${st.date_kind === 'estimated' ? ' · <span class="badge-est">expected</span>' : ''}${st.status === 'overdue' ? ' · <span class="badge-late">date passed</span>' : ''}</span>
        ${st.note ? `<span class="step-note">${esc(st.note)}</span>` : ''}
        ${sourceHtml(g, st)}</span>
    </li>`)
    .join('')}</ol>`;
}

// The email sentence a step (or its date) came from, one click away.
function sourceHtml(g, st) {
  if (!st.evidence) return '';
  const key = `src-${g.id}-${st.i}`;
  const open = state.expanded[key];
  const m = st.mail ? mail(st.mail) : null;
  const from = !m ? '' : m.direction === 'out' ? 'Your email' : `${firstName(person(m.person_id))}'s email`;
  const when = m ? `${fmtShort(-m.days_ago)}` : '';
  return `<button type="button" class="link src-toggle" data-action="toggle-src" data-id="${key}" aria-expanded="${Boolean(open)}" data-testid="src-toggle">${open ? 'Hide source' : 'Source'}</button>
    ${open ? `<blockquote class="src" data-testid="src"><span class="src-text">“${esc(renderDates(st.evidence))}”</span>${m ? `<span class="src-from">${esc(from)} · ${esc(when)}</span>` : ''}</blockquote>` : ''}`;
}


function stageChips(g) {
  const list = STAGES[g.kind];
  const at = list.indexOf(g.stage);
  return `<div class="chips" data-testid="stages">${list
    .map((s, i) => `<span class="chip${i < at ? ' past' : ''}${i === at ? ' now' : ''}"${i === at ? ' data-testid="stage-now"' : ''}>${esc(s)}</span>`)
    .join('<span class="chip-sep">›</span>')}</div>`;
}

function whoLine(g) {
  const p = person(g.person_id);
  const total = p.received_count + p.sent_count;
  const span = spanLabel((p.first_contact_days_ago ?? 0) - (p.last_contact_days_ago ?? 0));
  return `${esc(p.name)} · ${esc(company(p.company_id).name)} · ${total} email${total === 1 ? '' : 's'} over ${span} · ${esc(p.stage_label)}`;
}

function lastPromise(g) {
  const p = person(g.person_id);
  const promises = (p.facts || []).filter((f) => f.kind === 'promise');
  const f = promises[promises.length - 1];
  return f ? `<div class="promise" data-testid="promise">Last promise: ${esc(f.fact)}</div>` : '';
}

function draftFor(g) {
  const d = g.draft;
  if (!d) return null;
  const choice = state.answers[g.id];
  const opt = d.question && choice !== undefined ? d.question.options[choice] : null;
  return {
    body: state.edits[g.id] ?? (opt ? opt.body : d.body),
    unverified: opt ? opt.unverified || [] : d.unverified || [],
  };
}

function decidedHtml(g) {
  const checks = g.draft?.checks || [];
  const fails = checks.filter((c) => c.verdict === 'fail').length;
  const summary = !checks.length ? '' : fails ? `<span class="check-summary bad" data-testid="check-summary">${fails} check${fails === 1 ? '' : 's'} need${fails === 1 ? 's' : ''} your eye</span>` : `<span class="check-summary" data-testid="check-summary">All ${checks.length} checks passed</span>`;
  const open = state.expanded[g.id];
  const runs = g.runs || [];
  const body = !open
    ? ''
    : runs.length
      ? `<ol class="steps" data-testid="decided-steps">${runs
          .map(
            (r) => `<li><div class="step-name">${esc(STEP_NAMES[r.step] || r.step)}</div><div class="step-text">${esc(r.summary)}</div>
              <details><summary class="link">Show details</summary>
              ${r.step === 'judge' && checks.length ? `<ul class="checks">${checks.map((c) => `<li><span class="verdict ${c.verdict === 'n.a.' ? 'na' : c.verdict}">${esc(c.verdict)}</span><span>${esc(c.rule)}: ${esc(c.evidence)}</span></li>`).join('')}</ul>` : ''}
              <pre class="raw">${esc(JSON.stringify({ model: r.model, input: r.input_summary, tool_calls: r.tool_calls, output: r.output, ms: r.ms }, null, 2))}</pre></details></li>`,
          )
          .join('')}</ol>`
      : '<p class="step-text">No record yet for this item.</p>';
  return `<div class="section">
    <div class="decided-toggle"><button type="button" class="link" data-action="toggle-decided" data-id="${g.id}" data-testid="decided-toggle" aria-expanded="${Boolean(open)}">How Rapport decided ${open ? '▾' : '▸'}</button>${summary}</div>
    ${body}
  </div>`;
}

function renderPanel() {
  const g = state.openId && goal(state.openId);
  if (!g) {
    el.panel.hidden = true;
    el.scrim.hidden = true;
    return;
  }
  const p = person(g.person_id);
  const stuck = isStuck(g);
  const canSend = g.status === 'open' && (g.turn === 'me' || stuck) && g.draft;
  const shownMail = mail(stuck ? [...g.mail_ids].reverse().find((id) => mail(id).direction === 'out') : g.their_latest_mail_id || g.latest_mail_id);
  const mailLabel = shownMail.direction === 'out' ? `Your last email · ${daysLabel(shownMail.days_ago)} ago` : `${esc(firstName(p))}'s email · ${shownMail.days_ago < 0.25 ? 'just now' : `${daysLabel(shownMail.days_ago)} ago`}`;

  let change = '';
  if (g.sent) change = `Sent. Now waiting on ${esc(firstName(p))}.`;
  else if (stuck) change = `No reply for <strong>${Math.floor(g.last_moved_days_ago)} days</strong> after you sent it.`;
  else if (g.status === 'done') change = `Done ${daysLabel(g.last_moved_days_ago)} ago.`;
  else if (g.turn === 'them') change = `Waiting on ${esc(firstName(p))} for ${daysLabel(g.last_moved_days_ago)}.`;

  const d = draftFor(g);
  const q = g.draft?.question;
  const answered = state.answers[g.id] !== undefined;
  const draftHtml = !canSend
    ? ''
    : `${q ? `<div class="section" data-testid="question"><div class="section-label">One question for you</div><div class="question">${esc(q.text)}</div>
          <div class="chip-row">${q.options.map((o, i) => `<button type="button" class="chip-btn" data-action="answer" data-id="${g.id}" data-index="${i}" aria-pressed="${state.answers[g.id] === i}" data-testid="answer">${esc(o.label)}</button>`).join('')}</div></div>` : ''}
       <div class="section">
         <div class="section-label">${g.draft.mode === 'nudge' ? 'Nudge' : 'Draft'}</div>
         ${g.draft.based_on?.length ? `<div class="based-on" data-testid="based-on">Based on: ${esc(g.draft.based_on.join(', '))}</div>` : ''}
         <textarea class="draft" data-action="edit" data-id="${g.id}" data-testid="draft" aria-label="Draft reply">${esc(d.body)}</textarea>
         ${d.unverified.length && (!q || !answered) ? `<div class="notice notice-warn" data-testid="not-filled">Not filled in yet: ${esc(d.unverified.join('; '))}</div>` : ''}
         ${g.draft.attachment ? `<div class="notice notice-attach" data-testid="attach">Attach before sending: ${esc(g.draft.attachment)}</div>` : ''}
         <div class="actions"><button type="button" class="btn btn-big" data-action="send" data-id="${g.id}" data-testid="send">Send</button></div>
       </div>`;

  el.panel.className = `panel${stuck ? ' stuck-panel' : ''}`;
  el.panel.innerHTML = `
    <div class="panel-head"><div><h2 data-testid="panel-title">${esc(g.title)}</h2>
      <div class="who-line" data-testid="who-line">${whoLine(g)}</div>${lastPromise(g)}</div>
      <button type="button" class="x" data-action="close" aria-label="Close" data-testid="close">✕</button></div>
    <div class="section"><div class="section-label">Plan</div>${planHtml(g)}${change ? `<p class="change" data-testid="change">${change}</p>` : ''}</div>
    <div class="section"><div class="section-label">${mailLabel}</div>
      <div class="mail-box${state.expanded['mail-' + g.id] ? '' : ' clamp'}" data-testid="their-mail">${esc(renderDates(shownMail.body))}</div>
      <button type="button" class="link" data-action="toggle-mail" data-id="${g.id}">${state.expanded['mail-' + g.id] ? 'Show less' : 'Show whole email'}</button></div>
    ${draftHtml}
    ${g.status === 'done' || g.sent ? '' : decidedHtml(g)}`;
  el.panel.hidden = false;
  el.scrim.hidden = false;
}

// ---------------- actions ----------------

function toast(text, { undo = false } = {}) {
  el.toast.innerHTML = `<span>${esc(text)}</span>${undo ? '<button type="button" class="toast-undo" data-action="undo" data-testid="undo">Undo</button>' : ''}`;
  el.toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => {
    el.toast.hidden = true;
    state.undo = null;
  }, undo ? 7000 : 3200);
}

function openGoal(id) {
  const other = state.openId !== id;
  state.openId = id;
  state.opened.add(id);
  state.justSent.delete(id);
  render();
  if (other) el.panel.scrollTop = 0; // a different card starts at its title
  el.panel.focus();
}

function send(id) {
  const g = goal(id);
  const wasNudge = g.draft?.mode === 'nudge';
  state.undo = { goal: g, edits: state.edits[id], answers: state.answers[id] };
  state.goals = state.goals.map((x) => (x.id === id ? { ...applySend(x), last_action: wasNudge ? 'nudge' : 'reply' } : x));
  state.justSent.add(id);
  delete state.edits[id];
  delete state.answers[id];
  state.openId = null;
  render();
  toast(`${wasNudge ? 'Nudge sent' : 'Sent'} to ${person(g.person_id).name}. (Demo: saved, not emailed.)`, { undo: true });
}

// Puts the last sent card back exactly as it was, draft and answer included.
function undoSend() {
  const u = state.undo;
  if (!u) return;
  state.goals = state.goals.map((x) => (x.id === u.goal.id ? u.goal : x));
  state.justSent.delete(u.goal.id);
  if (u.edits !== undefined) state.edits[u.goal.id] = u.edits;
  if (u.answers !== undefined) state.answers[u.goal.id] = u.answers;
  state.undo = null;
  render();
  toast('Undone. The card is back where it was.');
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const { action, id } = t.dataset;
  if (action === 'open') { e.stopPropagation(); openGoal(id); }
  else if (action === 'close') { state.openId = null; render(); }
  else if (action === 'reset') { state = freshState(); render(); toast('Demo reset to the start.'); }
  else if (action === 'toggle-done') { state.showDone = !state.showDone; render(); }
  else if (action === 'toggle-noreply') { state.showNoReply = !state.showNoReply; render(); }
  else if (action === 'toggle-decided') { state.expanded[id] = !state.expanded[id]; renderPanel(); }
  else if (action === 'toggle-src') { state.expanded[id] = !state.expanded[id]; renderPanel(); }
  else if (action === 'toggle-mail') { state.expanded['mail-' + id] = !state.expanded['mail-' + id]; renderPanel(); }
  else if (action === 'answer') {
    const i = Number(t.dataset.index);
    if (state.answers[id] === i) return; // same answer again: keep the draft as it is
    if (state.edits[id] !== undefined && !window.confirm('Replace your edits with the draft for this answer?')) return;
    state.answers[id] = i;
    delete state.edits[id];
    renderPanel();
  }
  else if (action === 'toggle-later') { state.showLater = !state.showLater; render(); }
  else if (action === 'send') send(id);
  else if (action === 'undo') undoSend();
  else if (action === 'view') { state.view = t.dataset.view; render(); }
});

document.addEventListener('input', (e) => {
  if (e.target.dataset?.action === 'edit') state.edits[e.target.dataset.id] = e.target.value;
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state?.openId) { state.openId = null; render(); }
  if ((e.key === 'Enter' || e.key === ' ') && (e.target.classList?.contains('card') || e.target.classList?.contains('tl-row') || e.target.classList?.contains('ag-row'))) { e.preventDefault(); openGoal(e.target.dataset.id); }
});

load().catch((err) => {
  el.board.innerHTML = `<p class="empty">The demo could not load. Please refresh the page.</p>`;
  console.error(err);
});

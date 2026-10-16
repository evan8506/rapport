// Rapport demo board. Everything a visitor does stays in this browser tab's memory:
// a refresh or "Reset demo" brings back the starting board. Nothing is written to the server.

import { STAGES, arrangeBoard, isStuck, isFresh, daysLabel, spanLabel, applySend } from './lib/rules.js';

const STEP_NAMES = { identify: 'Who is it', track: 'Which work', prepare: "What's needed", draft: 'Write the reply', judge: 'Check it' };

const el = {
  board: document.getElementById('board'),
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
    showDone: false,
    showNoReply: false,
    answers: {}, // goal id -> chosen option index
    edits: {}, // goal id -> edited draft text
    expanded: {}, // goal id -> "How Rapport decided" open
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
  state = freshState();
  render();
}

// ---------------- board ----------------

function stageDots(g) {
  const list = STAGES[g.kind];
  const at = list.indexOf(g.stage);
  return `<span class="dots" aria-hidden="true">${list.map((_, i) => `<span class="dot${i <= at ? ' on' : ''}"></span>`).join('')}</span>`;
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
  const reason = fresh ? `<div class="reason">${esc(g.moved_reason || `${firstName(p)} sent a new email, so it's your move.`)}</div>` : '';
  return `<article class="card${stuck ? ' stuck' : ''}${fresh ? ' fresh' : ''}" data-action="open" data-id="${g.id}" data-testid="card" data-goal="${g.id}" tabindex="0">
    <h3 class="card-title">${esc(g.title)}</h3>
    <div class="card-who">${esc(p.name)} · ${esc(company(p.company_id).name)}</div>
    <div class="stage">${stageDots(g)}<span>${esc(g.stage)}</span></div>
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

  renderPanel();
}

// ---------------- panel ----------------

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
  else if (g.stage_change) change = `This email moved it from <strong>${esc(g.stage_change.from)}</strong> to <strong>${esc(g.stage_change.to)}</strong>.`;
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
    <div class="section">${stageChips(g)}${change ? `<p class="change" data-testid="change">${change}</p>` : ''}</div>
    <div class="section"><div class="section-label">${mailLabel}</div>
      <div class="mail-box${state.expanded['mail-' + g.id] ? '' : ' clamp'}" data-testid="their-mail">${esc(shownMail.body)}</div>
      <button type="button" class="link" data-action="toggle-mail" data-id="${g.id}">${state.expanded['mail-' + g.id] ? 'Show less' : 'Show whole email'}</button></div>
    ${draftHtml}
    ${g.status === 'done' || g.sent ? '' : decidedHtml(g)}`;
  el.panel.hidden = false;
  el.scrim.hidden = false;
}

// ---------------- actions ----------------

function toast(text) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.toast.hidden = true), 3200);
}

function openGoal(id) {
  state.openId = id;
  state.opened.add(id);
  render();
  el.panel.focus();
}

function send(id) {
  const g = goal(id);
  const wasNudge = g.draft?.mode === 'nudge';
  state.goals = state.goals.map((x) => (x.id === id ? applySend(x) : x));
  delete state.edits[id];
  delete state.answers[id];
  state.openId = null;
  render();
  toast(`${wasNudge ? 'Nudge sent' : 'Sent'} to ${person(g.person_id).name}. (Demo: saved, not emailed.)`);
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
  else if (action === 'toggle-mail') { state.expanded['mail-' + id] = !state.expanded['mail-' + id]; renderPanel(); }
  else if (action === 'answer') { state.answers[id] = Number(t.dataset.index); delete state.edits[id]; renderPanel(); }
  else if (action === 'send') send(id);
});

document.addEventListener('input', (e) => {
  if (e.target.dataset?.action === 'edit') state.edits[e.target.dataset.id] = e.target.value;
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state?.openId) { state.openId = null; render(); }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('card')) { e.preventDefault(); openGoal(e.target.dataset.id); }
});

load().catch((err) => {
  el.board.innerHTML = `<p class="empty">The demo could not load. Please refresh the page.</p>`;
  console.error(err);
});

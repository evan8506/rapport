// Runs the six Gemini steps over the whole seed and returns what assemble() needs,
// plus the per-item records shown under "How Rapport decided".

import { ask, MODELS, SCHEMA, TOOLS, RULES } from './gemini-steps.mjs';
import { STAGES, advanceStage, isStuck } from '../../public/lib/rules.js';
import { renderDates, offsetOf } from '../../public/lib/dates.js';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function runGemini(seed, now = new Date(), log = console.log) {
  const at = (daysAgo) => new Date(now.getTime() - daysAgo * 86400000);
  const people = Object.fromEntries(seed.people.map((p) => [p.id, p]));
  const companies = Object.fromEntries(seed.companies.map((c) => [c.id, c]));
  const body = (m) => renderDates(m.body, now);
  const fromOf = (m) => (m.direction === 'out' ? `${seed.me.name} <${seed.me.email}> (me)` : m.from ? `${m.from.name} <${m.from.email}>` : `${people[m.person_id].name} <${people[m.person_id].email}>`);
  const toOf = (m) => (m.direction === 'out' ? `${people[m.person_id].name} <${people[m.person_id].email}>` : `${seed.me.name} (me)`);
  const mailText = (m) => `id: ${m.id}\nfrom: ${fromOf(m)}\nto: ${toOf(m)}\ndate: ${iso(at(m.days_ago))}\nsubject: ${m.subject}\n\n${body(m)}`;
  const today = `Today is ${iso(now)} (${now.toLocaleDateString('en-US', { weekday: 'long' })}). I am ${seed.me.name}, ${seed.me.title} at ${seed.me.company}.`;
  const stageList = Object.entries(STAGES).map(([k, v]) => `${k}: ${v.join(' > ')}`).join('\n');

  // ---------- 2. track: which work does each email belong to (chronological) ----------
  const track = {};
  const goals = new Map(); // id -> { id, title, kind, stage, turn, person_id, mail_ids, runs }
  const chrono = [...seed.mails].sort((a, b) => b.days_ago - a.days_ago);
  let n = 0;
  for (const m of chrono) {
    n++;
    const open = [...goals.values()].map((g) => `- ${g.id}: "${g.title}" (${g.kind}, stage ${g.stage}, turn ${g.turn}, with ${people[g.person_id].name} of ${companies[people[g.person_id].company_id].name})`).join('\n') || '(none yet)';
    const { output, run } = await ask({
      step: 'track',
      model: MODELS.heavy,
      system: `You sort a work inbox into pieces of work. ${today}\nKinds and their stages (pick stages only from these lists):\n${stageList}\nRules: an email continues an existing work item when it is about the same request, even from a colleague of the same company. Automated mail, newsletters, receipts and simple thank-you notes are work "none" with needs_reply false. turn is who must act next: "me" if I owe a reply or action, "them" if I am waiting on them, "none" when the work is finished.`,
      prompt: `Existing work items:\n${open}\n\nEmail:\n${mailText(m)}`,
      schema: SCHEMA.track,
      inputSummary: `${m.id} "${m.subject}" from ${fromOf(m)}; ${goals.size} work items so far`,
    });
    let gid = output.work;
    if (gid === 'new') {
      gid = `w${goals.size + 1}`;
      goals.set(gid, { id: gid, title: output.new_title || m.subject, kind: output.kind, stage: STAGES[output.kind][0], turn: output.turn, person_id: m.person_id, mail_ids: [], runs: [] });
    }
    if (gid !== 'none' && !goals.has(gid)) gid = 'none';
    if (gid === 'none' || !m.person_id) {
      track[m.id] = { needs_reply: false, goal: null, reason: output.reason };
      log(`[track ${n}/${chrono.length}] ${m.id} -> none`);
      continue;
    }
    const g = goals.get(gid);
    const stage = advanceStage(g.kind, g.stage, STAGES[g.kind].includes(output.stage) ? output.stage : g.stage);
    g.stage = stage;
    g.turn = output.turn;
    g.mail_ids.push(m.id);
    g.runs.push(run);
    track[m.id] = { needs_reply: output.needs_reply, goal: gid, kind: g.kind, stage, turn: output.turn, reason: output.reason, title: g.title, confidence: output.confidence };
    log(`[track ${n}/${chrono.length}] ${m.id} -> ${gid} "${g.title}" ${stage} turn ${output.turn}`);
  }

  // ---------- 1. identify: facts per person ----------
  const facts = {};
  const stageReason = {};
  await Promise.all(seed.people.map(async (p) => {
    const pm = seed.mails.filter((m) => m.person_id === p.id);
    const { output } = await ask({
      step: 'identify',
      model: MODELS.light,
      system: `You keep a short memory card about a business contact. ${today} Only keep facts whose evidence sentence is copied exactly from an email.`,
      prompt: `Contact: ${p.name}, ${p.title}, ${companies[p.company_id].name}\n\nEmails:\n\n${pm.map(mailText).join('\n\n---\n\n')}`,
      schema: SCHEMA.identify,
      inputSummary: `${pm.length} emails with ${p.name}`,
    });
    const all = pm.map(body).join('\n');
    facts[p.id] = (output.facts || []).filter((f) => all.includes(f.evidence)).map((f) => ({ fact: f.fact, kind: f.kind, evidence: f.evidence, source_mail_id: f.mail_id, status: 'unconfirmed' }));
    stageReason[p.id] = output.stage_reason;
    log(`[identify] ${p.name}: ${facts[p.id].length} facts`);
  }));

  // ---------- 3. plan, 4. prepare, 5. draft, 6. judge per work item ----------
  const plans = {};
  const extra = {};
  const kb = seed.knowledge_docs;
  await Promise.all([...goals.values()].map(async (g) => {
    const p = people[g.person_id];
    const gm = g.mail_ids.map((id) => seed.mails.find((m) => m.id === id));
    const thread = gm.map(mailText).join('\n\n---\n\n');

    const planRes = await ask({
      step: 'plan',
      model: MODELS.heavy,
      system: `You are an assistant who turns an email thread into a dated work plan. ${today}\nList the steps of this piece of work from start to finish: what already happened (done true) and what still has to happen, with who owns it (me, them, both). Use dates written in the emails (date_kind from_email). When a step has no written date, estimate one from the thread, the company terms or common practice and mark it estimated with a short note saying why. Include promises either side made, with their dates. 3 to 8 steps.`,
      prompt: `Work item: "${g.title}" (${g.kind}) with ${p.name}, ${companies[p.company_id].name}\nCompany terms:\n${kb.map((d) => `## ${d.title}\n${d.body}`).join('\n')}\n\nThread:\n\n${thread}`,
      schema: SCHEMA.plan,
      inputSummary: `${gm.length} emails in "${g.title}"`,
    });
    const allText = gm.map(body).join('\n');
    plans[g.id] = planRes.output.steps.map((s) => ({
      title: s.title,
      start: offsetOf(s.start, now),
      end: offsetOf(s.end || s.start, now),
      owner: s.owner,
      done: s.done,
      date_kind: allText.includes(s.evidence) ? s.date_kind : 'estimated',
      evidence: s.evidence,
      mail: s.mail_id,
      ...(s.note ? { note: s.note } : {}),
    }));
    g.runs.push(planRes.run);
    log(`[plan] ${g.title}: ${plans[g.id].length} steps`);

    const lastMove = (() => { let last = 0; let prev = null; for (const id of g.mail_ids) { const t = track[id]; const k = `${t.stage}|${t.turn}`; if (k !== prev) { last = seed.mails.find((m) => m.id === id).days_ago; prev = k; } } return last; })();
    const finished = g.turn === 'none';
    const stuck = !finished && isStuck({ status: 'open', turn: g.turn, last_moved_days_ago: lastMove });
    if (finished || (g.turn !== 'me' && !stuck)) return;
    const mode = g.turn === 'me' ? 'reply' : 'nudge';
    const latest = gm[gm.length - 1];

    const toolImpl = (name, args) => {
      if (name === 'get_contact') return { ...people[args.person_id], company: companies[people[args.person_id]?.company_id]?.name, facts: facts[args.person_id] || [] };
      if (name === 'get_history') return seed.mails.filter((m) => m.person_id === args.person_id).sort((a, b) => a.days_ago - b.days_ago).slice(0, args.limit || 5).map((m) => ({ id: m.id, direction: m.direction, date: iso(at(m.days_ago)), subject: m.subject, body: body(m) }));
      if (name === 'get_goal') return { id: g.id, title: g.title, kind: g.kind, stage: g.stage, plan: planRes.output.steps, emails: g.mail_ids };
      if (name === 'search_knowledge') {
        const words = String(args.query || '').toLowerCase().split(/\W+/).filter((w) => w.length > 2);
        return kb.map((d) => ({ doc: d.title, lines: d.body.split('\n').filter((l) => words.some((w) => l.toLowerCase().includes(w))) })).filter((d) => d.lines.length);
      }
      return { error: 'unknown tool' };
    };
    const prep = await ask({
      step: 'prepare',
      model: MODELS.heavy,
      system: `You prepare the next email for this piece of work. ${today}\nUse the tools to look up the contact (person_id "${p.id}"), history, the work item (goal_id "${g.id}") and the company knowledge base before deciding. Never ask the person what a lookup can answer. If a choice only the person can make blocks the reply (a discount, a price not in the price list), make it ONE question with 2-3 short answers. Mode: ${mode}.`,
      prompt: `Latest email:\n${mailText(latest)}`,
      schema: SCHEMA.prepare,
      tools: TOOLS,
      toolImpl,
      inputSummary: `${mode} for "${g.title}", latest ${latest.id}`,
    });
    g.runs.push(prep.run);

    const draftRes = await ask({
      step: 'draft',
      model: MODELS.heavy,
      system: `You write the email that moves this work to its next step. ${today}\nRules:\n${RULES.slice(0, 8).map((r, i) => `${i + 1}. ${r}`).join('\n')}\nPrices only from the price list found below. If a decision is still open, write around it and list it in unverified; also write one alternative body per answer option in options. Tone: ${p.tone}. Sign as ${seed.me.name.split(' ')[0]}. ${mode === 'nudge' ? 'This is a short, friendly nudge that restates the last request and the date they promised.' : ''}`,
      prompt: `Work item "${g.title}" (${g.kind}, stage ${g.stage}). Allowed next stages: ${STAGES[g.kind].join(', ')}\nPlan:\n${plans[g.id].map((s) => `- ${s.title} (${s.done ? 'done' : 'open'}, ${iso(at(-s.start))})`).join('\n')}\nLookups found:\n${(prep.output.found || []).join('\n')}\nQuestion for the person: ${prep.output.question?.text || 'none'} Options: ${(prep.output.question?.options || []).join(' | ')}\n\nThread:\n\n${thread}`,
      schema: SCHEMA.draft,
      inputSummary: `${mode} draft for "${g.title}"`,
    });
    g.runs.push(draftRes.run);

    const judge = await ask({
      step: 'judge',
      model: MODELS.light,
      system: 'You check a draft email against 10 rules. Judge strictly and give one short reason per rule.',
      prompt: `Rules:\n${RULES.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\nSources actually looked up: ${prep.run.tool_calls.map((c) => `${c.name}(${JSON.stringify(c.args)})`).join('; ') || 'none'}\nPrice list:\n${kb.find((d) => d.id === 'price-list').body}\n\nTheir latest email:\n${body(latest)}\n\nDraft:\n${draftRes.output.body}`,
      schema: SCHEMA.judge,
      inputSummary: `10 checks on the ${mode} draft`,
    });
    g.runs.push(judge.run);

    const q = prep.output.blocker === 'needs_decision' && prep.output.question?.text ? prep.output.question : null;
    extra[g.id] = {
      draft: {
        mode,
        body: draftRes.output.body,
        based_on: prep.output.sources || [],
        unverified: draftRes.output.unverified || [],
        attachment: prep.output.attachment || null,
        next_stage: draftRes.output.next_stage || null,
        question: q && draftRes.output.options?.length ? { text: q.text, options: draftRes.output.options.map((o) => ({ label: o.label, body: o.body, unverified: [] })) } : null,
        checks: judge.output.checks,
      },
    };
    log(`[draft] ${g.title}: ${mode}, ${judge.output.checks.filter((c) => c.verdict === 'fail').length} failed checks`);
  }));

  // Plain one-sentence summaries per step for the panel.
  for (const g of goals.values()) {
    for (const r of g.runs) r.summary = summaryFor(r);
  }
  return { track, plans, facts, stageReason, goals, extra };
}

function summaryFor(r) {
  const o = r.output || {};
  if (r.step === 'track') return `${o.reason || ''}`.trim();
  if (r.step === 'plan') return `Built a plan of ${o.steps?.length || 0} steps from the emails, with dates.`;
  if (r.step === 'prepare') return `Looked up ${r.tool_calls.map((c) => c.name).join(', ') || 'nothing'}. ${o.blocker === 'needs_decision' ? 'One decision is yours to make.' : ''}`.trim();
  if (r.step === 'draft') return 'Wrote the email that moves this work to its next step.';
  if (r.step === 'judge') { const f = (o.checks || []).filter((c) => c.verdict === 'fail').length; return f ? `${f} of ${o.checks.length} checks need your eye.` : `All ${o.checks?.length || 0} checks passed.`; }
  return '';
}

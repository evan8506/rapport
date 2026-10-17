import { STAGES, advanceStage, isFinalStage, relationshipStage, RELATIONSHIP_LABEL } from '../../public/lib/rules.js';

// Builds goals, stage history and relationship stages from per-mail track results.
export function assemble(seed, track, plans = {}) {
  const titles = Object.fromEntries(seed.expected_goals.map((g) => [g.key, g.title]));
  const mailsChrono = [...seed.mails].sort((a, b) => b.days_ago - a.days_ago);
  const goals = new Map();

  for (const m of mailsChrono) {
    const t = track[m.id];
    if (!t || !t.goal) continue;
    if (!STAGES[t.kind]) throw new Error(`${m.id}: unknown kind ${t.kind}`);
    let g = goals.get(t.goal);
    if (!g) {
      g = { id: t.goal, person_id: m.person_id, title: titles[t.goal] || t.goal, kind: t.kind, stage: STAGES[t.kind][0], turn: 'none', status: 'open', stage_history: [], mail_ids: [] };
      goals.set(t.goal, g);
    }
    const before = { stage: g.stage, turn: g.turn };
    g.stage = advanceStage(g.kind, g.stage, t.stage);
    g.turn = t.turn || g.turn;
    g.mail_ids.push(m.id);
    if (before.stage !== g.stage || before.turn !== g.turn || g.stage_history.length === 0) {
      g.stage_history.push({ stage: g.stage, turn: g.turn, days_ago: m.days_ago, mail_id: m.id, evidence: t.evidence || null });
    }
    if (isFinalStage(g.kind, g.stage) || t.turn === 'none') { g.status = 'done'; g.turn = 'none'; }
  }

  for (const g of goals.values()) {
    const last = g.stage_history[g.stage_history.length - 1];
    g.last_moved_days_ago = last.days_ago;
    g.latest_mail_id = g.mail_ids[g.mail_ids.length - 1];
    const lastIn = [...g.mail_ids].reverse().find((id) => seed.mails.find((m) => m.id === id).direction === 'in');
    g.their_latest_mail_id = lastIn || null;
    const prev = g.stage_history.length > 1 ? g.stage_history[g.stage_history.length - 2] : null;
    g.moved_reason = track[last.mail_id]?.reason || null;
    g.stage_change = prev && prev.stage !== last.stage ? { from: prev.stage, to: last.stage } : null;
    g.plan = (plans[g.id] || []).map((s) => ({ ...s }));
    g.draft = null;
    g.runs = [];
  }

  const goalList = [...goals.values()];
  const people = seed.people.map((p) => {
    const pm = seed.mails.filter((m) => m.person_id === p.id);
    const rel = relationshipStage(pm, goalList.filter((g) => g.person_id === p.id));
    return {
      ...p,
      stage: rel.stage,
      stage_label: RELATIONSHIP_LABEL[rel.stage],
      stage_reason: null,
      received_count: pm.filter((m) => m.direction === 'in').length,
      sent_count: pm.filter((m) => m.direction === 'out').length,
      first_contact_days_ago: rel.facts.first ?? null,
      last_contact_days_ago: rel.facts.last ?? null,
      facts: [],
    };
  });

  const mails = seed.mails.map(({ expected, ...m }) => ({ ...m, goal_id: track[m.id]?.goal || null, needs_reply: Boolean(track[m.id]?.needs_reply) }));
  const noReply = mails.filter((m) => m.direction === 'in' && !m.goal_id && !m.needs_reply).map((m) => m.id);

  return {
    generated_at: new Date().toISOString(),
    me: seed.me,
    companies: seed.companies,
    knowledge_docs: seed.knowledge_docs.map(({ id, title }) => ({ id, title })),
    people,
    mails,
    goals: goalList,
    no_reply_mail_ids: noReply,
  };
}

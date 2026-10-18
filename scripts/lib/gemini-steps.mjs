// The six Gemini steps Rapport runs once over the demo inbox.
// Each step is one structured-output call (JSON schema); "prepare" also uses function calling
// to look things up. Every call is recorded so the page can show "How Rapport decided".

import { GoogleGenAI } from '@google/genai';
import { STAGES } from '../../public/lib/rules.js';

export const MODELS = {
  heavy: process.env.RAPPORT_MODEL_HEAVY || 'gemini-3.8-flash',
  light: process.env.RAPPORT_MODEL_LIGHT || 'gemini-3.5-flash-lite',
};

let client = null;
export function gemini() {
  if (!client) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set. Put it in .env.');
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

// One structured call with retry on bad JSON. Returns { output, run }.
export async function ask({ step, model, system, prompt, schema, tools, toolImpl, inputSummary }) {
  const started = Date.now();
  const toolCalls = [];
  const contents = [{ role: 'user', parts: [{ text: prompt }] }];
  for (let attempt = 0; attempt < 8; attempt++) {
    const config = { systemInstruction: system, temperature: 0.2 };
    if (tools) config.tools = [{ functionDeclarations: tools }];
    else { config.responseMimeType = 'application/json'; config.responseJsonSchema = schema; }
    const res = await gemini().models.generateContent({ model, contents, config });
    const calls = res.functionCalls || [];
    if (calls.length && toolImpl) {
      contents.push(res.candidates[0].content);
      const parts = [];
      for (const c of calls) {
        const result = toolImpl(c.name, c.args || {});
        toolCalls.push({ name: c.name, args: c.args || {}, result_summary: summarize(result) });
        parts.push({ functionResponse: { name: c.name, response: { result } } });
      }
      contents.push({ role: 'user', parts });
      continue;
    }
    if (tools) {
      // Tools are done; ask for the final answer in the schema.
      contents.push(res.candidates[0].content);
      contents.push({ role: 'user', parts: [{ text: 'Now give the final answer as JSON only, matching the schema.' }] });
      const final = await gemini().models.generateContent({ model, contents, config: { systemInstruction: system, temperature: 0.2, responseMimeType: 'application/json', responseJsonSchema: schema } });
      return done(final.text);
    }
    return done(res.text);
  }
  // Enough lookups: ask for the answer with what has been found so far.
  contents.push({ role: 'user', parts: [{ text: 'Stop looking things up. Give the final answer as JSON only, matching the schema, using what you found.' }] });
  const final = await gemini().models.generateContent({ model, contents, config: { systemInstruction: system, temperature: 0.2, responseMimeType: 'application/json', responseJsonSchema: schema } });
  return done(final.text);

  function done(text) {
    let output;
    try { output = JSON.parse(text); } catch { throw new Error(`${step}: model did not return JSON`); }
    return { output, run: { step, model, input_summary: inputSummary, output, tool_calls: toolCalls, ms: Date.now() - started } };
  }
}

function summarize(v) {
  const s = JSON.stringify(v);
  return s.length > 300 ? s.slice(0, 297) + '...' : s;
}

// ---------------- schemas ----------------

const KINDS = Object.keys(STAGES);
const ALL_STAGES = [...new Set(Object.values(STAGES).flat())];

export const SCHEMA = {
  identify: {
    type: 'object',
    properties: {
      facts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            fact: { type: 'string' },
            kind: { type: 'string', enum: ['promise', 'deadline', 'preference', 'org_info'] },
            evidence: { type: 'string', description: 'exact sentence copied from the email' },
            mail_id: { type: 'string' },
          },
          required: ['fact', 'kind', 'evidence', 'mail_id'],
        },
      },
      stage_reason: { type: 'string', description: 'one plain sentence on how the relationship stands' },
    },
    required: ['facts', 'stage_reason'],
  },
  track: {
    type: 'object',
    properties: {
      needs_reply: { type: 'boolean' },
      work: { type: 'string', description: 'id of an existing work item, "new", or "none" for mail that is not part of any work' },
      new_title: { type: 'string', description: 'short title for a new work item, 1-4 words' },
      kind: { type: 'string', enum: KINDS },
      stage: { type: 'string', enum: ALL_STAGES },
      turn: { type: 'string', enum: ['me', 'them', 'none'] },
      reason: { type: 'string', description: 'one plain sentence a non-technical person understands' },
      confidence: { type: 'number' },
    },
    required: ['needs_reply', 'work', 'kind', 'stage', 'turn', 'reason', 'confidence'],
  },
  plan: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '2-6 words' },
            start: { type: 'string', description: 'YYYY-MM-DD' },
            end: { type: 'string', description: 'YYYY-MM-DD, same as start for a single day' },
            owner: { type: 'string', enum: ['me', 'them', 'both'] },
            done: { type: 'boolean' },
            date_kind: { type: 'string', enum: ['from_email', 'estimated'] },
            evidence: { type: 'string', description: 'exact sentence from an email that supports this step or its date' },
            mail_id: { type: 'string' },
            note: { type: 'string', description: 'optional, one short sentence, e.g. why a date is estimated' },
          },
          required: ['title', 'start', 'end', 'owner', 'done', 'date_kind', 'evidence', 'mail_id'],
        },
      },
    },
    required: ['steps'],
  },
  prepare: {
    type: 'object',
    properties: {
      blocker: { type: 'string', enum: ['missing_attachment', 'needs_lookup', 'needs_decision', 'needs_third_party', 'none'] },
      question: {
        type: 'object',
        properties: { text: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, evidence: { type: 'string' } },
      },
      attachment: { type: 'string' },
      found: { type: 'array', items: { type: 'string' }, description: 'facts found by the lookups, each naming its source' },
      sources: { type: 'array', items: { type: 'string' }, description: 'plain names of what was looked up, e.g. "price list", "Jane\'s last 3 emails"' },
    },
    required: ['blocker', 'found', 'sources'],
  },
  draft: {
    type: 'object',
    properties: {
      body: { type: 'string' },
      unverified: { type: 'array', items: { type: 'string' } },
      next_stage: { type: 'string', enum: ALL_STAGES },
      options: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, body: { type: 'string' } }, required: ['label', 'body'] } },
    },
    required: ['body', 'unverified'],
  },
  judge: {
    type: 'object',
    properties: {
      checks: {
        type: 'array',
        items: {
          type: 'object',
          properties: { rule: { type: 'string' }, verdict: { type: 'string', enum: ['pass', 'fail', 'n.a.'] }, evidence: { type: 'string' } },
          required: ['rule', 'verdict', 'evidence'],
        },
      },
    },
    required: ['checks'],
  },
};

export const TOOLS = [
  { name: 'get_contact', description: 'Person and company card with remembered facts', parameters: { type: 'object', properties: { person_id: { type: 'string' } }, required: ['person_id'] } },
  { name: 'get_history', description: 'Earlier emails with this person, newest first', parameters: { type: 'object', properties: { person_id: { type: 'string' }, limit: { type: 'integer' } }, required: ['person_id'] } },
  { name: 'get_goal', description: 'The work item: kind, stage, plan steps and its emails', parameters: { type: 'object', properties: { goal_id: { type: 'string' } }, required: ['goal_id'] } },
  { name: 'search_knowledge', description: 'Search the company price list, FAQ, manual and terms', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
];

export const RULES = [
  'Lead with the answer in the first sentence',
  'Cover what they will ask next (terms, dates, next step)',
  'Say how their stated conditions were handled',
  'Look things up before asking them',
  "Match the contact's tone",
  'A thank-you comes with a reason',
  'Shorter than their email',
  'No notes to self in the body',
  'Every cited source was actually looked up',
  'Every price comes from the price list',
];

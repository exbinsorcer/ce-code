// Answers rule questions by the rule's structure, not just shared words. Plain code, no AI.
// Today it reads "when" choices (before, after, at the time of) against a rule's conditions, and "may" or "shall"
// choices against what the rule allows or requires. It answers only when exactly one choice fits, and no other choice
// fits any part that holds the question's words.
import { ruleParts } from './check-rule-words.js?v=a32e38e3';
import { structureOf, openerOf, ideasOf } from './rule-structure.js?v=a32e38e3';

const notSure = (why) => ({ status: 'not-sure', choice: null, confidence: null, because: why, outside: false, evidence: [], why: [why] });
const share = (want, have) => (want.length ? want.filter((w) => have.has(w)).length / want.length : 0);

// A choice about timing: "Before the work is started". Its kind and its own words.
const timingOf = (text) => {
  const o = openerOf(text);
  if (!o || o.kind === 'where') return null;
  return { kind: o.kind, words: ideasOf(o.rest) };
};

// Does a timing choice fit one condition of this part? Same kind of opener, and at least half its words in that condition.
function timingFits(choice, part) {
  return part.structure.conditions.some((c) => c.kind === choice.kind && share(choice.words, new Set(ideasOf(c.text))) >= 0.5);
}

// f: the question. rules: [{ rule, text, page, title }] for the rules the walk leads to, best first.
export function checkRuleStructure(f, rules) {
  if (f.options.length < 2) return notSure('There are no answer choices to check.');
  const asked = ideasOf(f.stem);
  const parts = rules.flatMap((r) => ruleParts(r.rule, r.text).map((p) => ({ ...p, page: r.page, structure: structureOf(p.text, r.title || '') })))
    // A part is about the question only when it holds a good share of the question's words.
    .map((p) => ({ ...p, fit: share(asked, new Set(ideasOf(p.text))) }))
    .filter((p) => p.fit >= 0.4)
    // The rule must be about the same thing as the question: some word of its subject is in the question.
    .filter((p) => !p.structure.subject || ideasOf(p.structure.subject).some((w) => asked.includes(w)));
  if (!parts.length) return notSure('No rule part holds the question\'s words.');
  // Only the parts that hold the question's words best are read. A weaker part may be about something else.
  const top = Math.max(...parts.map((p) => p.fit));
  parts.splice(0, parts.length, ...parts.filter((p) => p.fit >= top * 0.9));
  if (new Set(parts.map((p) => p.rule)).size > 1 && new Set(parts.map((p) => p.rule)).size !== 1) {
    // Parts of different rules tie, so the question does not pick one rule.
    const rulesHit = [...new Set(parts.map((p) => p.rule))];
    if (rulesHit.length > 1) return notSure(`Rules ${rulesHit.slice(0, 2).join(' and ')} both hold the question's words.`);
  }

  const timings = f.options.map((o) => ({ o, t: timingOf(o.text) }));
  if (timings.filter((x) => x.t).length >= 2) {
    // Every choice must be a timing choice, so none is skipped unread.
    if (timings.some((x) => !x.t)) return notSure('Some choices are about timing and some are not.');
    const fits = timings.map((x) => ({ ...x, parts: parts.filter((p) => timingFits(x.t, p)) }));
    const good = fits.filter((x) => x.parts.length);
    if (good.length !== 1) return notSure(good.length ? `${good.length} choices fit the rule's conditions.` : 'No choice fits a condition of the rule.');
    const [{ o, t, parts: where }] = good;
    const part = where.sort((a, b) => b.fit - a.fit)[0];
    if (part.structure.exceptions.length) return notSure(`Rule ${part.rule} has an exception there, so it has to be read by hand.`);
    const name = `Rule ${part.rule}${part.label ? ` ${part.label}` : ''}`;
    return {
      status: 'answer',
      choice: o.letter,
      confidence: 'medium',
      because: `${name} says this happens ${t.kind === 'same' ? 'at the same time as' : t.kind} the step this choice names. The wording differs, so it takes one step of reading.`,
      evidence: [{ kind: 'rule', ref: part.rule, page: part.page ?? null, box: null }],
      why: [
        { head: `Read ${name}`, say: 'It holds the question\'s words.' },
        { head: 'Find the timing word', say: `Look for before, after or at the time in the rule. It says ${t.kind === 'same' ? 'at the same time' : t.kind}.` },
        { head: 'Match the step', say: `Only choice ${o.letter} names that step with that timing word.` },
      ],
      mistake: 'Picking a choice with the right step but the wrong timing word, such as after instead of before.',
    };
  }
  return notSure('The choices are not about timing.');
}

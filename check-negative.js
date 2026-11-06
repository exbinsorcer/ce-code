// Answers questions that turn on a negative: "which is not", "all except", and true or false statements with "not".
// Plain code, no AI. A negative is easy to get backwards, so it answers only when the rule part is clear:
// - "which is not" and "except": exactly one choice fails the part and every other choice is shown to pass it
// - true or false: the whole statement sits in one part with no exception, and the "not"s decide it
// Anything else stays not sure.
import { ruleParts, bestPart } from './check-rule-words.js?v=4aa3f35a';
import { ideasOf } from './rule-structure.js?v=4aa3f35a';

// What blocked the "not" check, as a short code app/checker.js reads.
const CODES = [[/no answer choices/, 'no-choices'], [/numbers are read/, 'numbers'], [/exception/, 'negative-exception'], [/only part/, 'part-match'], [/is not a "which is not"/, 'negative-statement'], [/above/, 'none-above'], [/clearly in or out/, 'negative-unclear']];
const codeOf = (why) => CODES.find(([re]) => re.test(String(why)))?.[1] || 'negative';
const notSure = (why) => ({ status: 'not-sure', choice: null, confidence: null, because: why, outside: false, evidence: [], why: [why], stuck: codeOf(why) });
const NEG = /\b(?:not|no|never|without|cannot|isn't|aren't|doesn't|don't)\b/gi;
const CATCH = /\b(?:except|unless|notwithstanding)\b/i;
const WHICH_NOT = /\b(?:which|what)\b[^?]*\b(?:not|except)\b|\ball\b[^?]*\bexcept\b|\bexcept\b[^?]*\?|\bnot\b[^?]*\bwhich\b/i;
const TRUE_FALSE = (o) => /^(?:true|false)$/i.test(o.text.trim());
const POINTING = /\b(?:all|none|both|neither)\s+of\s+the\s+above\b/i;
const negCount = (text) => (String(text).match(NEG) || []).length;
const share = (want, have) => (want.length ? want.filter((w) => have.has(w)).length / want.length : 0);

// f: the question. rules: [{ rule, text, page, title }] for the rules the walk leads to, best first.
export function checkNegative(f, rules) {
  if (f.options.length < 2) return notSure('There are no answer choices to check.');
  if (f.options.some((o) => /\d/.test(o.text))) return notSure('Choices with numbers are read by the number check.');
  const parts = rules.flatMap((r) => ruleParts(r.rule, r.text).map((p) => ({ ...p, page: r.page, name: `Rule ${r.rule}${p.label ? ` ${p.label}` : ''}` })));
  // The part is picked by the question without its negative words, so "not" does not steer it.
  const { part, why } = bestPart(String(f.stem).replace(NEG, ' '), parts);
  if (!part) return notSure(why);
  if (CATCH.test(part.text)) return notSure(`${part.name} has an exception there, so it has to be read by hand.`);
  const have = new Set(ideasOf(part.text));
  const evidence = [{ kind: 'rule', ref: part.rule, page: part.page ?? null, box: null }];

  if (f.options.length === 2 && f.options.every(TRUE_FALSE)) {
    // Every word of the statement must be in the part. A partial match with a "not" is far too easy to get backwards.
    const fit = share(ideasOf(f.stem), have);
    if (fit < 0.8) return notSure(`${part.name} holds only part of the statement.`);
    const same = negCount(f.stem) % 2 === negCount(part.text) % 2;
    const pick = f.options.find((o) => /^true$/i.test(o.text.trim()) === same);
    return {
      status: 'answer',
      choice: pick.letter,
      // The words match, but a negative was weighed, so it cannot be ruled out that the sense differs.
      confidence: 'low',
      because: `The statement's words are all in ${part.name}, and it ${same ? 'says the same' : 'says "not" where the rule does not, or the other way round'}. A negative is easy to misread, so this is rated low.`,
      evidence,
      why: [
        { head: `Read ${part.name}`, say: 'It holds every word of the statement.' },
        { head: 'Count the nots', say: same ? 'The statement and the rule agree.' : 'The statement turns the rule around, so it is false.' },
      ],
      mistake: 'Missing a "not". It flips the meaning.',
    };
  }

  if (!WHICH_NOT.test(f.stem)) return notSure('The question is not a "which is not" or "except" question.');
  if (f.options.some((o) => POINTING.test(o.text))) return notSure('"All" or "none of the above" cannot settle a negative.');
  // Each choice either passes (its words are in the part, with no "not" the part lacks) or fails (almost none are).
  const tested = f.options.map((o) => {
    const fit = share(ideasOf(o.text), have);
    const flipped = negCount(o.text) % 2 !== negCount(part.text) % 2 && negCount(o.text) > 0;
    return { o, pass: fit >= 0.7 && !flipped, fail: fit < 0.3 || (fit >= 0.7 && flipped) };
  });
  const fails = tested.filter((x) => x.fail);
  if (fails.length !== 1 || tested.some((x) => !x.pass && !x.fail)) return notSure('Not every choice is clearly in or out of the rule.');
  const [out] = fails;
  return {
    status: 'answer',
    choice: out.o.letter,
    confidence: 'medium',
    because: `Every other choice is named in ${part.name}, and only this one is not.`,
    evidence,
    why: [
      { head: `Read ${part.name}`, say: 'It holds the question\'s words.' },
      { head: 'Tick off each choice', say: `All the choices but ${out.o.letter} are in the rule. The question asks which is not.` },
    ],
    mistake: 'Picking a choice that is in the rule, because the question asks for the one that is not.',
  };
}

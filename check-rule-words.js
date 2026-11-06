// Answers rule questions whose choices are words, not numbers: true or false statements, word choices,
// and "all of the above". Plain code, no AI. It finds the one rule part that holds the question's words, then tests each
// choice against that part's own words. Anything unclear is "not sure", because a wrong answer is far worse.
// Number-with-unit choices belong to app/check-rules.js.
import { splitRule } from './check-rules.js?v=a32e38e3';
import { rootOf, rootsOf } from './check-situations.js?v=a32e38e3';

const LIGHT = new Set(['a', 'an', 'the', 'of', 'to', 'and', 'or', 'in', 'on', 'for', 'with', 'by', 'is', 'are', 'be', 'been', 'has', 'have', 'that', 'which', 'it', 'its', 'as', 'at', 'from', 'this', 'then', 'there', 'their', 'any', 'will', 'must', 'shall', 'may', 'can', 'if', 'when', 'after', 'before', 'only', 'all', 'above', 'following', 'code', 'ce', 'rule', 'electrical']);
const NEGATIVE = new Set(['not', 'no', 'never', 'nor', 'without', 'cannot']);
const CATCH = /\b(?:except|unless|notwithstanding)\b/i;
const roots = (text) => rootsOf(text).filter((w) => !LIGHT.has(w) && !NEGATIVE.has(w)).map(rootOf);
const negatives = (text) => rootsOf(text).filter((w) => NEGATIVE.has(w)).length;
const share = (want, have) => (want.length ? want.filter((w) => have.has(w)).length / want.length : 0);
// What blocked the word check, as a short code app/checker.js reads.
const CODES = [[/no answer choices/, 'no-choices'], [/numbers are read/, 'numbers'], [/both hold|fits nearly|choices fit|shares many words/, 'two-fit'], [/No rule holds/, 'no-rule-part'], [/exception/, 'negative'], [/only part/, 'part-match'], [/None of the above/, 'none-above'], [/No choice fits/, 'no-choice-fits']];
const codeOf = (why) => CODES.find(([re]) => re.test(String(why)))?.[1] || 'rule-unclear';
const notSure = (...why) => ({ status: 'not-sure', choice: null, confidence: null, because: why[0], outside: false, evidence: [], why, stuck: codeOf(why[0]) });

const TRUE_FALSE = (o) => /^(?:true|false)$/i.test(o.text.trim());
const ALL = /^all\s+of\s+the\s+above$/i;
const NONE = /^none\s+of\s+the\s+above$/i;

// Each rule split into parts, plus the whole rule, since a short rule may hold a list in one sentence.
export function ruleParts(rule, text) {
  const parts = splitRule(text).map((p) => ({ rule, label: p.path?.filter(Boolean).join(' ') || '', text: `${p.lead || ''} ${p.text}`.trim() }));
  return [{ rule, label: '', text: String(text).trim() }, ...parts.filter((p) => p.text && p.label)];
}

// The part that holds most of the question's words. It must clearly beat the best part of every other rule.
export function bestPart(stem, parts) {
  const want = roots(stem);
  const scored = parts.map((p) => ({ ...p, words: new Set(roots(p.text)) })).map((p) => ({ ...p, fit: share(want, p.words) })).sort((a, b) => b.fit - a.fit);
  const [best] = scored;
  if (!best || best.fit < 0.4) return { part: null, why: 'No rule holds most of the question\'s words.' };
  const rival = scored.find((p) => p.rule !== best.rule);
  if (rival && rival.fit * 1.25 > best.fit) {
    const pick = (rule, fit) => scored.filter((p) => p.rule === rule && p.fit === fit).sort((a, b) => a.text.length - b.text.length)[0];
    return { part: null, rivals: [pick(best.rule, best.fit), pick(rival.rule, rival.fit)], why: `${best.name || best.rule} and ${rival.name || rival.rule} both hold the question's words.` };
  }
  // A narrower part of the same rule that fits as well is the one meant.
  const narrow = scored.filter((p) => p.rule === best.rule && p.fit === best.fit).sort((a, b) => a.text.length - b.text.length)[0];
  return { part: narrow };
}

// f: the question, from findInBook. rules: [{ rule, text, page }] for the rules the walk leads to, best first.
export function checkRuleWords(f, rules) {
  if (f.options.length < 2) return notSure('There are no answer choices to check.');
  if (f.options.some((o) => /\d/.test(o.text) && !/^\s*rule\s/i.test(o.text))) return notSure('Choices with numbers are read by the number check.');
  const parts = rules.flatMap((r) => ruleParts(r.rule, r.text).map((p) => ({ ...p, page: r.page, name: `Rule ${r.rule}${p.label ? ` ${p.label}` : ''}` })));
  return checkParts(f, parts);
}

// Tests the choices against the one part that holds the question's words. Each part has rule (what it belongs to),
// name (how the reader finds it), text and page.
export function checkParts(f, parts) {
  if (f.options.length < 2) return notSure('There are no answer choices to check.');
  const { part, why, rivals } = bestPart(f.stem, parts);
  if (rivals) {
    // Two places hold the question's words. Accept only when both lead to the same choice, and rate it no higher than either.
    const [a, b] = rivals.map((p) => checkPart(f, p));
    if (a.status !== 'answer' || b.status !== 'answer' || a.choice !== b.choice) return notSure(why);
    const low = a.confidence === 'low' || b.confidence === 'low';
    return { ...a, confidence: low ? 'low' : a.confidence, because: `${a.because} ${rivals[1].name || rivals[1].rule} says the same.`, evidence: [...a.evidence, ...b.evidence] };
  }
  if (!part) return notSure(why);
  return checkPart(f, part);
}

function checkPart(f, part) {
  const where = part.name || `Rule ${part.rule}`;
  if (CATCH.test(part.text)) return notSure(`${where} has an exception in that part, so it has to be read by hand.`);
  const evidence = [{ kind: part.kind || 'rule', ref: part.kind === 'page' ? where : part.rule, page: part.page ?? null, box: null }];

  // True or false: the statement must sit in the part. Then the negatives decide it.
  if (f.options.length === 2 && f.options.every(TRUE_FALSE)) {
    if (part.fit < 0.7) return notSure(`${where} holds only part of the statement.`);
    const same = (negatives(f.stem) % 2) === (negatives(part.text) % 2);
    const pick = f.options.find((o) => /^true$/i.test(o.text.trim()) === same);
    return {
      status: 'answer',
      choice: pick.letter,
      confidence: 'medium',
      because: `The statement's words are in ${where}, and ${same ? 'it says the same thing' : 'one of them says "not" where the other does not'}. Matching it takes one step of reading.`,
      evidence,
      why: [
        { head: `Read ${where}`, say: 'It holds the words of the statement.' },
        { head: 'Look for not, no and never', say: same ? 'The statement and the rule agree.' : 'The statement turns the rule around, so it is false.' },
      ],
      mistake: same ? null : 'Missing the "not". It flips the meaning.',
    };
  }

  if (f.options.some((o) => NONE.test(o.text.trim()))) {
    // "None of the above" can only be proved by showing every choice is wrong, which word matching cannot do.
    const others = f.options.filter((o) => !NONE.test(o.text.trim()));
    if (!others.some((o) => share(roots(o.text), part.words) >= 0.7)) return notSure('"None of the above" cannot be proved by matching words.');
  }
  const plain = f.options.filter((o) => !ALL.test(o.text.trim()) && !NONE.test(o.text.trim()));
  const all = f.options.find((o) => ALL.test(o.text.trim()));
  const partNeg = negatives(part.text) % 2;
  const fits = (o) => share(roots(o.text), part.words) >= 0.7 && roots(o.text).length >= 1 && negatives(o.text) % 2 <= partNeg;
  const loose = (o) => share(roots(o.text), part.words) >= 0.4;
  const backed = plain.filter(fits);

  let pick;
  let say;
  let partial = false;
  if (all && plain.length >= 2 && backed.length === plain.length) {
    pick = all;
    say = `Every other choice is named in ${where}.`;
  } else {
    if (backed.length > 1) return notSure(`${backed.length} choices fit ${where}.`);
    if (backed.length === 1 && !plain.filter((o) => o !== backed[0] && loose(o)).length) {
      [pick] = backed;
      say = `Choice ${pick.letter} uses the words of ${where}. No other choice comes close.`;
    } else {
      // A partial match: the best choice shares at least half its words with the part and clearly more than any other.
      // That is real evidence, but another choice cannot be ruled out, so it is rated low.
      const scored = plain.map((o) => ({ o, fit: negatives(o.text) % 2 <= partNeg ? share(roots(o.text), part.words) : 0 })).sort((x, y) => y.fit - x.fit);
      if (scored[0].fit < 0.5 || scored[0].fit - (scored[1]?.fit ?? 0) < 0.3) return notSure(backed.length ? `Another choice shares many words with ${where}.` : `No choice fits ${where} closely.`);
      pick = scored[0].o;
      partial = true;
      say = `Choice ${pick.letter} shares the most words with ${where}, clearly more than any other, but not all of them.`;
    }
  }
  return {
    status: 'answer',
    choice: pick.letter,
    confidence: partial ? 'low' : 'medium',
    because: partial ? `${where} holds the question's words, and this choice matches it best, but only in part.` : `The choice's words are in ${where}, which holds the question's words. Matching them takes one step of reading.`,
    evidence,
    why: [
      { head: 'Find the rule', say: `${where} holds most of the question's words.` },
      { head: 'Compare each choice', say },
    ],
    mistake: null,
  };
}

// Gathers the text of the rules the walk leads to, best first, from the book's own index.
export function rulesFor(f, index, ready, limit = 4) {
  const out = [];
  for (const r of (f.rules || []).slice(0, limit)) {
    const text = (index.blocks || []).filter((b) => b.rule === r.rule).map((b) => b.text).join(' ');
    if (text) out.push({ rule: r.rule, text, page: ready.rules.get(r.rule)?.pdfPage ?? null, title: ready.rules.get(r.rule)?.title || '' });
  }
  return out;
}

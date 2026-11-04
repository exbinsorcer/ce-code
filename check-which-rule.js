// Answers "which rule" questions, where each choice is a rule number. Plain code, no AI.
// It reads each rule's own title and names a choice only when exactly one title is fully in the question.
import { rootOf, rootsOf } from './check-situations.js?v=005809e6';

const LIGHT = new Set(['a', 'an', 'the', 'of', 'to', 'and', 'or', 'in', 'on', 'for', 'with', 'by', 'general']);
const roots = (text) => rootsOf(text).filter((w) => !LIGHT.has(w)).map(rootOf);
const notSure = (...why) => ({ status: 'not-sure', choice: null, confidence: null, because: why[0], outside: false, evidence: [], why });
const RULE = /^\s*(?:rule\s+)?([A-Z]?\d{1,2}-\d{3,4})\s*$/i;

// f: the question, from findInBook. rules: the book's rules by number, each with a title and a PDF page.
export function checkWhichRule(f, rules) {
  const numbers = f.options.map((o) => o.text.match(RULE)?.[1]);
  if (numbers.some((n) => !n)) return notSure('Not every choice is a rule number.');
  const stem = new Set(roots(f.stem));
  const read = f.options.map((o, i) => {
    const r = rules.get(numbers[i]);
    const own = r?.title ? roots(r.title) : [];
    return { option: o, rule: numbers[i], r, fits: own.length >= 2 && own.every((w) => stem.has(w)) };
  });
  if (read.some((x) => !x.r?.title)) return notSure('A choice names a rule whose title could not be read.');
  const fit = read.filter((x) => x.fits);
  if (fit.length !== 1) return notSure(fit.length ? 'More than one rule title fits the question.' : 'No rule title fits the question fully.');
  const [best] = fit;
  return {
    status: 'answer',
    choice: best.option.letter,
    confidence: 'high',
    because: 'The rule\'s own title matches the question, and no other choice\'s title does.',
    evidence: [{ kind: 'rule', ref: best.rule, page: best.r.pdfPage ?? null, box: null }],
    why: [
      { head: 'Read each rule title', say: 'Look up each choice and read the title printed after its number.' },
      { head: `Rule ${best.rule}`, say: `Its title, ${best.r.title}, is fully in the question. No other title is.` },
    ],
    mistake: null,
  };
}

// Definition questions that need more than one word-for-word match:
// - a true or false statement about a defined term
// - combined choices such as "answer A and C apply", where the definition has several items
// Plain code, no AI. Anything unclear is "not sure".
import { rootOf, rootsOf } from './check-situations.js?v=344d272b';

const LIGHT = new Set(['a', 'an', 'the', 'of', 'to', 'and', 'or', 'in', 'on', 'for', 'with', 'by', 'is', 'are', 'be', 'that', 'which', 'it', 'its', 'as', 'at', 'from', 'this', 'any', 'etc', 'term', 'when', 'used', 'code', 'ce', 'refers', 'means', 'mean', 'considered', 'has', 'have', 'one', 'more', 'someone', 'place', 'places']);
const NEGATIVE = new Set(['not', 'no', 'never', 'without', 'cannot']);
const roots = (text) => rootsOf(text).filter((w) => !LIGHT.has(w) && !NEGATIVE.has(w)).map(rootOf);
const share = (want, have) => (want.length ? want.filter((w) => have.has(w)).length / want.length : 0);
const notSure = (why) => ({ status: 'not-sure', choice: null, confidence: null, because: why, outside: false, evidence: [], why: [why] });
const TRUE_FALSE = (o) => /^(?:true|false)$/i.test(o.text.trim());
const COMBINED = /^(?:answers?\s+)?([a-e])\s+(?:and|&)\s+([a-e])(?:\s+(?:both\s+)?apply)?\.?$/i;
// Words that say a definition is the whole list: "any", "only", "all" in a statement often widen or narrow it.
const WIDENS = /\b(?:any|every|all|always|only)\b/i;

// The defined term named whole in the statement. The longest one wins; two of the same length is not sure.
export function termIn(stem, defs) {
  const asked = new Set(roots(stem));
  const found = defs.filter((d) => {
    const own = roots(d.term);
    return own.length && own.every((w) => asked.has(w));
  }).sort((a, b) => roots(b.term).length - roots(a.term).length);
  if (!found.length) return null;
  if (found[1] && roots(found[1].term).length === roots(found[0].term).length) return null;
  return found[0];
}

// The items of a definition: a), b), c) and so on. A definition with no items is one item.
export function itemsOf(text) {
  const parts = String(text).split(/(?:^|\s)[a-h]\)\s+/).map((x) => x.trim()).filter(Boolean);
  return parts.length > 1 ? parts.slice(String(text).trim().match(/^[a-h]\)/) ? 0 : 1) : [String(text)];
}

// A statement about a definition. True only when the statement's own words are all in the definition and nothing widens
// it. False only when the statement claims the term is something narrower or wider: the definition needs words the
// statement leaves out, and the statement uses a widening word like "any". Everything else is not sure.
export function checkDefinitionStatement(f, defs) {
  if (!(f.options.length === 2 && f.options.every(TRUE_FALSE))) return notSure('Not a true or false question.');
  const def = termIn(f.stem, defs);
  if (!def) return notSure('No defined term is named in the statement.');
  const claim = roots(f.stem).filter((w) => !roots(def.term).includes(w));
  const have = new Set(roots(def.text));
  const fit = share(claim, have);
  const pick = (yes) => f.options.find((o) => /^true$/i.test(o.text.trim()) === yes);
  const negStem = rootsOf(f.stem).some((w) => NEGATIVE.has(w));
  if (negStem) return notSure('The statement has a "not", so it has to be read by hand.');
  let yes;
  if (fit === 1 && claim.length >= 2 && !WIDENS.test(f.stem)) yes = true;
  else if (WIDENS.test(f.stem) && claim.length && fit > 0 && roots(def.text).filter((w) => !claim.includes(w)).length >= 3) yes = false;
  else return notSure(`The statement only partly matches the definition of ${def.term}.`);
  return {
    status: 'answer',
    choice: pick(yes).letter,
    confidence: 'medium',
    because: yes ? `Every word of the statement is in the definition of ${def.term}.` : `The statement says "${f.stem.match(WIDENS)[0].toLowerCase()}", but the definition of ${def.term} asks for more than the statement gives.`,
    evidence: [{ kind: 'definition', ref: def.term, page: def.page, box: null }],
    why: [
      { head: `"${def.term.toLowerCase()}"`, say: 'It is a defined term, so read its definition in Section 0.' },
      { head: 'Compare', say: yes ? 'The definition says everything the statement says.' : 'The definition needs more than the statement, so the statement is too wide.' },
    ],
    mistake: yes ? null : 'Taking an everyday meaning instead of the Code\'s definition.',
  };
}

// Combined choices: "A and C apply". Each item of the definition is matched to at most one plain choice. The combined
// choice is picked only when it names exactly the matched choices, and every plain choice is either matched or clearly not.
export function checkCombined(f, defs) {
  const combined = f.options.map((o) => ({ o, m: o.text.trim().match(COMBINED) })).filter((x) => x.m);
  if (!combined.length) return notSure('No combined choice.');
  const def = termIn(f.stem, defs);
  if (!def) return notSure('No defined term is named in the question.');
  const items = itemsOf(def.text).map((t) => new Set(roots(t)));
  const plain = f.options.filter((o) => !combined.some((c) => c.o === o));
  const scored = plain.map((o) => ({ o, best: Math.max(...items.map((it) => share(roots(o.text), it))) }));
  if (scored.some((x) => x.best >= 0.3 && x.best < 0.5)) return notSure('A choice partly matches the definition.');
  const matched = scored.filter((x) => x.best >= 0.5).map((x) => x.o.letter).sort();
  if (matched.length < 2) return notSure('Fewer than two choices match the definition.');
  const hit = combined.filter((c) => [c.m[1], c.m[2]].map((l) => l.toUpperCase()).sort().join() === matched.join());
  if (hit.length !== 1) return notSure('No combined choice names exactly the matching choices.');
  return {
    status: 'answer',
    choice: hit[0].o.letter,
    confidence: 'medium',
    because: `The definition of ${def.term} has separate parts, and choices ${matched.join(' and ')} each match one of them.`,
    evidence: [{ kind: 'definition', ref: def.term, page: def.page, box: null }],
    why: [
      { head: `"${def.term.toLowerCase()}"`, say: 'Read every item of its definition, not just the first.' },
      { head: 'Match each choice', say: `Choices ${matched.join(' and ')} each match an item. So the choice naming both is right.` },
    ],
    mistake: `Stopping at the first item and picking ${matched[0]} alone.`,
  };
}

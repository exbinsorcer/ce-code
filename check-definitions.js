// Answers definition questions by comparing each choice with the definition's own words in Section 0.
// Plain code, no AI. It names a choice only when exactly one clearly fits. Anything else is "not sure".
import { rootOf, rootsOf } from './check-situations.js?v=344d272b';

const LIGHT = new Set(['a', 'an', 'the', 'of', 'to', 'and', 'or', 'in', 'on', 'for', 'with', 'by', 'is', 'are', 'be', 'that', 'which', 'it', 'its', 'as', 'at', 'from', 'term', 'referred', 'called', 'known', 'would', 'definition', 'means', 'mean', 'code', 'ce', 'when', 'used', 'this']);
const roots = (text) => rootsOf(text).filter((w) => !LIGHT.has(w)).map(rootOf);
const notSure = (...why) => ({ status: 'not-sure', choice: null, confidence: null, because: why[0], outside: false, evidence: [], why });
// Choices that point at other choices, or true and false, need more than one definition read side by side.
const POINTING = /\b(?:all|none|both|neither)\s+of\s+the\s+above\b|\banswers?\s+[a-e]\s+(?:and|&)\s+[a-e]\b|^(?:true|false)$/i;

// A definition's own text, with "see Energized" style pointers followed once.
function definitionOf(defs, term) {
  const d = defs.find((x) => x.term.toLowerCase() === term.toLowerCase());
  if (!d) return null;
  const see = d.text.match(/^see\s+([\p{L} -]+?)\.?$/iu);
  return see ? defs.find((x) => x.term.toLowerCase() === see[1].trim().toLowerCase()) || d : d;
}

const share = (want, have) => (want.length ? want.filter((w) => have.has(w)).length / want.length : 0);

// f: the question, from findInBook. defs: the book's definitions, each { term, text, page }.
export function checkDefinition(f, defs) {
  if (!defs?.length || f.options.length < 2) return notSure('No definitions to compare with.');
  if (f.options.some((o) => POINTING.test(o.text.trim()))) return notSure('A choice points to other choices or is true or false, so the definitions have to be read side by side by hand.');
  const stem = new Set(roots(f.stem));

  // The question describes something and the choices are short names. At least two must be defined terms.
  // A choice that is not defined cannot match a definition, so it never wins.
  const short = f.options.every((o) => rootsOf(o.text).length <= 4);
  const named = f.options.map((o) => ({ option: o, def: definitionOf(defs, o.text.trim().replace(/[.]$/, '')) })).filter((x) => x.def);
  if (short && named.length >= 2) {
    const scored = named.map((x) => ({ ...x, fit: share(roots(x.def.text), stem) })).sort((a, b) => b.fit - a.fit);
    const [best, next] = scored;
    if (best.fit < 0.6 || next.fit > best.fit / 2) return notSure('The description does not clearly match one definition.');
    return {
      status: 'answer',
      choice: best.option.letter,
      confidence: best.fit >= 0.9 ? 'high' : 'medium',
      because: best.fit >= 0.9 ? 'The question uses the definition\'s own words.' : 'Most of the definition\'s words are in the question, so it takes one step to match.',
      evidence: [{ kind: 'definition', ref: best.def.term, page: best.def.page, box: null }],
      why: [
        { head: 'Look in Section 0', say: 'Each choice is a defined term. Read their definitions.' },
        { head: best.def.term, say: 'Its definition uses the same words as the question.' },
      ],
      mistake: null,
    };
  }

  // The question names a term and the choices describe it. The longest defined term found whole in the question is meant.
  const found = defs.filter((d) => {
    const own = roots(d.term);
    return own.length && own.every((w) => stem.has(w));
  }).sort((a, b) => roots(b.term).length - roots(a.term).length);
  if (!found.length) return notSure('No defined term is named in the question.');
  if (found[1] && roots(found[1].term).length === roots(found[0].term).length) return notSure('Two defined terms are named in the question.');
  const def = definitionOf(defs, found[0].term);
  const have = new Set(roots(def.text));
  const scored = f.options.map((o) => ({ option: o, fit: share(roots(o.text), have), size: roots(o.text).length })).sort((a, b) => b.fit - a.fit);
  const [best, next] = scored;
  if (best.fit < 1 || best.size < 2 || next.fit >= 0.5) return notSure(`More than one choice shares words with the definition of ${def.term}, or none matches it fully.`);
  return {
    status: 'answer',
    choice: best.option.letter,
    confidence: 'high',
    because: 'Every word of this choice is in the definition, and no other choice comes close.',
    evidence: [{ kind: 'definition', ref: def.term, page: def.page, box: null }],
    why: [
      { head: `"${found[0].term.toLowerCase()}"`, say: 'It is a defined term, so look in Section 0.' },
      { head: 'Compare word for word', say: `Every word of choice ${best.option.letter} is in the definition. No other choice comes close.` },
    ],
    mistake: null,
  };
}

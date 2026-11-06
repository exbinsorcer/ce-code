// The question tree: which kind a question looks like, and the steps that break it down. Plain data, no AI.
// Every step comes from what findInBook found in the owner's book. Nothing here holds Code wording.
import { kindOf } from './calc/check.js?v=7e5a823c';

export const KINDS = [
  { k: 'tf', name: 'True or false', small: 'Two choices', icon: 'tf' },
  { k: 'mc', name: 'Multiple choice', small: 'Pick one letter', icon: 'list' },
  { k: 'calc', name: 'Calculation', small: 'Work out a number', icon: 'calc' },
  { k: 'rule', name: 'Find the rule', small: 'Name the place', icon: 'search' },
];
export const kindName = (k) => KINDS.find((x) => x.k === k)?.name ?? '';

// The way the course site marks a true or false question. The parser turns it into the two choices.
export const TRUE_FALSE_LINE = "['t' = True 'f' = False]";
const isTrueFalse = (options) => options.length === 2 && options.every((o) => /^(true|false)$/i.test(o.text.trim()));

export const CALCULATORS = { boxFill: 'Box fill', conduitFill: 'Conduit fill', motor: 'Motor circuit', dwelling: 'Dwelling load', correction: 'Corrected conductor size', ampacity: 'Corrected ampacity' };

// A guess only. The reader can pick any kind.
export function guessKind(f) {
  if (isTrueFalse(f.options)) return 'tf';
  if (kindOf(f.stem)) return 'calc';
  if (f.options.length >= 2) return 'mc';
  return 'rule';
}

// The question as it is checked. Picking true or false for a question with no choices adds the two choices.
export function askedText(text, kind, f) {
  return kind === 'tf' && !f.options.length ? `${text}\n${TRUE_FALSE_LINE}` : text;
}

// The numbers the question gives, with the word after each, like "4 conductors". Read from the question, never the book.
export function givenNumbers(stem) {
  return [...String(stem).matchAll(/(?<![\w.#])(#\s*)?(\d{1,3}(?:,\d{3})+|\d*\.\d+|\d+(?:\/0)?)\s*(°\s*C|%|[A-Za-z³²]+)?/g)]
    .map((m) => `${m[1] ? '#' : ''}${m[2]}${m[3] ? ` ${m[3].replace(/\s+/g, '')}` : ''}`)
    .slice(0, 8);
}

/* The steps, in the order they are walked. Each one is plain data:
   words: pick the key words. book: the book's own word for one of yours. given: what a math question gives.
   places: places to open, as boxes, plus one box to go on without opening any. Each place says where it leads (to), for the route check.
   note: a step with no places, just words. work: your own working for a math question.
   final: the answer choices. lockWork: a math question with no choices, locked in on its own. end: nothing to choose, so the walk stops at the places to read. needChoices: no choices to pick from. */
export function routeSteps(f, kind) {
  const steps = [{ id: 'words', type: 'words', ask: 'Which words matter?' }];
  if (f.bookWords.length) steps.push({ id: 'book', type: 'book', ask: 'Does the book use another word?', swaps: f.bookWords });
  if (f.definitions.length) {
    steps.push({
      id: 'defs', type: 'places', ask: 'Do you know every word?', why: 'If not, start with Definitions.', skip: 'I know them',
      places: f.definitions.map((d) => ({ title: d.term, page: d.page, icon: 'word', to: { term: d.term }, open: { type: 'definition', definition: d } })),
    });
  }
  const scope = [
    ...f.scope.specific.map((s) => ({ title: `Section ${s.section}`, extra: s.title, page: s.page, icon: 'list', tag: 'Specific', to: { section: s.section }, open: { type: 'section', section: s.section } })),
    ...f.scope.general.map((s) => ({ title: `Section ${s.section}`, extra: s.title, page: s.page, icon: 'list', tag: 'General', to: { section: s.section }, open: { type: 'section', section: s.section } })),
  ];
  steps.push({
    id: 'scope', type: scope.length ? 'places' : 'note', ask: 'General or specific?', skip: 'None of these',
    why: 'Sections 0 to 16 and 26 are general. The rest add to or change them, so read a specific one first if it fits.',
    note: scope.length ? 'Found through the Contents and Index' : 'None stand out. Try the Index next.', places: scope,
  });
  if (f.headings.length) {
    steps.push({
      id: 'contents', type: 'places', ask: 'Do these headings point to a section?', why: 'These come from the Contents.', skip: 'None of these',
      places: f.headings.map((h) => ({
        title: h.top ? `Section ${h.section}` : h.title, extra: h.top ? h.title : `Section ${h.section}`, page: h.page, icon: 'list', to: { section: h.section },
        open: h.top || !h.page ? { type: 'section', section: h.section } : { type: 'page', page: h.page, name: h.title, sub: `Section ${h.section}` },
      })),
    });
  }
  if (f.entries.length) {
    steps.push({
      id: 'index', type: 'places', ask: 'Look up your key words in the Index.', why: 'These entries match.', skip: 'None of these',
      places: f.entries.map((e) => ({ title: e.path.join(' › '), page: e.page, icon: 'search', refs: e.refs, to: { refs: e.refs }, open: { type: 'entry', entry: e } })),
    });
  }
  const titles = [
    ...f.tables.slice(0, 3).map((t) => ({ title: `Table ${t.label}`, extra: t.title, page: t.page, icon: 'table', to: { table: t.label }, open: { type: 'table', label: t.label } })),
    ...f.rules.slice(0, 5).map((r) => ({ title: `Rule ${r.rule}`, extra: r.title ?? 'Not sure', page: r.pdfPage, appendixB: r.appendixB, icon: 'rule', to: { rule: r.rule }, open: { type: 'rule', rule: r.rule } })),
  ];
  steps.push({
    id: 'titles', type: titles.length ? 'places' : 'note', ask: titles.length ? 'Does a title fit?' : 'I could not find a place for this',
    why: titles.length ? 'Check the title first. Read the rule only if it fits.' : 'Try other words, or check the Index by hand.',
    note: titles.length ? 'These are places to look, not the answer. Read the rule and decide.' : '', skip: 'None fit', places: titles,
  });
  if (kind === 'calc') {
    steps.push({ id: 'given', type: 'given', ask: 'What does the question give?', calculator: kindOf(f.stem), numbers: givenNumbers(f.stem) });
    steps.push({ id: 'work', type: 'work', ask: 'Your working', why: 'Break it into parts. Type each one.' });
  }
  if (f.options.length >= 2) steps.push({ id: 'final', type: 'final', ask: 'What is your final choice?', options: f.options });
  else if (kind === 'calc' && kindOf(f.stem)) steps.push({ id: 'lock', type: 'lockWork', ask: 'Lock it in' });
  else if (kind === 'mc') steps.push({ id: 'final', type: 'needChoices', ask: 'Where are the choices?' });
  else steps.push({ id: 'end', type: 'end', ask: 'Read it and decide' });
  return steps;
}

// Each picked box opens the next step under it. A box step goes on with "next".
export const NEXT = 'next';
export const SKIP = 'skip';

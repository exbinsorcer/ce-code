// The pattern book: the route each of your own questions took through the book, so you can learn the routes by heart.
// No DOM and no network. It keeps only your question and the route as numbers and your own words, never text from the book.
// It gives no score, no streak and no new questions.
import { wordsOf } from './rules.js?v=344d272b';

// What a question asks for, from its own words. The first that fits wins.
const ASKS = [
  ['meaning', /\b(what does .+ mean|meaning of|definition|define|is defined as|what is meant)\b/i],
  ['distance', /\b(how far|distance|clearance|spacing|apart|within what|how high|height|depth|deep|above grade|below grade)\b/i],
  ['size', /\b(what size|which size|minimum size|smallest|largest|how big|awg|kcmil|gauge|trade size)\b/i],
  ['rating', /\b(rating|rated|setting|ampacity|amps?|current|overcurrent|fuse|breaker|correction factor)\b/i],
  ['type', /\b(what type|which type|kind of|type of|which enclosure|enclosure type|what wiring method)\b/i],
  ['number', /\b(how many|number of|maximum number|percent|%)\b/i],
];
export const asksFor = (stem) => ASKS.find(([, re]) => re.test(stem))?.[0] ?? 'other';

// found: what findInBook gave. result: what checkQuestion gave, or null.
// The route: what it asks for, general or specific, the Index words used, and where it ended.
export function patternOf(found, result = null) {
  const asks = asksFor(found.stem);
  const scope = found.scope?.lean ?? null;
  const entry = found.entries?.[0] ?? null;
  // Only the question's own words that led to the Index entry are kept, not the entry's wording.
  const entryWords = entry ? new Set(wordsOf(entry.path.join(' '))) : new Set();
  const indexWords = entry ? found.keywords.filter((k) => wordsOf(k).some((w) => entryWords.has(w))) : [];
  const proof = result?.status === 'answer' || result?.status === 'worked' ? result.evidence?.find((e) => e.kind === 'table' || e.kind === 'rule') : null;
  const place = proof ? { kind: proof.kind, id: proof.ref } : found.places?.[0] ? { kind: found.places[0].kind, id: found.places[0].id } : null;
  const section = place?.kind === 'rule' ? Number(String(place.id).split('-')[0]) : (found.scope?.[scope]?.[0]?.section ?? null);
  const clear = Boolean(place && indexWords.length);
  return {
    key: [asks, scope ?? '-', indexWords.join(' ') || '-', place ? `${place.kind} ${place.id}` : '-'].join(' | '),
    asks, scope, section, indexWords, place, clear,
    sure: proof ? 'checked' : 'walk only',
    why: clear ? null : !place ? 'The walk did not reach one rule or table.' : 'No Index entry matched your words.',
  };
}

// Questions that share a route show as one pattern, most used first.
// list: [{ question, pattern }]
export function groupPatterns(list) {
  const groups = new Map();
  for (const item of list) {
    const k = item.pattern.clear ? item.pattern.key : `unclear | ${item.question}`;
    if (!groups.has(k)) groups.set(k, { key: k, pattern: item.pattern, questions: [] });
    groups.get(k).questions.push(item.question);
  }
  return [...groups.values()].sort((a, b) => Number(b.pattern.clear) - Number(a.pattern.clear) || b.questions.length - a.questions.length);
}

// A route's own name, so a miss can be remembered between drills.
export const routeKey = (pattern) => pattern.key || [pattern.asks, pattern.scope, pattern.place?.kind, pattern.place?.id].join(' | ');

// The routes to practise: clear ones only, the ones you have missed most first. Each uses its first saved question.
export function drillDeck(groups, missed = {}) {
  return groups.filter((g) => g.pattern.clear)
    .map((g) => ({ key: routeKey(g.pattern), question: g.questions[0], pattern: g.pattern }))
    .sort((a, b) => (missed[b.key] || 0) - (missed[a.key] || 0));
}

// A miss is kept until you get that route on the first try.
export function noteDrill(missed, key, hadIt) {
  const next = { ...missed };
  if (hadIt) delete next[key];
  else next[key] = (next[key] || 0) + 1;
  return next;
}

// The steps a reader retraces, in order.
export const STEPS = ['scope', 'index', 'place'];
const same = (a, b) => wordsOf(String(a ?? '')).join(' ') === wordsOf(String(b ?? '')).join(' ');

// Compares a route said from memory with the saved one. attempt: { scope, index, place: 'rule 12-510' or 'table 2' }.
// It says which step differed first. No score is given.
export function checkRetrace(pattern, attempt = {}) {
  const want = {
    scope: pattern.scope,
    index: pattern.indexWords.join(' '),
    place: pattern.place ? `${pattern.place.kind} ${pattern.place.id}` : null,
  };
  const steps = STEPS.map((step) => {
    const said = attempt[step] ?? null;
    let match;
    if (step === 'index') {
      const words = new Set(wordsOf(String(said ?? '')));
      match = pattern.indexWords.length > 0 && pattern.indexWords.every((w) => wordsOf(w).every((x) => words.has(x)));
    } else if (step === 'place') {
      const norm = (s) => String(s ?? '').toLowerCase().replace(/^(rule|table)\s*/, '$1 ').replace(/\s+/g, ' ').trim();
      match = want.place !== null && norm(said) === norm(want.place);
    } else match = want.scope !== null && same(said, want.scope);
    return { step, said, want: want[step], match };
  });
  const first = steps.find((s) => !s.match);
  return { steps, differs: first ? first.step : null };
}

/* ---------- Saving on this device ---------- */

const KEY = 'patterns';
// kv: an object with get(key) and set(key, value), like app/store.js gives. Nothing is sent anywhere.
export async function savePattern(kv, question, pattern) {
  const list = (await kv.get(KEY)) || [];
  const at = list.findIndex((x) => x.question === question);
  const item = { question, pattern, saved: Date.now() };
  if (at >= 0) list[at] = item;
  else list.push(item);
  await kv.set(KEY, list);
  return list;
}
export async function loadPatterns(kv) {
  return (await kv.get(KEY)) || [];
}
// The same calls, on this browser's own storage.
export async function deviceStore() {
  const store = await import('./store.js');
  return { get: (k) => store.kvGet(k), set: (k, v) => store.kvSet(k, v) };
}

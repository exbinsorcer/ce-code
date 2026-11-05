// Extras for the question tree, as plain data: your own working in a calculation, the route check after Lock it in,
// replaying a route from memory, and what's new. No DOM, no network, no AI, and no words from the book.
import { SKIP, NEXT } from './tree.js?v=344d272b';

/* ---------- Your own numbers ---------- */
// Each part is a sum you type yourself: a number, a sign, a number, and your answer.
export const SIGNS = ['×', '÷', '+', '−'];
export const MOST_PARTS = 4;
const blankPart = () => ({ a: '', op: '×', b: '', r: '' });
export const newWorking = () => ({ parts: [blankPart(), blankPart()], total: '' });
export const addPart = (work) => (work.parts.length < MOST_PARTS ? { ...work, parts: [...work.parts, blankPart()] } : work);

// A typed number, or null. "1,200" and "1 200" are twelve hundred; "2,5" is two and a half.
export function readNumber(s) {
  const t = String(s ?? '').trim().replace(/(\d)[ ,](?=\d{3}\b)/g, '$1').replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  return Number(t);
}
// What a part works out to, or null when a number is missing.
export function partValue(p) {
  const a = readNumber(p.a);
  const b = readNumber(p.b);
  if (a === null || b === null) return null;
  if (p.op === '÷') return b === 0 ? null : a / b;
  return { '×': a * b, '+': a + b, '−': a - b }[p.op] ?? null;
}
const near = (a, b) => Math.abs(a - b) <= Math.max(0.005 * Math.abs(b), 0.01);

// After Lock it in. A part is ticked when its own sum is right. The total is ticked against the book's worked number,
// and is "unsure" when there is no worked number to compare with. A box left empty gets no mark.
export function checkWorking(work, bookValue = null) {
  const parts = work.parts.map((p) => {
    const want = partValue(p);
    const got = readNumber(p.r);
    if (want === null || got === null) return { mark: null, want };
    return { mark: near(got, want) ? 'yes' : 'no', want };
  });
  const got = readNumber(work.total);
  let total = null;
  const wants = [bookValue].flat().filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (got !== null) total = wants.length ? (wants.some((v) => near(got, v)) ? 'yes' : 'no') : 'unsure';
  return { parts, total };
}

/* ---------- The route check ---------- */
const sectionOf = (rule) => {
  const m = /^(\d+)-\d/.exec(String(rule));
  return m ? Number(m[1]) : null;
};
const ruleNum = (rule) => String(rule).split('-').map(Number);
function inRange(rule, from, to) {
  const [s, n] = ruleNum(rule);
  const [fs, fn] = ruleNum(from);
  const [ts, tn] = ruleNum(to);
  return s >= fs && s <= ts && (s > fs || n >= fn) && (s < ts || n <= tn);
}

// The places the book used for an answer: its evidence, then the places from the answer list.
// seeRules(label) gives the rules a table names, so a table also says which section it belongs to.
// No answer, or no place to go by, gives null: the route is then not checked.
export function bookGoals(result, seeRules = () => []) {
  if (!result || (result.status !== 'answer' && result.status !== 'worked')) return null;
  const goals = { rules: new Set(), tables: new Set(), sections: new Set(), terms: new Set() };
  const all = [...(result.evidence || []).map((e) => ({ kind: e.kind, id: e.ref })), ...(result.places || [])];
  for (const { kind, id } of all) {
    if (!id) continue;
    if (kind === 'rule') {
      goals.rules.add(String(id));
      if (sectionOf(id) !== null) goals.sections.add(sectionOf(id));
    }
    if (kind === 'table') {
      goals.tables.add(String(id));
      for (const r of seeRules(String(id)) || []) if (sectionOf(r) !== null) goals.sections.add(sectionOf(r));
    }
    if (kind === 'definition') goals.terms.add(String(id).toLowerCase());
  }
  return goals.rules.size || goals.tables.size || goals.terms.size ? goals : null;
}

// Whether a place box leads to one of the book's places. to: what the box opens, from routeSteps.
export function leadsTo(to, goals) {
  if (!to || !goals) return false;
  if (to.rule) return goals.rules.has(String(to.rule));
  if (to.table) return goals.tables.has(String(to.table));
  if (to.term) return goals.terms.has(String(to.term).toLowerCase());
  if (to.section !== undefined) return goals.sections.has(Number(to.section));
  if (to.refs) {
    return to.refs.some((r) => (r.type === 'rule' && goals.rules.has(String(r.rule)))
      || (r.type === 'range' && [...goals.rules].some((g) => inRange(g, r.from, r.to)))
      || (r.type === 'table' && goals.tables.has(String(r.label)))
      || (r.type === 'section' && goals.sections.has(Number(r.section))));
  }
  return false;
}

// Each step where you picked a place gets a mark: "yes" when your pick leads to the book's place,
// "no" when another box did, and null (not sure) when no box on that step leads there.
// book: the first box that leads there, so it can be shown. Nothing is marked before Lock it in.
export function judgeRoute(steps, trail, goals) {
  if (!goals) return null;
  const out = [];
  steps.forEach((st, i) => {
    if (st.type !== 'places' || i >= trail.length) return;
    const picked = trail[i];
    const hits = st.places.map((p) => leadsTo(p.to, goals));
    const book = hits.findIndex(Boolean);
    const mine = picked !== SKIP && picked !== NEXT && hits[Number(picked)];
    // Definitions are only judged when a definition settled the answer.
    if (st.id === 'defs' && !goals.terms.size) return;
    const mark = mine ? 'yes' : book >= 0 ? 'no' : null;
    out.push({ i, id: st.id, picked, book: book >= 0 ? String(book) : null, mark });
  });
  return out;
}
export function routeScore(judged) {
  const marked = (judged || []).filter((s) => s.mark);
  return { right: marked.filter((s) => s.mark === 'yes').length, of: marked.length };
}

/* ---------- Replay from memory ---------- */
const STOP = new Set(['the', 'and', 'for', 'are', 'what', 'which', 'when', 'where', 'how', 'does', 'that', 'this', 'with', 'from', 'into', 'must', 'shall', 'may', 'not', 'can', 'should', 'would', 'there', 'their', 'have', 'has', 'used', 'use', 'any', 'all', 'each', 'one', 'two', 'per', 'than', 'then', 'type', 'kind', 'true', 'false', 'following', 'minimum', 'maximum']);
const plainWords = (text) => String(text).toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !STOP.has(w));
const placeName = (p) => (p ? `${p.kind === 'table' ? 'Table' : p.kind === 'rule' ? 'Rule' : 'Page'} ${p.id}` : null);

// A shuffle that always comes out the same for the same route, so the boxes stay put when drawn again.
function seeded(text) {
  let h = 2166136261;
  for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    return h / 4294967296;
  };
}
function shuffled(list, rnd) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
// One step: the right pick plus up to two wrong ones, all different. A step with no wrong pick is left out.
function step(name, right, wrongs, rnd) {
  const seen = new Set([right]);
  const picks = [];
  for (const w of wrongs) {
    if (!w || seen.has(w)) continue;
    seen.add(w);
    picks.push(w);
    if (picks.length === 2) break;
  }
  if (!right || !picks.length) return null;
  const opts = shuffled([right, ...picks], rnd);
  return { name, opts, ok: opts.indexOf(right) };
}
// Nearest numbers first, for wrong picks taken from the book's own list.
const nearest = (list, n) => [...list].sort((a, b) => Math.abs(a - n) - Math.abs(b - n));

// route: { key, question, pattern } from drillDeck. others: the other saved routes.
// book: { sections: [numbers], rules: [ids in book order], tables: [labels] }, only for wrong picks when there are too few routes.
export function replaySteps(route, others = [], book = {}) {
  const p = route.pattern;
  const rnd = seeded(route.key);
  const steps = [];
  const mine = new Set(p.indexWords.flatMap(plainWords));
  const loose = [...new Set(plainWords(route.question).filter((w) => !mine.has(w)))];
  const otherWords = others.map((o) => o.pattern.indexWords.join(', ')).filter(Boolean);
  steps.push(step('Which words matter?', p.indexWords.join(', '), [loose.slice(0, 2).join(', '), ...otherWords, loose.slice(2, 4).join(', ')], rnd));
  if (p.scope === 'general' || p.scope === 'specific') {
    steps.push(step('General or specific?', p.scope === 'general' ? 'General' : 'Specific', [p.scope === 'general' ? 'Specific' : 'General'], rnd));
  }
  if (Number.isFinite(p.section)) {
    const fromRoutes = others.map((o) => o.pattern.section).filter((s) => Number.isFinite(s) && s !== p.section);
    const fromBook = nearest((book.sections || []).filter((s) => s !== p.section), p.section);
    steps.push(step('Which section?', `Section ${p.section}`, [...fromRoutes, ...fromBook].map((s) => `Section ${s}`), rnd));
  }
  if (p.place) {
    const sameKind = others.map((o) => o.pattern.place).filter((x) => x && x.kind === p.place.kind).map(placeName);
    const anyKind = others.map((o) => placeName(o.pattern.place)).filter(Boolean);
    let fromBook = [];
    if (p.place.kind === 'rule' && book.rules?.length) {
      const at = book.rules.indexOf(String(p.place.id));
      const sec = sectionOf(p.place.id);
      const near = at >= 0 ? [book.rules[at - 1], book.rules[at + 1], book.rules[at - 2], book.rules[at + 2]] : book.rules.filter((r) => sectionOf(r) === sec);
      fromBook = near.filter(Boolean).map((r) => `Rule ${r}`);
    } else if (p.place.kind === 'table' && book.tables?.length) {
      const at = book.tables.indexOf(String(p.place.id));
      fromBook = [book.tables[at - 1], book.tables[at + 1], book.tables[at + 2]].filter(Boolean).map((t) => `Table ${t}`);
    }
    steps.push(step('Where does it end?', placeName(p.place), [...sameKind, ...fromBook, ...anyKind], rnd));
  }
  return steps.filter(Boolean);
}
// The routes to replay, the ones you have missed most first. A route needs at least two steps to be worth replaying.
export function replayDeck(deck, book = {}) {
  return deck.map((route) => ({ key: route.key, question: route.question, steps: replaySteps(route, deck.filter((o) => o.key !== route.key), book) }))
    .filter((r) => r.steps.length >= 2);
}
// A fresh replay, on its first route.
export const newReplay = (routes) => ({ type: 'replay', routes, r: 0, at: 0, open: false, wrong: [], missed: false, firstTry: 0 });
// One tap on a picked box. Gives the replay as it is after the tap.
export function replayPick(v, j) {
  const st = v.routes[v.r].steps[v.at];
  if (j === st.ok) return { ...v, at: v.at + 1, open: false, wrong: [], missed: false, firstTry: v.firstTry + (v.missed ? 0 : 1) };
  return v.wrong.includes(j) ? v : { ...v, wrong: [...v.wrong, j], missed: true };
}
export const replayDone = (v) => v.at >= v.routes[v.r].steps.length;

/* ---------- What's new ---------- */
// Shown once by itself after an update, and any time from the button. Change NEWS_ID when the list changes.
export const NEWS_ID = 'space-tree-round-2';
export const NEWS = [
  { id: 'tree', icon: 'search', title: 'Space tree', say: 'Your question splits into boxes you tap.', tab: 'find', tip: 'Paste a question and tap Break it down.' },
  { id: 'work', icon: 'calc', title: 'Your own numbers', say: 'Type each part of a calculation.', tab: 'find', tip: 'Paste a math question and pick Calculation.' },
  { id: 'route', icon: 'route', title: 'Route check', say: 'Ticks and crosses on your path.', tab: 'find', tip: 'Lock in an answer to see your route checked.' },
  { id: 'peek', icon: 'page', title: 'Peek the page', say: 'The page slides up over the tree.', tab: 'find', tip: 'Tap a place box to peek at its page.' },
  { id: 'replay', icon: 'repeat', title: 'Replay from memory', say: 'Practise a route as blank boxes.', tab: 'practice', tip: 'Finish a question in Find, and its route shows up here.' },
];
export const hasNews = (seen) => seen !== NEWS_ID;

// The tool's rules, with no screen code, so tests can check them.
export const TOTAL_PAGES = 972;

// Page starts come from the book's contents, checked against the PDF.
export const PLACES = [
  { k: 'def', n: 'Definitions', i: 'word', pdf: 59 },
  { k: 'rules', n: 'Rules', i: 'rule', pdf: 74 },
  { k: 'tables', n: 'Tables', i: 'size', pdf: 399 },
  { k: 'notes', n: 'Notes on Rules', i: 'why', pdf: 562 },
  { k: 'index', n: 'Index', i: 'lost', pdf: 936 },
];
export const placeOf = (k) => PLACES.find((p) => p.k === k);

export function splitWords(text) {
  return String(text)
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
}

export function newQuestion(text, now, id) {
  return {
    id, text: String(text).trim(), analyzed: false, route: null, misses: {}, tries: 0, got: 0, lastTried: null,
    createdAt: now, updatedAt: now, deleted: false,
  };
}

export function validPage(page, total = TOTAL_PAGES) {
  const s = String(page).trim();
  if (!/^\d+$/.test(s)) return false;
  const n = Number(s);
  return n >= 1 && n <= total;
}

export const STEP_NAMES = { clue: 'Picking the clue word', place: 'Where to look first', table: 'Finding the table or page', row: 'Picking the right row', answer: 'Reading the answer' };

export function patterns(questions) {
  const live = questions.filter((q) => !q.deleted);
  const routed = live.filter((q) => q.route && q.tries);
  const clues = routed.map((q) => ({ id: q.id, clue: q.route.clue || q.text, label: q.route.label, page: q.route.page }));
  const stuck = Object.keys(STEP_NAMES)
    .map((k) => ({ k, name: STEP_NAMES[k], count: routed.reduce((n, q) => n + (q.misses?.[k] || 0), 0) }))
    .filter((x) => x.count)
    .sort((a, b) => b.count - a.count);
  const practice = routed
    .filter((q) => q.tries > q.got)
    .map((q) => ({ id: q.id, text: q.text, missed: q.tries - q.got, tries: q.tries }))
    .sort((a, b) => b.missed - a.missed);
  return { clues, stuck, practice };
}

// Combining two devices: for each item, the newest change wins. Deleted items stay marked so they don't come back.
export function mergeById(local, incoming) {
  const all = new Map(local.map((x) => [x.id, x]));
  for (const x of incoming) {
    const have = all.get(x.id);
    if (!have || (x.updatedAt || 0) > (have.updatedAt || 0)) all.set(x.id, x);
  }
  return [...all.values()];
}

const BACKUP_KIND = 'ce-study-progress';

export function makeBackup(questions, bookmarks, now) {
  return JSON.stringify({ kind: BACKUP_KIND, version: 1, savedAt: now, questions, bookmarks }, null, 1);
}

const str = (v) => (typeof v === 'string' ? v : '');
const num = (v) => (Number.isFinite(v) ? v : 0);

function cleanQuestion(x) {
  const misses = {};
  for (const k of Object.keys(STEP_NAMES)) if (num(x.misses?.[k])) misses[k] = num(x.misses[k]);
  const r = x.route;
  return {
    id: str(x.id), text: str(x.text), analyzed: x.analyzed === true, misses,
    route: r && validPage(r.page) ? {
      kind: str(r.kind), label: str(r.label), page: Number(r.page), answer: r.answer ? str(r.answer) : null,
      clue: str(r.clue), ticked: Array.isArray(r.ticked) ? r.ticked.map(str) : [],
    } : null,
    tries: num(x.tries), got: num(x.got), lastTried: Number.isFinite(x.lastTried) ? x.lastTried : null,
    createdAt: num(x.createdAt), updatedAt: num(x.updatedAt), deleted: x.deleted === true,
  };
}

function cleanBookmark(x) {
  return { id: str(x.id), page: num(x.page), note: str(x.note), updatedAt: num(x.updatedAt), deleted: x.deleted === true };
}

// Returns null when the file isn't one of this tool's progress files.
export function readBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || data.kind !== BACKUP_KIND || !Array.isArray(data.questions)) return null;
  return {
    questions: data.questions.map(cleanQuestion).filter((q) => q.id && q.text),
    bookmarks: (Array.isArray(data.bookmarks) ? data.bookmarks : []).map(cleanBookmark).filter((b) => b.id && b.page >= 1),
  };
}

export function normalizeText(s) {
  return String(s)
    .normalize('NFKC')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// pages: normalized page text, first page at index 0.
export function searchPages(pages, query, maxResults = 200) {
  const q = normalizeText(query);
  if (!q) return { total: 0, results: [] };
  const results = [];
  let total = 0;
  pages.forEach((text, i) => {
    const at = text.indexOf(q);
    if (at < 0) return;
    total++;
    if (results.length >= maxResults) return;
    let hits = 0;
    for (let from = at; from >= 0; from = text.indexOf(q, from + q.length)) hits++;
    results.push({
      page: i + 1, hits,
      before: text.slice(Math.max(0, at - 40), at),
      match: text.slice(at, at + q.length),
      after: text.slice(at + q.length, at + q.length + 50),
    });
  });
  return { total, results };
}

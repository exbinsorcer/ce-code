// Finds answers in the book and builds the guided steps. No AI: it only reports what the book's own text shows.
// book = { norm: [page text, lower case], raw: [page text], lines: async (page) => [{ y, items: [{ x, str }] }], total }
import { normalizeText } from './logic.js?v=026f7ebb';

const STOP = new Set(`a about an and any are as at be been being but by can could do does for from had has have how i if in into is it
its may me must my no not of on or our shall should so than that the their them then there these they this to under up us was we were
what when where which while who whom why will with would you your`.split(/\s+/));

const stem = (w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const tokens = (s) => normalizeText(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const keyWords = (s) => [...new Set(tokens(s).filter((w) => !STOP.has(w) && w.length > 2 && !/^\d+$/.test(w)))];
const stems = (s) => new Set(tokens(s).filter((w) => !STOP.has(w)).map(stem));

export function shuffled(list, rand = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- Reading what you pasted ---------- */
export function parseQuestion(raw) {
  const lines = String(raw).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const stemLines = [];
  const options = [];
  for (const line of lines) {
    const m = line.match(/^\(?([A-Ha-h])[).:]\s*(.*)$/);
    if (m) options.push({ letter: m[1].toUpperCase(), text: m[2] });
    else if (options.length) {
      const last = options[options.length - 1];
      last.text = `${last.text} ${line}`.trim();
    } else if (!/^question\s*\d*\s*(options)?\s*:?$/i.test(line)) stemLines.push(line);
  }
  const usable = options.filter((o) => o.text);
  return { stem: stemLines.join(' '), options: usable.length >= 2 ? usable : [] };
}

/* ---------- How rare each word is ---------- */
export function wordCounts(norm) {
  const counts = new Map();
  for (const text of norm) for (const w of new Set(tokens(text).map(stem))) counts.set(w, (counts.get(w) || 0) + 1);
  return counts;
}

function bestPages(words, book, counts, limit) {
  const scored = [];
  book.norm.forEach((text, i) => {
    const on = new Set(tokens(text).map(stem));
    let score = 0;
    for (const w of words) if (on.has(stem(w))) score += 1 / Math.log(2 + (counts.get(stem(w)) || 1));
    if (score) scored.push({ page: i + 1, score });
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/* ---------- Tables made of ticks ---------- */
const TICK = /^[✓✔✗✘xX]$/;
const CELL = /^[✓✔✗✘xX—–-]$/;
const IS_TICK = (c) => /^[✓✔xX]$/.test(c);
const HEAD = /^\d{1,2}[A-Z]{0,3}$/;
const FOOTNOTE_MARKS = /[*†‡§]+$/;

function cellsOf(line) {
  const parts = [];
  for (const it of [...line.items].sort((a, b) => a.x - b.x)) {
    let x = it.x;
    for (const word of it.str.split(/\s+/).filter(Boolean)) {
      // Footnote marks sit on a column's name, as in 12K with a dagger. The name itself is what matters here.
      const p = /^\d/.test(word) ? word.replace(FOOTNOTE_MARKS, '') : word;
      parts.push({ x, t: p });
      x += p.length * 4;
    }
  }
  return parts;
}

export function readTickTable(lines) {
  const parsed = lines.map((l) => ({ y: l.y, parts: cellsOf(l) }));
  const heads = parsed.filter((l) => l.parts.filter((p) => HEAD.test(p.t)).length >= 4)
    .map((l) => ({ y: l.y, cols: l.parts.filter((p) => HEAD.test(p.t)).map((p) => p.t) }));
  if (!heads.length) return null;
  const rows = [];
  for (const l of parsed) {
    let start = l.parts.length;
    while (start > 0 && CELL.test(l.parts[start - 1].t)) start--;
    const cells = l.parts.slice(start).map((p) => p.t);
    if (cells.length < 4 || !cells.some((c) => TICK.test(c))) continue;
    const head = heads.filter((h) => h.y > l.y).sort((a, b) => a.y - b.y).find((h) => h.cols.length === cells.length)
      || heads.find((h) => h.cols.length === cells.length);
    if (!head) continue;
    rows.push({ y: l.y, label: l.parts.slice(0, start).map((p) => p.t).join(' '), cols: head.cols, cells });
  }
  if (!rows.length) return null;
  // Row names can wrap above or below their ticks, so each spare line joins the nearest row.
  for (const l of parsed) {
    if (rows.some((r) => r.y === l.y) || heads.some((h) => h.y === l.y)) continue;
    const text = l.parts.filter((p) => !CELL.test(p.t)).map((p) => p.t).join(' ');
    if (!text || l.parts.length > 16) continue;
    const near = [...rows].sort((a, b) => Math.abs(a.y - l.y) - Math.abs(b.y - l.y))[0];
    if (Math.abs(near.y - l.y) > 14) continue;
    near.extra = near.extra || [];
    near.extra.push({ y: l.y, text });
  }
  for (const r of rows) {
    const parts = [...(r.extra || []), { y: r.y, text: r.label }].sort((a, b) => b.y - a.y);
    r.label = parts.map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim();
    delete r.extra;
  }
  return rows.filter((r) => r.label);
}

// The share of a row's own words the question also uses. A row that adds other conditions scores lower.
function rowFit(label, questionStems) {
  const own = [...stems(label)];
  if (!own.length) return 0;
  return own.filter((w) => questionStems.has(w)).length / own.length;
}

const optionToken = (text) => {
  const named = text.match(/type\s+([0-9]+[a-z]{0,3})\b/i);
  if (named) return named[1].toUpperCase();
  const only = text.trim().match(/^([0-9]+[a-z]{0,3})$/i);
  return only ? only[1].toUpperCase() : null;
};

const tableLabel = (raw) => raw.match(/Table\s+\d+[A-Z]?/)?.[0]?.replace(/\s+/, ' ') || null;

async function tryTable(q, book, counts) {
  const words = keyWords(q.stem);
  const qStems = stems(q.stem);
  for (const { page } of bestPages(words, book, counts, 12)) {
    const rows = readTickTable(await book.lines(page));
    if (!rows?.length) continue;
    const ranked = rows.map((r) => ({ r, fit: rowFit(r.label, qStems) })).sort((a, b) => b.fit - a.fit);
    const top = ranked[0];
    if (top.fit < 0.6 || (ranked[1] && top.fit - ranked[1].fit < 0.1)) continue;
    const ticked = top.r.cols.filter((_, i) => IS_TICK(top.r.cells[i]));
    const base = {
      kind: 'table', page, label: tableLabel(book.raw[page - 1]) || 'this table', rows: ranked, row: top.r, ticked,
      footnotes: /[†‡§]/.test(book.raw[page - 1]),
    };
    if (q.options.length) {
      const hits = q.options.filter((o) => ticked.includes(optionToken(o.text)));
      if (!q.options.every((o) => optionToken(o.text)) || hits.length !== 1) continue;
      return { ...base, answer: hits[0].letter };
    }
    if (ticked.length === 1) return { ...base, answer: null };
  }
  return null;
}

/* ---------- Definitions ---------- */
export function readDefinitions(pageTexts, firstPage) {
  const out = [];
  const find = /(?:^|[.\s])([A-Z][\p{L}\p{N} ,()'-]{0,70}?) ?— ?/gu;
  pageTexts.forEach((text, i) => {
    const clean = text.replace(/\s+/g, ' ');
    let m;
    const here = [];
    while ((m = find.exec(clean))) here.push({ term: m[1].trim(), from: m.index + m[0].length, at: m.index });
    here.forEach((d, n) => {
      const body = clean.slice(d.from, n + 1 < here.length ? here[n + 1].at + 1 : clean.length).trim();
      out.push({ term: d.term, text: body, page: firstPage + i });
    });
  });
  return out.filter((d) => d.text.length >= 15);
}

const DEFINE = /(?:definition of|definition for|define|meaning of|what does|what is meant by|what is an?|what are)\s+(?:the\s+|a\s+|an\s+)?["']?([\p{L}\p{N} -]+?)["']?(?:\s+mean)?\s*\?*$/iu;
const defRange = (book) => (book.total === 972 ? [59, 73] : [1, book.total]);

function tryDefinition(q, book) {
  const asked = q.stem.match(DEFINE)?.[1];
  if (!asked) return null;
  const [a, b] = defRange(book);
  const defs = readDefinitions(book.raw.slice(a - 1, b), a);
  const want = [...tokens(asked)].map(stem).join(' ');
  const hit = defs.find((d) => tokens(d.term).map(stem).join(' ') === want);
  if (!hit) return null;
  let answer = null;
  if (q.options.length) {
    const own = stems(hit.text);
    const fit = q.options.map((o) => {
      const s = [...stems(o.text)];
      return { o, fit: s.length ? s.filter((w) => own.has(w)).length / s.length : 0 };
    }).sort((x, y) => y.fit - x.fit);
    if (fit[0].fit < 0.6 || (fit[1] && fit[0].fit - fit[1].fit < 0.2)) return null;
    answer = fit[0].o.letter;
  }
  return { kind: 'def', page: hit.page, label: hit.term, def: hit, others: defs.filter((d) => d !== hit), answer };
}

/* ---------- Guided steps ---------- */
function clueStep(q, found, book, counts, rand) {
  const words = keyWords(q.stem).filter((w) => counts.has(stem(w)));
  if (words.length < 3) return null;
  const onPage = new Set(tokens(book.norm[found.page - 1]).map(stem));
  const rare = (w) => counts.get(stem(w)) || 0;
  const byRare = [...words].sort((x, y) => rare(x) - rare(y));
  const clue = byRare.find((w) => onPage.has(stem(w)));
  if (!clue) return null;
  const common = byRare.filter((w) => w !== clue).reverse().slice(0, 3);
  return {
    kind: 'clue', clue, title: 'Which word is the best clue?',
    hint: 'Pick the word used in the fewest places in the book.',
    teach: `"${clue}" is on ${rare(clue)} page${rare(clue) === 1 ? '' : 's'}. "${common[0]}" is on ${rare(common[0])}. Rare words get you there faster.`,
    choices: shuffled([{ t: clue, ok: true }, ...common.map((t) => ({ t, ok: false }))], rand),
  };
}

const PLACE_CHOICES = ['Definitions', 'Rules', 'Tables', 'Notes on Rules', 'Index'];
function placeStep(found, rand) {
  const right = found.kind === 'def' ? 'Definitions' : 'Tables';
  return {
    kind: 'place', title: 'Where do you look first?',
    hint: found.kind === 'def' ? 'The question asks what a word means.' : 'The question compares types against a condition.',
    teach: found.kind === 'def' ? 'Asking what a word means points to Section 0, Definitions.' : 'Comparing things against a condition usually means a table.',
    choices: shuffled(PLACE_CHOICES.map((t) => ({ t, ok: t === right })), rand),
  };
}

function tableStep(found, book, rand) {
  const labels = new Set();
  for (const text of book.raw) for (const m of text.matchAll(/Table\s+(\d+[A-Z]?)/g)) labels.add(`Table ${m[1]}`);
  labels.delete(found.label);
  return {
    kind: 'table', title: 'Which table has it?', open: found.page,
    hint: `Search your clue word, or open the book at PDF page ${found.page}.`,
    teach: `${found.label} is on PDF page ${found.page}. Look at it now.`,
    choices: shuffled([{ t: found.label, ok: true }, ...shuffled([...labels], rand).slice(0, 3).map((t) => ({ t, ok: false }))], rand),
  };
}

function rowStep(q, found, rand) {
  const decoys = found.rows.slice(1, 4).map((x) => ({ t: x.r.label, ok: false }));
  return {
    kind: 'row', title: 'Which row matches the question?', open: found.page,
    hint: 'Choose the row that matches every condition in the question, with nothing extra.',
    teach: 'This row matches the conditions in your question. Similar rows can tick different columns.',
    choices: shuffled([{ t: found.row.label, ok: true }, ...decoys], rand),
  };
}

function answerStep(q, found, rand) {
  const list = q.options.length ? q.options.map((o) => ({ t: `${o.letter}) ${o.text}`, ok: o.letter === found.answer }))
    : shuffled([...new Set(found.row.cols)].filter((c) => c !== found.ticked[0]), rand).slice(0, 3).map((t) => ({ t, ok: false })).concat({ t: found.ticked[0], ok: true });
  return {
    kind: 'answer', title: 'Now read across. Which one is right?', open: found.page,
    hint: 'Find the row, then see which column has the tick.',
    teach: `Ticked in that row: ${found.ticked.join(', ')}. Source: ${found.label}, PDF page ${found.page}.${found.footnotes ? ' This table has footnotes. Read them on the page.' : ''}`,
    choices: q.options.length ? list : shuffled(list, rand),
  };
}

function defPageStep(found, rand) {
  const near = [-2, -1, 1, 2].map((d) => found.page + d).filter((p) => p >= 59 || p > 0);
  return {
    kind: 'table', title: `Definitions run A to Z. Which page has "${found.label}"?`, open: found.page,
    hint: `Open the book and flip by first letter. Start near PDF page ${found.page}.`,
    teach: `"${found.label}" is on PDF page ${found.page}.`,
    choices: shuffled([{ t: `PDF page ${found.page}`, ok: true }, ...shuffled(near, rand).slice(0, 3).map((p) => ({ t: `PDF page ${p}`, ok: false }))], rand),
  };
}

function defAnswerStep(q, found, rand) {
  const list = q.options.length ? q.options.map((o) => ({ t: `${o.letter}) ${o.text}`, ok: o.letter === found.answer }))
    : shuffled([{ t: found.def.text, ok: true }, ...shuffled(found.others, rand).slice(0, 3).map((d) => ({ t: d.text, ok: false }))], rand);
  return {
    kind: 'answer', title: `Which is the definition of "${found.label}"?`, open: found.page,
    hint: 'Open the page and read the entry for this word.',
    teach: `Source: Section 0, Definitions, PDF page ${found.page}.`,
    choices: list,
  };
}

/* ---------- Putting it together ---------- */
export async function analyze(rawQuestion, book, counts, rand = Math.random) {
  const q = parseQuestion(rawQuestion);
  if (!q.stem) return { confirmed: false, q, pages: [] };
  const found = tryDefinition(q, book) || (await tryTable(q, book, counts));
  if (!found) return { confirmed: false, q, pages: bestPages(keyWords(q.stem), book, counts, 3).map((p) => p.page) };
  const steps = [clueStep(q, found, book, counts, rand), placeStep(found, rand)];
  if (found.kind === 'table') steps.push(tableStep(found, book, rand), rowStep(q, found, rand), answerStep(q, found, rand));
  else steps.push(defPageStep(found, rand), defAnswerStep(q, found, rand));
  return {
    confirmed: true, q, steps: steps.filter(Boolean),
    route: {
      kind: found.kind, label: found.label, page: found.page, answer: found.answer,
      clue: steps[0]?.clue || '', ticked: found.ticked || [],
    },
    rowCount: found.rows?.length || 0,
  };
}

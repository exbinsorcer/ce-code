// A map of the book's own signposts: contents, table list, tables, definitions, Appendix B notes and the index.
// It is built from the PDF on the device each time the book opens, held in memory, and never saved.
import { startsBold, wordsOf, compareRules } from './rules.js?v=005809e6';

const MARKS = /^[\sΔ∆▲△●○■□◆◇*†‡§•]+/u;
const RULE = /(?<![\p{L}\p{N}-])(\d{1,2})\s?[-‐‑–]\s?(\d{3,4})(?![\p{N}-])/gu;
const tidy = (t) => t.replace(MARKS, '').replace(/\s+/g, ' ').trim();
const ruleId = (m) => `${Number(m[1])}-${m[2]}`;

const REF_START = /(?:^|\s)(?=(?:Sections?\s+\d|Tables?\s+D?\d|Appendi(?:x|ces)\s+[A-Z]|Diagrams?\s+D?\d|See\b|\d{1,2}-\d{3,4}\b))/;

// Splits an index line into its words and the places it points to.
export function parseIndexRefs(text) {
  const refs = [];
  let mode = null;
  const see = text.match(/\bSee(?:\s+also)?\s+(.+)$/);
  const body = see ? text.slice(0, see.index) : text;
  if (see) refs.push({ type: 'see', term: see[1].replace(/[.,]$/, '').trim() });
  for (const raw of body.split(/,|\band\b/)) {
    const piece = raw.trim();
    if (!piece) continue;
    const section = piece.match(/^Sections?\s+(\d{1,2})(?:\s+to\s+(\d{1,2}))?/);
    if (section) {
      refs.push({ type: 'section', section: Number(section[1]) });
      mode = 'section';
      continue;
    }
    const app = piece.match(/^Appendi(?:x|ces)\s+([A-Z])/);
    if (app) {
      refs.push({ type: 'appendix', letter: app[1] });
      mode = 'appendix';
      continue;
    }
    const ruleBits = [...piece.matchAll(RULE)];
    if (ruleBits.length) {
      if (ruleBits.length >= 2 && /\bto\b/.test(piece)) refs.push({ type: 'range', from: ruleId(ruleBits[0]), to: ruleId(ruleBits[1]) });
      else for (const m of ruleBits) refs.push({ type: 'rule', rule: ruleId(m) });
      mode = 'rule';
      continue;
    }
    const named = piece.match(/^(Tables?|Diagrams?)\s+(D?\d+[A-Z]*)(?:\s+to\s+(D?\d+[A-Z]*))?/);
    if (named) {
      mode = /^T/.test(named[1]) ? 'table' : 'diagram';
      refs.push(named[3] ? { type: mode, label: named[2], to: named[3] } : { type: mode, label: named[2] });
      continue;
    }
    const bare = piece.match(/^(D?\d+[A-Z]*)(?:\s+to\s+(D?\d+[A-Z]*))?$/);
    if (bare && (mode === 'table' || mode === 'diagram')) refs.push(bare[2] ? { type: mode, label: bare[1], to: bare[2] } : { type: mode, label: bare[1] });
    else if (bare && mode === 'section') refs.push({ type: 'section', section: Number(bare[1]) });
  }
  return refs;
}

export function splitIndexLine(text) {
  const at = text.search(REF_START);
  if (at < 0) return { term: text.trim(), refText: '' };
  return { term: text.slice(0, at).replace(/[,\s]+$/, '').trim(), refText: text.slice(at).trim() };
}

// The rules a piece of text points to, in the order it names them.
export function rulesNamedIn(text, own = null) {
  const out = [];
  for (const m of String(text).matchAll(/\bRules?\s+((?:\d{1,2}\s?[-‐‑–]\s?\d{3,4}(?:\s?\d+\))?(?:\s*(?:,|and|to|or)\s*)?)+)/g)) {
    for (const r of m[1].matchAll(RULE)) {
      const id = ruleId(r);
      if (id !== own && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

export function tablesNamedIn(text) {
  const out = [];
  for (const m of String(text).matchAll(/\bTables?\s+((?:D?\d+[A-Z]*(?:\s*(?:,|and|to|or)\s*)?)+)/g)) {
    for (const t of m[1].matchAll(/D?\d+[A-Z]*/g)) if (!out.includes(t[0])) out.push(t[0]);
  }
  return out;
}

const WATCH = ['shall not', 'must not', 'need not', 'may not', 'shall', 'must', 'may', 'except', 'unless', 'notwithstanding', 'provided that', 'only', 'at least', 'not less than', 'not more than', 'minimum', 'maximum'];

// The words in a rule that change what it means. Each is counted once.
export function watchWordsIn(text) {
  let rest = ` ${String(text).toLowerCase().replace(/\s+/g, ' ')} `;
  const found = [];
  for (const w of WATCH) {
    if (rest.includes(` ${w} `) || rest.includes(` ${w},`)) {
      found.push(w);
      rest = rest.split(w).join(' ');
    }
  }
  return found;
}

export function createBookMap() {
  const contents = [];
  const tableList = new Map();
  const tables = new Map();
  const definitions = [];
  const notes = [];
  const indexEntries = [];
  let inContents = false;
  let contentsDone = false;
  let contentsSection = null;
  let pending = '';
  let inTableList = false;
  let tableRow = null;
  let inIndex = false;
  let def = null;
  let note = null;
  let stack = [];
  let lastIndex = null;
  let baseX = null;

  // The class method asks you to know these two parts of Appendix C, so the tool finds them.
  const guides = {};
  const readGuides = (pg) => {
    if (pg.head.appendix !== 'C') return;
    for (const s of pg.body) {
      const m = tidy(s.text).match(/^(C9\.8|C11)\b/);
      if (m && !guides[m[1]]) guides[m[1]] = pg.n;
    }
  };

  const pdfOrder = (pg) => [...pg.body].filter((s) => s.dir === 0).sort((a, b) => b.y - a.y || a.x - b.x);

  const readContents = (pg) => {
    for (const s of pdfOrder(pg)) {
      const text = tidy(s.text);
      if (!inContents && !contentsDone && text === 'Contents' && startsBold(s) === true) {
        inContents = true;
        continue;
      }
      if (!inContents) continue;
      const whole = pending ? `${pending} ${text}` : text;
      const m = whole.match(/^(.*\S)\s+(\d{1,4})$/);
      if (!m) {
        pending = whole;
        continue;
      }
      pending = '';
      const sec = m[1].match(/^Section\s+(\d{1,2})\s*[—–-]+\s*(.*)$/);
      if (sec) {
        contentsSection = Number(sec[1]);
        contents.push({ section: contentsSection, title: sec[2], printed: m[2], top: true });
      } else if (/^(Tables|Appendix\b|Annex\b|Index)/.test(m[1])) {
        contentsSection = null;
        contents.push({ section: null, title: m[1], printed: m[2], top: true });
        if (/^Index$/.test(m[1])) {
          inContents = false;
          contentsDone = true;
        }
      } else if (contentsSection !== null) contents.push({ section: contentsSection, title: m[1], printed: m[2], top: false });
    }
  };

  const finishTableRow = () => {
    if (!tableRow) return;
    const m = tableRow.text.match(/^(.*\S)\s+(\d{1,4})$/);
    tableList.set(tableRow.label, { label: tableRow.label, title: m ? m[1] : tableRow.text, printed: m ? m[2] : null });
    tableRow = null;
  };

  const readTableList = (pg) => {
    const rows = pdfOrder(pg);
    if (rows.some((s) => tidy(s.text) === 'Tables' && s.size > 14)) inTableList = true;
    if (!inTableList) return;
    if (rows.some((s) => /^Table\s+D?\d/.test(tidy(s.text)))) {
      finishTableRow();
      inTableList = false;
      return;
    }
    for (const s of rows) {
      const text = tidy(s.text);
      if (text === 'Tables') continue;
      const m = text.match(/^(D?\d+[A-Z]*)\s+(.+)$/);
      if (m && startsBold(s) === true) {
        finishTableRow();
        tableRow = { label: m[1], text: m[2] };
      } else if (tableRow) tableRow.text = `${tableRow.text} ${text}`;
    }
  };

  const readTables = (pg) => {
    if (pg.head.section !== null) return;
    const byDir = [...pg.body].sort((a, b) => a.dir - b.dir || b.y - a.y || a.x - b.x);
    byDir.forEach((s, i) => {
      const text = tidy(s.text);
      const m = text.match(/^Table\s+(D?\d+[A-Z]*)\b\s*(\(.*\))?$/);
      if (!m || startsBold(s) !== true) return;
      const label = m[1];
      if (tables.has(label)) {
        const t = tables.get(label);
        if (!t.pages.includes(pg.n)) t.pages.push(pg.n);
        return;
      }
      let title = '';
      const see = [];
      for (const b of byDir.slice(i + 1, i + 7)) {
        if (b.dir !== s.dir || s.y - b.y > 60) break;
        const bt = tidy(b.text);
        if (/^\(\s*See\b/i.test(bt)) {
          see.push(...rulesNamedIn(bt));
          continue;
        }
        if (startsBold(b) === true && !title) title = bt;
        else if (startsBold(b) === true && s.y - b.y < 34 && !see.length) title = `${title} ${bt}`;
        else break;
      }
      tables.set(label, { label, title, see, page: pg.n, pages: [pg.n], dir: s.dir, text: '' });
    });
    // Every table on a page keeps that page's words, so a search can look inside tables.
    for (const t of tables.values()) if (t.pages.includes(pg.n)) t.text = `${t.text} ${byDir.map((s) => s.text).join(' ')}`;
  };

  const readDefinitions = (pg) => {
    if (pg.head.section !== 0) {
      def = null;
      return;
    }
    for (const s of pdfOrder(pg)) {
      const text = tidy(s.text);
      const m = text.match(/^(.+?)\s+—\s*(.*)$/);
      if (m && startsBold(s) === true && !/^Section\b/.test(m[1])) {
        if (def && def.page === pg.n) def.endY = s.y;
        def = { term: m[1], text: m[2], page: pg.n, y: s.y, endY: null };
        definitions.push(def);
      } else if (startsBold(s) === true) {
        if (def && def.page === pg.n) def.endY = s.y;
        def = null;
      }
      else if (def) def.text = `${def.text} ${text}`;
    }
  };

  const readNotes = (pg) => {
    if (pg.head.appendix !== 'B') {
      if (note) note.endPage = note.endPage ?? pg.n - 1;
      note = null;
      return;
    }
    for (const s of pdfOrder(pg)) {
      const text = tidy(s.text);
      const m = text.match(/^Rules?\s+(\d{1,2}-\d{3,4}.*)$/);
      const isHead = m && startsBold(s) === true && text.length <= 80 && !/[.;:]$/.test(text);
      const bigTitle = s.size > 12 && startsBold(s) === true;
      if (isHead || bigTitle) {
        if (note) {
          note.endPage = pg.n;
          note.endY = s.y;
        }
        note = null;
      }
      if (isHead) {
        const bits = [...m[1].matchAll(RULE)].map(ruleId);
        note = { label: text, rules: bits, ranged: /\bto\b/.test(m[1]) && bits.length === 2, page: pg.n, y: s.y, endPage: null, endY: null, text: '' };
        notes.push(note);
      } else if (note) note.text = `${note.text} ${text}`;
    }
  };

  const readIndex = (pg) => {
    const rows = pdfOrder(pg);
    if (!inIndex && rows.some((s) => tidy(s.text) === 'Index' && s.size > 14)) inIndex = true;
    if (!inIndex) return;
    for (const s of rows) {
      const text = tidy(s.text);
      if (text === 'Index' && s.size > 14) continue;
      if (/^[A-Z]$/.test(text) && startsBold(s) === true) continue;
      if (baseX === null) baseX = s.x;
      const carries = lastIndex && /(,|\bto|\band)$/.test(lastIndex.raw);
      if (carries) {
        lastIndex.raw = `${lastIndex.raw} ${text}`;
        const part = splitIndexLine(lastIndex.raw);
        lastIndex.term = part.term;
        lastIndex.refs = parseIndexRefs(part.refText);
        continue;
      }
      const level = Math.max(0, Math.round((s.x - baseX) / 18));
      const part = splitIndexLine(text);
      stack = stack.slice(0, level);
      const entry = { term: part.term, path: [...stack.map((e) => e.term), part.term], refs: parseIndexRefs(part.refText), page: pg.n, level, raw: text };
      stack[level] = entry;
      indexEntries.push(entry);
      lastIndex = entry;
    }
  };

  return {
    add(pg) {
      readContents(pg);
      readTableList(pg);
      readTables(pg);
      readDefinitions(pg);
      readNotes(pg);
      readIndex(pg);
      readGuides(pg);
    },
    finish(index) {
      finishTableRow();
      const pdfOf = new Map();
      for (const [n, i] of index.info) if (i.printed?.sure && i.printed.value && !pdfOf.has(i.printed.value)) pdfOf.set(i.printed.value, n);
      for (const c of contents) c.page = pdfOf.get(c.printed) ?? null;
      for (const [label, t] of tableList) if (!tables.has(label)) tables.set(label, { label, title: t.title, see: [], page: pdfOf.get(t.printed) ?? null, pages: [], listed: true });
      for (const t of tables.values()) {
        const listed = tableList.get(t.label);
        if (listed) t.title = listed.title;
      }
      // A note can cover a range of rules, so each rule in the range finds it too.
      const allRules = [...index.rules.keys()];
      const notesByRule = new Map();
      for (const n of notes) {
        let list = n.rules;
        if (n.ranged) list = allRules.filter((r) => compareRules(r, n.rules[0]) >= 0 && compareRules(r, n.rules[1]) <= 0);
        for (const r of list) {
          if (!notesByRule.has(r)) notesByRule.set(r, []);
          notesByRule.get(r).push(n);
        }
      }
      return { contents, tables, tableList, definitions, notes, notesByRule, index: indexEntries, guides };
    },
  };
}

export function lookupTable(map, label) {
  const key = String(label).replace(/^table\s*/i, '').trim().toUpperCase();
  const t = map.tables.get(key);
  return t ? { ...t, status: t.page ? 'found' : 'unsure' } : { status: 'missing', label: key };
}

export function parseTableNumber(input) {
  const m = String(input ?? '').trim().match(/^tables?\s*(D?\d+[A-Za-z]*)$/i);
  return m ? m[1].toUpperCase() : null;
}

export const definitionWords = (d) => wordsOf(d.term);

// Finds a rule's heading in the book by its number. No AI and no network: it reads the font and position
// of each piece of text on the page, held in memory only, and never saves any of it.
//
// A page comes in as { n, view: [x0, y0, x1, y1], items: [{ str, t: [a, b, c, d, x, y], w, font: { name, bold } | null }] }.

const RULE_AT_START = /^(\d{1,2})-(\d{3,4})(?![\d-])/;
const RULE_ANYWHERE = /(?<![\p{L}\p{N}-])(\d{1,2})\s?[-‐‑–]\s?(\d{3,4})(?![\p{N}-])/gu;
const MARKER = /^[\sΔ∆▲△●○■□◆◇*†‡§•]+$/u;
const SECTION_LINE = /^Section\s+(\d{1,2})\s*[\u2014\u2013-]+\s*(.*)$/;
const LAST_SECTION = 86;
// Change marks in the margin can sit in front of a section heading.
const sectionLine = (text) => text.replace(/^[\sΔ∆▲△●○■□◆◇*†‡§•]+/u, '').match(SECTION_LINE);
const BAND = 0.075; // Share of the page at the top and bottom that holds running heads and page numbers.

const stemWord = (w) => {
  if (w.length <= 3 || !w.endsWith('s') || w.endsWith('ss')) return w;
  // Boxes, switches and classes lose the whole ending, so they match box, switch and class.
  return /(?:x|ch|sh|ss)es$/.test(w) ? w.slice(0, -2) : w.slice(0, -1);
};
export function wordsOf(text) {
  return String(text).normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(stemWord);
}

export function isBoldFont(font) {
  if (!font) return null;
  const name = String(font.name || '').replace(/^[A-Z]{6}\+/, '');
  if (/bold|black|heavy|semibold|demi|extrabold/i.test(name)) return true;
  if (font.bold === true) return true;
  if (!name) return null;
  return false;
}

// Turns each piece of text so it reads left to right, whatever way it was printed.
function direction(a, b) {
  if (Math.abs(a) >= Math.abs(b)) return a >= 0 ? 0 : 180;
  return b > 0 ? 90 : 270;
}
function turn(dir, x, y) {
  if (dir === 0) return [x, y];
  if (dir === 90) return [y, -x];
  if (dir === 270) return [-y, x];
  return [-x, -y];
}

function frameBox(view, dir) {
  const [x0, y0, x1, y1] = view;
  const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => turn(dir, x, y));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys) };
}

export function toItems(page) {
  const out = [];
  for (const it of page.items || []) {
    if (typeof it.str !== 'string' || !it.str) continue;
    const [a, b, , , px, py] = it.t;
    const dir = direction(a, b);
    const [x, y] = turn(dir, px, py);
    const size = Math.hypot(a, b);
    out.push({ str: it.str, x, y, w: Math.abs(it.w || 0), size, dir, bold: isBoldFont(it.font), font: it.font?.name || '' });
  }
  return out;
}

const blank = (s) => !s.trim();

// Groups text into lines, then splits each line where a wide gap shows a new column or cell.
function segmentsOf(items) {
  const byDir = new Map();
  for (const it of items) {
    if (!byDir.has(it.dir)) byDir.set(it.dir, []);
    byDir.get(it.dir).push(it);
  }
  const segs = [];
  for (const [dir, list] of byDir) {
    const lines = [];
    for (const it of [...list].sort((p, q) => q.y - p.y)) {
      if (blank(it.str)) continue;
      const line = lines.find((l) => Math.abs(l.y - it.y) <= 0.35 * Math.max(l.size, it.size));
      if (line) {
        line.items.push(it);
        line.size = Math.max(line.size, it.size);
      } else lines.push({ y: it.y, size: it.size, items: [it] });
    }
    for (const line of lines) {
      // Spaces that sit between words join their line's pieces back in order.
      const words = line.items.sort((p, q) => p.x - q.x);
      let cur = null;
      for (const it of words) {
        const gap = cur ? it.x - cur.end : 0;
        if (!cur || gap > 1.8 * Math.max(it.size, cur.size)) {
          cur = { dir, y: line.y, x: it.x, end: it.x + it.w, size: it.size, parts: [] };
          segs.push(cur);
        } else if (gap > 0.15 * it.size) cur.parts.push({ str: ' ', bold: null, size: it.size, space: true });
        cur.parts.push({ str: it.str, bold: it.bold, size: it.size, x: it.x, font: it.font });
        cur.end = Math.max(cur.end, it.x + it.w);
        cur.size = Math.max(cur.size, it.size);
      }
    }
  }
  for (const s of segs) {
    s.text = s.parts.map((p) => p.str).join('').replace(/\s+/g, ' ').trim();
    // Change marks in the margin do not move where the line itself starts.
    const first = s.parts.find((p) => !p.space && !MARKER.test(p.str));
    if (first) s.x = first.x;
  }
  return segs;
}

function modeSize(items) {
  const count = new Map();
  for (const it of items) {
    if (blank(it.str)) continue;
    const k = Math.round(it.size * 2) / 2;
    count.set(k, (count.get(k) || 0) + it.str.length);
  }
  let best = 0;
  let size = 0;
  for (const [k, c] of count) if (c > best) [best, size] = [c, k];
  return size;
}

export function readPrintedPage(segs) {
  const found = new Set(segs.filter((s) => s.band && /^(\d{1,4}|[ivxlcdm]{1,7})$/i.test(s.text)).map((s) => s.text.toLowerCase()));
  if (!found.size) return { value: null, sure: true, note: 'no printed number' };
  if (found.size > 1) return { value: null, sure: false, note: 'more than one number in the margins', seen: [...found] };
  return { value: [...found][0], sure: true };
}

export function readRunningHead(segs) {
  const top = segs.filter((s) => s.band === 'top').map((s) => s.text).join(' | ');
  const section = top.match(/\bSection\s+(\d{1,2})\b/);
  const appendix = top.match(/\bAppendix\s+([A-Z])\b/);
  return { section: section ? Number(section[1]) : null, appendix: appendix ? appendix[1] : null };
}

// Splits a heading line into the bold number, the bold title, and the plain text after it.
function splitHeading(seg) {
  const parts = [...seg.parts];
  while (parts.length && (parts[0].space || MARKER.test(parts[0].str))) parts.shift();
  const text = parts.map((p) => p.str).join('');
  const m = text.match(RULE_AT_START);
  if (!m) return null;
  let pos = 0;
  let i = 0;
  const flags = [];
  for (; i < parts.length && pos < m[0].length; i++) {
    flags.push(parts[i].bold);
    pos += parts[i].str.length;
  }
  const numBold = flags.includes(false) ? false : flags.includes(null) ? null : true;
  const rest = text.slice(m[0].length);
  if (pos > m[0].length && !/^\s/.test(text.slice(m[0].length))) {
    // The number and the next word share one piece of text with no space between them.
    if (/^[\p{L}\p{N}]/u.test(rest)) return null;
  }
  // The title is the bold text after the number, until plain text starts.
  let title = '';
  let after = '';
  let unknown = false;
  let carry = text.slice(m[0].length, pos);
  if (carry) title += carry;
  let inTitle = true;
  for (; i < parts.length; i++) {
    const p = parts[i];
    if (inTitle && (p.space || p.bold === true || blank(p.str))) title += p.str;
    else if (inTitle && p.bold === null) {
      unknown = true;
      title += p.str;
    } else {
      inTitle = false;
      after += p.str;
    }
  }
  return {
    rule: `${Number(m[1])}-${m[2]}`, section: Number(m[1]), numBold, unknownFont: unknown || numBold === null,
    title: title.replace(/\s+/g, ' ').trim(), after: after.replace(/\s+/g, ' ').trim(),
    size: parts[0].size, x: seg.x,
  };
}

export const startsBold = (seg) => {
  const p = seg.parts.find((q) => !q.space && !MARKER.test(q.str));
  return p ? p.bold : false;
};
const boldPrefix = (seg) => {
  let s = '';
  let rest = '';
  let inBold = true;
  for (const p of seg.parts) {
    if (inBold && (p.space || p.bold === true || MARKER.test(p.str) && !s.trim())) s += MARKER.test(p.str) && !s.trim() ? '' : p.str;
    else {
      inBold = false;
      rest += p.str;
    }
  }
  return { text: s.replace(/\s+/g, ' ').trim(), rest: rest.replace(/\s+/g, ' ').trim() };
};

export function readAppendixNote(after) {
  if (!after) return { letters: [], sure: true };
  if (!/appendi/i.test(after)) return { letters: [], sure: true };
  const sep = String.raw`\s*(?:,\s*and|,|and|&)\s*`;
  const m = after.match(new RegExp(String.raw`^\(\s*[Ss]ee\s+[Aa]ppendi(?:x|ces)\s+([A-Z](?:${sep}[A-Z])*)\s*\)`));
  if (!m) return { letters: [], sure: false };
  return { letters: m[1].split(new RegExp(sep)).map((l) => l.trim().toUpperCase()), sure: true };
}

/* ---------- One page ---------- */
export function readPage(page) {
  const items = toItems(page);
  const segs = segmentsOf(items);
  const boxes = new Map();
  for (const s of segs) {
    if (!boxes.has(s.dir)) boxes.set(s.dir, frameBox(page.view || [0, 0, 612, 792], s.dir));
    const box = boxes.get(s.dir);
    const h = box.top - box.bottom;
    s.band = s.y > box.top - BAND * h ? 'top' : s.y < box.bottom + BAND * h ? 'bottom' : null;
  }
  const body = segs.filter((s) => !s.band);
  const bodySize = modeSize(items.filter((it) => body.some((s) => s.dir === it.dir)));
  const head = readRunningHead(segs);
  const printed = readPrintedPage(segs);

  // Where columns start: x positions that begin at least two body lines.
  const starts = new Map();
  for (const s of body) {
    const k = `${s.dir}:${Math.round(s.x)}`;
    starts.set(k, (starts.get(k) || 0) + 1);
  }
  const atColumnStart = (s) => [-1, 0, 1].some((d) => (starts.get(`${s.dir}:${Math.round(s.x) + d}`) || 0) >= 2);

  const headings = [];
  for (const seg of body) {
    const h = splitHeading(seg);
    if (!h || h.numBold === false) continue;
    if (h.size < 0.9 * bodySize) continue; // Small bold numbers belong to tables and notes.
    const doubts = [];
    if (h.unknownFont) doubts.push('font weight unknown');
    if (!atColumnStart(seg)) doubts.push('not at the start of a column');
    const sameCol = body.filter((s) => s.dir === seg.dir && s !== seg && s.x >= seg.x - 3 && s.x <= seg.x + 3 * seg.size);
    const colRight = Math.max(seg.end, ...body.filter((s) => s.dir === seg.dir && Math.abs(s.x - seg.x) < 40).map((s) => s.end));
    let title = h.title;
    let after = h.after;
    let line = seg;
    let continues = null;
    // Titles can wrap onto the next lines. Each extra line must be bold, the same size, and right below.
    while (!after) {
      const below = sameCol.filter((s) => s.y < line.y && s.y > line.y - 3 * line.size).sort((p, q) => q.y - p.y)[0];
      const long = line.end >= colRight - 90;
      if (!below) {
        const lowest = !sameCol.some((s) => s.y < line.y);
        if (lowest && long && title) continues = { from: line, colRight };
        break;
      }
      const gap = line.y - below.y;
      const bold = startsBold(below);
      if (bold !== true || RULE_AT_START.test(below.text.replace(/^[^\p{L}\p{N}(]+/u, '')) || Math.abs(below.size - h.size) > 0.6 || gap > 1.8 * h.size) {
        if (bold === null) doubts.push('font weight unknown on the next line');
        break;
      }
      if (!long) {
        doubts.push('next line is bold but the title line is short');
        break;
      }
      const more = boldPrefix(below);
      title = `${title} ${more.text}`.trim();
      after = more.rest;
      line = below;
    }
    // The note can sit on its own line right under the title.
    if (!after) {
      const below = sameCol.filter((s) => s.y < line.y && s.y > line.y - 2 * line.size).sort((p, q) => q.y - p.y)[0];
      if (below && /^\(\s*see\s+appendi/i.test(below.text)) {
        after = below.text;
        line = below;
      }
    }
    // A plain note like "(see Appendix" can break onto the next line.
    if (after && /\(\s*see[^)]*$/i.test(after)) {
      const below = sameCol.filter((s) => s.y < line.y && s.y > line.y - 2 * line.size).sort((p, q) => q.y - p.y)[0];
      if (below) after = `${after} ${below.text}`;
    }
    if (!title) doubts.push('no bold title after the number');
    else if (!/\p{L}/u.test(title)) doubts.push('title has no words');
    if (title && !/^[\p{Lu}(“"']/u.test(title)) doubts.push('title does not start with a capital letter');
    const note = readAppendixNote(after);
    if (!note.sure) doubts.push('appendix note beside the title could not be read');
    headings.push({
      rule: h.rule, section: h.section, page: page.n, title, appendix: note.letters, appendixSure: note.sure,
      doubts, continues: continues ? { size: h.size, colRight, x: seg.x, dir: seg.dir } : null, y: seg.y, x: seg.x, dir: seg.dir, size: h.size,
    });
  }

  // A section opens with a large bold "Section 26 — Title" line, and it can start partway down a page.
  const sectionStarts = [];
  const contents = [];
  for (const seg of segs) {
    if (seg.dir !== 0 || seg.band === 'bottom') continue;
    const m = sectionLine(seg.text);
    if (!m || startsBold(seg) !== true) continue;
    const section = Number(m[1]);
    const lineBelow = (from, range) => segs.filter((s) => s.dir === 0 && s.band !== 'bottom' && s.y < from.y && s.y > from.y - range * from.size && !sectionLine(s.text) && !RULE_AT_START.test(s.text)).sort((p, q) => q.y - p.y)[0];
    // Only pages with a section's name at the top hold real headings. Lists at the front of the book look alike.
    if (head.section !== null && seg.size >= 1.25 * bodySize) {
      let title = m[2].trim();
      let from = seg;
      // Long titles wrap onto more large bold lines.
      for (let i = 0; i < 4; i++) {
        const below = lineBelow(from, 2.2);
        if (!below || startsBold(below) !== true || Math.abs(below.size - seg.size) > 0.6) break;
        title = `${title} ${below.text}`.trim();
        from = below;
      }
      sectionStarts.push({ section, title, y: seg.y, atTop: !body.some((s) => s.dir === 0 && s.y > seg.y + 1) });
    } else if (head.section === null) {
      // The contents list each section with its printed page at the end, sometimes after a wrapped line.
      let whole = m[2].trim();
      let from = seg;
      const number = (t) => /\s\d{1,4}$/.test(` ${t}`);
      for (let i = 0; i < 3 && !number(whole); i++) {
        const beside = i === 0 && segs.find((s) => s !== seg && s.dir === 0 && Math.abs(s.y - seg.y) < 2 && s.x > seg.x && /^\d{1,4}$/.test(s.text));
        if (beside) {
          whole = `${whole} ${beside.text}`;
          break;
        }
        const below = lineBelow(from, 1.8);
        if (!below) break;
        whole = `${whole} ${below.text}`;
        from = below;
      }
      const parts = whole.match(/^(.*\S)\s+(\d{1,4})$/);
      if (parts) contents.push({ section, title: parts[1], printed: parts[2] });
    }
  }

  // The first body line of each column, for titles that run on from the column or page before.
  const tops = body.filter((s) => s.dir === 0).sort((p, q) => q.y - p.y);

  const mentions = new Set();
  for (const s of segs) for (const m of s.text.matchAll(RULE_ANYWHERE)) mentions.add(`${Number(m[1])}-${m[2]}`);

  // Bold lines between rules, like a heading over a group of rules. They are not part of the rule above them.
  const headingLines = new Set(headings.map((h) => h.y));
  const subheads = body.filter((s) => s.dir === 0 && startsBold(s) === true && !headingLines.has(s.y) && !RULE_AT_START.test(s.text) && s.text.length < 90 && !/[.;:,]$/.test(s.text) && s.parts.filter((p) => !p.space).every((p) => p.bold !== false)).map((s) => s.y);

  return { n: page.n, view: page.view, head, printed, headings, mentions: [...mentions], tops, body, sectionStarts, contents, subheads };
}

// Joins a title that runs past the bottom of a column onto the top of the next column or page.
function carryOver(h, here, next) {
  const c = h.continues;
  let target = here.body.filter((s) => s.dir === c.dir && s.x > c.colRight - 2).sort((p, q) => q.y - p.y || p.x - q.x)[0];
  let where = 'next column';
  if (!target) {
    if (!next) return { doubt: 'title may go on to the next page, which was not read' };
    target = next.body.filter((s) => s.dir === c.dir).sort((p, q) => q.y - p.y || p.x - q.x)[0];
    where = 'next page';
  }
  if (!target) return {};
  const bold = startsBold(target);
  if (bold === null) return { doubt: `font weight unknown at the top of the ${where}` };
  if (bold !== true || Math.abs(target.size - c.size) > 0.6 || RULE_AT_START.test(target.text)) return {};
  const more = boldPrefix(target);
  return { text: more.text, after: more.rest, where };
}

// Whether a page has two columns of text, and where they split.
export function readColumns(view, body) {
  const [left, , right] = view || [0, 0, 612, 792];
  const mid = (left + right) / 2;
  const flat = (body || []).filter((s) => s.dir === 0);
  const inRight = flat.filter((s) => s.x > mid).length;
  const inLeft = flat.filter((s) => s.x < mid && s.end <= mid + 12).length;
  const crossing = flat.filter((s) => s.x < mid - 12 && s.end > mid + 12).length;
  const two = inRight >= 3 && inLeft >= 3 && crossing <= (inLeft + inRight) * 0.1;
  return { two, mid, left, right };
}

// The part of a page that holds one rule: from its heading down to the next heading in its column.
// If no heading follows, the rule may go on, so the preview says so.
export function rulePreview(index, rule) {
  const h = (index.rules.get(rule) || []).filter(inSection);
  if (h.length !== 1 || h[0].y === undefined) return null;
  const me = h[0];
  const col = index.info.get(me.page)?.columns;
  if (!col) return null;
  const onRight = col.two && me.x >= col.mid;
  const sameCol = (o) => !col.two || (o.x >= col.mid) === onRight;
  const next = [...index.rules.values()].flat()
    .filter((o) => o.page === me.page && o.dir === me.dir && o.y < me.y && sameCol(o))
    .sort((a, b) => b.y - a.y)[0];
  // A wrapped title is bold too, so only a heading lower than the title's own lines can end the rule.
  const titleLines = Math.ceil((me.title || '').length / 70);
  const stops = (index.info.get(me.page)?.subheads || []).filter((y) => y < me.y - 14 * titleLines && (!next || y > next.y));
  const bottom = stops.length ? Math.max(...stops) : next ? next.y : null;
  return {
    page: me.page, sideways: me.dir !== 0, top: me.y, bottom, goesOn: bottom === null,
    x0: col.two && onRight ? col.mid : col.left, x1: col.two && !onRight ? col.mid : col.right,
  };
}

/* ---------- The whole book ---------- */
// Pages go in one at a time, in order. Only the last page is kept whole, so a title can run onto the next page.
export function createIndexer() {
  const rules = new Map();
  const mentions = new Map();
  const info = new Map();
  const sections = new Map();
  const contents = new Map();
  const blocks = [];
  let current = null; // The rule or section whose text is being read.
  let held = null;
  let total = 0;
  const startBlock = (section, rule) => {
    current = { section, rule, byPage: new Map(), text: '' };
    blocks.push(current);
  };
  // Keeps each rule's words in memory, page by page, so a section can be searched. Nothing is saved.
  const collect = (pg) => {
    if (pg.head.appendix !== null || (pg.head.section === null && !pg.sectionStarts.length)) {
      current = null;
      return;
    }
    if (pg.head.section !== null && !pg.sectionStarts.length && current?.section !== pg.head.section) startBlock(pg.head.section, null);
    let previous = '';
    for (const s of [...pg.body].sort((p, q) => p.dir - q.dir || q.y - p.y || p.x - q.x)) {
      const opens = s.dir === 0 && pg.sectionStarts.find((o) => o.y === s.y && sectionLine(s.text)?.[1] === String(o.section));
      if (opens) {
        startBlock(opens.section, null);
        continue;
      }
      const h = pg.headings.find((o) => o.dir === s.dir && o.y === s.y && o.x === s.x);
      if (h && h.section === current?.section) startBlock(h.section, h.rule);
      if (!current) continue;
      if (!current.byPage.has(pg.n)) current.byPage.set(pg.n, new Set());
      current.text += `${s.text} `;
      const set = current.byPage.get(pg.n);
      const words = wordsOf(s.text);
      for (const w of words) set.add(w);
      // A word split across two lines with a hyphen also counts as the whole word.
      if (previous && /[\p{L}]-$/u.test(previous) && words[0]) set.add(stemWord(previous.split(/[^\p{L}\p{N}]+/u).filter(Boolean).pop().toLowerCase() + words[0]));
      previous = s.text;
    }
  };
  const settle = (pg, next) => {
    for (const h of pg.headings) {
      // A section can open partway down a page that still has the last section's name at the top.
      const opened = pg.sectionStarts.some((s) => s.section === h.section && s.y > h.y);
      const entry = { ...h, doubts: [...h.doubts], printed: pg.printed, head: opened ? { ...pg.head, section: h.section } : pg.head };
      if (h.continues) {
        const more = carryOver(h, pg, next && next.n === pg.n + 1 ? next : null);
        if (more.doubt) entry.doubts.push(more.doubt);
        if (more.text) {
          entry.title = `${entry.title} ${more.text}`;
          entry.runsOn = more.where;
          if (more.after) {
            const note = readAppendixNote(more.after);
            entry.appendix = note.letters;
            if (!note.sure) entry.doubts.push('appendix note beside the title could not be read');
          }
        }
      }
      delete entry.continues;
      if (!rules.has(h.rule)) rules.set(h.rule, []);
      rules.get(h.rule).push(entry);
    }
  };
  return {
    add(page) {
      const pg = page.headings ? page : readPage(page);
      total++;
      info.set(pg.n, { printed: pg.printed, head: pg.head, columns: readColumns(pg.view, pg.body), subheads: pg.subheads });
      for (const r of pg.mentions) {
        if (!mentions.has(r)) mentions.set(r, new Set());
        mentions.get(r).add(pg.n);
      }
      for (const s of pg.sectionStarts) {
        const had = sections.get(s.section);
        sections.set(s.section, { ...s, page: pg.n, printed: pg.printed, twice: Boolean(had) });
      }
      // The contents come first, so a later list that looks like them does not replace them.
      for (const c of pg.contents) if (!contents.has(c.section)) contents.set(c.section, c);
      collect(pg);
      if (held) settle(held, pg);
      held = pg;
    },
    finish() {
      if (held) settle(held, null);
      held = null;
      return { rules, mentions, info, total, sections, contents, blocks };
    },
  };
}

export function buildIndex(pages) {
  const ix = createIndexer();
  for (const p of pages) ix.add(p);
  return ix.finish();
}

/* ---------- Asking for a rule ---------- */
export function parseRuleNumber(input) {
  const s = String(input ?? '').trim().replace(/^rule\s+/i, '').replace(/[‐‑–—]/g, '-').replace(/\s*-\s*/, '-');
  const m = s.match(/^(\d{1,2})-(\d{3,4})$/);
  if (!m) return { ok: false, reason: s ? 'Type a rule number like 2-328.' : 'Type a rule number.' };
  const section = Number(m[1]);
  if (section > LAST_SECTION) return { ok: false, reason: `This search covers Sections 0 to ${LAST_SECTION} only.`, rule: `${section}-${m[2]}` };
  return { ok: true, rule: `${section}-${m[2]}`, section };
}

const inSection = (h) => h.head.section === h.section;

export function lookup(index, input) {
  const q = parseRuleNumber(input);
  if (!q.ok) return { status: 'invalid', reason: q.reason, rule: q.rule || null };
  const all = index.rules.get(q.rule) || [];
  const mentionPages = [...(index.mentions.get(q.rule) || [])].sort((a, b) => a - b);
  const notesPages = mentionPages.filter((p) => index.info.get(p)?.head.appendix === 'B');
  const homes = all.filter(inSection);
  const strays = all.filter((h) => !inSection(h));
  const base = { rule: q.rule, section: q.section, mentionPages, notesPages };
  const sectionHas = [...index.rules.values()].some((list) => list.some((h) => inSection(h) && h.section === q.section));

  if (!homes.length) {
    if (strays.length) {
      const h = strays[0];
      return {
        ...base, status: 'unsure', pdfPage: h.page, printedPage: h.printed.sure ? h.printed.value : null, title: null,
        appendixB: null, candidates: strays.map((s) => s.page),
        reasons: [h.head.section === null ? 'the page with this heading has no section name at the top' : 'the heading is on a page of another part of the book'],
      };
    }
    return {
      ...base, status: 'missing', sectionHasRules: sectionHas,
      reasons: [sectionHas ? 'no bold heading with this number was found' : `no numbered rules were found in Section ${q.section}`],
    };
  }
  if (homes.length > 1) {
    return {
      ...base, status: 'unsure', title: null, appendixB: null, pdfPage: homes[0].page,
      printedPage: homes[0].printed.sure ? homes[0].printed.value : null, candidates: homes.map((h) => h.page),
      reasons: ['more than one heading has this number'],
    };
  }
  const h = homes[0];
  const reasons = [...h.doubts];
  if (!h.printed.sure) reasons.push('the printed page number could not be read');
  const titleSure = !h.doubts.length;
  return {
    ...base, status: reasons.length ? 'unsure' : 'found',
    title: titleSure ? h.title : null,
    titleSure,
    appendixB: h.appendixSure && titleSure ? h.appendix.includes('B') : null,
    otherAppendix: h.appendix.filter((l) => l !== 'B'),
    pdfPage: h.page,
    printedPage: h.printed.sure ? h.printed.value : null,
    printedNote: h.printed.note || null,
    runsOn: h.runsOn || null,
    reasons,
  };
}

/* ---------- Sections ---------- */
export function parseSectionNumber(input) {
  const m = String(input ?? '').trim().match(/^(?:sec(?:tion)?\.?\s*)?(\d{1,2})$/i);
  return m ? Number(m[1]) : null;
}

const printedOf = (index, page) => {
  const p = index.info.get(page)?.printed;
  return p?.sure && p.value ? p.value : null;
};

// Where a section stops: where the next one opens, or its last page with its name at the top.
function sectionPages(index, section) {
  const start = index.sections.get(section);
  const named = [...index.info].filter(([, i]) => i.head.section === section).map(([n]) => n);
  const first = start ? start.page : named.length ? Math.min(...named) : null;
  if (first === null) return null;
  const next = [...index.sections.values()].filter((s) => s.page > first || (s.page === first && start && s.y < start.y)).sort((a, b) => a.page - b.page || b.y - a.y)[0];
  let last = first;
  if (next) last = next.atTop ? next.page - 1 : next.page;
  else {
    while (index.info.get(last + 1)?.head.section === section) last++;
  }
  return { first, last: Math.max(first, last) };
}

const sameTitle = (a, b) => wordsOf(a).join(' ') === wordsOf(b).join(' ');

export function lookupSection(index, section) {
  if (section > LAST_SECTION) return { status: 'invalid', reason: `This search covers Sections 0 to ${LAST_SECTION} only.` };
  const pages = sectionPages(index, section);
  if (!pages) return { status: 'missing', section };
  const start = index.sections.get(section);
  const listed = index.contents.get(section);
  const reasons = [];
  if (!start) reasons.push('no section heading was found');
  if (start?.twice) reasons.push('more than one heading has this number');
  if (start && listed && printedOf(index, start.page) !== listed.printed) reasons.push('the contents give a different page');
  if (start && listed && !sameTitle(start.title, listed.title)) reasons.push('the contents give a different title');
  const rules = rulesInSections(index, section, section).map((rule) => {
    const r = lookup(index, rule);
    return { rule, title: r.title, appendixB: r.appendixB, pdfPage: r.pdfPage, status: r.status };
  });
  return {
    status: reasons.length ? 'unsure' : 'found', section, title: start && !reasons.length ? start.title : null,
    firstPage: pages.first, lastPage: pages.last, printedFirst: printedOf(index, pages.first), printedLast: printedOf(index, pages.last),
    rules, reasons,
  };
}

const hasWord = (set, w) => {
  if (set.has(w)) return true;
  if (w.length < 4) return false;
  for (const t of set) if (t.startsWith(w)) return true;
  return false;
};

// Finds the rules in one section that use every word typed. Small words like "not" count too.
export function searchSection(index, section, query) {
  const words = [...new Set(wordsOf(query))];
  if (!words.length) return { status: 'empty', hits: [] };
  const hits = [];
  for (const b of index.blocks) {
    if (b.section !== section) continue;
    if (b.rule === null) {
      for (const [page, set] of b.byPage) if (words.every((w) => hasWord(set, w))) hits.push({ rule: null, page, inTitle: false });
      continue;
    }
    const sets = [...b.byPage.values()];
    if (!words.every((w) => sets.some((s) => hasWord(s, w)))) continue;
    const r = lookup(index, b.rule);
    const titleWords = new Set(wordsOf(r.title || ''));
    hits.push({
      rule: b.rule, title: r.title, appendixB: r.appendixB, status: r.status,
      page: [...b.byPage].filter(([, s]) => words.some((w) => hasWord(s, w))).map(([p]) => p).sort((p, q) => p - q)[0],
      inTitle: words.every((w) => hasWord(titleWords, w)),
    });
  }
  hits.sort((a, b) => Number(b.inTitle) - Number(a.inTitle) || a.page - b.page);
  return { status: hits.length ? 'found' : 'none', hits };
}

// Rules in the given sections, for checking the whole book.
export function rulesInSections(index, from = 0, to = LAST_SECTION) {
  const out = new Set();
  for (const [rule, list] of index.rules) if (list.some((h) => h.section >= from && h.section <= to && inSection(h))) out.add(rule);
  return [...out].sort(compareRules);
}

export function compareRules(a, b) {
  const [sa, na] = a.split('-').map(Number);
  const [sb, nb] = b.split('-').map(Number);
  return sa - sb || na - nb;
}

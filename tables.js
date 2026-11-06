// Reads one table from the book the way a person does: find the row, find the column, read the cell.
// No AI, no DOM and no network, so it runs in a browser and in Node. It reads only when asked and saves nothing.
//
// It uses the text pieces and their positions, plus the thin lines the book draws between cells.
// When a value could belong to two rows or two columns, the table is marked 'unsure' with the reason. It never guesses.
import { toItems } from './rules.js?v=4aa3f35a';

// The PDF.js drawing step numbers this file needs. They match the copy in app/vendor/pdfjs.
const OPS = { save: 10, restore: 11, transform: 12, constructPath: 91, endPath: 28, fills: new Set([20, 21, 22, 23, 24, 25, 26, 27]) };
const PATH = { moveTo: 13, lineTo: 14, curveTo: 15, curveTo2: 16, curveTo3: 17, closePath: 18, rectangle: 19 };
const THIN = 2; // A drawn shape thinner than this is a line between cells, not a shaded box.

const MARKS = '*†‡§¶#';
const TRAILING_MARKS = new RegExp(`\\s*([${MARKS}]+(?:\\s*,\\s*[${MARKS}]+)*)$`);
const MARGIN_MARK = /^[\sΔ∆▲△●○■□◆◇•]+$/u;
const TICK = /^[✓✔√]$/;
const DASH = /^[—–-]$/;
const NUMBER = /^[\d\s.,/–—-]+$/;
const SUPERSCRIPT = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const HEADING = /^Table\s+(D?\d+[A-Z]*)(?:\s*\((?:Continued|Concluded)\))?$/;
const COL_NUMBER = /^Col\.?\s*(\d+)$/i;
const SNAP = 1.5; // Lines closer than this are the same line.
// Tables the book no longer has. They are not misreadings, so they are counted on their own.
const GONE = { deleted: 'the book marks this table as deleted', diagram: 'the book says this table is now a diagram' };

/* ---------- Reading the drawn lines ---------- */

const multiply = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// Each shape in a path, as its corner points before the page's own transform.
function shapesOf(ops, coords) {
  const shapes = [];
  let cur = null;
  let k = 0;
  const take = (n) => {
    const pts = [];
    for (let i = 0; i < n; i += 2) pts.push([coords[k + i], coords[k + i + 1]]);
    k += n;
    return pts;
  };
  for (const op of ops) {
    if (op === PATH.moveTo) {
      cur = take(2);
      shapes.push(cur);
    } else if (op === PATH.rectangle) {
      const [[x, y], [w, h]] = take(4);
      shapes.push([[x, y], [x + w, y + h]]);
      cur = null;
    } else if (op === PATH.lineTo || op === PATH.curveTo || op === PATH.curveTo2 || op === PATH.curveTo3) {
      const n = op === PATH.lineTo ? 2 : op === PATH.curveTo ? 6 : 4;
      const pts = take(n);
      if (!cur) {
        cur = [];
        shapes.push(cur);
      }
      cur.push(...pts);
    }
  }
  return shapes.filter((s) => s.length);
}

// The thin lines drawn on one page, in the PDF's own page units: [{ x0, y0, x1, y1 }].
// pdfPage is a page from PDF.js. Add the result to the page data as `lines` before calling readTable.
export async function readRulings(pdfPage) {
  const list = await pdfPage.getOperatorList();
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let pending = [];
  const out = [];
  list.fnArray.forEach((fn, i) => {
    const args = list.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = multiply(ctm, args);
    else if (fn === OPS.constructPath) {
      for (const shape of shapesOf(args[0], args[1])) {
        const pts = shape.map(([x, y]) => apply(ctm, x, y));
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        pending.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
      }
    } else if (OPS.fills.has(fn)) {
      for (const r of pending) if (Math.min(r.x1 - r.x0, r.y1 - r.y0) < THIN && Math.max(r.x1 - r.x0, r.y1 - r.y0) > THIN) out.push(r);
      pending = [];
    } else if (fn === OPS.endPath) pending = [];
  });
  return out;
}

/* ---------- Turning the page so the table reads left to right ---------- */

function turn(dir, x, y) {
  if (dir === 0) return [x, y];
  if (dir === 90) return [y, -x];
  if (dir === 270) return [-y, x];
  return [-x, -y];
}
function unturn(dir, x, y) {
  if (dir === 0) return [x, y];
  if (dir === 90) return [-y, x];
  if (dir === 270) return [y, -x];
  return [-x, -y];
}

// The drawn lines as the reader sees them once the page is turned: across (h) and down (v).
function rulingsOf(page, dir) {
  const h = [];
  const v = [];
  // The rule under the running head and anything else in the page's top and bottom bands is not part of a table.
  const [, py0, , py1] = page.view || [0, 0, 0, 0];
  const band = 0.075 * (py1 - py0);
  for (const r of page.lines || []) {
    if (page.view && (r.y0 > py1 - band || r.y1 < py0 + band)) continue;
    const a = turn(dir, r.x0, r.y0);
    const b = turn(dir, r.x1, r.y1);
    const x0 = Math.min(a[0], b[0]);
    const x1 = Math.max(a[0], b[0]);
    const y0 = Math.min(a[1], b[1]);
    const y1 = Math.max(a[1], b[1]);
    if (y1 - y0 < THIN) h.push({ y: (y0 + y1) / 2, x0, x1 });
    else if (x1 - x0 < THIN) v.push({ x: (x0 + x1) / 2, y0, y1 });
  }
  return { h, v };
}

/* ---------- Text pieces into lines ---------- */

const tidy = (s) => s.replace(/\s+/g, ' ').trim();
const top = (it) => it.y + 0.75 * it.size;
const bottom = (it) => it.y - 0.25 * it.size;

function linesOf(items) {
  const lines = [];
  for (const it of [...items].sort((p, q) => q.size - p.size || q.y - p.y)) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= 0.35 * Math.max(l.size, it.size));
    if (line) line.items.push(it);
    else lines.push({ y: it.y, size: it.size, items: [it] });
  }
  for (const l of lines) {
    l.items.sort((p, q) => p.x - q.x);
    l.top = Math.max(...l.items.map(top));
    l.bottom = Math.min(...l.items.map(bottom));
    l.text = joinItems(l.items, l);
    l.bold = l.items.every((it) => it.bold === true || MARGIN_MARK.test(it.str));
  }
  return lines.sort((p, q) => q.y - p.y);
}

// Joins pieces in reading order. A small raised number becomes a superscript, as in mm².
function joinItems(items, line) {
  let out = '';
  let end = null;
  for (const it of items) {
    const raised = it.size < 0.8 * line.size && it.y - line.y > 0.2 * line.size;
    let str = it.str;
    if (raised && /^\d+$/.test(str.trim())) str = [...str.trim()].map((d) => SUPERSCRIPT[d]).join('');
    else if (end !== null && it.x - end > 0.15 * it.size) out += ' ';
    out += str;
    end = it.x + it.w;
  }
  return tidy(out);
}

// Splits the trailing footnote marks off a piece of text: '14**' gives { text: '14', notes: ['**'] }.
export function splitMarks(text) {
  const m = text.match(TRAILING_MARKS);
  if (!m || m.index === 0) return { text, notes: [] };
  // Different marks run together, as in ‡**, are separate footnotes; a repeated mark, as in **, is one.
  return { text: text.slice(0, m.index).trim(), notes: m[1].match(/([*†‡§¶#])\1*/gu) };
}

/* ---------- Finding the table on a page ---------- */

function headingOf(line) {
  const items = line.items.filter((it) => !MARGIN_MARK.test(it.str));
  if (!items.length || items[0].bold !== true) return null;
  const m = joinItems(items, line).match(HEADING);
  return m ? m[1] : null;
}

// The part of one page that belongs to the table: its lines and drawn lines, in reading direction.
function regionOf(page, label, reasons) {
  const all = toItems(page).filter((it) => it.str.trim());
  // The heading's direction is the table's direction.
  const dirs = [...new Set(all.map((it) => it.dir))];
  for (const dir of dirs) {
    const lines = linesOf(all.filter((it) => it.dir === dir));
    const at = lines.findIndex((l) => headingOf(l) === label);
    if (at < 0) continue;
    const next = lines.findIndex((l, i) => i > at && headingOf(l) !== null);
    let body = lines.slice(at + 1, next < 0 ? lines.length : next);
    // The title is bold and as large as the heading; a "(See ...)" line can follow it.
    let i = 0;
    while (i < body.length && body[i].bold && body[i].size >= lines[at].size - 0.3) i++;
    if (i < body.length && /^[([]\s*See\b/.test(body[i].text)) {
      while (i < body.length && !/[)\]]\.?$/.test(body[i].text)) i++;
      i++;
    }
    const title = body.slice(0, i).filter((l) => l.size >= lines[at].size - 0.3 && l.bold).map((l) => l.text).join(' ');
    body = body.slice(i);
    // Running heads and page numbers sit in the top and bottom bands of an upright page.
    if (dir === 0) {
      const [, y0, , y1] = page.view;
      const band = 0.075 * (y1 - y0);
      body = body.filter((l) => l.y > y0 + band && l.y < y1 - band);
    }
    body = body.filter((l) => !/^\((?:Continued|Concluded)\)$/.test(l.text));
    if (!body.length) {
      if (/^Deleted$/i.test(title)) reasons.push(GONE.deleted);
      else if (/^This Table is now Diagram\s/i.test(title)) reasons.push(GONE.diagram);
      else reasons.push(`nothing under the heading on page ${page.n}`);
      return null;
    }
    const lo = Math.min(...body.map((l) => l.bottom)) - 4;
    const hi = Math.max(...body.map((l) => l.top)) + 4;
    const r = rulingsOf(page, dir);
    // A short line just under a word is a link underline, not a cell border.
    const underline = (h) => body.some((l) => l.items.some((it) => h.y <= it.y + 1 && h.y >= it.y - 3.5 && h.x0 >= it.x - 2 && h.x1 <= it.x + it.w + 2));
    const h = r.h.filter((x) => x.y >= lo && x.y <= hi && !underline(x));
    const v = r.v.filter((x) => x.y1 >= lo && x.y0 <= hi);
    return { page, dir, title, lines: body, h, v };
  }
  reasons.push(`no heading for Table ${label} on page ${page.n}`);
  return null;
}

/* ---------- Columns ---------- */

const cluster = (values) => {
  const out = [];
  for (const x of [...values].sort((a, b) => a - b)) {
    if (out.length && x - out[out.length - 1].last <= SNAP) {
      const c = out[out.length - 1];
      c.sum += x;
      c.n++;
      c.last = x;
    } else out.push({ sum: x, n: 1, last: x });
  }
  return out.map((c) => c.sum / c.n);
};

const vAt = (reg, x, y) => reg.v.some((r) => Math.abs(r.x - x) <= SNAP && y >= r.y0 - 1 && y <= r.y1 + 1);
const hAcross = (reg, x, yLo, yHi) => reg.h.filter((r) => r.y > yLo && r.y < yHi && x >= r.x0 - 1 && x <= r.x1 + 1);

// Splits a line into pieces of text that sit together. A drawn line between two pieces always splits them.
function tokensOf(reg, line) {
  const out = [];
  let cur = null;
  for (const it of line.items) {
    if (MARGIN_MARK.test(it.str)) continue;
    const gap = cur ? it.x - cur.x1 : 0;
    const ruled = cur && reg.v.some((r) => r.x > cur.x1 - 0.5 && r.x < it.x + 0.5 && line.y >= r.y0 - 1 && line.y <= r.y1 + 1);
    if (!cur || ruled || gap > 0.5 * Math.max(it.size, line.size)) {
      cur = { x0: it.x, x1: it.x + it.w, items: [] };
      out.push(cur);
    }
    cur.items.push(it);
    cur.x1 = Math.max(cur.x1, it.x + it.w);
  }
  for (const t of out) {
    t.text = joinItems(t.items, line);
    t.top = Math.max(...t.items.map(top));
    t.bottom = Math.min(...t.items.map(bottom));
    t.y = line.y;
    t.bold = t.items.every((it) => it.bold === true);
  }
  return out;
}

// Which columns a piece of text covers: [first, last], or null when it sits outside them all.
function spanOf(cols, t) {
  const hit = [];
  cols.forEach((c, i) => {
    if (Math.min(c.x1, t.x1) - Math.max(c.x0, t.x0) > 0.5) hit.push(i);
  });
  return hit.length ? [hit[0], hit[hit.length - 1]] : null;
}

// Column edges come from the drawn lines that run down through the body of the table.
function columnsFrom(reg, yLo, yHi) {
  const xs = reg.v.filter((r) => Math.min(r.y1, yHi) - Math.max(r.y0, yLo) > 2).map((r) => r.x);
  const left = Math.min(...reg.h.map((r) => r.x0), ...reg.v.map((r) => r.x));
  const right = Math.max(...reg.h.map((r) => r.x1), ...reg.v.map((r) => r.x));
  const edges = cluster([left, ...xs, right]);
  const cols = [];
  for (let i = 1; i < edges.length; i++) if (edges[i] - edges[i - 1] > 3) cols.push({ x0: edges[i - 1], x1: edges[i] });
  return cols;
}

// With no drawn lines, columns are the gaps that run clear down every body line.
function columnsFromGaps(tokens) {
  const spans = tokens.map((t) => [t.x0, t.x1]).sort((a, b) => a[0] - b[0]);
  const cols = [];
  for (const [a, b] of spans) {
    const last = cols[cols.length - 1];
    if (last && a <= last.x1 + 1) last.x1 = Math.max(last.x1, b);
    else cols.push({ x0: a, x1: b });
  }
  return cols;
}

const mid = (t) => (t.x0 + t.x1) / 2;

// Some boxes hold two columns side by side with no border between them. Two values never share one cell,
// so when a line has two pieces in one box, the box is split where a gap runs clear down every line.
function splitByGaps(cols, lines, p, reasons) {
  const out = [];
  cols.forEach((c, i) => {
    const per = lines.map((l) => l.tokens.filter((t) => {
      const s = spanOf(cols, t);
      return s && s[0] === i && s[1] === i;
    }));
    if (!per.some((ts) => ts.length > 1)) {
      out.push(c);
      return;
    }
    const gaps = columnsFromGaps(per.flat());
    const fits = gaps.length > 1 && per.every((ts) => new Set(ts.map((t) => gaps.findIndex((g) => t.x0 >= g.x0 - 0.1 && t.x1 <= g.x1 + 0.1))).size === ts.length);
    if (!fits) {
      reasons.push(`two values share one cell in column ${i + 1} on page ${p}`);
      out.push(c);
      return;
    }
    gaps.forEach((g, k) => {
      const x0 = k === 0 ? c.x0 : (gaps[k - 1].x1 + g.x0) / 2;
      const x1 = k === gaps.length - 1 ? c.x1 : (g.x1 + gaps[k + 1].x0) / 2;
      out.push({ x0, x1, soft: k > 0 });
    });
  });
  return out;
}

// One piece of text alone on its line, crossing column edges where no border is drawn, and wide or bold.
function isGroupLine(reg, cols, l) {
  if (l.tokens.length !== 1) return false;
  const t = l.tokens[0];
  const span = spanOf(cols, t);
  if (!span || span[0] === span[1]) return false;
  if (cols.slice(span[0] + 1, span[1] + 1).some((c) => vAt(reg, c.x0, t.y))) return false;
  return t.bold || span[1] - span[0] + 1 >= cols.length / 2;
}

const valueLike = (t) => TICK.test(t.text) || DASH.test(t.text) || NUMBER.test(splitMarks(t.text).text);

/* ---------- One page of the table ---------- */

function readPagePart(reg, first, reasons) {
  const p = reg.page.n;
  const ruled = reg.v.length > 0 && reg.h.length > 0;
  const lines = reg.lines.map((l) => ({ ...l, tokens: tokensOf(reg, l) })).filter((l) => l.tokens.length);
  // A later page with no borders and only running text holds the rest of the footnotes.
  if (!ruled && !first && lines.every((l) => l.tokens.length <= 2)) return { reg, notesOnly: true, notes: lines };
  if (!ruled) reasons.push(`no cell borders on page ${p}, so columns come from gaps alone`);

  // Drawn lines may stop above the footnotes; text below the lowest border is notes.
  let tableLines = lines;
  let noteLines = [];
  if (ruled) {
    const floor = Math.min(...reg.h.map((r) => r.y), ...reg.v.map((r) => r.y0));
    tableLines = lines.filter((l) => l.y > floor);
    noteLines = lines.filter((l) => l.y <= floor);
  } else {
    const k = lines.findIndex((l) => new RegExp(`^(?:[${MARKS}]|Notes?:|\\d+\\)\\s)`).test(l.text));
    if (k >= 0) {
      tableLines = lines.slice(0, k);
      noteLines = lines.slice(k);
    }
  }
  if (!tableLines.length) {
    reasons.push(`no table text found on page ${p}`);
    return null;
  }

  // First guess at the columns, from every border, to find where the headings end.
  let cols = ruled ? columnsFrom(reg, -Infinity, Infinity) : columnsFromGaps(tableLines.flatMap((l) => l.tokens));
  const stubOf = (l) => l.tokens.find((t) => spanOf(cols, t)?.[0] === 0);
  let split = 0;
  for (let i = 0; i < tableLines.length; i++) {
    const l = tableLines[i];
    if (!l.tokens.every((t) => t.bold)) break;
    const stub = stubOf(l);
    const prev = tableLines[i - 1];
    const newBox = !prev || !stub || !ruled || hAcross(reg, (stub.x0 + stub.x1) / 2, l.top - 1, prev.bottom + 1).length > 0;
    const values = l.tokens.filter((t) => t !== stub && valueLike(t)).length;
    if (i > 0 && stub && newBox && values >= Math.max(1, (cols.length - 1) / 2)) break;
    split = i + 1;
  }
  // Headings are only bold at the top; a table with no plain text at all is read as all body.
  if (split === tableLines.length) split = 0;
  // A bold line on its own across many columns, boxed off from the headings, names the rows under it.
  while (split > 1 && isGroupLine(reg, cols, tableLines[split - 1]) && (!ruled || hAcross(reg, mid(tableLines[split - 1].tokens[0]), tableLines[split - 1].top - 1, tableLines[split - 2].bottom + 1).length)) split--;
  // So does a bold row label alone in the first column, under a border that runs the full width of the table.
  // A border is often drawn in pieces, one per column, so the pieces at one height are put together.
  const fullRule = (l, above) => {
    const between = reg.h.filter((r) => r.y > l.top - 1 && r.y < above.bottom + 1);
    return cluster(between.map((r) => r.y)).some((y) => {
      const pieces = between.filter((r) => Math.abs(r.y - y) <= SNAP).sort((a, b) => a.x0 - b.x0);
      let reach = cols[0].x0 + SNAP;
      for (const r of pieces) if (r.x0 <= reach + 2) reach = Math.max(reach, r.x1);
      return reach >= cols[cols.length - 1].x1 - SNAP;
    });
  };
  while (ruled && split > 1 && tableLines[split - 1].tokens.every((t) => spanOf(cols, t)?.[1] === 0) && fullRule(tableLines[split - 1], tableLines[split - 2])) split--;
  const headLines = tableLines.slice(0, split);
  const bodyLines = tableLines.slice(split);
  const bodyTop = Math.max(...bodyLines.map((l) => l.top));
  const bodyBottom = Math.min(...bodyLines.map((l) => l.bottom));
  if (ruled) cols = columnsFrom(reg, bodyBottom, bodyTop);
  else cols = columnsFromGaps(bodyLines.flatMap((l) => l.tokens));
  cols = splitByGaps(cols, bodyLines, p, reasons);
  if (cols.length < 2) {
    reasons.push(`fewer than two columns found on page ${p}`);
    return null;
  }

  return { reg, cols, head: readHeadings(reg, cols, headLines, ruled, reasons), body: bodyLines, bodyTop, bodyBottom, notes: noteLines, ruled };
}

// Each heading sits in a box drawn around it. A box over one column names it; a wider box groups the columns under it.
function readHeadings(reg, cols, lines, ruled, reasons) {
  const p = reg.page.n;
  // First find the drawn box around each piece of heading text.
  const found = [];
  for (const l of lines) {
    for (const t of l.tokens) {
      const span = spanOf(cols, t);
      if (!ruled) {
        if (!span || span[0] !== span[1]) reasons.push(`a heading on page ${p} could belong to more than one column`);
        else found.push({ t, span, box: `${span[0]}`, line: l });
        continue;
      }
      const left = Math.max(cols[0].x0, ...cols.map((c) => c.x0).filter((x) => x <= t.x0 + 1 && vAt(reg, x, t.y)));
      const right = Math.min(cols[cols.length - 1].x1, ...cols.map((c) => c.x1).filter((x) => x >= t.x1 - 1 && vAt(reg, x, t.y)));
      const inside = cols.map((c, i) => (c.x0 >= left - SNAP && c.x1 <= right + SNAP ? i : -1)).filter((i) => i >= 0);
      if (!inside.length || !span) {
        reasons.push(`a heading on page ${p} does not fit any column`);
        continue;
      }
      const m = mid(t);
      const above = reg.h.filter((r) => r.y > t.y + 0.3 * l.size && m >= r.x0 - 1 && m <= r.x1 + 1).map((r) => r.y);
      const below = reg.h.filter((r) => r.y <= t.y + 0.3 * l.size && m >= r.x0 - 1 && m <= r.x1 + 1).map((r) => r.y);
      const boxTop = above.length ? Math.min(...above) : Infinity;
      const boxBottom = below.length ? Math.max(...below) : -Infinity;
      // Borders inside one column can still split its heading into boxes side by side.
      const inner = reg.v.filter((r) => vAt(reg, r.x, t.y)).map((r) => r.x);
      const x = Math.max(-1e9, ...inner.filter((v) => v <= t.x0 + 1));
      const x1 = Math.min(1e9, ...inner.filter((v) => v >= t.x1 - 1));
      const level = Number.isFinite(boxTop) ? boxTop : 1e9;
      found.push({ t, span, range: [inside[0], inside[inside.length - 1]], box: `${inside[0]}-${inside[inside.length - 1]}@${boxTop}/${boxBottom}:${Math.round(x)}-${Math.round(x1)}`, x, level, line: l });
    }
  }
  // A box over several columns that has pieces side by side holds each column's own heading, read piece by piece.
  const split = new Set();
  for (const f of found) if (found.some((o) => o !== f && o.box === f.box && o.line === f.line)) split.add(f.box);
  const cells = new Map();
  for (const f of found) {
    const [first, last] = split.has(f.box) || !f.range ? f.span : f.range;
    const key = `${f.box}|${first}-${last}`;
    if (!cells.has(key)) cells.set(key, { first, last, y: f.t.y, x: f.x ?? 0, level: f.level ?? 0, parts: [] });
    cells.get(key).parts.push(f.t.text);
  }
  const heads = cols.map(() => ({ label: [], groups: [] }));
  for (const c of [...cells.values()].sort((a, b) => b.level - a.level || a.x - b.x || b.y - a.y)) {
    const text = { ...readText(c.parts), level: c.level };
    for (let i = c.first; i <= c.last; i++) {
      if (c.first === c.last) heads[i].label.push(text);
      else if (heads[i].label.length) reasons.push(`a heading over several columns sits under a column's own heading on page ${p}`);
      else heads[i].groups.push(text);
    }
  }
  return heads;
}

/* ---------- Rows ---------- */

// Reads the body of one page into rows. Returns rows whose cells are still lists of text pieces.
function readRows(part, stub, reasons) {
  const { reg, cols, body, ruled } = part;
  const p = reg.page.n;
  const rows = [];
  let colNumbers = null;
  const lines = [];
  for (const l of body) {
    if (l.tokens.every((t) => COL_NUMBER.test(t.text))) {
      colNumbers = l.tokens.map((t) => ({ n: Number(t.text.match(COL_NUMBER)[1]), span: spanOf(cols, t) }));
      continue;
    }
    if (isGroupLine(reg, cols, l)) {
      lines.push({ l, placed: [], group: l.tokens[0].text });
      continue;
    }
    const placed = [];
    for (const t of l.tokens) {
      const span = spanOf(cols, t);
      if (!span) {
        reasons.push(`text sits outside the columns on page ${p}`);
        continue;
      }
      if (span[0] !== span[1]) {
        // A box drawn across several columns holds one value that counts for each of them, like a merged cell.
        // The borders must show it: one at each end (or the table's edge), none inside, and every edge inside a real border elsewhere.
        const inner = cols.slice(span[0] + 1, span[1] + 1);
        const closed = (i, x) => i === 0 || i === cols.length || vAt(reg, x, t.y);
        const boxed = inner.every((c) => !c.soft && !vAt(reg, c.x0, t.y)) && closed(span[0], cols[span[0]].x0) && closed(span[1] + 1, cols[span[1]].x1);
        if (!boxed || span[0] <= stub) {
          reasons.push(`a value spreads over columns ${span[0] + 1} to ${span[1] + 1} on page ${p}`);
          continue;
        }
        t.span = span;
        for (let c = span[0]; c <= span[1]; c++) {
          if (placed.some((pc) => pc.col === c)) reasons.push(`two values share one cell in column ${c + 1} on page ${p}`);
          placed.push({ col: c, t });
        }
        continue;
      }
      if (placed.some((pc) => pc.col === span[0])) reasons.push(`two values share one cell in column ${span[0] + 1} on page ${p}`);
      placed.push({ col: span[0], t });
    }
    lines.push({ l, placed, group: null });
  }

  // Bands are the spaces between borders drawn across the label column. One band holds one or more rows.
  const labelMid = (cols[stub].x0 + cols[stub].x1) / 2;
  const cuts = ruled ? cluster(hAcross(reg, labelMid, -Infinity, Infinity).map((r) => r.y)).sort((a, b) => b - a) : [];
  const bandOf = (y) => cuts.filter((c) => c > y).length;
  // Row labels can nest by indent. A label with no values, whose next label starts further right, heads the rows under it
  // until a label starts as far left as it does.
  const labelX = (ln) => Math.min(...ln.placed.filter((pc) => pc.col === stub).map((pc) => pc.t.x0));
  const labelled = lines.filter((ln) => ln.placed.some((pc) => pc.col === stub));
  labelled.forEach((ln, i) => {
    const next = labelled[i + 1];
    if (next && !ln.placed.some((pc) => pc.col > stub) && labelX(next) > labelX(ln) + 3) ln.heading = true;
  });
  let group = null;
  let heads = [];
  const bands = new Map();
  for (const ln of lines) {
    if (ln.group) {
      group = ln.group;
      heads = [];
      continue;
    }
    if (!ln.placed.length) continue;
    if (labelled.includes(ln)) heads = heads.filter((h) => h.x < labelX(ln) - 3);
    if (ln.heading) {
      heads.push({ x: labelX(ln), text: readText(ln.placed.map((pc) => pc.t.text)).text });
      continue;
    }
    const b = bandOf(ln.l.y);
    if (!bands.has(b)) bands.set(b, []);
    bands.get(b).push({ ...ln, group, heads: heads.map((h) => h.text) });
  }
  for (const [b, list] of [...bands].sort((x, y) => x[0] - y[0])) {
    const anchors = list.filter((ln) => ln.placed.some((pc) => pc.col > stub));
    const owners = anchors.length > 1 ? anchors : [list.find((ln) => ln.placed.some((pc) => pc.col > stub)) || list[0]];
    const made = owners.map((ln) => ({ page: p, group: ln.group, heads: ln.heads, lines: [], band: b }));
    // Wrapped lines between two rows split where the space between lines is clearly widest, as a reader sees it.
    // Lines before the first row or after the last must run on with ordinary line spacing. Otherwise we cannot tell.
    const ordered = [...list].sort((x, y) => y.l.y - x.l.y);
    const rowOf = new Map(owners.map((o, k) => [o, k]));
    if (owners.length === 1) for (const ln of ordered) rowOf.set(ln, 0);
    else {
      const gap = (i) => Math.abs(ordered[i].l.y - ordered[i + 1].l.y);
      const near = (i) => gap(i) <= 1.3 * Math.max(ordered[i].l.size, ordered[i + 1].l.size);
      const at = ordered.map((ln, i) => (rowOf.has(ln) ? i : -1)).filter((i) => i >= 0);
      const unsure = () => reasons.push(`a wrapped line on page ${p} could belong to two rows`);
      // In a table with cell borders, a drawn line across the label column between two text lines is a row boundary,
      // and no line between them means they share one cell. Either way the drawing settles it, as it does for a reader.
      const labelCol = cols[stub];
      const ruleBetween = (i) => {
        if (!ruled || !labelCol) return null;
        const [upper, lower] = [ordered[i], ordered[i + 1]];
        const x = (labelCol.x0 + labelCol.x1) / 2;
        return hAcross(reg, x, lower.l.y + 0.7 * lower.l.size, upper.l.y - 0.1 * upper.l.size).length > 0;
      };
      for (let i = at[0] - 1; i >= 0; i--) {
        if (!near(i) && ruleBetween(i) !== false) {
          unsure();
          break;
        }
        rowOf.set(ordered[i], rowOf.get(ordered[at[0]]));
      }
      for (let i = at[at.length - 1] + 1; i < ordered.length; i++) {
        if (!near(i - 1) && ruleBetween(i - 1) !== false) {
          unsure();
          break;
        }
        rowOf.set(ordered[i], rowOf.get(ordered[at[at.length - 1]]));
      }
      for (let k = 0; k + 1 < at.length; k++) {
        const [from, to] = [at[k], at[k + 1]];
        if (to - from < 2) continue;
        const gaps = [];
        for (let i = from; i < to; i++) gaps.push(gap(i));
        // Exactly one drawn line between the two rows marks where one ends and the next begins.
        const drawn = [];
        for (let i = from; i < to; i++) if (ruleBetween(i)) drawn.push(i - from);
        if (drawn.length === 1) {
          for (let i = from + 1; i < to; i++) rowOf.set(ordered[i], rowOf.get(ordered[i <= from + drawn[0] ? from : to]));
          continue;
        }
        const widest = gaps.indexOf(Math.max(...gaps));
        const others = gaps.filter((_, i) => i !== widest);
        if (!others.every((g, i) => g * 1.3 <= gaps[widest] && near(from + (i < widest ? i : i + 1)))) {
          unsure();
          continue;
        }
        for (let i = from + 1; i < to; i++) rowOf.set(ordered[i], rowOf.get(ordered[i <= from + widest ? from : to]));
      }
    }
    for (const ln of list) if (rowOf.has(ln)) made[rowOf.get(ln)].lines.push(ln);
    rows.push(...made);
  }

  // Check the column numbers printed under the table, when there are any.
  if (colNumbers) {
    for (const { n, span } of colNumbers) if (!span || span[0] !== span[1] || span[0] !== n - 1) reasons.push(`Col. ${n} does not line up with column ${n} on page ${p}`);
    if (colNumbers.length !== cols.length) reasons.push(`the table numbers ${colNumbers.length} columns but ${cols.length} were found on page ${p}`);
  }

  const bandEdges = (band) => [band === 0 ? Infinity : cuts[band - 1], band < cuts.length ? cuts[band] : -Infinity];
  return rows.map((r) => {
    const cells = cols.map(() => []);
    for (const ln of r.lines.sort((x, y) => y.l.y - x.l.y)) for (const pc of ln.placed) cells[pc.col].push(pc.t);
    const pieces = cells.flat();
    let [hi, lo] = bandEdges(r.band);
    if (r.lines.length && (!Number.isFinite(hi) || !Number.isFinite(lo) || owners(r))) {
      hi = Math.max(...pieces.map((t) => t.top)) + 1;
      lo = Math.min(...pieces.map((t) => t.bottom)) - 1;
    }
    return { page: p, group: r.group, heads: r.heads, cells, hi, lo };
  });

  function owners(r) {
    return rows.filter((x) => x.band === r.band).length > 1;
  }
}

/* ---------- The whole table ---------- */

// Joins pieces of text, taking the footnote marks off the end of each one.
function readText(texts) {
  const notes = [];
  const words = [];
  for (const s of texts) {
    const part = splitMarks(s);
    words.push(part.text);
    for (const n of part.notes) if (!notes.includes(n)) notes.push(n);
  }
  // Each piece is its own line. A word broken at a line end, like "Nomi-" and "nal", is joined back with its hyphen,
  // because some words keep one. Inside a line, "single- and" keeps its space.
  let text = '';
  for (const w of words.filter(Boolean)) {
    if (/\p{L} ?-$/u.test(text) && /^\p{Ll}/u.test(w)) text = `${text.replace(/ -$/, '-')}${w}`;
    else text = text ? `${text} ${w}` : w;
  }
  return { text: tidy(text), notes };
}

function cellOf(texts, box) {
  const { text, notes } = readText(texts.map((t) => t.text));
  const mark = TICK.test(text) ? 'tick' : DASH.test(text) ? 'dash' : null;
  return { text, mark, notes, box };
}

function boxOf(dir, page, x0, x1, lo, hi) {
  const pts = [unturn(dir, x0, lo), unturn(dir, x1, hi)];
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  const r = (v) => Math.round(v * 10) / 10;
  return { page, x: r(Math.min(...xs)), y: r(Math.min(...ys)), w: r(Math.abs(xs[0] - xs[1])), h: r(Math.abs(ys[0] - ys[1])) };
}

function readNotes(lines) {
  const notes = [];
  const start = new RegExp(`^([${MARKS}]+)\\s*(.*)$`);
  for (const l of lines) {
    const text = l.text.replace(/^[Δ∆▲△]\s*/u, '');
    let m;
    if (/^Notes?:?$/.test(text)) continue;
    if ((m = text.match(start))) notes.push({ mark: m[1], text: m[2] });
    else if ((m = text.match(/^(\d+)\)\s+(.*)$/))) notes.push({ mark: `${m[1]})`, text: m[2] });
    else if (notes.length) notes[notes.length - 1].text = `${notes[notes.length - 1].text} ${text}`;
    else notes.push({ mark: null, text });
  }
  return notes;
}

// When two columns share one drawn box with no border between them, the first holds group names if each band
// between borders starts with a name there, and the name sits only on the band's top lines, with blanks below it.
function namesEachBand(part, i, has) {
  if (!part.cols[i + 1].soft) return false;
  const cuts = cluster(hAcross(part.reg, mid(part.cols[i + 1]), part.bodyBottom, part.bodyTop).map((r) => r.y));
  const bands = new Map();
  for (const l of part.body) {
    if (!l.tokens.length || isGroupLine(part.reg, part.cols, l)) continue;
    const b = cuts.filter((c) => c > l.y).length;
    if (!bands.has(b)) bands.set(b, []);
    bands.get(b).push(has(l, i));
  }
  if (bands.size < 2) return false;
  // Each band reads like [name, name, blank, blank]: at least one name, then only blanks.
  return [...bands.values()].every((marks) => marks[0] && marks.indexOf(false) !== -1 && !marks.slice(marks.indexOf(false)).includes(true)
    || marks.every(Boolean) && marks.length === 1);
}

// Why one page's columns cannot be read with another's, or null when they match.
function mismatch(first, part) {
  // Edges split by gaps alone move a little from page to page; drawn edges must line up.
  const near = (a, b, soft) => Math.abs(a - b) < (soft ? 15 : 3);
  const same = part.cols.length === first.cols.length && part.cols.every((c, i) => near(c.x0, first.cols[i].x0, c.soft || first.cols[i].soft) && near(c.x1, first.cols[i].x1, part.cols[i + 1]?.soft || first.cols[i + 1]?.soft));
  if (!same) return `the columns on page ${part.reg.page.n} do not match page ${first.reg.page.n}`;
  const labels = (h) => h.map((c) => [...c.groups, ...c.label].map((x) => x.text).join(' | ')).join(' || ');
  if (part.head.some((c) => c.label.length || c.groups.length) && labels(part.head) !== labels(first.head)) {
    return `the headings on page ${part.reg.page.n} do not match page ${first.reg.page.n}`;
  }
  return null;
}

// Splits a table into runs of pages that share their columns, and reads each run as a whole table.
// A page holding only footnotes goes with the run before it.
function sectionsOf(label, parts, noteParts) {
  const runs = [];
  for (const part of parts) {
    const run = runs[runs.length - 1];
    if (run && !mismatch(run.parts[0], part)) run.parts.push(part);
    else runs.push({ parts: [part] });
  }
  for (const np of noteParts) {
    const run = [...runs].reverse().find((r) => r.parts[0].reg.page.n < np.reg.page.n) || runs[0];
    run.notes = [...(run.notes || []), np];
  }
  return runs.map((run) => {
    const pageList = [...run.parts, ...(run.notes || [])].map((p) => p.reg.page).sort((a, b) => a.n - b.n);
    const t = readTable(label, pageList, { split: false });
    return { status: t.status, reasons: t.reasons, columns: t.columns, rows: t.rows, notes: t.notes, stub: t.stub, pages: pageList.map((p) => p.n) };
  });
}

// pages: page data from readPageData() in app/viewer.js, one per page the table is on, each with `lines` from readRulings().
// Without `lines` most tables come back 'unsure', because the borders are what show which box a value is in.
export function readTable(label, pages, { split = true } = {}) {
  const reasons = [];
  const result = { label, status: 'unsure', reasons, columns: [], rows: [], notes: [] };
  const parts = [];
  const noteParts = [];
  for (const page of pages || []) {
    const reg = regionOf(page, label, reasons);
    if (!reg) continue;
    const part = readPagePart(reg, !parts.length, reasons);
    if (part?.notesOnly) noteParts.push(part);
    else if (part) {
      if (noteParts.length) reasons.push(`more of the table follows its footnotes on page ${page.n}`);
      parts.push(part);
    }
  }
  if (!parts.length) {
    if (!reasons.length) reasons.push('no pages given');
    if (reasons.some((r) => r === GONE.deleted || r === GONE.diagram)) result.deleted = true;
    return result;
  }

  // The first page sets the columns. Later pages must have the same ones.
  const first = parts[0];
  for (const part of parts.slice(1)) {
    const why = mismatch(first, part);
    if (why) reasons.push(why);
  }
  if (reasons.some((r) => /do not match/.test(r))) {
    // Some tables change their columns from page to page. Each run of pages with the same columns is read as a table
    // of its own, in `sections`. The table itself stays unsure, so code that does not know sections still skips it.
    if (split) result.sections = sectionsOf(label, parts, noteParts);
    return result;
  }

  // The label column is the first one, unless the first holds group names that span several rows of the second.
  // That shows as more borders across the second column than the first, inside the body, with blanks in the first.
  let stub = 0;
  while (stub + 1 < first.cols.length - 1 && first.ruled) {
    const across = (i) => cluster(hAcross(first.reg, mid(first.cols[i]), first.bodyBottom, first.bodyTop).map((r) => r.y)).length;
    const has = (l, i) => l.tokens.some((t) => spanOf(first.cols, t)?.[0] === i && spanOf(first.cols, t)?.[1] === i);
    const blanks = first.body.some((l) => has(l, stub + 1) && !has(l, stub));
    if (blanks && (across(stub + 1) > across(stub) || namesEachBand(first, stub, has))) stub++;
    else break;
  }

  const all = first.head.map((h, i) => ({
    key: `c${i + 1}`,
    label: tidy(h.label.map((x, k) => (k && x.level === h.label[k - 1].level ? `/ ${x.text}` : x.text)).join(' ')),
    groups: h.groups.map((g) => g.text),
    notes: [...new Set([...h.groups, ...h.label].flatMap((x) => x.notes))],
  }));
  // A short table can be printed folded, its columns repeated side by side. Read it as one list: left half, then right.
  const sig = (c) => [...c.groups, c.label].join(' > ');
  let width = all.length;
  for (let k = stub + 2; k <= all.length / 2; k++) {
    if (all.length % k === 0 && all.every((c, i) => sig(c) === sig(all[i % k]))) {
      width = k;
      break;
    }
  }
  const columns = all.slice(0, width);
  const sigs = columns.map(sig).filter((x, i) => i > stub);
  if (new Set(sigs).size < sigs.length) reasons.push('two columns have the same heading');
  columns.forEach((c, i) => {
    if (!c.label && i > stub) reasons.push(`column ${i + 1} has no heading`);
  });

  const rows = [];
  let carried = null;
  for (const part of parts) {
    const raw = readRows(part, stub, reasons);
    for (let at = 0; at < part.cols.length; at += width) {
      const groupCells = [];
      for (const r of raw) {
        const box = (i) => boxOf(part.reg.dir, part.reg.page.n, part.cols[i].x0, part.cols[i].x1, r.lo, r.hi);
        if (r.group) carried = readText([r.group]).text;
        const own = r.cells.slice(at, at + width);
        // The last rows of a folded half can be left blank.
        if (at > 0 && own.every((c) => !c.length)) continue;
        // Columns left of the label column hold group names. A blank one carries down from the row above.
        const groups = [];
        for (let i = 0; i < stub; i++) {
          const { text } = readText(own[i].map((t) => t.text));
          if (text) groupCells[i] = text;
          if (!groupCells[i]) reasons.push(`a row on page ${part.reg.page.n} has no group name in column ${i + 1}`);
          groups.push(groupCells[i] || '');
        }
        const { text: labelText, notes } = readText(own[stub].map((t) => t.text));
        // A row with no label is kept for now: it may be half of a cell whose two values are stacked. That is settled below.
        const cells = {};
        for (let i = stub + 1; i < width; i++) {
          // A merged cell gets the box of the whole merged area, and says which columns it covers.
          const s = own[i].length && own[i].every((t) => t.span) ? own[i][0].span : null;
          const merged = s && own[i].every((t) => t.span[0] === s[0] && t.span[1] === s[1]) && s[0] >= at && s[1] < at + width;
          const b = merged ? boxOf(part.reg.dir, part.reg.page.n, part.cols[s[0]].x0, part.cols[s[1]].x1, r.lo, r.hi) : box(at + i);
          cells[columns[i].key] = cellOf(own[i], b);
          if (merged) cells[columns[i].key].span = [columns[s[0] - at].key, columns[s[1] - at].key];
        }
        rows.push({ key: `r${rows.length + 1}`, label: labelText, groups: [...(carried ? [carried] : []), ...groups, ...r.heads], notes, page: part.reg.page.n, cells });
      }
    }
  }
  // A row with no label and one filled cell, between two rows on its page, is a second value stacked in a box beside it.
  // It cannot be told which row it belongs to, so the cells above and below it in that column are marked unsure and the
  // rest of the table still reads. Any other row with no label leaves the whole table unsure, as before.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.label) continue;
    const filled = Object.entries(r.cells).filter(([, c]) => c.text);
    const above = rows[i - 1];
    const below = rows[i + 1];
    // Both neighbours must already hold their own value in that column. If one is blank, the value may be its missing
    // value, so the table stays unsure.
    const key = filled[0]?.[0];
    if (filled.length === 1 && above?.label && below?.label && above.page === r.page && below.page === r.page && above.cells[key]?.text && below.cells[key]?.text) {
      for (const n of [above, below]) if (n.cells[key]) n.cells[key].unsure = 'two values are stacked near this box, so it is not clear which is this row\'s';
      rows.splice(i, 1);
      i--;
    } else reasons.push(`a row on page ${r.page} has values but no label`);
  }
  rows.forEach((r, i) => {
    r.key = `r${i + 1}`;
  });
  if (!rows.length) reasons.push('no rows found');

  const seen = new Map();
  for (const r of rows) {
    const k = [...r.groups, r.label, ...r.notes].join(' | ');
    if (seen.has(k)) reasons.push(`two rows read the same: ${r.key} and ${seen.get(k)}`);
    else seen.set(k, r.key);
  }

  const notes = readNotes([...parts, ...noteParts].flatMap((p) => p.notes));
  const known = new Set(notes.map((n) => n.mark));
  const used = new Set([...columns.flatMap((c) => c.notes), ...rows.flatMap((r) => [...r.notes, ...Object.values(r.cells).flatMap((c) => c.notes)])]);
  for (const m of used) if (!known.has(m)) reasons.push(`the mark ${m} has no footnote under the table`);

  result.columns = columns;
  result.rows = rows;
  result.notes = notes;
  result.stub = stub;
  result.folded = width < all.length;
  result.status = reasons.length ? 'unsure' : 'sure';
  // Keep each reason once.
  result.reasons = [...new Set(reasons)];
  return result;
}

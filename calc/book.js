// Shared reading for the calculators. Every value comes from the owner's book at run time: table cells through
// app/tables.js and numbers inside a rule's own wording. If a value cannot be read clearly, the answer is not sure.
// No values from the book are written here.
import { splitRule } from '../check-rules.js?v=a32e38e3';
import { sizeKey } from '../check-numbers.js?v=a32e38e3';

// Where each calculator reads. Rule and table numbers only, never their contents. The Lead can change these in one place.
export const PLACES = {
  boxFill: { rule: '12-3034', perConductor: '22', boxes: '23' },
  conduitFill: { rule: '12-910', fill: '8', areas: ['6A', '6B', '6C', '6D', '6E', '6F', '6G', '6H', '6I', '6J', '6K'], conduits: ['9A', '9B', '9C', '9D', '9E', '9F', '9G', '9H'] },
  dwelling: { rule: '8-200' },
  correction: { rule: '4-004', ampacity: { copper: '2', aluminum: '4' }, heat: '5A', many: '5C' },
  motor: { conductors: '28-106', overcurrent: '28-200', percent: '29', threePhase: '44', singlePhase: '45', ampacity: { copper: '2', aluminum: '4' } },
};

export class NotSure extends Error {}
export const notSure = (why) => ({ status: 'not-sure', result: null, steps: [], why: [why] });
export const done = (result, steps) => ({ status: 'done', result, steps, why: [] });

// ctx.table(id) gives a table from readTable(), with its pdf page in `page` if known. ctx.rule(id) gives { text, page }.
export function table(ctx, id) {
  const t = ctx.table(id);
  if (!t || t.deleted) throw new NotSure(`Table ${id} could not be found in the book.`);
  if (t.status === 'sure') return t;
  const sure = (t.sections || []).filter((s) => s.status === 'sure');
  if (sure.length === 1) return { ...sure[0], label: id };
  throw new NotSure(`Table ${id} does not read clearly.`);
}

// The row of a size table for one conductor size, like "12" or "1/0".
export function rowForSize(t, size) {
  const want = sizeKey(String(size).trim().replace(/^(#|No\.?\s*)/i, '').replace(/\s*(awg|kcmil)$/i, ''));
  const rows = t.rows.filter((r) => sizeKey(r.label.trim()) === want);
  if (rows.length !== 1) throw new NotSure(rows.length ? `More than one row of Table ${t.label} is size ${size}.` : `Table ${t.label} has no row for size ${size}.`);
  return rows[0];
}

// One number from a cell. Unsure cells, footnote marks and anything but one plain number mean not sure.
// allow: footnote marks that were read and found not to change this calculation.
export function cellNumber(t, row, column, allow = []) {
  const c = row.cells[column.key];
  if (!c || c.unsure) throw new NotSure(`The cell for ${row.label} in Table ${t.label} does not read clearly.`);
  const marks = [...(c.notes || []), ...(row.notes || []), ...(column.notes || [])].filter((m) => !allow.includes(m));
  if (marks.length) throw new NotSure(`A footnote applies to ${row.label} in Table ${t.label}, so it has to be read by hand.`);
  const text = c.text.trim().replace(/(\d) (?=\d{3}\b)/g, '$1');
  if (!/^\d*\.?\d+$/.test(text)) throw new NotSure(`The cell for ${row.label} in Table ${t.label} is not one number.`);
  return Number(text);
}

// The one value column of a two-column table, or the column whose heading holds all the given words.
export function columnWith(t, words = []) {
  const values = t.columns.slice((t.stub ?? 0) + 1);
  if (!words.length) {
    if (values.length !== 1) throw new NotSure(`Table ${t.label} has more than one column of values.`);
    return values[0];
  }
  const has = (c) => words.every((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu').test([...c.groups, c.label].join(' ')));
  const hits = values.filter(has);
  if (hits.length !== 1) throw new NotSure(hits.length ? `More than one column of Table ${t.label} fits.` : `No column of Table ${t.label} fits.`);
  return hits[0];
}

// A number with a given unit written in one part of a rule, like the "1)" or "2) a)" part. Exactly one must be there.
export function ruleNumber(ctx, id, path, unit, nth = 0) {
  const r = ctx.rule(id);
  if (!r?.text) throw new NotSure(`Rule ${id} could not be read.`);
  const part = splitRule(r.text.replace(/^[\sΔ∆▲△]*\d{1,2}-\d{3,4}\s*/, '')).find((p) => p.path.join(' ') === path);
  if (!part) throw new NotSure(`Part ${path} of Rule ${id} could not be found.`);
  // Numbers can be written with a space between thousands, like "24 000".
  const re = new RegExp(`(?<![\\d.])(\\d{1,3}(?: \\d{3})+|\\d*\\.?\\d+)\\s*${unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\d])`, 'gu');
  const found = [...part.text.matchAll(re)].map((m) => Number(m[1].replace(/ /g, '')));
  if (found.length <= nth) throw new NotSure(`Part ${path} of Rule ${id} does not give a value in ${unit}.`);
  return { value: found[nth], count: found.length, page: r.page ?? null };
}

// Runs a calculator body and turns a NotSure into the not-sure result.
export function guard(fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof NotSure) return notSure(e.message);
    throw e;
  }
}
export const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

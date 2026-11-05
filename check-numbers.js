// Answers questions that want a number from a table: an ampacity, a size, a fill, a correction factor.
// Plain code, no AI, no DOM and no network. It reads the table the way a person does: the table, then the row, then the column.
// It names a choice only when exactly one table, one row, one column and one choice fit. Anything else is "not sure".
// It holds no wording or values from the book. Those come from the owner's book at run time.
import { wordsOf as bookWords } from './rules.js?v=344d272b';

const notSure = (why, extra = {}) => ({ status: 'not-sure', choice: null, evidence: [], why: [why], mistake: null, ...extra });

// Words that say nothing about which table, row or column is meant.
const PLAIN = new Set(`a an and are as at be by for from has have how in into is it its of on or the this to what which with
size sizes awg kcmil mcm number no conductor conductors table tables value values given shown per used use rated rating ratings column columns
mm mm2 ml m a v in3`.split(/\s+/));
// Words in a simple form, so "ampacities" and "ampacity" match.
const wordsOf = (text) => bookWords(text).map((w) => (w.length > 4 && w.endsWith('ie') ? `${w.slice(0, -2)}y` : w));
const plainWords = (text) => wordsOf(text).filter((w) => !PLAIN.has(w));

/* ---------- Sizes and numbers as people write them ---------- */

// The book writes 1/0 as 0, 2/0 as 00 and so on.
const AUGHT = { '1/0': '0', '2/0': '00', '3/0': '000', '4/0': '0000' };
export const sizeKey = (s) => AUGHT[s] || s.replace(/^0+(?=[1-9])/, '');

// Conductor sizes in a piece of text: "#6", "No. 6", "6 AWG", "500 kcmil", "1/0" and "2/0 AWG".
export function sizesIn(text) {
  const out = [];
  const add = (s) => {
    const k = sizeKey(s);
    if (!out.includes(k)) out.push(k);
  };
  const t = String(text);
  for (const m of t.matchAll(/(?:#|\bNo\.?\s*|\bnumber\s+)(\d{1,2}(?:\/0)?)(?![\d.])/gi)) add(m[1]);
  for (const m of t.matchAll(/\b(\d{1,4}(?:\/0)?)\s*-?\s*(?:awg|kcmil|mcm)\b/gi)) add(m[1]);
  for (const m of t.matchAll(/(?<![\d/.])([1-4]\/0)\b/g)) add(m[1]);
  return out;
}

// Numbers in a piece of text, ignoring units: "65 A" gives 65, ".88" gives 0.88 and "1,000" gives 1000.
export function numbersIn(text) {
  return [...String(text).matchAll(/(?<![\d.])(\d{1,3}(?:,\d{3})+|\d*\.\d+|\d+)(?![\d.])/g)].map((m) => Number(m[1].replace(/,/g, '')));
}

// A cell that holds one plain number, like "65" or "0.88". Ranges, dashes and stacked values do not count.
const ONE_NUMBER = /^\d{1,3}(?:,\d{3})+$|^\d*\.?\d+$/;
const cellNumber = (cell) => (cell && !cell.mark && ONE_NUMBER.test(cell.text.trim()) ? Number(cell.text.trim().replace(/,/g, '')) : null);

// Numbers in the question that are not a size, a temperature or a percent.
function plainNumbers(stem) {
  const rest = String(stem)
    .replace(/(?:#|\bNo\.?\s*)\d+(?:\/0)?|\b\d+(?:\/0)?\s*-?\s*(?:awg|kcmil|mcm)\b/gi, ' ')
    .replace(/\d{2,3}\s*(?:°|º|degrees?\b|deg\b)\s*C?\b|\b\d{2,3}\s*C\b/gi, ' ')
    .replace(/\d+(?:\.\d+)?\s*%/g, ' ');
  return [...new Set(numbersIn(rest))];
}

// Temperatures in the question, like "75 °C", "75°C", "75 C" or "75 degrees".
const temperaturesIn = (text) => [...String(text).matchAll(/(\d{2,3})\s*(?:°|º|degrees?\b|deg\b)\s*C?\b|\b(\d{2,3})\s*C\b/gi)].map((m) => m[1] || m[2]);

/* ---------- Footnotes that were read and found not to change the answer ---------- */

// Each entry was checked by reading the note in the owner's book. A mark that is not listed always means not sure.
// `unless` lists the words that would bring the note into play. If the question uses any of them, it is not sure.
// These are short trigger words only, never the note's own wording.
const OVERCURRENT = /\b(overcurrent|breakers?|fuses?|fused|protect\w*|trip)\b/i;
const MORE_THAN_THREE = /\b(more than (three|3)|over (three|3)|([4-9]|\d{2,})\s+(insulated\s+|current[- ]carrying\s+)?conductors|four|five|six|seven|eight|nine|ten|correction|correct|derat\w*|bundled?)\b/i;
const TYPE_CODE = /\b[A-Z]{1,5}\d{2,3}[A-Z]*\b/; // An insulation type such as one written with letters then a temperature.
const SHEATHED = /\bsheath\w*\b/i;
const MINERAL = /\bmineral\b|\bdeviation\b/i;
export const CHECKED_NOTES = {
  1: { '†': SHEATHED, '§': MINERAL, '**': OVERCURRENT },
  2: { '†': SHEATHED, '‡': TYPE_CODE, '††': MORE_THAN_THREE, '**': MINERAL, '§': OVERCURRENT },
  3: { '†': SHEATHED, '‡': TYPE_CODE, '§': OVERCURRENT },
  4: { '†': SHEATHED, '‡': TYPE_CODE, '§': MORE_THAN_THREE, '**': OVERCURRENT },
  '5A': { '†': null },
  29: { '*': null },
};
// Conditions that change a plain table reading whatever the notes say, such as a correction for heat or for many conductors.
// A question that names one is a calculation, so a single cell does not settle it.
const CONDITIONS = /\b(ambient|correction|correct(ed)?|derat\w*|multipl\w*|nameplate|power factor|bundled?|in contact|spaced|layers?)\b/i;

// The marks on a row, a column and a cell, and whether each one is safe for this question.
function markTrouble(table, row, column, cell, stem, checkedNotes) {
  const marks = [...new Set([...(row.notes || []), ...(column.notes || []), ...(cell.notes || [])])];
  const checked = checkedNotes[table.label] || {};
  for (const m of marks) {
    if (!(m in checked)) return `A footnote mark ${m} sits on this row, column or cell of Table ${table.label}, and it has not been checked.`;
    const unless = checked[m];
    if (unless && unless.test(stem)) return `Footnote ${m} of Table ${table.label} could change the answer for this question.`;
  }
  return null;
}

// Words in many table titles that say nothing about what one table is for.
const GENERIC = new Set(wordsOf('minimum maximum min max rating ratings setting settings allowable permitted required various type types based more less than not'));

// Everyday words in notes that do not, on their own, point to a special case.
const NOTE_PLAIN = new Set(wordsOf('apply applies applied applying shall permitted required used where when than also only these those this that such other given based'));

// Words in the notes that hang on no mark, which apply to the whole table. A question that uses one of their own words
// may be the case the note changes, so it is not sure. Words already in the table's title, row or column do not count.
function generalNoteTrouble(table, row, column, stem) {
  const marked = new Set([...table.columns.flatMap((c) => c.notes || []), ...table.rows.flatMap((r) => [...(r.notes || []), ...Object.values(r.cells).flatMap((c) => c.notes || [])])]);
  const known = new Set([...NOTE_PLAIN, ...plainWords([table.title || '', row.label, ...(row.groups || []), ...table.columns.flatMap((c) => [c.label, ...c.groups])].join(' '))]);
  const asked = new Set(plainWords(stem));
  for (const n of table.notes || []) {
    if (n.mark && marked.has(n.mark)) continue;
    const hit = plainWords(n.text).find((w) => asked.has(w) && !known.has(w) && !/^\d+$/.test(w) && w.length > 3);
    if (hit) return `A note under Table ${table.label} covers "${hit}", so it may change the answer.`;
  }
  return null;
}

// A number far bigger or smaller than the numbers on both sides of it in its row may be a misread, such as two values
// run together. Real tables change step by step.
function outOfLine(table, row, column) {
  const values = table.columns.slice((table.stub ?? 0) + 1);
  const at = values.indexOf(column);
  const v = cellNumber(row.cells[column.key]);
  const left = at > 0 ? cellNumber(row.cells[values[at - 1].key]) : null;
  const right = at < values.length - 1 ? cellNumber(row.cells[values[at + 1].key]) : null;
  if (!v || !left || !right) return false;
  return (v > 5 * left && v > 5 * right) || (v * 5 < left && v * 5 < right);
}

/* ---------- The table, the row and the column ---------- */

// Two tables printed the same way, with the same column headings, that differ only in their title, like copper and aluminum.
export function twins(a, b) {
  if (a.columns.length !== b.columns.length || a.columns.length < 2) return false;
  const sig = (c) => [...c.groups, c.label].join(' > ').toLowerCase();
  const same = a.columns.filter((c, i) => sig(c) === sig(b.columns[i])).length;
  return same / a.columns.length >= 0.5;
}

// The words of a table's title that the question must not contradict. Two tables that differ only in, say, copper and
// aluminum are told apart by the word the question uses.
export function titleFits(stem, table, others = []) {
  const asked = new Set(plainWords(stem));
  const own = new Set(plainWords(table.title || ''));
  for (const o of others) {
    if (o === table || !twins(o, table)) continue;
    for (const w of plainWords(o.title || '')) if (asked.has(w) && !own.has(w)) return { fits: false, word: w, other: o.label };
  }
  return { fits: true };
}

// A table whose rows are conductor sizes, written AWG or kcmil.
const isSizeTable = (table) => /\bawg\b|\bkcmil\b/i.test([table.columns[table.stub ?? 0]?.label, ...(table.columns[table.stub ?? 0]?.groups || [])].join(' '));
// A row label that is a range, like "7–24", and the two ends.
// Open ends are written "43 and up", "25 or more", "165 or less" and "Over 750".
const rangeOf = (label) => {
  const t = String(label).trim();
  let m;
  if ((m = t.match(/^(\d+)\s*[–—-]\s*(\d+)$/))) return [Number(m[1]), Number(m[2])];
  if ((m = t.match(/^(\d+)\s+(?:and up|and over|or more)$/i))) return [Number(m[1]), Infinity];
  if ((m = t.match(/^(\d+)\s+or less$/i))) return [0, Number(m[1])];
  if ((m = t.match(/^over\s+(\d+)$/i))) return [Number(m[1]) + 1e-9, Infinity];
  return null;
};

// The rows whose label is the asked size, or whose whole name is in the question.
function rowsFor(stem, table) {
  const asked = new Set(wordsOf(stem));
  const groupsFit = (r) => (r.groups || []).every((g) => {
    const words = plainWords(g);
    return !words.length || words.every((w) => asked.has(w));
  });
  if (isSizeTable(table)) {
    const sizes = sizesIn(stem);
    if (sizes.length !== 1) return { rows: [], why: sizes.length ? 'The question names more than one size.' : 'The question names no conductor size.' };
    const rows = table.rows.filter((r) => sizeKey(r.label.trim()) === sizes[0] && groupsFit(r));
    return { rows, size: sizes[0] };
  }
  // A row that is a range fits when exactly one plain number in the question falls inside it.
  if (table.rows.length && table.rows.every((r) => rangeOf(r.label))) {
    const nums = plainNumbers(stem);
    if (nums.length !== 1) return { rows: [], why: nums.length ? 'The question has more than one number that could pick the row.' : 'The question has no number to pick the row.' };
    return { rows: table.rows.filter((r) => groupsFit(r) && rangeOf(r.label)[0] <= nums[0] && nums[0] <= rangeOf(r.label)[1]) };
  }
  // A row named by a plain number or a fraction, like "5", "1/2" or "1-1/2", fits only that whole number in the question.
  const tokens = numberTokens(stem);
  const fitting = table.rows.map((r) => ({ r, own: isNumberLabel(r.label) ? [r.label.trim()] : plainWords(r.label) })).filter(({ r, own }) => {
    if (!own.length) return false;
    if (isNumberLabel(r.label)) return tokens.includes(r.label.trim()) && groupsFit(r);
    return own.every((w) => asked.has(w)) && groupsFit(r);
  });
  const longest = Math.max(0, ...fitting.map(({ own }) => own.length));
  let rows = fitting.filter(({ own }) => own.length === longest).map(({ r }) => r);
  // When two numbers in the question each name a row, the heading of the row labels decides, as in "an ambient
  // temperature of 40 °C": the number written next to that heading's own word picks the row.
  if (rows.length > 1 && rows.every((r) => isNumberLabel(r.label))) {
    const values = table.columns.slice((table.stub ?? 0) + 1);
    const elsewhere = new Set(values.flatMap((c) => plainWords([...c.groups, c.label].join(' '))));
    const key = plainWords(table.columns[table.stub ?? 0]?.label || '').filter((w) => !elsewhere.has(w) && !/^\d/.test(w) && w.length > 3);
    const picked = numberNextTo(stem, key);
    if (picked !== null) rows = rows.filter((r) => r.label.trim() === picked);
  }
  return { rows };
}

const NUMBER_LABEL = /^\d+(?:-\d+\/\d+|\/\d+|\.\d+)?$/;
const isNumberLabel = (label) => NUMBER_LABEL.test(String(label).trim());
// Whole numbers in the question as written: "1-1/2", "3/4", "0.5", "40".
const numberTokens = (stem) => String(stem).match(/\d+-\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?/g) || [];

// The number written closest to one of the given words, within a few words of it. Null when there is none or it is unclear.
function numberNextTo(stem, words) {
  if (!words.length) return null;
  const text = String(stem);
  const found = [];
  for (const m of text.matchAll(/[\p{L}]+/gu)) {
    if (!words.includes(wordsOf(m[0])[0])) continue;
    let best = null;
    for (const n of text.matchAll(/\d+-\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?/g)) {
      const gap = n.index > m.index ? n.index - (m.index + m[0].length) : m.index - (n.index + n[0].length);
      if (gap <= 30 && (!best || gap < best.gap)) best = { gap, n: n[0] };
    }
    if (best) found.push(best.n);
  }
  return new Set(found).size === 1 ? found[0] : null;
}

// The value columns whose heading fits the question. With only one value column, that one fits.
// Every word that sets a column's own label apart must be in the question. Where the columns sit under different group
// headings, at least one word that sets its group apart must be there too.
function columnsFor(stem, table, row, used) {
  const values = table.columns.slice((table.stub ?? 0) + 1);
  if (values.length === 1) return values;
  const asked = new Set(wordsOf(stem));
  const temps = new Set(temperaturesIn(stem));
  const nums = new Set(numberTokens(stem));
  if (used) {
    nums.delete(used);
    temps.delete(used);
  }
  // A heading's words, with numbers kept whole, so "25.4" stays one number.
  const clean = (t) => {
    const text = String(t).replace(/[([]?\s*see notes?\b[^)\]]*[)\]]?/gi, ' ');
    return [...numberTokens(text), ...wordsOf(text.replace(/\d+-\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?/g, ' '))].filter((w) => !PLAIN.has(w));
  };
  const shared = values.map((c) => clean([...c.groups, c.label].join(' '))).reduce((a, b) => a.filter((w) => b.includes(w)));
  const fits = (w, hot) => (/^\d/.test(w) ? temps.has(w) || (!hot && nums.has(w)) : asked.has(w));
  return values.filter((c) => {
    const hot = /°\s*C/i.test([...c.groups, c.label].join(' '));
    const label = clean(c.label).filter((w) => !shared.includes(w));
    const group = clean(c.groups.join(' ')).filter((w) => !shared.includes(w) && !label.includes(w));
    if (!label.length && !group.length) return false;
    // A label written as a list, like "Duplex, triplex", fits when one part of the list is named in full.
    const parts = c.label.split(/,|\bor\b/i).map((x) => clean(x).filter((w) => !shared.includes(w))).filter((x) => x.length);
    const labelFits = !label.length || parts.some((part) => part.every((w) => fits(w, hot)));
    return labelFits && (!group.length || group.some((w) => fits(w, hot)));
  });
}

/* ---------- Questions this file leaves alone ---------- */

// "What is the smallest size that can carry 60 A?" runs the table backwards and needs a rule as well, so it is left for now.
// It shows as a table of sizes, a question that names no size, and choices that are sizes.
export function asksSmallest(f, table) {
  if (/\b(smallest|largest|minimum size|maximum size|min\.? size)\b/i.test(f.stem) && isSizeTable(table)) return true;
  return isSizeTable(table) && !sizesIn(f.stem).length && f.options.length > 1 && f.options.every((o) => sizesIn(o.text).length || /^\s*\d{1,4}(?:\/0)?\s*$/.test(o.text));
}
const isCorrectionTable = (table) => /\b(correction|factors?)\b/i.test(table.title || '');

/* ---------- The whole check ---------- */

// f: what findInBook found, with the question's stem and options. table: one table from readTable().
// others: the other tables that might fit, so a sibling table with the same row can be told apart or warned about.
// checked: the footnotes read and found safe, by table. Tests pass their own.
export function checkNumbers(f, table, { others = [], checked = CHECKED_NOTES } = {}) {
  const stem = f.stem;
  if (table.status !== 'sure' || table.deleted) return notSure(`Table ${table.label} does not read clearly.`);
  if (f.negated?.length || (f.watch || []).some((w) => /\b(not|no|except|unless|without|never)\b/.test(w))) return notSure('The question turns on a negative, so it has to be read by hand.');
  if (asksSmallest(f, table)) return notSure('It asks for the smallest or largest size, which needs a rule as well as a table.', { smallest: true });
  // A table of correction factors is where those conditions are read, so they only block the other tables.
  if (CONDITIONS.test(stem) && !isCorrectionTable(table)) return notSure('The question adds a condition, like heat or many conductors, so the table alone does not settle it.');

  // The question has to name what the table is about, not just a heading inside it.
  const asked = new Set(plainWords(stem));
  if (!plainWords(table.title || '').some((w) => asked.has(w) && !GENERIC.has(w))) return notSure(`The question does not name what Table ${table.label} is about.`);
  const title = titleFits(stem, table, others);
  if (!title.fits) return notSure(`The word "${title.word}" fits Table ${title.other}, not Table ${table.label}.`);

  const { rows, why: rowWhy, size } = rowsFor(stem, table);
  if (!rows.length) return notSure(rowWhy || `No row of Table ${table.label} fits the question.`);
  if (rows.length > 1) return notSure(`More than one row of Table ${table.label} fits the question.`);
  const [row] = rows;

  // The number that picked the row cannot also pick the column.
  const cols = columnsFor(stem, table, row, size ?? (isNumberLabel(row.label) ? row.label.trim() : null));
  if (!cols.length) return notSure(`No column of Table ${table.label} fits the question.`);
  if (cols.length > 1) return notSure(`More than one column of Table ${table.label} fits the question.`);
  const [column] = cols;
  if (/see note/i.test(column.label)) return notSure(`Column ${column.label} of Table ${table.label} points to a note.`);

  const cell = row.cells[column.key];
  if (!cell || cell.unsure) return notSure(`That cell of Table ${table.label} does not read clearly.`);
  const value = cellNumber(cell);
  if (value === null) return notSure(`That cell of Table ${table.label} does not hold one plain number.`);
  if (outOfLine(table, row, column)) return notSure(`That cell of Table ${table.label} is far out of line with the cells beside it, so it needs a check by eye.`);

  const trouble = markTrouble(table, row, column, cell, stem, checked) || generalNoteTrouble(table, row, column, stem);
  if (trouble) return notSure(trouble);

  const has = (o, v) => numbersIn(o.text).includes(v);
  const backed = f.options.filter((o) => has(o, value));
  if (backed.length !== 1) return notSure(backed.length ? `${backed.length} choices hold the same number.` : `No choice holds the number in Table ${table.label}.`);
  const option = backed[0];

  const heading = [...column.groups, column.label].filter(Boolean).join(', ');
  const rowName = [...(row.groups || []), row.label].filter(Boolean).join(', ');
  const why = [
    { head: `Table ${table.label}`, say: others.length > 1 ? 'Its title fits the question, and the similar tables do not.' : 'Its title fits the question.' },
    { head: `Row ${rowName}`, say: size ? `The question names size ${row.label}.` : 'The row name is in the question.' },
    { head: `Column ${heading}`, say: table.columns.length - (table.stub ?? 0) - 1 > 1 ? 'The question names this column and no other.' : 'This table has one column of values.' },
    { head: 'Read where they meet', say: `That cell matches choice ${option.letter}.` },
  ];

  // The most useful warning: a neighbouring column, or the same row in a similar table, that gives another choice.
  let mistake = null;
  const values = table.columns.slice((table.stub ?? 0) + 1);
  const at = values.indexOf(column);
  for (const near of [values[at - 1], values[at + 1]].filter(Boolean)) {
    const v = cellNumber(row.cells[near.key]);
    const wrong = v !== null && f.options.find((o) => o !== option && has(o, v));
    if (wrong) {
      mistake = `Reading the next column, ${[...near.groups, near.label].join(', ')}. It gives ${wrong.letter}.`;
      break;
    }
  }
  if (!mistake) {
    for (const o of others) {
      if (o === table || o.status !== 'sure') continue;
      const twin = o.rows.find((r) => r.label === row.label && (r.groups || []).join('|') === (row.groups || []).join('|'));
      const col = twin && o.columns.find((c) => c.label === column.label && c.groups.join('|') === column.groups.join('|'));
      const v = col && cellNumber(twin.cells[col.key]);
      const wrong = v != null && f.options.find((x) => x !== option && has(x, v));
      if (wrong) {
        mistake = `Reading Table ${o.label} instead. The same row and column there gives ${wrong.letter}.`;
        break;
      }
    }
  }

  return {
    status: 'answer',
    choice: option.letter,
    evidence: [{ kind: 'table', ref: table.label, page: row.page, box: cell.box ?? null }],
    why,
    mistake,
  };
}

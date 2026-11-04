// Tests each answer choice against the book. Plain code, no AI.
// It names a choice only when exactly one has the book behind it. Anything else is "not sure", because a wrong answer is far worse.
import { findInBook } from './finder.js?v=69e81bc8';
import { wordsOf } from './rules.js?v=69e81bc8';
import { readTable as readBookTable } from './tables.js?v=69e81bc8';

const JOINING = new Set(['and', 'or', 'of', 'the', 'a', 'an', 'in', 'on', 'to', 'for', 'with', 'use', 'used']);
const meaningful = (text) => wordsOf(text).filter((w) => !JOINING.has(w));
const notSure = (...why) => ({ status: 'not-sure', choice: null, evidence: [], why });

// Checks one table that reads clearly against the question. Works on tables of ticks and dashes.
export function checkTable(f, table) {
  const asked = new Set(wordsOf(f.stem));
  // The row whose whole name is in the question. When one name sits inside another, the longer one is meant.
  const fitting = table.rows.map((row) => ({ row, own: meaningful(row.label) })).filter(({ own }) => own.length && own.every((w) => asked.has(w)));
  if (!fitting.length) return notSure(`No row of Table ${table.label} fits the question.`);
  const longest = Math.max(...fitting.map(({ own }) => own.length));
  const best = fitting.filter(({ own }) => own.length === longest);
  if (best.length > 1) return notSure(`More than one row of Table ${table.label} fits the question.`);
  const { row } = best[0];

  // Column headings the question names, like "indoor", narrow the columns. A heading only counts if the question names all of it.
  const headingOf = (c) => c.groups[c.groups.length - 1] || '';
  const named = new Set(table.columns.map(headingOf).filter((h) => meaningful(h).length && meaningful(h).every((w) => asked.has(w))));
  const open = table.columns.filter((c) => !named.size || named.has(headingOf(c)));

  // Each choice must name one column, like "Type 13" naming column 13.
  const columnWords = (c) => wordsOf(c.label.replace(/[^\p{L}\p{N} ]+/gu, ' '));
  const choiceColumn = f.options.map((o) => {
    const words = new Set(wordsOf(o.text));
    const hits = table.columns.filter((c) => columnWords(c).length && columnWords(c).every((w) => words.has(w)));
    return { option: o, column: hits.length === 1 ? hits[0] : null };
  });
  if (choiceColumn.filter((x) => x.column).length < 2) return notSure(`The choices do not match the columns of Table ${table.label}.`);

  const ticked = (r, c) => r.cells[c.key]?.mark === 'tick';
  const backed = choiceColumn.filter((x) => x.column && open.includes(x.column) && ticked(row, x.column));
  if (backed.length !== 1) return notSure(backed.length ? `${backed.length} choices fit this row of Table ${table.label}.` : `No choice has a tick in this row of Table ${table.label}.`);
  const { option, column } = backed[0];

  const openTicks = open.filter((c) => ticked(row, c)).length;
  const heading = named.size ? headingOf(column) : '';
  const why = [];
  if (heading) {
    const own = meaningful(heading).map((w) => (f.stem.match(/[\p{L}\p{N}]+/gu) || []).find((t) => wordsOf(t)[0] === w) || w);
    why.push({ head: `"${own.join(' ')}"`, say: `Only read the ${heading} columns.` });
  }
  why.push({ head: `"${row.label.toLowerCase()}"`, say: `That is one exact row in Table ${table.label}.` });
  why.push({ head: 'Read across that row', say: openTicks === 1 ? `Only one ${heading ? `${heading} ` : ''}column has a tick: ${column.label}.` : `Column ${column.label} has a tick, and it is the only one of your choices that does.` });

  // A row with similar words that would back a different choice is the mistake to warn about.
  const rowWords = new Set(meaningful(row.label));
  let mistake = null;
  for (const other of table.rows) {
    if (other === row || meaningful(other.label).filter((w) => rowWords.has(w)).length < 2) continue;
    const wrong = choiceColumn.find((x) => x.column && x.option !== option && open.includes(x.column) && ticked(other, x.column));
    if (wrong) {
      mistake = `Reading a similar row, ${other.label}. That row ticks ${wrong.column.label}, so ${wrong.option.letter} looks right.`;
      break;
    }
  }
  return {
    status: 'answer',
    choice: option.letter,
    evidence: [{ kind: 'table', ref: table.label, page: row.page, box: row.cells[column.key]?.box ?? null }],
    why,
    mistake,
  };
}

// raw: the question as pasted, with its choices. pageData gives a page with its text and drawn lines, as app/tables.js needs.
export async function checkQuestion(raw, { index, map, ready, pageData, readTable = readBookTable }) {
  const f = findInBook(raw, index, map, ready);
  if (f.options.length < 2) return notSure('There are no answer choices to check.');
  if (!readTable || !pageData) return notSure('This kind of question cannot be checked yet.');
  // A question that turns on a negative is easy to get backwards, so a table alone does not settle it.
  if (f.negated.length || f.watch.some((w) => /\b(not|no|except|unless|without|never)\b/.test(w))) return notSure('The question turns on a negative, so it has to be read by hand.');

  const found = [];
  for (const place of f.places.filter((p) => p.kind === 'table')) {
    const info = map.tables.get(place.id);
    const pages = await Promise.all((info.pages?.length ? info.pages : [info.page]).map((n) => pageData(n)));
    const table = readTable(place.id, pages);
    if (table.status !== 'sure') continue;
    found.push({ result: checkTable(f, table), info });
  }
  const answers = found.filter((x) => x.result.status === 'answer');
  if (!answers.length) return notSure(...(found.flatMap((x) => x.result.why).slice(0, 2)), ...(found.length ? [] : ['No table that reads clearly fits this question.']));
  if (new Set(answers.map((x) => x.result.choice)).size > 1) return notSure('Two tables point to different choices.');

  const { result, info } = answers[0];
  const entry = f.entries[0];
  const rules = (info.see || []).slice(0, 2).map((rule) => ({ kind: 'rule', ref: rule, page: ready.rules.get(rule)?.pdfPage ?? null, box: null }));
  return {
    ...result,
    evidence: [...result.evidence, ...rules],
    pattern: `${entry ? `Index: ${entry.path.join(', ')}. Then ` : ''}Table ${info.label}: row first, then column.`,
  };
}

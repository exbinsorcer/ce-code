// Answers table questions that describe a situation instead of naming a row, like a place where dust settles.
// Plain code, no AI. It names a choice only when exactly one fits. Anything else is "not sure".
// It works on tables of ticks and dashes whose columns sit under headings such as "Indoor use".

// Words of no use for picking a row.
const LIGHT = new Set(['and', 'or', 'of', 'the', 'a', 'an', 'in', 'on', 'to', 'for', 'with', 'by', 'from', 'is', 'are', 'be', 'which', 'what', 'type', 'that', 'this', 'its', 'use', 'used', 'during', 'normal', 'operating', 'conditions', 'condition', 'designated', 'recognized', 'intended', 'areas', 'area', 'location', 'locations', 'subject', 'exposed', 'following', 'provides', 'degree', 'protection', 'against', 'environmental']);

// Everyday words for where a thing is. They point to a column heading, not a row.
const OUTDOOR = new Set(['outdoor', 'outdoors', 'outside', 'exterior', 'weather']);
const INDOOR = new Set(['indoor', 'indoors', 'inside', 'interior']);

// One form for each word, so dripping, drips and drip match, and fibre matches fiber.
export function rootOf(word) {
  let w = String(word).toLowerCase();
  for (const end of ['ings', 'ing', 'ed', 'es', 's']) {
    if (w.length - end.length >= 3 && w.endsWith(end) && !w.endsWith('ss')) {
      w = w.slice(0, -end.length);
      break;
    }
  }
  // dripp becomes drip, settl stays settl, fibr and fiber both become fibr.
  if (/([b-df-hj-np-tv-z])\1$/.test(w)) w = w.slice(0, -1);
  if (w.length > 4) w = w.replace(/er$/, 'r').replace(/re$/, 'r');
  return w;
}

// The words of a text, with hyphens joined, so non-corrosive and noncorrosive are one word.
export function rootsOf(text) {
  return String(text).normalize('NFKC').toLowerCase().replace(/(\p{L})-(\p{L})/gu, '$1$2').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

const notSure = (...why) => ({ status: 'not-sure', choice: null, confidence: null, because: why[0], outside: false, evidence: [], why });

// "Which is not", "is not designated" and the like.
export const asksWhichNot = (stem) => /\b(?:not|isn't|cannot)\b/i.test(stem);

// Where the question puts the thing: outdoor, indoor, both, or nowhere.
export function placeAsked(stem) {
  const words = rootsOf(stem);
  return { outdoor: words.some((w) => OUTDOOR.has(w)), indoor: words.some((w) => INDOOR.has(w)) };
}

// A heading that names indoor and not outdoor allows indoors only. "Indoor/outdoor use" allows both.
const headingOf = (c) => (c.groups[c.groups.length - 1] || '').toLowerCase();
const indoorOnly = (c) => /indoor/.test(headingOf(c)) && !/outdoor/.test(headingOf(c));
const namesIndoor = (c) => /indoor/.test(headingOf(c));

// Picks the row the situation describes. The first word of a row name counts double, because it says what the row is about.
// A row wins only when it clearly beats every other row: twice the score, or every word the others matched as well.
export function pickRow(stem, rows) {
  const asked = new Set(rootsOf(stem).filter((w) => !LIGHT.has(w)).map(rootOf));
  const scored = rows.map((row) => {
    const own = rootsOf(row.label).filter((w) => !LIGHT.has(w)).map(rootOf);
    const hit = new Set(own.filter((w) => asked.has(w)));
    const said = rootsOf(stem).filter((w) => hit.has(rootOf(w)));
    const score = [...hit].reduce((s, w) => s + (w === own[0] ? 2 : 1), 0);
    return { row, hit, said, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return { row: null, why: 'no row' };
  const [best, ...rest] = scored;
  const beats = (o) => o.score * 2 <= best.score || ([...o.hit].every((w) => best.hit.has(w)) && o.hit.size < best.hit.size);
  // Rows with the same name differ only in a footnote, so they are read together.
  const same = rest.filter((o) => o.row.label === best.row.label);
  const others = rest.filter((o) => o.row.label !== best.row.label);
  if (!others.every(beats)) return { row: null, why: 'two rows', rows: [best.row, others.find((o) => !beats(o)).row] };
  return { row: best.row, rows: [best.row, ...same.map((o) => o.row)], hit: [...new Set(best.said)] };
}

// Each choice must name one column, like "Type 3R" naming column 3R and not 3 or 3RX.
export function choiceColumns(options, columns) {
  return options.map((o) => {
    const words = new Set(rootsOf(o.text));
    const hits = columns.filter((c) => c.label && words.has(String(c.label).toLowerCase()));
    return { option: o, column: hits.length === 1 ? hits[0] : null };
  });
}

// f: the question, from findInBook. table: a table read by app/tables.js.
export function checkSituation(f, table) {
  const stem = f.stem;
  const columns = table.columns.filter((c) => c.groups.length);
  const choices = choiceColumns(f.options, columns);
  if (choices.some((x) => !x.column) || choices.length < 2) return notSure(`The choices do not all match the columns of Table ${table.label}.`);

  const where = placeAsked(stem);
  if (where.indoor && where.outdoor) return notSure('The question names both indoors and outdoors.');
  const picked = pickRow(stem, table.rows);
  if (picked.why === 'two rows') return notSure(`Two rows of Table ${table.label} fit the question: ${picked.rows[0].label} and ${picked.rows[1].label}.`);
  const rows = picked.row ? picked.rows : [];
  const ticked = (c) => rows.some((r) => r.cells[c.key]?.mark === 'tick');
  const negative = asksWhichNot(stem);
  if (!rows.length && !where.outdoor) return notSure(`No row of Table ${table.label} fits the question.`);
  if (!rows.length && negative) return notSure('A "which is not" question needs one clear row.');

  // Columns a place allows. Outdoors rules out columns for indoor use only.
  const allowed = (c) => (where.outdoor ? !indoorOnly(c) : true);
  const why = [];
  const rowSay = rows.length ? `"${picked.hit.join(', ')}" points to the row ${rows[0].label}.` : '';

  let backed;
  let note = '';
  if (negative) {
    // Only one choice may lack the tick. Any more and the table cannot settle it.
    backed = choices.filter((x) => !ticked(x.column) || !allowed(x.column));
    if (backed.length !== 1) return notSure(backed.length ? `${backed.length} choices lack a tick in that row.` : 'Every choice has a tick in that row.');
    note = `Of your choices, only ${backed[0].column.label} has no tick there.`;
  } else if (where.indoor) {
    // Indoor use columns first. Only if none of the choices fits there, the columns that also allow indoor use.
    backed = choices.filter((x) => indoorOnly(x.column) && ticked(x.column));
    if (backed.length) note = 'Read the Indoor use columns first.';
    else {
      backed = choices.filter((x) => namesIndoor(x.column) && ticked(x.column));
      if (backed.length) note = 'None of your choices has a tick in the Indoor use columns, so read the columns that also allow indoor use.';
    }
  } else {
    backed = choices.filter((x) => allowed(x.column) && (!rows.length || ticked(x.column)));
    if (where.outdoor) note = 'Outdoors rules out the columns for indoor use only.';
  }
  if (backed.length !== 1) return notSure(backed.length ? `${backed.length} choices fit Table ${table.label}.` : `No choice fits Table ${table.label}.`);
  const { option, column } = backed[0];

  if (where.outdoor || where.indoor) why.push({ head: where.outdoor ? '"outdoors"' : '"indoors"', say: note && !negative ? note : `Mind the column headings: ${headingOf(column)}.` });
  if (rowSay) why.push({ head: 'Find the row', say: rowSay });
  why.push({ head: 'Read across', say: negative ? note : `Column ${column.label} (${headingOf(column)}) fits, and it is the only one of your choices that does.` });

  // A choice that a looser reading would pick is the mistake to warn about.
  let mistake = null;
  const loose = choices.find((x) => x !== backed[0] && (negative ? !ticked(x.column) : ticked(x.column)));
  if (loose) mistake = negative ? null : `Type ${loose.column.label} also has a tick in that row, but it sits under ${headingOf(loose.column)}.`;

  const row = rows[0];
  // A situation mapped to a row or heading is one step of reasoning. Rows that differ only by a footnote, read together, lower it one more.
  const footnoted = rows.length > 1;
  const confidence = footnoted ? 'low' : 'medium';
  const because = `${rows.length ? 'The situation is matched to a table row' : 'The place named in the question is matched to a column heading'}${where.indoor && note.startsWith('None') ? ', and the columns that also allow indoor use were needed' : ''}. That takes one step of reasoning${footnoted ? ', and two rows of that name differ by footnotes that were not checked' : ''}.`;
  return {
    status: 'answer',
    choice: option.letter,
    confidence,
    because,
    evidence: [{ kind: 'table', ref: table.label, page: row?.page ?? table.page ?? null, box: row?.cells[column.key]?.box ?? null }],
    why,
    mistake,
  };
}

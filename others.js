// Says why each other choice loses, from the same place in the book that backs the answer. Plain code, no AI.
// It never changes which choice is picked. If another choice comes close, the rating drops one step and says why.
// It holds no book text; it reads the place again at run time.
import { wordsOf } from './rules.js?v=5bb51be2';
import { parseQuestion } from './engine.js?v=5bb51be2';
import { splitRule } from './check-rules.js?v=5bb51be2';
import { numbersIn } from './check-numbers.js?v=5bb51be2';

const LIGHT = new Set(['a', 'an', 'and', 'or', 'of', 'the', 'to', 'in', 'on', 'for', 'with', 'by', 'at', 'is', 'are', 'be', 'it', 'its', 'as', 'that', 'this', 'from']);
const keyWords = (text) => [...new Set(wordsOf(text).filter((w) => !LIGHT.has(w) && !/^\d/.test(w)))];
const DOWN = { high: 'medium', medium: 'low', low: 'low' };

// The words at the place that backs the answer: a definition, a rule part, a whole rule, or a table.
async function placeOf(evidence, { map, ready, pageData, readTable }) {
  if (!evidence) return null;
  if (evidence.kind === 'definition') {
    const d = [...(map.definitions?.values?.() || [])].find((x) => x.term === evidence.ref);
    return d ? { kind: 'definition', text: d.text } : null;
  }
  if (evidence.kind === 'rule') {
    const text = ready.rules.get(evidence.ref)?.text;
    if (!text) return null;
    const parts = splitRule(text);
    const part = evidence.part ? parts.find((p) => p.path.join(' ') === evidence.part) : null;
    return { kind: 'rule', text: part ? `${part.lead} ${part.text}` : text, parts, part };
  }
  if (evidence.kind === 'table' && readTable && pageData) {
    const info = map.tables.get(evidence.ref);
    if (!info) return null;
    const pages = await Promise.all((info.pages?.length ? info.pages : [info.page]).filter(Boolean).map((n) => pageData(n)));
    const t = readTable(evidence.ref, pages);
    const tables = t.status === 'sure' ? [t] : (t.sections || []).filter((s) => s.status === 'sure');
    for (const tab of tables) {
      for (const row of tab.rows) {
        for (const col of tab.columns) {
          const cell = row.cells[col.key];
          if (cell?.box && evidence.box && cell.box.x === evidence.box.x && cell.box.y === evidence.box.y && cell.box.page === evidence.box.page) return { kind: 'table', table: tab, row, col };
        }
      }
    }
    return null;
  }
  return null;
}

// Where a number sits in a table, beside the answer's row and column.
function inTable({ table, row, col }, n) {
  const at = (r, c) => {
    const cell = r.cells[c.key];
    return cell && !cell.mark && Number(String(cell.text).replace(/[ ,]/g, '')) === n;
  };
  const cols = table.columns.slice((table.stub ?? 0) + 1);
  const ci = cols.indexOf(col);
  const ri = table.rows.indexOf(row);
  for (const c of cols) if (c !== col && at(row, c)) return { say: `It is in the same row, under ${[...c.groups, c.label].join(', ')}, a column the question does not ask for.`, close: Math.abs(cols.indexOf(c) - ci) === 1 };
  for (const r of table.rows) if (r !== row && at(r, col)) return { say: `It is in the same column, on the row for ${r.label}, a row the question does not ask for.`, close: Math.abs(table.rows.indexOf(r) - ri) === 1 };
  return { say: `It is not beside the answer in Table ${table.label}.`, close: false };
}

// result: what the checker gave. raw: the question as pasted. book: what the checker was given.
// Gives the result back with `others`: [{ letter, lost, close }], and a lower rating when a choice comes close.
export async function explainOthers(result, raw, book) {
  if (result?.status !== 'answer' || !result.choice) return result;
  const options = parseQuestion(raw).options;
  const chosen = options.find((o) => o.letter === result.choice);
  if (!chosen) return result;
  let place = null;
  try {
    place = await placeOf(result.evidence?.[0], book);
  } catch {
    place = null;
  }
  const flagged = new Set([...String(result.mistake || '').matchAll(/\b(?:gives|so|picking)\s+([A-H])\b/g)].map((m) => m[1]));
  const placeWords = place?.text ? new Set(wordsOf(place.text)) : null;
  const cover = (o) => {
    const k = keyWords(o.text);
    return k.length ? k.filter((w) => placeWords.has(w)).length / k.length : 0;
  };
  const mine = placeWords ? cover(chosen) : 0;
  // A close rival is evidence against the answer, so it lowers the rating. The easy mistake is a warning about misreading:
  // it is marked close for the reader, but the book's evidence for the answer is just as strong.
  const rivals = [];
  const others = options.filter((o) => o !== chosen).map((o) => {
    let lost = 'The place the book points to does not back it.';
    let close = false;
    const n = numbersIn(o.text);
    const tick = place?.kind === 'table' && place.row.cells[place.col.key]?.mark === 'tick';
    if (tick) {
      // A table of ticks: the choice names a column, and the answer's row either has a tick there or not.
      const labelWords = (c) => wordsOf(String(c.label).replace(/[^\p{L}\p{N} ]+/gu, ' '));
      const said = new Set(wordsOf(o.text));
      const cols = place.table.columns.filter((c) => labelWords(c).length && labelWords(c).every((w) => said.has(w)));
      if (cols.length === 1) {
        const mark = place.row.cells[cols[0].key]?.mark;
        lost = mark === 'tick' ? `Column ${cols[0].label} also has a tick in the row for ${place.row.label}, but the question's other words rule it out.` : `The row for ${place.row.label} has no tick under ${cols[0].label}.`;
        close = close || mark === 'tick';
      } else lost = `It does not name one column of Table ${place.table.label}.`;
    } else if (place?.kind === 'table' && n.length === 1) {
      const where = inTable(place, n[0]);
      lost = where.say;
      close = close || where.close;
    } else if (place?.kind === 'rule' && place.part && n.length) {
      const other = place.parts.find((p) => p !== place.part && numbersIn(p.text).includes(n[0]));
      lost = other ? `Its number is in part ${other.path.join(' ')} of the rule, which is about something else.` : 'Its number is not written in that part of the rule.';
      close = close || Boolean(other);
    } else if (placeWords) {
      const c = cover(o);
      const k = keyWords(o.text).length;
      lost = `${Math.round(c * k)} of its ${k} key words are in the ${place.kind === 'definition' ? 'definition' : 'rule'}, against more for ${chosen.letter}.`;
      if (c >= mine) lost = `Word for word it is no further from the ${place.kind === 'definition' ? 'definition' : 'rule'} than ${chosen.letter}. ${chosen.letter} wins for the reason given above.`;
      close = close || (c >= 0.5 && c >= mine - 0.15);
    }
    if (close) rivals.push(o.letter);
    if (flagged.has(o.letter)) lost = `${lost} This is the easy mistake here.`;
    return { letter: o.letter, lost, close: close || flagged.has(o.letter) };
  });
  const near = rivals;
  if (!near.length) return { ...result, others };
  return {
    ...result,
    others,
    confidence: DOWN[result.confidence] || 'low',
    because: `${String(result.because || '').replace(/[.\s]*$/, '.')} ${near.join(' and ')} come${near.length > 1 ? '' : 's'} close, so the rating is one step lower.`.trim(),
  };
}

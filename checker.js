// Tests each answer choice against the book. Plain code, no AI.
// It names a choice only when exactly one has the book behind it. Anything else is "not sure", because a wrong answer is far worse.
import { findInBook, watchWords, negatedWords } from './finder.js?v=a32e38e3';
import { wordsOf } from './rules.js?v=a32e38e3';
import { readTable as readBookTable } from './tables.js?v=a32e38e3';
import { checkNumbers } from './check-numbers.js?v=a32e38e3';
import { checkRules } from './check-rules.js?v=a32e38e3';
import { checkSituation } from './check-situations.js?v=a32e38e3';
import { checkDefinition } from './check-definitions.js?v=a32e38e3';
import { checkWhichRule } from './check-which-rule.js?v=a32e38e3';
import { checkOutside } from './check-outside.js?v=a32e38e3';
import { explainOthers } from './others.js?v=a32e38e3';
import { checkCalculation } from './calc/check.js?v=a32e38e3';
import { checkRuleWords, rulesFor } from './check-rule-words.js?v=a32e38e3';
import { checkAbout } from './check-about.js?v=a32e38e3';
import { checkRuleStructure } from './check-rule-structure.js?v=a32e38e3';
import { checkNegative } from './check-negative.js?v=a32e38e3';
import { checkDefinitionStatement, checkCombined } from './check-definition-statements.js?v=a32e38e3';

const JOINING = new Set(['and', 'or', 'of', 'the', 'a', 'an', 'in', 'on', 'to', 'for', 'with', 'use', 'used']);
const meaningful = (text) => wordsOf(text).filter((w) => !JOINING.has(w));
// Why the checker is stuck, so each "not sure" says what blocked it. The words are what the reader sees.
export const STUCK = {
  'no-choices': 'No answer choices to check.',
  'not-built': 'This kind of question cannot be checked yet.',
  negative: 'It turns on a "not" or "except".',
  'table-row': 'No table row clearly fits.',
  'rule-unclear': 'The rule does not settle it.',
  'rule-unread': 'The rule could not be read clearly.',
  'word-choices': 'The choices are words, and the rule check reads numbers only.',
  numbers: 'The choices are numbers, and no rule or table gave one.',
  'two-fit': 'More than one choice fits the rule.',
  'part-match': 'The rule holds only part of the choice.',
  'none-above': '"All" or "none of the above" cannot be proved by matching words.',
  'no-choice-fits': 'No choice fits the rule closely.',
  'negative-exception': 'The rule part has its own exception.',
  'negative-statement': 'A "not" inside a statement, not a "which is not" question.',
  'negative-unclear': 'Not every choice is clearly in or out of the rule.',
  'no-rule-part': 'No part of the rule holds the question\'s key words.',
  'two-parts': 'Two parts of the rule fit.',
  'two-rules': 'Two rules point to different choices.',
  'points-on': 'The rule sends you to another rule or table.',
  'min-max': 'The question asks for a minimum or maximum the rule does not give.',
  'choice-not-written': 'No single choice is written in the rule.',
  'wrong-section': 'The rule found is in a section the question does not name.',
  'no-rule': 'No rule was found.',
  'two-tables': 'Two tables disagree.',
  'many-tables': 'More than one table fits.',
  smallest: 'Needs a table and a rule together.',
  other: 'The book does not settle it.',
};
// stuck: the reason code from STUCK, then plain reasons.
const stuckOn = (stuck, ...why) => ({ ...notSure(...why), stuck, because: why.length && typeof why[0] === 'string' ? why[0] : STUCK[stuck] });
const notSure = (...why) => ({ status: 'not-sure', choice: null, confidence: null, because: typeof why[0] === 'string' ? why[0] : 'The book does not settle it.', outside: false, evidence: [], why });

// Every result carries a rating, a plain reason for it, and whether the book covers the subject at all.
export function rated(result) {
  const answer = result.status === 'answer' && Boolean(result.choice);
  return {
    ...result,
    choice: answer ? result.choice : null,
    confidence: answer || result.status === 'worked' ? result.confidence || 'medium' : null,
    because: result.because || (answer ? 'The book backs this choice.' : 'The book does not settle it.'),
    outside: Boolean(result.outside),
    evidence: result.evidence || [],
    why: result.why || [],
    mistake: result.mistake ?? null,
    // Every "not sure" names what blocked it.
    stuck: answer || result.status === 'worked' ? null : result.stuck || (result.outside ? null : 'other'),
  };
}

const hasTicks = (table) => table.rows.some((r) => Object.values(r.cells).some((c) => c.mark === 'tick'));

// Checks one table that reads clearly against the question. Tables of numbers go to app/check-numbers.js.
// others: the similar tables that could also fit, so a number table can be told apart from them.
export function checkTable(f, table, { others = [] } = {}) {
  if (!hasTicks(table)) return checkNumbers(f, table, { others });
  return checkTicks(f, table);
}

// Checks a table of ticks and dashes.
function checkTicks(f, table) {
  const asked = new Set(wordsOf(f.stem));
  // The row whose whole name is in the question. When one name sits inside another, the longer one is meant.
  const fitting = table.rows.map((row) => ({ row, own: meaningful([...(row.groups || []), row.label].join(' ')) })).filter(({ own }) => own.length && own.every((w) => asked.has(w)));
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

  // A cell marked unsure never counts as a tick.
  const ticked = (r, c) => r.cells[c.key]?.mark === 'tick' && !r.cells[c.key]?.unsure;
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
    // An exact row and one ticked column is the book's own words. Narrowing by a heading is one step of reasoning.
    confidence: heading ? 'medium' : 'high',
    because: heading ? 'The row matches exactly, and a column heading named in the question narrows it to one choice.' : 'The question names one exact row, and only one choice has a tick in it.',
    evidence: [{ kind: 'table', ref: table.label, page: row.page, box: row.cells[column.key]?.box ?? null }],
    why,
    mistake,
  };
}

const BOUNDS = /\b(?:not less than|not more than|not exceeding|not exceed|not greater than|not over)\b/gi;

// A rule's answer, with the path a reader follows and what each place said.
function withRulePattern(f, byRule, tried) {
  const entry = f.entries[0];
  const { tried: ruleTried, ...rest } = byRule;
  return {
    ...rest,
    // A rule number with a unit takes reading the rule's wording, so it is one step less sure than a table cell.
    confidence: rest.confidence || 'medium',
    because: rest.because || 'The rule the Index leads to gives this number with its unit, and no other choice matches it.',
    tried: [...tried, ...ruleTried.map((x) => ({ rule: x.rule, status: x.result.status, choice: x.result.choice, why: x.result.why }))],
    pattern: `${entry ? `Index: ${entry.path.join(', ')}. Then ` : ''}Rule ${rest.evidence[0].ref}: find the part with your key words, then read its number.`,
  };
}

// raw: the question as pasted, with its choices. pageData gives a page with its text and drawn lines, as app/tables.js needs.
export async function checkQuestion(raw, book) {
  // Each answer also says why every other choice loses (app/others.js).
  return rated(await explainOthers(await checkAll(raw, book), raw, { readTable: readBookTable, ...book }));
}

// Choices that each name one column, like "Type 13", are a strong sign this is the table, wherever the walk ranked it.
function choicesNameColumns(f, table) {
  const labelWords = (col) => wordsOf(String(col.label).replace(/[^\p{L}\p{N} ]+/gu, ' '));
  const named = f.options.filter((o) => {
    const words = new Set(wordsOf(o.text));
    return table.columns.filter((col) => labelWords(col).length && labelWords(col).every((w) => words.has(w))).length === 1;
  });
  return named.length >= 2 && named.length === f.options.length;
}

async function checkAll(raw, { index, map, ready, pageData, readTable = readBookTable }) {
  const f = findInBook(raw, index, map, ready);
  if (f.options.length < 2) {
    // A math question with no choices can still be worked out.
    if (readTable && pageData) {
      const open = await checkCalculation(f, { map, ready, pageData, readTable });
      if (open.status === 'worked' || open.calculation) return open;
    }
    return stuckOn('no-choices', 'There are no answer choices to check.');
  }
  // A subject the Code never mentions is sent elsewhere before anything else is tried.
  const outside = checkOutside(f, index, map);
  if (outside) return outside;
  // A definition question is settled by Section 0 alone, before any table.
  const defined = checkDefinition(f, [...(map.definitions?.values?.() || [])]);
  if (defined.status === 'answer') return { ...defined, pattern: 'Section 0: find the term, then compare word for word.' };
  for (const more of [checkDefinitionStatement, checkCombined]) {
    const r = more(f, [...(map.definitions?.values?.() || [])]);
    if (r.status === 'answer') return { ...r, pattern: 'Section 0: read every part of the definition, then compare.' };
  }
  const which = checkWhichRule(f, ready.rules);
  if (which.status === 'answer') return { ...which, pattern: 'Choices that are rule numbers: read each rule title.' };
  if (!readTable || !pageData) return stuckOn('not-built', 'This kind of question cannot be checked yet.');
  // A math question is worked with the calculators (app/calc/check.js), when it gives every number they need.
  const worked = await checkCalculation(f, { map, ready, pageData, readTable });
  if (worked.status === 'answer' || worked.calculation) return worked;
  // A question that turns on a negative is easy to get backwards, so a table alone does not settle it.
  const negative = f.negated.length || f.watch.some((w) => /\b(not|no|except|unless|without|never)\b/.test(w));
  // "Not more than" and "not less than" are limits, not negatives. Only rule wording reads them; tables still stop.
  const bare = String(f.stem).replace(BOUNDS, ' ');
  const strictlyNegative = negatedWords(bare).length || watchWords(bare).some((w) => /\b(not|no|except|unless|without|never)\b/.test(w));
  if (strictlyNegative) {
    // "Which is not" is the one negative a table can settle: exactly one choice lacks the tick.
    for (const t of f.tables || []) {
      const info = map.tables.get(t.label);
      if (!info?.page) continue;
      const table = readTable(t.label, await Promise.all((info.pages?.length ? info.pages : [info.page]).map((n) => pageData(n))));
      if (table.status !== 'sure' || !hasTicks(table) || !choicesNameColumns(f, table)) continue;
      const situation = checkSituation(f, table);
      if (situation.status === 'answer') return { ...situation, evidence: [...situation.evidence, ...(info.see || []).slice(0, 2).map((rule) => ({ kind: 'rule', ref: rule, page: ready.rules.get(rule)?.pdfPage ?? null, box: null }))] };
    }
    // Then a clear rule part: one choice out and the rest shown in, or a whole statement with its nots counted.
    const neg = checkNegative(f, rulesFor(f, index, ready));
    if (neg.status === 'answer') return { ...neg, pattern: 'Questions with not or except: read the rule, then tick off each choice.' };
    return stuckOn(neg.stuck || 'negative', 'The question turns on a negative, so it has to be read by hand.', neg.because);
  }
  if (negative) {
    const byRule = await checkRules(f, { index, ready, pageData });
    if (byRule.status === 'answer') return withRulePattern(f, byRule, []);
    // Then a clear rule part: one choice out and the rest shown in, or a whole statement with its nots counted.
    const neg = checkNegative(f, rulesFor(f, index, ready));
    if (neg.status === 'answer') return { ...neg, pattern: 'Questions with not or except: read the rule, then tick off each choice.' };
    return stuckOn(neg.stuck || 'negative', 'The question turns on a negative, so it has to be read by hand.', neg.because);
  }

  // The tables to try: the ones the walk leads to, and tables with nearly the same title, which a question must tell apart.
  const labels = [...new Set([...f.places.filter((p) => p.kind === 'table').map((p) => p.id), ...(f.tables || []).map((t) => t.label)])].filter((l) => map.tables.has(l));
  const near = (a, b) => {
    const x = new Set(meaningful(a || ''));
    const y = new Set(meaningful(b || ''));
    const both = [...x].filter((w) => y.has(w)).length;
    return x.size && y.size && both / new Set([...x, ...y]).size >= 0.5;
  };
  const all = [...map.tables.values()];
  for (const l of [...labels]) for (const t of all) if (!labels.includes(t.label) && near(map.tables.get(l).title, t.title)) labels.push(t.label);
  const placed = new Set(f.places.filter((p) => p.kind === 'table').map((p) => p.id));

  const tables = [];
  for (const label of labels) {
    const info = map.tables.get(label);
    const pages = await Promise.all((info.pages?.length ? info.pages : [info.page]).filter(Boolean).map((n) => pageData(n)));
    const read = readTable(label, pages);
    if (read.deleted) continue;
    // A table whose columns change from page to page is tried one section at a time, using only the sections that read
    // clearly. Two sections giving different choices means not sure, like two tables.
    const parts = read.status === 'sure' ? [read] : (read.sections || []).filter((x) => x.status === 'sure').map((x) => ({ ...x, label }));
    for (const table of parts) {
      // A tick table is only read when the walk leads straight to it, as before.
      if (hasTicks(table) && !placed.has(label) && !choicesNameColumns(f, table)) continue;
      tables.push({ table: { ...table, title: table.title ?? info.title }, info });
    }
  }
  const others = tables.map((x) => x.table).filter((t) => !hasTicks(t));
  // A row named outright first, then a situation described in everyday words.
  const tryTable = (table) => {
    const result = checkTable(f, table, { others });
    if (result.status === 'answer' || !hasTicks(table)) return result;
    const situation = checkSituation(f, table);
    return situation.status === 'answer' ? situation : result;
  };
  const found = tables.map(({ table, info }) => ({ result: tryTable(table), info, numbers: !hasTicks(table), stub: table.columns[table.stub ?? 0]?.label }));
  const answers = found.filter((x) => x.result.status === 'answer');
  const smallest = found.some((x) => x.result.smallest);
  // What each table said, for checks run by hand. The reader is shown `why`, not this.
  const tried = found.map((x) => ({ table: x.info.label, status: x.result.status, choice: x.result.choice, why: x.result.why }));
  if (!answers.length) {
    // No table settles it, so try the words of the rules the walk leads to. A "smallest size" question needs both, so it waits.
    if (!smallest) {
      const byRule = await checkRules(f, { index, ready, pageData });
      if (byRule.status === 'answer') return withRulePattern(f, byRule, tried);
      // Word choices against the rule part that holds the question's words, then the pages about the Code itself.
      // The rule's structure first (when, may or shall), then its plain words.
      const shaped = checkRuleStructure(f, rulesFor(f, index, ready));
      if (shaped.status === 'answer') return { ...shaped, pattern: 'Find the rule, then read its conditions: before, after, or at the time.' };
      const worded = checkRuleWords(f, rulesFor(f, index, ready));
      if (worded.status === 'answer') return { ...worded, pattern: 'Find the rule part that holds the question\'s words, then compare each choice with it.' };
      const about = await checkAbout(f, { map, pageData });
      if (about.status === 'answer') return about;
      tried.push(...byRule.tried.map((x) => ({ rule: x.rule, status: x.result.status, choice: x.result.choice, why: x.result.why })));
      const ruleWhy = byRule.tried.length ? [byRule.why[0]] : [];
      // A rule was tried, so the rule's own reason comes first: that is what blocked it.
      // Word choices are read by the word check, so its reason is the real one.
      const ruleStuck = byRule.stuck === 'word-choices' ? worded.stuck || byRule.stuck : byRule.stuck;
      const stuck = byRule.tried.length ? ruleStuck || 'rule-unclear' : found.length ? 'table-row' : 'no-rule';
      const tableWhy = [...(found.flatMap((x) => x.result.why).slice(0, 1)), ...(found.length ? [] : ['No table that reads clearly fits this question.'])];
      return { ...stuckOn(stuck, ...ruleWhy, ...tableWhy), tried };
    }
    return { ...stuckOn('smallest', ...(found.flatMap((x) => x.result.why).slice(0, 2)), ...(found.length ? [] : ['No table that reads clearly fits this question.'])), tried, ...(smallest ? { smallest } : {}) };
  }
  if (new Set(answers.map((x) => x.result.choice)).size > 1) return { ...stuckOn('two-tables', 'Two tables point to different choices.'), tried };
  // A number is only trusted when exactly one table gives it. When several do, the one whose title holds clearly more of
  // the question's words is the one a reader would open. A tie means not sure.
  let numberAnswers = answers.filter((x) => x.numbers);
  if (numberAnswers.length > 1) {
    const asked = new Set(meaningful(f.stem));
    // The title and the heading over the row labels, which says what the rows are.
    const cover = (x) => new Set(meaningful([x.info.title || '', x.stub || ''].join(' ')).filter((w) => asked.has(w))).size;
    const best = Math.max(...numberAnswers.map(cover));
    numberAnswers = numberAnswers.filter((x) => cover(x) === best);
    if (numberAnswers.length > 1) return { ...stuckOn('many-tables', 'More than one table fits the question.'), tried };
    answers.splice(0, answers.length, ...answers.filter((x) => !x.numbers || x === numberAnswers[0]));
  }

  const { result, info, numbers } = answers[0];
  const entry = f.entries[0];
  // An exact number read from one table cell is as sure as the checker gets.
  if (numbers && !result.confidence) Object.assign(result, { confidence: 'high', because: result.because || 'One table cell gives this exact number, and no other choice matches it.' });
  const rules = (info.see || []).slice(0, 2).map((rule) => ({ kind: 'rule', ref: rule, page: ready.rules.get(rule)?.pdfPage ?? null, box: null }));
  return {
    ...result,
    evidence: [...result.evidence, ...rules],
    pattern: `${entry ? `Index: ${entry.path.join(', ')}. Then ` : ''}Table ${info.label}: row first, then column.`,
  };
}

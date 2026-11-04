// Answers questions settled by a rule's own words: a distance, a size, a percent, a number of things.
// Plain code, no AI, no DOM and no network. It holds no wording from the book; the rule's text comes from the owner's book.
//
// It splits a rule into subrules and items, finds the one part that holds the question's key words, and tests each
// choice against that part. It names a choice only when exactly one choice is written there and the others are not.
// The kind of question turned on so far: choices that are a number with a unit, like "1.5 m", "300 mm", "3%" or "15 A".
import { wordsOf as bookWords, lookup } from './rules.js?v=a8290e52';

const notSure = (why) => ({ status: 'not-sure', choice: null, evidence: [], why: [why], mistake: null });
const wordsOf = (text) => bookWords(text).map((w) => (w.length > 4 && w.endsWith('ie') ? `${w.slice(0, -2)}y` : w));
const SKIP = new Set(wordsOf(`a an and are as at be by can could do does for from has have how i if in into is it its of on or the this to what when
where which who why will with within would you your shall must may should required require rule code minimum maximum least most far apart much many
often big long large small high deep distance size sized number need needs needed installed install used use allowed permitted`));

/* ---------- Splitting a rule into its parts ---------- */

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

// Splits a rule's text into parts: each subrule 1), each item a) and each sub-item i), in order. A number like "1)" only
// starts a part when it is the next one expected and is not a pointer such as "Subrules 1) and 2)".
export function splitRule(text) {
  const t = ` ${String(text).replace(/\s+/g, ' ')} `;
  const marks = [];
  const want = { sub: 1, item: 0, roman: 0 };
  for (const m of t.matchAll(/(?<=\s)(\d{1,2}|[a-z]{1,4})\)(?=\s)/g)) {
    const before = t.slice(Math.max(0, m.index - 40), m.index);
    if (/(?:Subrules?|Items?)\s*$/.test(before) || /(?:Subrules?|Items?)\s+(?:\S+\)\s*,?\s*)+(?:and|or|to)?\s*$/.test(before)) continue;
    const k = m[1];
    if (/^\d+$/.test(k)) {
      if (Number(k) !== want.sub) continue;
      marks.push({ at: m.index, end: m.index + m[0].length, level: 1, label: `${k})` });
      want.sub++;
      want.item = 0;
      want.roman = 0;
    } else if (k === LETTERS[want.item]) {
      marks.push({ at: m.index, end: m.index + m[0].length, level: 2, label: `${k})` });
      want.item++;
      want.roman = 0;
    } else if (k === ROMAN[want.roman] && want.item > 0) {
      marks.push({ at: m.index, end: m.index + m[0].length, level: 3, label: `${k})` });
      want.roman++;
    }
  }
  const parts = [];
  const lead = { 1: '', 2: '' };
  const path = { 1: null, 2: null };
  if (!marks.length || marks[0].at > 0) parts.push({ path: [], text: t.slice(0, marks[0]?.at ?? t.length).trim(), lead: '' });
  marks.forEach((mk, i) => {
    const own = t.slice(mk.end, marks[i + 1]?.at ?? t.length).trim();
    if (mk.level === 1) {
      path[1] = mk.label;
      path[2] = null;
      lead[1] = own;
      lead[2] = '';
    }
    if (mk.level === 2) {
      path[2] = mk.label;
      lead[2] = own;
    }
    const at = mk.level === 1 ? [mk.label] : mk.level === 2 ? [path[1], mk.label].filter(Boolean) : [path[1], path[2], mk.label].filter(Boolean);
    // The words a part hangs from: its subrule's opening, or the rule's opening when it has no subrules.
    const intro = parts[0]?.path.length === 0 ? parts[0].text : '';
    const above = mk.level === 1 ? '' : mk.level === 2 ? lead[1] || intro : `${lead[1] || intro} ${lead[2]}`;
    parts.push({ path: at, text: own, lead: above.trim() });
  });
  return parts.filter((p) => p.text);
}

/* ---------- Numbers with units ---------- */

const UNIT = { m: 'm', metre: 'm', metres: 'm', meter: 'm', meters: 'm', mm: 'mm', millimetres: 'mm', cm: 'cm', km: 'km', '%': '%', percent: '%', a: 'A', amps: 'A', amperes: 'A', v: 'V', volts: 'V', w: 'W', kw: 'kW', kva: 'kVA', mm2: 'mm²', 'mm²': 'mm²', h: 'h', s: 's', min: 'min' };
const VALUE = /(\d{1,3}(?:[ ,]\d{3})+|\d*\.\d+|\d+)\s*(mm²|mm2|millimetres|metres?|meters?|percent|amperes|amps|volts|kva|kw|mm|cm|km|min|%|m|a|v|w|h|s)(?![\p{L}\d])/giu;

// Every number with its unit in a piece of text: "1.5 m" gives { n: 1.5, unit: 'm' }.
export function valuesIn(text) {
  return [...String(text).matchAll(VALUE)].map((m) => ({ n: Number(m[1].replace(/[ ,]/g, '')), unit: UNIT[m[2].toLowerCase()] }));
}
// A choice that is just one number and its unit, like "1.5 m". Anything else is not this kind of question.
function choiceValue(text) {
  const v = valuesIn(text);
  const rest = String(text).replace(VALUE, ' ').replace(/[\s.,;:()]+/g, '');
  return v.length === 1 && !rest ? v[0] : null;
}
const sameValue = (a, b) => a.n === b.n && a.unit === b.unit;

/* ---------- Words that change the meaning ---------- */

// Limits read as a minimum or a maximum. They are how a distance is given, so they do not block by themselves.
const AT_LEAST = /\b(not less than|at least|minimum of|or more)\b/gi;
const AT_MOST = /\b(not more than|not exceeding|not exceed|shall not exceed|not greater than|not over|at most|maximum of|or less|up to)\b/gi;
// Words that can turn the answer around. Any of these left in the part means not sure.
const TURNS = /\b(not|no|except|unless|notwithstanding|need not|other than|without)\b/i;
// The part sends the reader somewhere else.
const POINTS = /\b(Rule|Rules|Subrule|Subrules|Table|Tables|Section|Item|Items|in accordance with|as provided|as required by|Appendix)\b/;

const ASKS_MIN = /\b(minimum|min\.?|at least|closest|shortest|least)\b/i;
const ASKS_MAX = /\b(maximum|max\.?|at most|farthest|furthest|longest|greatest|most|how far apart|how often|intervals?)\b/i;

/* ---------- One rule ---------- */

// f: what findInBook found. rule: { rule, text, status } with the rule's own text from the book.
export function checkRule(f, rule) {
  if (!rule?.text) return notSure(`The words of Rule ${rule?.rule ?? ''} could not be read.`);
  if (rule.status && rule.status !== 'found') return notSure(`The heading of Rule ${rule.rule} is not sure.`);
  const choices = f.options.map((o) => ({ option: o, value: choiceValue(o.text) }));
  if (choices.length < 2 || choices.some((c) => !c.value)) return notSure('This kind of choice is not checked against rule wording yet.');

  // The rule's own words, after its number, its title and any "(see Appendix ...)" beside the title.
  let body = String(rule.text).replace(/^[\sΔ∆▲△]*\d{1,2}-\d{3,4}\s*/, '');
  if (rule.title && body.startsWith(rule.title)) body = body.slice(rule.title.length);
  body = body.replace(/^\s*\((?:see|See) Appendi[^)]*\)\s*/, '');
  const parts = splitRule(body);
  if (!parts.length) return notSure(`Rule ${rule.rule} could not be split into parts.`);

  // The part that holds the most of the question's key words. A tie means not sure.
  const keys = [...new Set(wordsOf(f.stem).filter((w) => !SKIP.has(w) && !/^\d/.test(w)))];
  // A part's own words count fully; the words it hangs from count half, since its neighbours share them.
  // Only parts that give some number with a unit can settle this kind of question.
  const scored = parts.filter((p) => valuesIn(p.text).length).map((p) => {
    const own = new Set(wordsOf(p.text));
    const above = new Set(wordsOf(p.lead));
    const hits = keys.filter((k) => own.has(k) || above.has(k));
    return { p, hits, score: keys.filter((k) => own.has(k)).length + 0.5 * keys.filter((k) => !own.has(k) && above.has(k)).length };
  }).sort((a, b) => b.score - a.score);
  const holds = (p) => choices.some((c) => valuesIn(p.text).some((v) => sameValue(v, c.value)));
  let best = scored[0];
  if (!best || best.hits.length < 2) return notSure(`No part of Rule ${rule.rule} holds enough of the question's key words.`);
  const tied = scored.filter((x) => x.score === best.score);
  // A tie is only settled when one tied part holds a choice and the others hold none.
  if (tied.length > 1) {
    const withChoice = tied.filter((x) => holds(x.p));
    if (withChoice.length !== 1) return notSure(`Two parts of Rule ${rule.rule} fit the question equally.`);
    best = withChoice[0];
  }
  const part = best.p;
  const where = `${rule.rule}${part.path.length ? ` ${part.path.join(' ')}` : ''}`;
  const reading = `${part.lead} ${part.text}`;

  if (POINTS.test(part.text)) return notSure(`Rule ${where} points to another rule or table, which has not been followed.`);
  const left = reading.replace(AT_LEAST, ' ').replace(AT_MOST, ' ').replace(/\bNo\.\s*(?=\d)/g, '#');
  if (TURNS.test(left)) return notSure(`Rule ${where} has a word like "not", "except" or "unless" that could change the answer.`);
  const min = AT_LEAST.test(reading);
  AT_LEAST.lastIndex = 0;
  const max = AT_MOST.test(reading);
  AT_MOST.lastIndex = 0;
  if (ASKS_MIN.test(f.stem) && !min) return notSure(`The question asks for a minimum, and Rule ${where} does not give one.`);
  if (ASKS_MIN.test(f.stem) && max && !min) return notSure(`The question asks for a minimum, but Rule ${where} gives a maximum.`);
  if (/\b(maximum|max\.?|at most)\b/i.test(f.stem) && min && !max) return notSure(`The question asks for a maximum, but Rule ${where} gives a minimum.`);

  const written = valuesIn(part.text);
  const around = valuesIn(part.lead);
  const backed = choices.filter((c) => written.some((v) => sameValue(v, c.value)));
  if (backed.length !== 1) return notSure(backed.length ? `${backed.length} choices are written in Rule ${where}.` : `No choice is written in Rule ${where}.`);
  if (choices.some((c) => c !== backed[0] && around.some((v) => sameValue(v, c.value)))) return notSure(`Another choice is written just above, in Rule ${where}.`);
  const { option, value } = backed[0];
  // A part that fits nearly as well and gives another choice could be the one meant, so it is not sure.
  for (const { p, score } of scored) {
    if (p === part) continue;
    if (score < best.score - 1) break;
    if (choices.some((c) => c !== backed[0] && valuesIn(p.text).some((v) => sameValue(v, c.value)))) return notSure(`Another part of Rule ${rule.rule} fits nearly as well and gives another choice.`);
  }

  // The most useful warning: a nearby part of the same rule that gives another choice.
  let mistake = null;
  for (const other of parts) {
    if (other === part) continue;
    const wrong = choices.find((c) => c !== backed[0] && valuesIn(other.text).some((v) => sameValue(v, c.value)));
    if (wrong) {
      mistake = `Reading ${rule.rule}${other.path.length ? ` ${other.path.join(' ')}` : ''} instead. It gives ${wrong.option.letter}.`;
      break;
    }
  }
  return {
    status: 'answer',
    choice: option.letter,
    evidence: [{ kind: 'rule', ref: rule.rule, part: part.path.join(' ') || null, page: rule.pdfPage ?? null, value: `${value.n} ${value.unit}`, box: null }],
    why: [
      { head: `Rule ${rule.rule}`, say: 'The Index and the titles lead here.' },
      { head: part.path.length ? `Part ${part.path.join(' ')}` : 'The rule', say: `It holds your key words: ${best.hits.join(', ')}.` },
      { head: 'Read the number there', say: `Only choice ${option.letter} is written in that part.` },
    ],
    mistake,
  };
}

/* ---------- Where the proving line sits on the page ---------- */

// The box of the text piece on the rule's pages that holds the proving number. Null when it is not exactly one piece.
export async function lineBox(evidence, pages, pageData) {
  const [n, unit] = String(evidence.value).split(' ');
  const hits = [];
  for (const p of pages) {
    const page = await pageData(p);
    const items = page?.items || [];
    items.forEach((it, i) => {
      const here = `${it.str}${items[i + 1]?.str ?? ''}${items[i + 2]?.str ?? ''}`.replace(/\s+/g, ' ');
      if (new RegExp(`(^|[^\\d.])${n.replace('.', '\\.')}\\s*${unit.replace('%', '%')}(?![\\p{L}\\d])`, 'u').test(here) && it.str.includes(n.split('.')[0])) {
        const [, , , size, x, y] = it.t || [];
        hits.push({ page: p, x, y, w: it.w, h: size });
      }
    });
  }
  return hits.length === 1 ? hits[0] : null;
}

// Tries the rules the walk leads to. ready.rules holds each rule's text, read from the owner's book.
export async function checkRules(f, { index, ready, pageData }) {
  // Only the rules the walk leads to. Reading further down the ranked list found right numbers in the wrong rules.
  const ids = [...new Set(f.places.filter((p) => p.kind === 'rule').map((p) => p.id))];
  const asked = new Set(wordsOf(f.stem));
  const tried = [];
  for (const id of ids) {
    const r = ready.rules.get(id);
    // A rule in a specific section, like one for one kind of building, only counts when the question names that kind.
    const sec = ready.sections?.get(r?.section);
    if (sec?.kind === 'specific' && ![...(sec.titleWords || [])].some((w) => w.length > 3 && !SKIP.has(w) && asked.has(w))) {
      tried.push({ rule: id, result: notSure(`Rule ${id} is in Section ${sec.section}, which the question does not name.`) });
      continue;
    }
    const found = index ? lookup(index, id) : { status: r?.status, title: r?.title };
    const result = checkRule(f, { rule: id, text: r?.text, status: found.status, title: found.title ?? r?.title, pdfPage: r?.pdfPage });
    if (result.status === 'answer' && pageData) {
      const pages = r?.pdfPage ? [r.pdfPage, r.pdfPage + 1] : [];
      result.evidence[0].box = await lineBox(result.evidence[0], pages, pageData).catch(() => null);
    }
    tried.push({ rule: id, result });
  }
  const answers = tried.filter((x) => x.result.status === 'answer');
  if (!answers.length) return { ...notSure(tried[0]?.result.why[0] ?? 'No rule the walk leads to settles this question.'), tried };
  if (new Set(answers.map((x) => x.result.choice)).size > 1) return { ...notSure('Two rules point to different choices.'), tried };
  return { ...answers[0].result, tried };
}

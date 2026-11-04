// Reads a rule part by its structure: who it is about (subject), what it says (shall, shall not, may, may not),
// what is required (action), when or where it applies (conditions), and what it leaves out (exceptions).
// Plain code, no AI. It reads the book's own wording at run time and keeps nothing.
import { rootOf, rootsOf } from './check-situations.js?v=5bb51be2';

// Everyday words that mean the same thing. General vocabulary only, never anything from one question.
const SAME = [
  ['start', 'begin', 'commence', 'commencing', 'starting', 'beginning'],
  ['finish', 'complete', 'completed', 'done', 'end', 'finished'],
  ['obtain', 'get', 'take', 'taken', 'issue', 'issued', 'receive', 'obtained'],
  ['cover', 'conceal', 'concealed', 'covered', 'hide', 'inaccessible'],
  ['notify', 'inform', 'tell', 'notified', 'informed'],
  ['submit', 'file', 'filed', 'send', 'sent', 'provide', 'provided', 'submitted', 'give'],
  ['reject', 'revoke', 'refuse', 'withdraw', 'rejected', 'revoked'],
  ['job', 'work', 'installation', 'project'],
  ['inspection', 'inspector', 'inspected'],
  ['apply', 'application', 'applying'],
];
const GROUP = new Map();
SAME.forEach((g, i) => g.forEach((w) => GROUP.set(rootOf(w), `#${i}`)));
// One form for each idea, so commence and start match.
export const idea = (w) => GROUP.get(rootOf(w)) || rootOf(w);

const LIGHT = new Set(['a', 'an', 'the', 'of', 'to', 'and', 'or', 'in', 'on', 'for', 'with', 'by', 'is', 'are', 'be', 'been', 'being', 'has', 'have', 'that', 'which', 'it', 'its', 'as', 'from', 'this', 'any', 'such', 'all', 'shall', 'must', 'may', 'will', 'can', 'not', 'no', 'code', 'ce', 'rule', 'electrical']);
// Hyphenated words count both joined and apart, so "current-permit" matches "current permit".
export const ideasOf = (text) => [...new Set([...rootsOf(text), ...rootsOf(String(text).replace(/-/g, ' '))])].filter((w) => !LIGHT.has(w)).map(idea);

// Timing and condition openers, grouped by what they mean. "When" and "at the time" both mean at the same time.
const OPENERS = [
  // "At any time" names no time, so it never fits a rule's condition. It is listed first so it is not read as "at the time".
  ['any', /\bat any time\b/i],
  ['before', /\b(?:before|prior to)\b/i],
  ['after', /\b(?:after|once|following)\b/i],
  ['same', /\b(?:at the (?:same )?time(?: that| when| as)?|when|whenever|while|as soon as)\b/i],
  ['until', /\buntil\b/i],
  ['where', /\b(?:where|if|provided that|in cases where)\b/i],
];
const EXCEPT = /\b(?:except|unless|notwithstanding|other than|excluding)\b/i;
const MODAL = /\b(shall not|must not|may not|shall|must|may|is permitted to|are permitted to|is not permitted to|are not permitted to|is required to|are required to|reserves the right to|has the right to)\b/i;

// Which kind of opener starts a piece of text, if any.
export function openerOf(text) {
  const t = String(text).trim();
  for (const [kind, re] of OPENERS) {
    const m = t.match(re);
    if (m && m.index === 0) return { kind, rest: t.slice(m[0].length).trim() };
  }
  return null;
}

// The structure of one rule part.
// title: the rule's own number and caption, which open its text and are not part of what it says.
export function structureOf(text, title = '') {
  let t = String(text).replace(/\s+/g, ' ').trim().replace(/^[A-Z]?\d{1,2}\s*[-\u2010-\u2013]\s*\d{3,4}\s*/, '');
  if (title && t.toLowerCase().startsWith(title.toLowerCase())) t = t.slice(title.length).trim();
  t = t.replace(/^\((?:see [^)]*)\)\s*/i, '');
  const m = t.match(MODAL);
  const modal = m ? m[1].toLowerCase() : null;
  const negative = modal ? /\bnot\b/.test(modal) : false;
  const subject = m ? t.slice(0, m.index).trim() : '';
  const after = m ? t.slice(m.index + m[0].length).trim() : t;
  // Conditions and exceptions start at an opener word anywhere in the rule, and run to the next opener or the end.
  const marks = [];
  for (const [kind, re] of [...OPENERS, ['except', EXCEPT]]) {
    const g = new RegExp(re.source, 'gi');
    for (const x of t.matchAll(g)) marks.push({ kind, at: x.index, len: x[0].length });
  }
  marks.sort((a, b) => a.at - b.at);
  const conditions = [];
  const exceptions = [];
  let excepting = false;
  marks.forEach((mk, i) => {
    const end = marks[i + 1]?.at ?? t.length;
    const body = t.slice(mk.at + mk.len, end).replace(/^[\s,;:]+|[\s,;:.]+$/g, '');
    // "except where ..." puts the next clause under the exception, so it is never read as a plain condition.
    if (!body) {
      if (mk.kind === 'except') excepting = true;
      return;
    }
    (mk.kind === 'except' || excepting ? exceptions : conditions).push({ kind: mk.kind, text: body });
    excepting = false;
  });
  const action = after.split(new RegExp(`${OPENERS.map(([, re]) => re.source).join('|')}|${EXCEPT.source}`, 'i'))[0].replace(/[\s,;:.]+$/g, '');
  return { subject, modal, negative, action, conditions, exceptions };
}

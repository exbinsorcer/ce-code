// Turns a question into where to look in the book, following the steps taught in class:
// key words, definitions, contents, index, rule titles, then any table, note or rule the rule points to.
// It never decides the answer. It uses the question only, not the answer choices, so it cannot give one away.
import { parseQuestion } from './engine.js?v=7e5a823c';
import { wordsOf, compareRules, lookup } from './rules.js?v=7e5a823c';
import { tablesNamedIn } from './map.js?v=7e5a823c';

const STOP = new Set(`a about above after all also an and any are as at be been being below between both but by can could do does during each every
for from had has have how i if in into is it its of on onto or our per should so some such than that the their them then there these they this
those through to under until up upon us was were what when where which while who whom why will with within would you your
type kind used use using given following correct true false answer question options option required require requires according code ce cec
choose select best shown state find being let like much many need needs make makes made get rule rules allowed permitted far apart often high big long large small can
designated present installed install needed apply applies mean located`.split(/\s+/));

// Words kept for meaning, and shown to the reader, but not used to find a page.
const CONDITIONS = ['not', 'no', 'without', 'except', 'unless', 'notwithstanding', 'may', 'must', 'shall', 'only', 'minimum', 'maximum', 'least', 'most', 'more', 'less', 'never', 'always'];
const WATCH_PHRASES = ['shall not', 'must not', 'may not', 'need not', 'not required', 'not permitted', 'not present', 'not less than', 'not more than', 'at least', 'at most', 'more than', 'less than', 'greater than', 'except', 'unless', 'notwithstanding', 'without', 'minimum', 'maximum', 'may', 'must', 'shall', 'only', 'never', 'always', 'not', 'no'];

// Everyday words and the words the book uses for them.
const BOOK_WORDS = {
  wire: ['conductor'], wires: ['conductor'], wiring: ['conductor'], breaker: ['overcurrent', 'breaker'], breakers: ['overcurrent', 'breaker'], fuse: ['fuse', 'overcurrent'], fuses: ['fuse', 'overcurrent'],
  plug: ['receptacle', 'outlet'], plugs: ['receptacle', 'outlet'], outlet: ['outlet', 'receptacle'], outlets: ['outlet', 'receptacle'], panel: ['panelboard', 'equipment'], panels: ['panelboard', 'equipment'],
  identify: ['identification', 'identified'], identified: ['identification'], pipes: ['piping', 'pipe'], pipe: ['conduit', 'raceway', 'piping'], neutral: ['neutral', 'identified'], house: ['dwelling'], home: ['dwelling'],
  apartment: ['dwelling'], light: ['luminaire', 'lighting'], lights: ['luminaire', 'lighting'], fixture: ['luminaire'], fixtures: ['luminaire'],
  conduit: ['conduit', 'raceway'], gauge: ['awg', 'size'], amps: ['ampacity', 'rating'], amp: ['ampacity', 'rating'], romex: ['sheathed'], nmd: ['sheathed'],
  old: ['existing'], older: ['existing'], upgrade: ['renovation', 'alteration'], upgraded: ['renovation', 'alteration'], renovate: ['renovation'], renovated: ['renovation'],
  'roughed-in': ['concealed', 'covered', 'inaccessible'], roughed: ['concealed', 'covered', 'inaccessible'], hidden: ['concealed'],
  charger: ['charging'], chargers: ['charging'], ev: ['vehicle'], car: ['vehicle'], pull: ['manual'], gfi: ['gfci', 'ground', 'interrupter'], gfci: ['gfci', 'interrupter', 'ground'],
  afci: ['afci', 'arc'], disconnect: ['disconnecting', 'disconnect'], clearance: ['clearance', 'spacing'], derate: ['correction'], derating: ['correction'], tub: ['tub', 'bathtub', 'hydromassage'], sizing: ['size'], sized: ['size'],
  burial: ['cover', 'buried', 'underground'], depth: ['depth', 'cover'], height: ['height', 'clearance'], calculate: ['calculated', 'demand'], calculation: ['calculated', 'demand'], supports: ['support'], supported: ['support'],
  revoke: ['reject', 'rejection'], revoked: ['reject', 'rejection'], withdrawn: ['reject'], cancelled: ['reject'],
  reconnect: ['reconnection'], reconnected: ['reconnection'], 're-connected': ['reconnection'], 're-connect': ['reconnection'], disconnected: ['cut', 'reconnection'],
  bill: ['payment', 'bills'], bills: ['payment', 'bills'], arrears: ['payment', 'bills'],
  maintain: ['maintenance'], maintaining: ['maintenance'], maintained: ['maintenance'], servicing: ['maintenance'],
  drywall: ['inaccessible', 'concealed'], 'rough-in': ['inaccessible', 'concealed'],
  fit: ['fill', 'number'], classified: ['classification'], classify: ['classification'], pv: ['photovoltaic'], solar: ['photovoltaic', 'solar'],
};

const light = (w) => {
  if (w.length > 4 && w.endsWith('ie')) return `${w.slice(0, -2)}y`;
  if (w.length > 6 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 5 && w.endsWith('ed')) return w.slice(0, -2);
  return w;
};
const lightWords = (text) => wordsOf(text).map(light);
// Small words like "of" say nothing about whether an Index entry or title fits.
const STOP_WORDS = new Set(lightWords([...STOP].join(' ')));
const ASKING_WORDS = new Set(['definition', 'definitions', 'define', 'defined', 'meaning']);
// The general sections, by their numbers in the Contents. Every other section adds to or changes these.
// tools/check_sections.mjs checks this list against the book's own wording.
// Section 0 counts as general too, though it is only offered through the definitions step.
export const GENERAL_SECTIONS = new Set([0, 2, 4, 6, 8, 10, 12, 14, 16, 26]);

const DEFINE = /(?:definition\s+(?:of|for)|define|meaning\s+of|what\s+does|what\s+is\s+meant\s+by|what\s+is\s+an?|what\s+are)\s+(?:the\s+|an?\s+)?["'“]?([\p{L}\p{N} ,-]+?)["'”]?(?:\s+mean)?\s*\??$/iu;
const LOOKS_LIKE_TABLE = /\b(what\s+size|how\s+big|minimum\s+size|maximum\s+number|how\s+many|ampacity|ampacities|correction\s+factors?|spacing|gauge|awg|rating\s+of|largest|smallest|type\s+of\s+\w*\s*enclosure|enclosure\s+type)\b/i;

// "No. 6" is a size, not a negative.
const sizeNumbers = (stem) => String(stem).replace(/\bNo\.\s*(?=\d)|\bNo\s+(?=\d)/gi, '#');

export function watchWords(stem) {
  const text = ` ${sizeNumbers(stem).toLowerCase().replace(/[^\p{L}\p{N}' -]+/gu, ' ').replace(/\s+/g, ' ')} `;
  let rest = text;
  const found = [];
  for (const p of WATCH_PHRASES) {
    if (rest.includes(` ${p} `)) {
      found.push(p);
      rest = rest.split(` ${p} `).join(' | ');
    }
  }
  return found;
}

// The words a negative covers. "without a cover" gives cover. "spraying is not present" gives spraying.
export function negatedWords(stem) {
  const clean = sizeNumbers(stem).toLowerCase();
  const out = new Set();
  const take = (s) => {
    for (const w of s.split(/[^\p{L}\p{N}-]+/u)) if (w && !STOP.has(w) && !CONDITIONS.includes(w)) out.add(w);
  };
  for (const m of clean.matchAll(/\b(?:without|except|excluding|other than|no|not)\s+([^,.;?]{1,40})/g)) {
    if (/^(?:present|required|permitted|allowed|used|applicable|needed|exposed)\b/.test(m[1])) continue;
    take(m[1].split(/\b(?:and|or|but|when|where|is|are)\b/)[0]);
  }
  // The thing ruled out runs back to the nearest word that opens the clause: "when a widget is not present".
  for (const m of clean.matchAll(/([^.;?]*?)\s+(?:is|are|was|were)\s+not\s+(?:present|required|permitted|allowed|used|exposed)\b/gu)) {
    const parts = m[1].split(/\b(?:when|where|if|that|while|because)\b/);
    take(parts.length > 1 ? parts[parts.length - 1] : m[1].trim().split(/\s+/).slice(-4).join(' '));
  }
  return [...out];
}

// Where the words you are looking for sit in a piece of page text, so they can be marked.
export function markRanges(text, marks) {
  const out = [];
  for (const m of String(text).matchAll(/[\p{L}\p{N}]+/gu)) {
    const [word] = lightWords(m[0]);
    if (word && marks.has(word)) out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// Hints use the question and the places it leads to. They never look at the answer choices.
export function hintsFor(f) {
  const kept = f.keywords.filter((w) => !f.dropped.includes(w));
  const place = f.places[0];
  const hints = [['The words that decide it', `${kept.join(', ')}.${f.watch.length ? ` Do not skip: ${f.watch.join(', ')}.` : ''}`]];
  if (place) hints.push(['Where to read', place.kind === 'table' ? `Table ${place.id}. Find your row first, then your column.` : `Rule ${place.id}. Read it to the end before you choose.`]);
  hints.push(['Watch out', place?.kind === 'table' ? 'Rows can look alike. Read the whole row name before you read across.' : 'Look for not, except and unless. They change the meaning.']);
  return hints;
}

// Long words that start the same way are forms of one word, like maintaining and maintenance. A root token, "~" and the
// first six letters, lets titles and Index entries match those forms. It counts a little less than the word itself.
const ROOT = 6;
const rootOf = (w) => (w.length > ROOT && /^\p{L}+$/u.test(w) ? `~${w.slice(0, ROOT)}` : null);
const rooted = (set) => {
  for (const w of [...set]) {
    const r = rootOf(w);
    if (r) set.add(r);
  }
  return set;
};

export function prepareFinder(index, map) {
  const ruleBlocks = index.blocks.filter((b) => b.rule);
  const total = ruleBlocks.length + map.index.length + 1;
  const df = new Map();
  const addAll = (words) => {
    for (const w of new Set(words)) df.set(w, (df.get(w) || 0) + 1);
  };
  const rules = new Map();
  for (const b of ruleBlocks) {
    const words = new Set(lightWords(b.text || ''));
    addAll(words);
    const r = lookup(index, b.rule);
    rules.set(b.rule, { rule: b.rule, words, text: b.text || '', size: words.size, titleWords: rooted(new Set(lightWords(r.title || ''))), title: r.title, status: r.status, pdfPage: r.pdfPage, appendixB: r.appendixB, section: b.section });
  }
  // The same entry printed twice is one entry with all of its places.
  const once = new Map();
  for (const e of map.index) {
    const key = e.path.join(' > ').toLowerCase();
    const had = once.get(key);
    if (!had) once.set(key, { ...e, refs: [...e.refs] });
    else for (const r of e.refs) if (!had.refs.some((x) => JSON.stringify(x) === JSON.stringify(r))) had.refs.push(r);
  }
  const entries = [...once.values()].map((e) => {
    const leaf = rooted(new Set(lightWords(e.term)));
    const path = new Set(lightWords(e.path.join(' ')));
    addAll(path);
    rooted(path);
    return { ...e, leaf, pathWords: path };
  });
  const tables = [...map.tables.values()].map((t) => ({ ...t, words: rooted(new Set(lightWords(t.title || ''))), bodyWords: new Set(lightWords(t.text || '')) }));
  const headings = map.contents.filter((c) => c.section !== null).map((c) => ({ ...c, words: rooted(new Set(lightWords(c.title))) }));
  // A rule sits under a heading in the Contents. Those words count as part of the rule, as they do for a reader.
  for (const r of rules.values()) {
    const here = headings.filter((h) => !h.top && h.section === r.section && h.page);
    const before = here.filter((h) => h.page <= r.pdfPage);
    const last = before[before.length - 1];
    r.context = new Set([...here.filter((h) => h.page === r.pdfPage), ...(last ? [last] : [])].flatMap((h) => [...h.words]));
    r.searchWords = new Set([...r.words, ...r.context]);
  }
  const sections = new Map();
  for (const h of headings.filter((x) => x.top)) {
    if (h.section && !/^deleted$/i.test(h.title.trim())) sections.set(h.section, { section: h.section, title: h.title, page: h.page, printed: h.printed, kind: GENERAL_SECTIONS.has(h.section) ? 'general' : 'specific', titleWords: h.words });
  }
  // A word in many section titles, like equipment, says nothing about which section you want.
  const titleCounts = new Map();
  for (const s of sections.values()) for (const w of s.titleWords) titleCounts.set(w, (titleCounts.get(w) || 0) + 1);
  const defs = map.definitions.map((d) => ({ ...d, words: lightWords(d.term) }));
  for (const d of defs) addAll(d.words);
  // A root is as common as all the words that share it.
  const rootDf = new Map();
  for (const [w, c] of df) {
    const r = rootOf(w);
    if (r) rootDf.set(r, (rootDf.get(r) || 0) + c);
  }
  const idf = (w) => Math.log(1 + total / (1 + ((w[0] === '~' ? rootDf : df).get(w) || 0)));
  const ruleList = [...index.rules.keys()];
  const tableLabels = [...map.tables.keys()];
  const tableByLabel = new Map(tables.map((t) => [t.label, t]));
  // The words at the places an Index entry leads to. Worked out once, the first time it is needed.
  const placesOf = (e) => {
    if (e.places) return e.places;
    const out = [];
    for (const ref of e.refs) {
      if (ref.type === 'rule' && rules.has(ref.rule)) out.push(rules.get(ref.rule).searchWords);
      if (ref.type === 'range') for (const r of ruleList.filter((k) => compareRules(k, ref.from) >= 0 && compareRules(k, ref.to) <= 0).slice(0, 12)) out.push(rules.get(r)?.searchWords || new Set());
      if (ref.type === 'table') {
        const list = ref.to ? tableLabels.slice(tableLabels.indexOf(ref.label), tableLabels.indexOf(ref.to) + 1) : [ref.label];
        for (const label of list) if (tableByLabel.has(label)) out.push(new Set([...tableByLabel.get(label).words, ...tableByLabel.get(label).bodyWords]));
      }
    }
    e.places = out;
    return out;
  };
  // The book's own Index "See" entries, read at run time: a one-word entry that sends the reader to another term, as
  // "Live, see Energized" does, makes the two words one idea. Nothing from the book is kept in the source.
  const seeWords = new Map();
  for (const e of map.index || []) {
    if ((e.path || []).length !== 1) continue;
    const own = lightWords(e.term || '');
    if (own.length !== 1) continue;
    for (const ref of e.refs || []) {
      if (ref.type !== 'see' || !ref.term) continue;
      const to = lightWords(ref.term).filter((w) => !STOP_WORDS.has(w));
      if (!to.length || to.length > 3) continue;
      seeWords.set(own[0], [...new Set([...(seeWords.get(own[0]) || []), ...to])]);
    }
  }
  return { rules, entries, tables, headings, defs, idf, ruleList, tableLabels, sections, titleCounts, placesOf, seeWords };
}

function expandRange(ready, from, to) {
  return ready.ruleList.filter((r) => compareRules(r, from) >= 0 && compareRules(r, to) <= 0);
}

const round = (n) => Math.round(n * 100) / 100;

export function findInBook(raw, index, map, ready, { dropped = [] } = {}) {
  const parsed = parseQuestion(raw);
  const stem = parsed.stem || String(raw).trim();
  const dropSet = new Set(dropped);
  const original = [];
  for (const w of stem.toLowerCase().split(/[^\p{L}\p{N}-]+/u)) {
    if (!w || w.length < 2 || STOP.has(w) || CONDITIONS.includes(w) || /^\d+$/.test(w)) continue;
    if (!original.includes(w)) original.push(w);
  }
  const keywords = original.filter((w) => !dropSet.has(w));
  // Each key word is one idea, whichever of its words the book uses, so one idea is only counted once.
  const ideas = [];
  const bookWords = [];
  const asked = stem.match(DEFINE)?.[1]?.trim();
  for (const w of keywords) {
    if (asked && ASKING_WORDS.has(w)) continue;
    const own = lightWords(w);
    const extra = [...new Set([...(BOOK_WORDS[w] || []), ...(ready.seeWords?.get(light(w)) || ready.seeWords?.get(w) || [])])];
    const fresh = extra.filter((e) => !own.includes(light(e)));
    if (fresh.length) bookWords.push({ word: w, book: fresh });
    const early = original.indexOf(w) < 3 ? 1.25 : 1;
    own.forEach((s, i) => ideas.push({ words: rooted(new Set([s, ...(i === 0 ? extra.flatMap((e) => lightWords(e)) : [])])), early }));
  }
  const allWords = new Set(ideas.flatMap((i) => [...i.words]));
  const defWords = asked ? lightWords(asked) : null;
  const measure = (words) => {
    let sum = 0;
    let hit = 0;
    for (const idea of ideas) {
      let best = 0;
      for (const w of idea.words) if (words.has(w)) best = Math.max(best, ready.idf(w));
      if (best) {
        sum += best * idea.early;
        hit++;
      }
    }
    let own = 0;
    let counted = 0;
    for (const w of words) {
      if (allWords.has(w)) own++;
      else if (STOP_WORDS.has(w)) continue;
      counted++;
    }
    return { sum, reach: ideas.length ? hit / ideas.length : 0, fit: counted ? own / counted : 0, hit };
  };
  // How much of the question is covered once you follow an Index entry to the place it names.
  const followed = (e) => {
    const places = ready.placesOf(e);
    if (!places.length) return e.refs.some((r) => r.type === 'section' || r.type === 'appendix') ? 0.5 : 0.25;
    let best = 0;
    for (const place of places) {
      let hit = 0;
      for (const idea of ideas) {
        for (const w of idea.words) {
          if (e.pathWords.has(w) || place.has(w)) {
            hit++;
            break;
          }
        }
      }
      best = Math.max(best, ideas.length ? hit / ideas.length : 0);
    }
    return best;
  };

  /* Index entries */
  const entries = ready.entries.map((e) => {
    const m = measure(e.pathWords);
    if (!m.sum) return { e, s: 0 };
    const leafHit = measure(e.leaf).sum > 0;
    const thin = m.hit === 1 && m.fit < 1 ? 0.5 : 1;
    const s = m.sum * (0.35 + 0.65 * m.fit) * m.reach ** 0.7 * (leafHit ? 1 : 0.5) * (e.refs.length ? 1 : 0.25) * thin;
    return { e, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  // An entry is only useful if the place it leads to is about the question, so the best ones are followed and checked.
  const topEntries = entries.slice(0, 80).map(({ e, s }) => ({ e, s: s * (0.2 + 0.8 * followed(e)) * (asked && e.pathWords.has('definition') ? 1.5 : 1) })).sort((a, b) => b.s - a.s).slice(0, 12);

  /* Rules and tables, from the index, the titles, the contents and the text */
  const ruleScore = new Map();
  const tableScore = new Map();
  const sectionScore = new Map();
  const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
  topEntries.forEach(({ e, s }, i) => {
    const fade = s / (1 + i * 0.15);
    const places = e.refs.filter((r) => r.type === 'rule' || r.type === 'table' || r.type === 'range').length;
    const share = fade / Math.sqrt(1 + places / 3);
    for (const ref of e.refs) {
      if (ref.type === 'rule' && ready.rules.has(ref.rule)) add(ruleScore, ref.rule, share * 1.2);
      if (ref.type === 'range') {
        const list = expandRange(ready, ref.from, ref.to);
        for (const r of list) add(ruleScore, r, (share * 1.2) / Math.sqrt(list.length));
      }
      if (ref.type === 'table') {
        const list = ref.to ? ready.tableLabels.slice(ready.tableLabels.indexOf(ref.label), ready.tableLabels.indexOf(ref.to) + 1) : [ref.label];
        for (const t of list) add(tableScore, t, (share * 1.2) / Math.sqrt(list.length));
      }
      if (ref.type === 'section') add(sectionScore, ref.section, fade * 0.3);
    }
  });
  for (const r of ready.rules.values()) {
    const t = measure(r.titleWords);
    if (t.sum) {
      const whole = t.fit === 1 && r.titleWords.size >= 2 ? 1.3 : 1;
      add(ruleScore, r.rule, t.sum * (0.35 + 0.65 * t.fit) * t.reach ** 0.5 * 1.4 * whole);
      add(sectionScore, r.section, t.sum * t.reach * 0.1);
    }
    const b = measure(r.searchWords);
    if (b.sum) add(ruleScore, r.rule, b.sum * b.reach ** 2 * 0.45);
  }

  /* Contents */
  const measured = ready.headings.map((h) => {
    const m = measure(h.words);
    return { h, s: m.sum * (0.3 + 0.7 * m.fit) * m.reach ** 0.5 * (h.top ? 0.8 : 1) };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  // A matching heading lifts the rules printed under it.
  for (const { h, s } of measured.slice(0, 5)) {
    if (!h.page) continue;
    add(sectionScore, h.section, s * 0.4);
    if (h.top) continue;
    const next = ready.headings.find((o) => o.page && o.section === h.section && ready.headings.indexOf(o) > ready.headings.indexOf(h) && o.page >= h.page && o.title !== h.title);
    const last = next ? next.page : h.page + 1;
    const under = [...ready.rules.values()].filter((r) => r.section === h.section && r.pdfPage >= h.page && r.pdfPage <= last);
    for (const r of under) add(ruleScore, r.rule, (s * 0.8) / Math.sqrt(under.length));
  }
  const bestSections = [...sectionScore].sort((a, b) => b[1] - a[1]);
  const lift = new Map(bestSections.slice(0, 2).map(([sec], i) => [sec, i === 0 ? 1.2 : 1.08]));
  for (const [rule, s] of ruleScore) ruleScore.set(rule, s * (lift.get(ready.rules.get(rule)?.section) || 1));

  /* Tables named by the top rules, and tables whose own title fits */
  const tableAsked = LOOKS_LIKE_TABLE.test(stem);
  const topRules = [...ruleScore].sort((a, b) => b[1] - a[1]).slice(0, 5);
  for (const [rule, s] of topRules) {
    const named = new Set([...tablesNamedIn(ready.rules.get(rule)?.text || ''), ...ready.tables.filter((t) => t.see?.includes(rule)).map((t) => t.label)]);
    for (const label of named) if (map.tables.has(label)) add(tableScore, label, (s * 0.35) / Math.sqrt(named.size));
  }
  for (const t of ready.tables) {
    const m = measure(t.words);
    if (m.sum && m.reach >= 0.5) add(tableScore, t.label, m.sum * (0.25 + 0.75 * m.fit) * m.reach * 1.5);
    const inside = measure(t.bodyWords);
    if (inside.sum && inside.reach >= 0.6) add(tableScore, t.label, inside.sum * inside.reach ** 2 * 0.3);
  }
  if (!tableAsked) for (const [k, v] of tableScore) tableScore.set(k, v * 0.75);

  const rankedRules = [...ruleScore].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([rule, s]) => {
    const r = ready.rules.get(rule);
    return { rule, title: r.title, status: r.status, pdfPage: r.pdfPage, appendixB: r.appendixB, score: round(s) };
  });
  const rankedTables = [...tableScore].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([label, s]) => ({ label, title: map.tables.get(label)?.title ?? null, page: map.tables.get(label)?.page ?? null, score: round(s) }))
    .filter((t) => t.page);

  /* Definitions */
  const stemWords = new Set(lightWords(stem));
  let definitions;
  if (defWords?.length) {
    const want = defWords.join(' ');
    definitions = ready.defs.filter((d) => d.words.join(' ') === want);
    if (!definitions.length) definitions = ready.defs.filter((d) => defWords.every((w) => d.words.includes(w))).slice(0, 4);
  } else {
    definitions = ready.defs.filter((d) => d.words.length && d.words.every((w) => stemWords.has(w)))
      .sort((a, b) => b.words.length - a.words.length || ready.idf(b.words[0]) - ready.idf(a.words[0])).slice(0, 4);
  }

  const headings = measured.slice(0, 3).map(({ h, s }) => ({ section: h.section, title: h.title, page: h.page, printed: h.printed, top: h.top, score: round(s) }));

  /* General or specific: only the Contents and the Index decide this, the way it is done by hand. No rule is read. */
  const leaning = new Map();
  const sure = new Map(); // The key words matched by a heading or Index entry that fits fully and names one section only.
  const sectionOfRule = (rule) => Number(String(rule).split('-')[0]);
  const note = (sec, words) => {
    if (measure(words).fit < 1) return;
    const had = sure.get(sec) || new Set();
    ideas.forEach((idea, i) => {
      for (const w of idea.words) if (words.has(w)) had.add(i);
    });
    sure.set(sec, had);
  };
  for (const { h, s } of measured.slice(0, 5)) {
    add(leaning, h.section, h.top ? s * 1.5 : s);
    note(h.section, h.words);
  }
  entries.slice(0, 12).forEach(({ e, s }, i) => {
    const named = new Set();
    for (const ref of e.refs) {
      if (ref.type === 'section') named.add(ref.section);
      if (ref.type === 'rule') named.add(sectionOfRule(ref.rule));
      if (ref.type === 'range') named.add(sectionOfRule(ref.from));
      if (ref.type === 'table' && map.tables.get(ref.label)?.see?.[0]) named.add(sectionOfRule(map.tables.get(ref.label).see[0]));
    }
    for (const sec of named) add(leaning, sec, s / (1 + i * 0.15) / Math.sqrt(named.size));
    if (named.size === 1) note([...named][0], e.pathWords);
  });
  const sorted = [...leaning].filter(([sec]) => ready.sections.has(sec)).sort((a, b) => b[1] - a[1]);
  const strongest = sorted[0]?.[1] || 0;
  // A specific section only shows when the question is really about that kind of installation.
  const fits = (sec, s) => {
    const info = ready.sections.get(sec);
    if (info.kind === 'general') return true;
    return ideas.some((idea) => [...idea.words].some((w) => info.titleWords.has(w) && ready.titleCounts.get(w) < 3)) || ((sure.get(sec)?.size || 0) >= 2 && s >= strongest * 0.6);
  };
  const kept = sorted.filter(([sec, s]) => s >= strongest * 0.3 && fits(sec, s));
  const pick = (kind) => kept.filter(([sec]) => ready.sections.get(sec).kind === kind).slice(0, 2).map(([sec]) => {
    const { section, title, page, printed, kind: k } = ready.sections.get(sec);
    return { section, title, page, printed, kind: k };
  });
  const scope = { lean: kept[0] ? ready.sections.get(kept[0][0]).kind : null, specific: pick('specific'), general: pick('general') };

  /* The places to settle the question: what the best Index entry names, then the best matches */
  const places = [];
  const addPlace = (kind, id) => {
    if (!places.some((p) => p.kind === kind && p.id === id)) places.push({ kind, id });
  };
  const bestRefs = topEntries[0]?.e.refs || [];
  for (const ref of bestRefs) if (ref.type === 'table' && map.tables.has(ref.label)) addPlace('table', ref.label);
  for (const ref of bestRefs) {
    if (ref.type === 'rule' && ready.rules.has(ref.rule)) addPlace('rule', ref.rule);
    if (ref.type === 'range' && ready.rules.has(ref.from)) addPlace('rule', ref.from);
  }
  if (tableAsked && rankedTables[0]) addPlace('table', rankedTables[0].label);
  for (const r of rankedRules.slice(0, 2)) addPlace('rule', r.rule);

  /* Which way to go first, and why */
  const named = stem.match(/\b(\d{1,2}-\d{3,4})\b/)?.[1] || null;
  const namedTable = stem.match(/\bTable\s+(D?\d+[A-Z]*)\b/i)?.[1]?.toUpperCase() || null;
  let route;
  if (named) route = { go: 'rule', why: 'The question names a rule, so go straight to it.', target: named };
  else if (namedTable) route = { go: 'table', why: 'The question names a table, so go straight to it.', target: namedTable };
  else if (defWords && definitions.length) route = { go: 'definitions', why: 'It asks what a word means, so start in Section 0, Definitions.' };
  else if (LOOKS_LIKE_TABLE.test(stem) && rankedTables.length) route = { go: 'index', why: 'It asks for a size, number or type. Those often end in a table, so use the Index to find the rule or table.' };
  else if (headings[0] && headings[0].score >= (rankedRules[0]?.score ?? 0) * 0.55) route = { go: 'contents', why: 'A heading in the Contents matches your key words, so try that section first.' };
  else if (topEntries.length) route = { go: 'index', why: 'No section stands out, so look up your key words in the Index.' };
  else route = { go: 'none', why: 'I could not match these words. Try other words, or check the Index by hand.' };

  return {
    stem, options: parsed.options, keywords: original, dropped: original.filter((w) => dropSet.has(w)), bookWords,
    watch: watchWords(stem), negated: negatedWords(stem), route, definitions: definitions.map((d) => ({ term: d.term, page: d.page, text: d.text, y: d.y, endY: d.endY })),
    headings, scope, places: places.slice(0, 3), marks: [...allWords],
    // Entries far behind the best one are left out. The places they name can still show in the list of rules and tables.
    entries: topEntries.slice(0, 5).filter(({ s }) => s >= topEntries[0].s * 0.4).map(({ e, s }) => ({ path: e.path, refs: e.refs, page: e.page, score: round(s) })),
    rules: rankedRules, tables: rankedTables,
    sections: bestSections.slice(0, 3).map(([section]) => section),
  };
}

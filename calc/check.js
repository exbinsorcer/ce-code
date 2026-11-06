// Answers math questions with the step-by-step calculators in app/calc/. Plain code, no AI.
// It reads the inputs from the question's own words. If an input is missing or unclear, or the worked result matches no
// choice or more than one, it says not sure. Every value comes from the owner's book at run time, never from this file.
import { wordsOf } from '../rules.js?v=7e5a823c';
import { numbersIn, sizesIn, sizeKey } from '../check-numbers.js?v=7e5a823c';
import { PLACES } from './book.js?v=7e5a823c';
import { boxFill } from './box-fill.js?v=7e5a823c';
import { conduitFill } from './conduit-fill.js?v=7e5a823c';
import { motorCircuit } from './motor.js?v=7e5a823c';
import { dwellingLoad } from './dwelling.js?v=7e5a823c';
import { correctedSize, correctedAmpacity } from './correction.js?v=7e5a823c';

const notSure = (why) => ({ status: 'not-sure', choice: null, confidence: null, because: why, outside: false, evidence: [], why: [why] });
const COUNT = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const countOf = (w) => (/^\d+$/.test(w) ? Number(w) : COUNT[String(w).toLowerCase()] ?? null);
const SIZE = String.raw`(?:#\s*|No\.?\s*)?(\d{1,4}(?:\/0)?)\s*(?:AWG|kcmil)?`;

// "four #14 and two No. 12 conductors" gives [{ size: '14', count: 4 }, { size: '12', count: 2 }].
export function countedSizes(stem) {
  const out = [];
  const re = new RegExp(String.raw`\b(\d{1,3}|${Object.keys(COUNT).join('|')})\s*(?:x|×)?\s*(?:#\s*|No\.?\s*)(\d{1,4}(?:\/0)?)\b|\b(\d{1,3}|${Object.keys(COUNT).join('|')})\s+(\d{1,4}(?:\/0)?)\s*(?:AWG|kcmil)\b`, 'gi');
  for (const m of String(stem).matchAll(re)) {
    const count = countOf(m[1] ?? m[3]);
    const size = sizeKey(m[2] ?? m[4]);
    if (count) out.push({ size, count });
  }
  return out;
}
const numberBefore = (stem, unit) => {
  const m = [...String(stem).matchAll(new RegExp(String.raw`(\d+(?:[.,]\d+)?)\s*${unit}`, 'gi'))];
  return m.length === 1 ? Number(m[0][1].replace(',', '')) : null;
};
const material = (stem) => (/\balumin(?:i)?um\b/i.test(stem) ? 'aluminum' : /\bcopper\b/i.test(stem) ? 'copper' : null);
const temperatures = (stem) => [...String(stem).matchAll(/(\d{2,3})\s*(?:°|º|degrees?\s*)\s*C\b/gi)].map((m) => Number(m[1]));

const GIVEN_SIZE = /\b(?:No\.?\s*|#\s*)(\d{1,4}(?:\/0)?)\b/i;
const INSULATION = /\b(TW75|TWN75|TW|T90|RW90|RW75|R90|RPV90|TWU75|TWU|RWU90|NMD90)\b/;
const WORD_COUNT = String.raw`\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve`;

// How many conductors count toward the Table 5C multiplier, from Rule 4-004. Gives { count, say }, or null when it can't be told.
// A two-wire circuit: both count, because the identified conductor carries the same current. It isn't a neutral.
// A single-phase three-wire circuit: the neutral carries only the unbalanced current, so it doesn't count.
// A three-phase four-wire circuit depends on how the loads are connected, so it is left to be read by hand.
export function conductorCount(stem) {
  const s = String(stem);
  const bonding = /\bbonding\b/i.test(s) ? ' A bonding conductor never counts.' : '';
  const m = s.match(new RegExp(String.raw`\b(${WORD_COUNT})\s+((?:(?:single|three)[- ]phase,?\s+)?(?:two|three|four)[- ]wire(?:,?\s+(?:single|three)[- ]phase)?)\b[^.?]*?\b(?:loads?|circuits?)\b`, 'i'));
  if (m) {
    const circuits = countOf(m[1]);
    const what = m[2].toLowerCase();
    const three = /three[- ]phase/.test(what);
    const single = /single[- ]phase/.test(what);
    if (!circuits) return null;
    if (/two[- ]wire/.test(what)) return { count: circuits * 2, say: `${circuits} two-wire circuits × 2. The identified conductor carries the same current, so it counts.${bonding}` };
    if (/three[- ]wire/.test(what) && single) return { count: circuits * 2, say: `${circuits} three-wire circuits × 2. The neutral carries only the unbalanced current, so it doesn't count.${bonding}` };
    if (/three[- ]wire/.test(what) && three) return { count: circuits * 3, say: `${circuits} three-phase circuits × 3.${bonding}` };
    return null;
  }
  const n = countOf((s.match(new RegExp(String.raw`\b(${WORD_COUNT})\s+(?:[a-z0-9-]+\s+){0,2}conductors\b`, 'i')) || [])[1]);
  return n ? { count: n, say: null } : null;
}

// The temperature column: the terminations when the question names them, not the insulation.
function columnFor(s, ambient) {
  const term = s.match(/terminat\w*[^.?]*?(\d{2,3})\s*(?:°|º|degrees?\s*)\s*C/i);
  const code = (s.match(INSULATION) || [])[1];
  if (term) return { rating: term[1], say: code ? `Use the ${term[1]} °C column for the terminations, not the insulation rating of ${code}.` : `Use the ${term[1]} °C column for the terminations.` };
  const rating = temperatures(s).filter((t) => String(t) !== String(ambient));
  return rating.length === 1 ? { rating: String(rating[0]), say: null } : null;
}

// Copper or aluminum. The insulation alone doesn't say, so copper is assumed and the step says so.
function metalFor(s) {
  const named = material(s);
  if (named) return { material: named, say: null };
  return INSULATION.test(s) ? { material: 'copper', say: 'The question names no metal, so this uses copper, Table 2. If it is aluminum, the answer changes.' } : null;
}

// These don't use Tables 2 and 5C as worked here, or the load itself changes, so they stay not sure.
const OTHER_METHOD = /\b(free air|underground|directly buried|auxiliary gutter|cable tray|voltage drop)\b|(?<!non[- ])\bcontinuous\b/i;

// Why a sizing question has to be worked by hand.
function handReason(kind, stem) {
  const s = String(stem);
  if (kind === 'correction' || kind === 'ampacity') {
    if (/(?<!non[- ])\bcontinuous\b/i.test(s)) return 'A continuous load changes how the conductor is sized, and this calculator does not do that yet. Work it by hand.';
    if (OTHER_METHOD.test(s)) return 'This kind of run uses different tables, and this calculator does not do that yet. Work it by hand.';
    if (/four[- ]wire/i.test(s)) return 'On a three-phase four-wire circuit, whether the neutral counts depends on how the loads are connected. Read Rule 4-004 and work it by hand.';
  }
  return 'The question does not give every number the calculator needs, so it has to be worked by hand.';
}

function sizingCommon(s) {
  if (OTHER_METHOD.test(s)) return null;
  const ambient = /\bambient\b/i.test(s) ? (s.match(/ambient[^.?]*?(\d{2,3})\s*(?:°|º|degrees?\s*)\s*C/i) || [])[1] : null;
  const column = columnFor(s, ambient);
  const metal = metalFor(s);
  const counted = conductorCount(s);
  if (!column || !metal || !counted) return null;
  return { rating: column.rating, ratingSay: column.say, material: metal.material, materialSay: metal.say, ambient: ambient ? Number(ambient) : null, conductors: counted.count, countSay: counted.say };
}

// Which calculator a question is for, from its words. Only clear cases are taken.
export function kindOf(stem) {
  const s = String(stem);
  if (/\bbox\b/i.test(s) && /\b(mL|cm3|cm³|in3|volume|space)\b/i.test(s)) return 'boxFill';
  if (/\b(conduit|tubing|EMT|raceway)\b/i.test(s) && /\b(fill|fit|trade size)\b/i.test(s) && /\bTW|RW|T90|RPV|R90|TWU|TWN/.test(s)) return 'conduitFill';
  if (/\b(hp|horsepower)\b/i.test(s) && /\bmotor\b/i.test(s)) return 'motor';
  if (/\b(single dwelling|house|dwelling)\b/i.test(s) && /\b(m2|m²|square met)/i.test(s) && /\b(service|feeder|calculated load|minimum load)\b/i.test(s)) return 'dwelling';
  // Starting from a given size: how much it can carry in that run.
  if (/\bampacity\b/i.test(s) && GIVEN_SIZE.test(s) && /\b(conduit|raceway|cable|tubing|EMT)\b/i.test(s)) return 'ampacity';
  // Starting from a load: what size the conductors must be.
  if (/\bsizes?\b[^.?]*\bconductors?\b|\bconductors?\b[^.?]*\bsizes?\b/i.test(s) && /\b\d+(?:\.\d+)?\s*A\b/.test(s) && /\b(conduit|raceway|cable|tubing|EMT)\b/i.test(s)) return 'correction';
  if (/\bambient\b/i.test(s) || (/\bconductors?\b/i.test(s) && /\b(load|carry)\b/i.test(s) && /\b(raceway|cable)\b/i.test(s) && /\b\d+\s*A\b/.test(s))) return 'correction';
  return null;
}

// The calculator's inputs, read from the question. Null when one it needs is not there.
export function inputsFor(kind, stem, map) {
  const s = String(stem);
  if (kind === 'boxFill') {
    const volume = numberBefore(s, String.raw`(?:mL|cm3|cm³)`);
    const conductors = countedSizes(s);
    const devices = countOf((s.match(/\b(\d+|one|two|three|four)\s+(?:flush\s+)?(?:devices?|switch(?:es)?|receptacles?)\b/i) || [])[1]) || 0;
    const studs = countOf((s.match(/\b(\d+|one|two|three)\s+(?:fixture\s+)?(?:studs?|hickeys?)\b/i) || [])[1]) || 0;
    return volume && conductors.length ? { volume, conductors, devices, studs } : null;
  }
  if (kind === 'conduitFill') {
    const code = (s.match(/\b(TW75|TWN75|TW|T90|RW90|RW75|R90|RPV90|TWU75|TWU)\b/) || [])[1];
    // The area table whose title names that insulation type.
    const tables = PLACES.conduitFill.areas.filter((id) => new RegExp(String.raw`\b${code}\b`).test(map?.tables?.get(id)?.title || ''));
    const size = (s.match(/\btrade size\s+(\d{2,3})\b|\b(\d{2,3})\s+trade size\b/i) || []).slice(1).find(Boolean);
    const kinds = ['rigid PVC conduit', 'rigid metal conduit', 'electrical metallic tubing', 'electrical non-metallic tubing', 'flexible metal conduit'];
    const named = kinds.filter((k) => new RegExp(k.replace(/ /g, String.raw`\s+`), 'i').test(s) || (k === 'electrical metallic tubing' && /\bEMT\b/.test(s)));
    const conductors = countedSizes(s).map((c) => ({ ...c, group: /\bsolid\b/i.test(s) ? 'Solid' : 'Stranded' }));
    return code && tables.length === 1 && size && named.length === 1 && conductors.length ? { conductorTable: tables[0], conductors, conduit: { kind: named[0], size } } : null;
  }
  if (kind === 'motor') {
    const hp = (s.match(/\b(\d+(?:-\d+\/\d+|\/\d+)?)\s*(?:hp|horsepower)\b/i) || [])[1];
    const volts = numberBefore(s, String.raw`V\b`);
    const phase = /\bthree[- ]phase|3[- ]phase|3ø/i.test(s) ? 3 : /\bsingle[- ]phase|1[- ]phase/i.test(s) ? 1 : null;
    const temps = temperatures(s);
    const device = /\bnon[- ]time[- ]delay\b/i.test(s) ? 'non-time-delay fuse' : /\btime[- ]delay\b/i.test(s) ? 'time-delay fuse' : /\bbreaker\b/i.test(s) ? 'inverse-time breaker' : null;
    const motorType = phase === 1 ? 'Single-phase' : /\bwound[- ]rotor\b/i.test(s) ? 'Wound rotor' : /\bsquirrel|induction\b/i.test(s) && /\bfull[- ]voltage\b|across[- ]the[- ]line/i.test(s) ? 'Full-voltage' : null;
    const want = /\b(overcurrent|fuse|breaker)\b/i.test(s) ? 'overcurrent' : 'conductor';
    return hp && volts && phase && temps.length <= 1 ? { want, phase, hp, volts: String(volts), rating: temps[0] ? String(temps[0]) : null, material: material(s), device, motorType } : null;
  }
  if (kind === 'dwelling') {
    const areas = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(?:m2|m²|square met)/gi)].map((m) => Number(m[1]));
    const noBasement = /\b(no|without a)\s+basement\b/i.test(s);
    if (areas.length !== 1 || !noBasement) return null;
    const watts = (re) => {
      const m = s.match(re);
      return m ? Number(m[1].replace(/[ ,]/g, '')) * (/kW/i.test(m[0]) ? 1000 : 1) : 0;
    };
    return {
      livingArea: areas[0], floorArea: areas[0],
      heating: watts(/(\d[\d ,]*)\s*(k?W)\s+(?:of\s+)?(?:electric\s+)?(?:space[- ])?heat/i),
      rangeW: watts(/(\d[\d ,.]*)\s*(k?W)\s+(?:electric\s+)?range/i),
      otherLoads: [],
    };
  }
  if (kind === 'correction') {
    const load = numberBefore(s, String.raw`A\b`);
    const common = sizingCommon(s);
    return load && common ? { load, ...common } : null;
  }
  if (kind === 'ampacity') {
    const size = (s.match(GIVEN_SIZE) || [])[1];
    const common = sizingCommon(s);
    return size && common ? { size, ...common } : null;
  }
  return null;
}

// The choice the worked result matches. Sizes match sizes, numbers match numbers. Exactly one, or null.
function matchChoice(options, kind, out, stem) {
  if (kind === 'motor') {
    if (/\b(overcurrent|fuse|breaker)\b/i.test(stem)) return byNumber(options, out.overcurrentMax);
    return bySize(options, out.result.value);
  }
  if (kind === 'correction') return bySize(options, out.result.value);
  if (kind === 'ampacity') return byNumber(options, out.result.value);
  if (kind === 'boxFill' && /\b(fit|allowed|permitted|enough|large enough)\b/i.test(stem) && options.every((o) => /^(yes|no)\b/i.test(o.text))) {
    const hits = options.filter((o) => /^yes\b/i.test(o.text) === out.fits);
    return hits.length === 1 ? hits[0] : null;
  }
  if (kind === 'conduitFill' && options.every((o) => /^(yes|no)\b/i.test(o.text))) {
    const hits = options.filter((o) => /^yes\b/i.test(o.text) === out.fits);
    return hits.length === 1 ? hits[0] : null;
  }
  return byNumber(options, out.result.value);
}
const near = (a, b) => Math.abs(a - b) <= Math.max(0.005 * Math.abs(b), 0.01);
function byNumber(options, v) {
  const hits = options.filter((o) => {
    const n = numbersIn(o.text.replace(/(\d) (?=\d{3}\b)/g, '$1'));
    const scale = /\bkW\b/i.test(o.text) ? 1000 : 1;
    return n.length === 1 && near(n[0] * scale, v);
  });
  return hits.length === 1 ? hits[0] : null;
}
function bySize(options, size) {
  const hits = options.filter((o) => {
    const s = sizesIn(o.text);
    const plain = s.length ? s : /^\s*(\d{1,4}(?:\/0)?)\s*$/.test(o.text) ? [sizeKey(o.text.trim())] : [];
    return plain.length === 1 && plain[0] === sizeKey(String(size));
  });
  return hits.length === 1 ? hits[0] : null;
}

// The tables a calculator may read, so their pages can be loaded first.
const TABLES = {
  boxFill: () => [PLACES.boxFill.perConductor],
  conduitFill: () => [...PLACES.conduitFill.areas, PLACES.conduitFill.fill, ...PLACES.conduitFill.conduits],
  motor: () => [PLACES.motor.percent, PLACES.motor.threePhase, PLACES.motor.singlePhase, ...Object.values(PLACES.motor.ampacity)],
  dwelling: () => [],
  correction: () => [PLACES.correction.heat, PLACES.correction.many, ...Object.values(PLACES.correction.ampacity)],
  ampacity: () => [PLACES.correction.heat, PLACES.correction.many, ...Object.values(PLACES.correction.ampacity)],
};
const RUN = { boxFill, conduitFill, motor: motorCircuit, dwelling: dwellingLoad, correction: correctedSize, ampacity: correctedAmpacity };

// f: what findInBook found. Gives a result like the other checkers, with the calculator's `steps`, or not sure.
export async function checkCalculation(f, { map, ready, pageData, readTable }) {
  const kind = kindOf(f.stem);
  if (!kind) return notSure('This is not a kind of math question the calculators take.');
  const input = inputsFor(kind, f.stem, map);
  if (!input) return { ...notSure(handReason(kind, f.stem)), calculation: kind };
  const tables = new Map();
  for (const id of TABLES[kind]()) {
    const info = map.tables.get(id);
    if (!info) continue;
    const pages = await Promise.all((info.pages?.length ? info.pages : [info.page]).filter(Boolean).map((n) => pageData(n)));
    tables.set(id, readTable(id, pages));
  }
  const ctx = { table: (id) => tables.get(id) ?? null, rule: (id) => (ready.rules.get(id) ? { text: ready.rules.get(id).text, page: ready.rules.get(id).pdfPage } : null) };
  const out = RUN[kind](ctx, input);
  if (out.status !== 'done') return { ...notSure(out.why[0]), calculation: kind, steps: [] };
  const workedWhy = out.steps.map((s) => ({ head: [s.method === 'one' ? 'Method One' : s.method === 'two' ? 'Method Two' : null, s.ref ? `${s.ref.type === 'table' ? 'Table' : 'Rule'} ${s.ref.id}` : null].filter(Boolean).join(' · ') || 'Work it out', say: s.say }));
  const workedEvidence = out.steps.filter((s) => s.ref).map((s) => ({ kind: s.ref.type, ref: s.ref.id, page: s.ref.page, box: null }));
  // A question with no choices, like one in the course book: the worked result is the answer, with nothing to match it to.
  if (f.options.length < 2) {
    return { status: 'worked', choice: null, confidence: 'medium', because: 'Worked step by step from the book.', outside: false, calculation: kind, steps: out.steps, methods: out.methods || null, given: out.given || null, accept: out.accept || null, result: out.result, evidence: workedEvidence, why: workedWhy, mistake: null };
  }
  const pick = matchChoice(f.options, kind, out, f.stem);
  if (!pick) return { ...notSure('The worked answer matches no choice, or more than one.'), calculation: kind, steps: out.steps };
  return {
    status: 'answer',
    choice: pick.letter,
    // Several values are read and put together, so a worked answer is rated medium at most.
    confidence: 'medium',
    because: 'Worked step by step from the book.',
    outside: false,
    calculation: kind,
    steps: out.steps,
    methods: out.methods || null,
    given: out.given || null, accept: out.accept || null,
    result: out.result,
    evidence: workedEvidence,
    why: workedWhy,
    mistake: null,
  };
}

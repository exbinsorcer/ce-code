// Conductor size for a load, with the heat and the number of conductors in the raceway taken into account.
// Logic only, no screens. The ampacities and both correction factors are read from the owner's book at run time.
//
// A load is worked two ways, because the course teaches both:
//   Method Two: load ÷ factor gives the table ampacity needed. One step, with no guessing.
//   Method One: pick a size for the load, multiply its table ampacity by the factor, and go up a size until it carries the load.
// The two must land on the same size, or the answer is not sure. A given size has only one way: table ampacity × factor.
import { PLACES, table, rowForSize, cellNumber, guard, done, round, NotSure } from './book.js?v=344d272b';
import { CHECKED_NOTES } from '../check-numbers.js?v=344d272b';

// A row label that is a range, like "4–6" or "43 and up".
const inRange = (label, n) => {
  const t = String(label).trim();
  let m;
  if ((m = t.match(/^(\d+)\s*[–—-]\s*(\d+)$/))) return n >= Number(m[1]) && n <= Number(m[2]);
  if ((m = t.match(/^(\d+)\s+and up$/i))) return n >= Number(m[1]);
  return false;
};

const ruleRef = (ctx) => {
  const r = ctx.rule?.(PLACES.correction.rule);
  return { type: 'rule', id: PLACES.correction.rule, page: r?.page ?? null };
};

// The shared start: how many conductors count, which column, and the factors from the book. Gives the combined factor.
function factorsFor(ctx, { rating, ambient = null, conductors = 3, countSay = null, ratingSay = null, materialSay = null }) {
  const P = PLACES.correction;
  const steps = [];
  let factor = 1;
  if (countSay) steps.push({ say: countSay, value: conductors, unit: 'conductors', ref: ruleRef(ctx) });
  if (materialSay) steps.push({ say: materialSay, value: null, unit: '', ref: null });
  if (ratingSay) steps.push({ say: ratingSay, value: Number(rating), unit: '°C', ref: null });
  if (ambient !== null && ambient !== undefined) {
    const heat = table(ctx, P.heat);
    const rows = heat.rows.filter((r) => Number(r.label) === Number(ambient));
    if (rows.length !== 1) throw new NotSure(`Table ${P.heat} has no row for exactly ${ambient} °C. Read the next row up by hand.`);
    const cols = heat.columns.slice((heat.stub ?? 0) + 1).filter((c) => c.label.trim() === String(rating));
    if (cols.length !== 1) throw new NotSure(`Table ${P.heat} has no single column for ${rating} °C insulation.`);
    const f = cellNumber(heat, rows[0], cols[0], Object.keys(CHECKED_NOTES[P.heat] || {}));
    factor *= f;
    steps.push({ say: `Heat: ${ambient} °C around ${rating} °C insulation.`, value: f, unit: '×', ref: { type: 'table', id: P.heat, page: rows[0].page } });
  }
  const many = table(ctx, P.many);
  const rows = many.rows.filter((r) => inRange(r.label, conductors));
  if (rows.length !== 1) throw new NotSure(`Table ${P.many} has no single row for ${conductors} conductors.`);
  const col = many.columns.slice((many.stub ?? 0) + 1);
  if (col.length !== 1) throw new NotSure(`Table ${P.many} has more than one column.`);
  const g = cellNumber(many, rows[0], col[0]);
  factor *= g;
  steps.push({ say: `${conductors} conductors in one raceway or cable: this is the multiplier.`, value: g, unit: '×', ref: { type: 'table', id: P.many, page: rows[0].page } });
  return { factor, steps };
}

function ampacityColumn(ctx, material, rating) {
  const id = PLACES.correction.ampacity[material];
  if (!id) throw new NotSure('Say copper or aluminum.');
  const amp = table(ctx, id);
  const cols = amp.columns.slice((amp.stub ?? 0) + 1).filter((c) => new RegExp(`(^|\\s)${rating}\\s*°C$`).test(c.label.trim()));
  if (cols.length !== 1) throw new NotSure(`Table ${id} has no single column for ${rating} °C.`);
  const allow = Object.keys(CHECKED_NOTES[id] || {});
  return { id, amp, read: (r) => cellNumber(amp, r, cols[0], allow) };
}

// input: { load: amps the conductors must carry, material: 'copper' | 'aluminum', rating: temperature column like '75',
//          ambient: °C around the conductors, or left out for none; conductors: how many count in the raceway or cable,
//          countSay, ratingSay, materialSay: how the question led to those, shown as steps }
export function correctedSize(ctx, input) {
  const { load, material, rating, conductors = 3 } = input;
  return guard(() => {
    if (!(load > 0)) throw new NotSure('Give the load in amps.');
    const { factor, steps: start } = factorsFor(ctx, input);
    const { id, amp, read } = ampacityColumn(ctx, material, rating);
    const ref = (r) => ({ type: 'table', id, page: r.page });

    // Method Two
    const need = round(load / factor);
    const two = amp.rows.find((r) => read(r) >= need);
    if (!two) throw new NotSure(`No size in Table ${id} is large enough.`);
    const methodTwo = [
      { method: 'two', say: `Divide the load by the multiplier: ${load} A ÷ ${round(factor, 4)}. This is the table ampacity needed.`, value: need, unit: 'A', ref: null },
      { method: 'two', say: `The smallest ${material} size at ${rating} °C that reaches it, rated ${read(two)} A.`, value: two.label, unit: 'AWG or kcmil', ref: ref(two) },
    ];

    // Method One
    const methodOne = [];
    const first = amp.rows.findIndex((r) => read(r) >= load);
    if (first < 0) throw new NotSure(`No size in Table ${id} is large enough.`);
    let one = null;
    for (const r of amp.rows.slice(first)) {
      const carries = round(read(r) * factor);
      const fits = carries >= load;
      methodOne.push({ method: 'one', say: `No. ${r.label}: ${read(r)} A × ${round(factor, 4)}. ${fits ? `It carries the ${load} A load.` : `Too small for ${load} A, so go up a size.`}`, value: carries, unit: 'A', ref: ref(r) });
      if (fits) {
        one = r;
        break;
      }
    }
    if (!one) throw new NotSure(`No size in Table ${id} is large enough.`);
    // Each method checks the other.
    if (one !== two) throw new NotSure('The two methods land on different sizes, so this has to be worked by hand.');

    const corrected = round(read(two) * factor);
    const steps = [...start, ...methodTwo, ...methodOne];
    return {
      ...done({ value: two.label, unit: 'AWG or kcmil' }, steps),
      factor: round(factor, 4),
      corrected,
      // Any of these is a right last number: the ampacity needed, what the size carries, or the size itself.
      accept: [need, corrected, ...(/^\d+$/.test(two.label) ? [Number(two.label)] : [])],
      methods: { start, one: methodOne, two: methodTwo },
      given: [
        { key: 'load', label: 'Load', value: load, unit: 'A' },
        { key: 'conductors', label: 'Conductors that count', value: conductors, unit: '' },
        { key: 'column', label: 'Temperature column', value: Number(rating), unit: '°C' },
        { key: 'factor', label: 'Multiplier', value: round(factor, 4), unit: '×' },
      ],
    };
  });
}

// Starting from a given size, there is one way: its table ampacity × the factor.
// input: { size, material, rating, ambient, conductors, countSay, ratingSay, materialSay }
export function correctedAmpacity(ctx, input) {
  const { size, material, rating, conductors = 3 } = input;
  return guard(() => {
    const { factor, steps: start } = factorsFor(ctx, input);
    const { id, amp, read } = ampacityColumn(ctx, material, rating);
    const row = rowForSize(amp, size);
    const carries = round(read(row) * factor);
    const worked = { method: 'one', say: `No. ${row.label}: ${read(row)} A × ${round(factor, 4)}.`, value: carries, unit: 'A', ref: { type: 'table', id, page: row.page } };
    return {
      ...done({ value: carries, unit: 'A' }, [...start, worked]),
      factor: round(factor, 4),
      methods: { start, one: [worked], two: [] },
      given: [
        { key: 'size', label: 'Size', value: row.label, unit: 'AWG or kcmil' },
        { key: 'conductors', label: 'Conductors that count', value: conductors, unit: '' },
        { key: 'column', label: 'Temperature column', value: Number(rating), unit: '°C' },
        { key: 'factor', label: 'Multiplier', value: round(factor, 4), unit: '×' },
      ],
    };
  });
}

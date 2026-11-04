// Conductor size for a load, with the heat and the number of conductors in the raceway taken into account.
// Logic only, no screens. The ampacities and both correction factors are read from the owner's book at run time.
import { PLACES, table, cellNumber, guard, done, round, NotSure } from './book.js?v=a8290e52';
import { CHECKED_NOTES } from '../check-numbers.js?v=a8290e52';

// A row label that is a range, like "4–6" or "43 and up".
const inRange = (label, n) => {
  const t = String(label).trim();
  let m;
  if ((m = t.match(/^(\d+)\s*[–—-]\s*(\d+)$/))) return n >= Number(m[1]) && n <= Number(m[2]);
  if ((m = t.match(/^(\d+)\s+and up$/i))) return n >= Number(m[1]);
  return false;
};

// input: { load: amps the conductors must carry, material: 'copper' | 'aluminum', rating: temperature column like '75',
//          ambient: °C around the conductors, or left out for none; conductors: how many in the raceway or cable }
export function correctedSize(ctx, { load, material, rating, ambient = null, conductors = 3 }) {
  return guard(() => {
    const P = PLACES.correction;
    if (!(load > 0)) throw new NotSure('Give the load in amps.');
    const steps = [];
    let factor = 1;

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
    steps.push({ say: `${conductors} conductors in one raceway or cable.`, value: g, unit: '×', ref: { type: 'table', id: P.many, page: rows[0].page } });
    const need = round(load / factor);
    steps.push({ say: 'Divide the load by the factors: the table ampacity needed.', value: need, unit: 'A', ref: null });

    const id = P.ampacity[material];
    if (!id) throw new NotSure('Say copper or aluminum.');
    const amp = table(ctx, id);
    const cols = amp.columns.slice((amp.stub ?? 0) + 1).filter((c) => new RegExp(`^${rating}\\s*°C$`).test(c.label.trim()));
    if (cols.length !== 1) throw new NotSure(`Table ${id} has no single column for ${rating} °C.`);
    const allow = Object.keys(CHECKED_NOTES[id] || {});
    for (const r of amp.rows) {
      const v = cellNumber(amp, r, cols[0], allow);
      if (v >= need) {
        steps.push({ say: `The smallest ${material} size at ${rating} °C with that ampacity.`, value: r.label, unit: 'AWG or kcmil', ref: { type: 'table', id, page: r.page } });
        steps.push({ say: 'Its ampacity after the factors.', value: round(v * factor), unit: 'A', ref: null });
        return { ...done({ value: r.label, unit: 'AWG or kcmil' }, steps), factor: round(factor, 4), corrected: round(v * factor) };
      }
    }
    throw new NotSure(`No size in Table ${id} is large enough.`);
  });
}

// Minimum calculated load for the service or feeder of a single dwelling. Logic only, no screens.
// It works out both ways the rule gives, a) by adding up the loads and b) the flat load for the floor area, and takes
// the greater. Every wattage, area and percent is read from the rule's own wording at run time.
import { PLACES, ruleNumber, guard, done, NotSure } from './book.js?v=4aa3f35a';

// input: { livingArea: m² of living area, worked out the way the book says; floorArea: m² not counting the basement;
//          heating: W after its demand factors; airConditioning: W; rangeW: rating of one electric range, or 0;
//          waterHeaters: W of tankless, steamer, pool, hot tub or spa heaters; evse: W of vehicle chargers;
//          otherLoads: [W of each other load] }
export function dwellingLoad(ctx, input) {
  return guard(() => {
    const id = PLACES.dwelling.rule;
    const { livingArea, floorArea } = input;
    if (!(livingArea > 0) || !(floorArea > 0)) throw new NotSure('Give the living area and the floor area without the basement, in m².');
    const n = (path, unit, nth = 0) => ruleNumber(ctx, id, path, unit, nth);
    const ref = (path) => ({ type: 'rule', id: `${id} ${path}`, page: ctx.rule(id)?.page ?? null });
    const steps = [];

    // a) Adding up the loads.
    const basic = n('1) a) i)', 'W');
    const first = n('1) a) i)', 'm2');
    let a = basic.value;
    steps.push({ say: `Basic load for the first ${first.value} m² of living area.`, value: basic.value, unit: 'W', ref: ref('1) a) i)') });
    const extra = n('1) a) ii)', 'W');
    const each = n('1) a) ii)', 'm2');
    const over = Math.max(0, livingArea - first.value);
    if (over > 0) {
      const blocks = Math.ceil(over / each.value);
      a += blocks * extra.value;
      steps.push({ say: `${blocks} more block${blocks > 1 ? 's' : ''} of ${each.value} m² or part of one.`, value: blocks * extra.value, unit: 'W', ref: ref('1) a) ii)') });
    }
    const heatAc = (input.heating || 0) + (input.airConditioning || 0);
    if (heatAc) {
      a += heatAc;
      steps.push({ say: 'Space heating after its demand factors, plus air conditioning at its full rating.', value: heatAc, unit: 'W', ref: ref('1) a) iii)') });
    }
    const range = Number(input.rangeW) || 0;
    if (range) {
      const flat = n('1) a) iv)', 'W');
      const pct = n('1) a) iv)', '%');
      const above = n('1) a) iv)', 'kW');
      const r = flat.value + (Math.max(0, range - above.value * 1000) * pct.value) / 100;
      a += r;
      steps.push({ say: `Range: ${flat.value} W, plus ${pct.value}% of the rating above ${above.value} kW.`, value: r, unit: 'W', ref: ref('1) a) iv)') });
    }
    for (const [key, path, say] of [['waterHeaters', '1) a) v)', 'Tankless and pool, hot tub or spa heaters'], ['evse', '1) a) vi)', 'Vehicle chargers']]) {
      const w = Number(input[key]) || 0;
      if (!w) continue;
      const pct = n(path, '%');
      a += (w * pct.value) / 100;
      steps.push({ say: `${say} at ${pct.value}%.`, value: (w * pct.value) / 100, unit: 'W', ref: ref(path) });
    }
    const min = n('1) a) vii)', 'W', 0);
    const others = (input.otherLoads || []).filter((w) => w > min.value);
    if (others.length) {
      const sum = others.reduce((x, y) => x + y, 0);
      let w;
      if (range) {
        const pct = n('1) a) vii)', '%', 0);
        w = (sum * pct.value) / 100;
        steps.push({ say: `Other loads over ${min.value} W, with a range: ${pct.value}% of each.`, value: w, unit: 'W', ref: ref('1) a) vii)') });
      } else {
        const cap = n('1) a) vii)', 'W', 1);
        const full = n('1) a) vii)', '%', 1);
        const rest = n('1) a) vii)', '%', 2);
        w = (Math.min(sum, cap.value) * full.value) / 100 + (Math.max(0, sum - cap.value) * rest.value) / 100;
        steps.push({ say: `Other loads over ${min.value} W, no range: ${full.value}% up to ${cap.value} W, then ${rest.value}% of the rest.`, value: w, unit: 'W', ref: ref('1) a) vii)') });
      }
      a += w;
    }
    steps.push({ say: 'Total by adding up the loads.', value: a, unit: 'W', ref: ref('1) a)') });

    // b) The flat load for the floor area.
    const big = n('1) b) i)', 'W');
    const cut = n('1) b) i)', 'm2');
    const small = n('1) b) ii)', 'W');
    const cut2 = n('1) b) ii)', 'm2');
    if (cut.value !== cut2.value) throw new NotSure(`The two parts of ${id} 1) b) give different floor areas.`);
    const b = floorArea >= cut.value ? big.value : small.value;
    steps.push({ say: `Flat load for a floor area ${floorArea >= cut.value ? 'of' : 'under'} ${cut.value} m²${floorArea >= cut.value ? ' or more' : ''}, not counting the basement.`, value: b, unit: 'W', ref: ref(floorArea >= cut.value ? '1) b) i)' : '1) b) ii)') });
    const total = Math.max(a, b);
    steps.push({ say: 'The calculated load is the greater of the two.', value: total, unit: 'W', ref: ref('1)') });
    return { ...done({ value: total, unit: 'W' }, steps), byLoads: a, byArea: b };
  });
}

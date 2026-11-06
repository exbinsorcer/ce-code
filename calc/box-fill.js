// Box fill, by usable space per insulated conductor. Logic only, no screens.
// It follows the rule for boxes with conductors of different sizes or a volume of their own: each conductor needs the
// space the table gives for its size, the box loses room for studs, devices and deep devices, and the total must fit.
// Every space and constant is read from the owner's book at run time.
import { PLACES, table, rowForSize, cellNumber, columnWith, ruleNumber, guard, done, round, NotSure } from './book.js?v=a8a283be';

// input: { volume: box volume in mL (all sections together), conductors: [{ size: '14', count: 4 }],
//          studs: fixture studs or hickeys, devices: flush devices on one strap, deep: [depth in cm of each deep device] }
export function boxFill(ctx, { volume, conductors = [], studs = 0, devices = 0, deep = [] }) {
  return guard(() => {
    const P = PLACES.boxFill;
    if (!(volume > 0)) throw new NotSure('Give the box volume in mL.');
    if (!conductors.length) throw new NotSure('Give the conductors in the box.');
    const t = table(ctx, P.perConductor);
    const col = columnWith(t);
    const steps = [];
    const space = new Map();
    let need = 0;
    for (const { size, count } of conductors) {
      const row = rowForSize(t, size);
      const each = cellNumber(t, row, col);
      space.set(String(size), each);
      need += each * count;
      steps.push({ say: `${count} × size ${size}: each needs this much space.`, value: each, unit: 'mL', ref: { type: 'table', id: t.label, page: row.page } });
    }
    // The largest conductor is the one that needs the most space.
    const [largest, big] = [...space].sort((a, b) => b[1] - a[1])[0];
    if (studs) {
      need += studs * big;
      steps.push({ say: `Each fixture stud or hickey counts as one conductor of the largest size, ${largest}.`, value: studs * big, unit: 'mL', ref: { type: 'rule', id: P.rule, page: ctx.rule(P.rule)?.page ?? null } });
    }
    if (devices) {
      need += devices * 2 * big;
      steps.push({ say: `Each flush device on one strap counts as two conductors. Counted at the largest size, ${largest}, to be safe.`, value: devices * 2 * big, unit: 'mL', ref: { type: 'rule', id: P.rule, page: ctx.rule(P.rule)?.page ?? null } });
    }
    steps.push({ say: 'Pairs of connectors with caps are not counted when each size has its own space.', value: 0, unit: 'mL', ref: { type: 'rule', id: P.rule, page: ctx.rule(P.rule)?.page ?? null } });
    let usable = volume;
    if (deep.length) {
      const limit = ruleNumber(ctx, P.rule, '3)', 'cm');
      const per = ruleNumber(ctx, P.rule, '3)', 'cm3');
      for (const d of deep) {
        if (d > limit.value) {
          usable -= per.value * d;
          steps.push({ say: `A device deeper than ${limit.value} cm takes ${per.value} cm³ for each cm of its depth.`, value: round(per.value * d), unit: 'mL', ref: { type: 'rule', id: P.rule, page: limit.page } });
        }
      }
    }
    need = round(need);
    usable = round(usable);
    steps.push({ say: `Space needed, against the box's usable space of ${usable} mL.`, value: need, unit: 'mL', ref: null });
    return { ...done({ value: need, unit: 'mL' }, steps), fits: need <= usable, usable };
  });
}

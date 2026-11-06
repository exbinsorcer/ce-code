// One motor on continuous duty: its full load current, the smallest branch circuit conductor, and the largest
// overcurrent device. Logic only, no screens. Every percent, current and ampacity is read from the owner's book.
import { PLACES, table, cellNumber, ruleNumber, guard, done, round, NotSure } from './book.js?v=a32e38e3';
import { CHECKED_NOTES } from '../check-numbers.js?v=a32e38e3';

const lower = (s) => String(s).toLowerCase();
const DEVICES = { 'time-delay fuse': /^time-delay fuses?$/i, 'non-time-delay fuse': /^non-time-delay/i, 'inverse-time breaker': /inverse-time circuit breaker/i };

// input: { phase: 1 or 3, hp: '10', volts: '575', flc: amps from the nameplate (used instead of the table when given),
//          motorType: words from the row of motor types, device: 'time-delay fuse' | 'non-time-delay fuse' | 'inverse-time breaker',
//          material: 'copper' | 'aluminum', rating: conductor temperature column, like '75' }
// want: 'conductor' or 'overcurrent' works out only that part, so a question about one needs no inputs for the other.
export function motorCircuit(ctx, input) {
  return guard(() => {
    const want = input.want || 'both';
    const P = PLACES.motor;
    const steps = [];

    // 1. Full load current.
    let flc = Number(input.flc) || null;
    if (flc) steps.push({ say: 'Full load current from the nameplate.', value: flc, unit: 'A', ref: null });
    else {
      const id = input.phase === 3 ? P.threePhase : input.phase === 1 ? P.singlePhase : null;
      if (!id) throw new NotSure('Say single-phase or three-phase, or give the nameplate current.');
      const t = table(ctx, id);
      const rows = t.rows.filter((r) => r.label.trim() === String(input.hp).trim());
      if (rows.length !== 1) throw new NotSure(`Table ${id} has no single row for ${input.hp} hp.`);
      const cols = t.columns.slice((t.stub ?? 0) + 1).filter((c) => new RegExp(`^${input.volts}\\s*V$`).test(c.label.trim()) && (input.phase === 1 || /induction/i.test(c.groups.join(' '))));
      if (cols.length !== 1) throw new NotSure(`Table ${id} has no single column for ${input.volts} V.`);
      flc = cellNumber(t, rows[0], cols[0]);
      steps.push({ say: `Full load current of a ${input.hp} hp motor at ${input.volts} V.`, value: flc, unit: 'A', ref: { type: 'table', id, page: rows[0].page } });
    }

    let size = null;
    let need = null;
    // 2. The conductors must carry the rule's percent of that current.
    if (want !== 'overcurrent') {
    const pct = ruleNumber(ctx, P.conductors, '1)', '%');
    if (pct.count !== 1) throw new NotSure(`Rule ${P.conductors} 1) gives more than one percent.`);
    need = round((flc * pct.value) / 100);
    steps.push({ say: `The conductors must carry at least ${pct.value}% of the full load current.`, value: need, unit: 'A', ref: { type: 'rule', id: P.conductors, page: pct.page } });
    const ampId = P.ampacity[input.material];
    if (!ampId) throw new NotSure('Say copper or aluminum.');
    const amp = table(ctx, ampId);
    const tcols = amp.columns.slice((amp.stub ?? 0) + 1).filter((c) => new RegExp(`^${input.rating}\\s*°C$`).test(c.label.trim()));
    if (tcols.length !== 1) throw new NotSure(`Table ${ampId} has no single column for ${input.rating} °C.`);
    // The table lists sizes from small to large, so the first row that carries enough is the smallest.
    const allow = Object.keys(CHECKED_NOTES[ampId] || {});
    for (const r of amp.rows) {
      const v = cellNumber(amp, r, tcols[0], allow);
      if (v >= need) {
        size = { label: r.label, value: v, page: r.page };
        break;
      }
    }
    if (!size) throw new NotSure(`No size in Table ${ampId} carries ${need} A.`);
    steps.push({ say: `The smallest ${input.material} size in a raceway at ${input.rating} °C that carries that much.`, value: size.label, unit: 'AWG or kcmil', ref: { type: 'table', id: ampId, page: size.page } });

    }
    if (want === 'conductor') return { ...done({ value: size.label, unit: 'AWG or kcmil' }, steps), flc, conductorAmps: need, overcurrentMax: null };

    // 3. The overcurrent device may not exceed the table's percent of the full load current.
    const pt = table(ctx, P.percent);
    const rows = pt.rows.filter((r) => input.motorType && lower([...r.groups, r.label].join(' ')).includes(lower(input.motorType)));
    if (rows.length !== 1) throw new NotSure(`Pick one type of motor from Table ${P.percent}.`);
    const dev = DEVICES[input.device];
    const dcols = dev ? pt.columns.slice((pt.stub ?? 0) + 1).filter((c) => dev.test(c.label.trim())) : [];
    if (dcols.length !== 1) throw new NotSure(`Pick one kind of overcurrent device from Table ${P.percent}.`);
    const devPct = cellNumber(pt, rows[0], dcols[0], Object.keys(CHECKED_NOTES[P.percent] || {}));
    const max = round((flc * devPct) / 100);
    steps.push({ say: `The ${input.device} may not exceed ${devPct}% of the full load current.`, value: max, unit: 'A', ref: { type: 'table', id: P.percent, page: rows[0].page } });
    const floor = ruleNumber(ctx, P.overcurrent, '3) a)', 'A');
    if (max < floor.value) steps.push({ say: `A device of ${floor.value} A is still allowed even though it is more than this.`, value: floor.value, unit: 'A', ref: { type: 'rule', id: P.overcurrent, page: floor.page } });
    steps.push({ say: 'Use a standard rating at or below this. The rule allows more only when the motor will not start.', value: Math.max(max, max < floor.value ? floor.value : 0), unit: 'A', ref: { type: 'rule', id: P.overcurrent, page: floor.page } });

    const most = Math.max(max, max < floor.value ? floor.value : 0);
    if (want === 'overcurrent') return { ...done({ value: most, unit: 'A' }, steps), flc, conductorAmps: null, overcurrentMax: most };
    return { ...done({ value: size.label, unit: 'AWG or kcmil' }, steps), flc, conductorAmps: need, overcurrentMax: most };
  });
}

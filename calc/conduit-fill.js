// Conduit fill, by adding up the cross-sectional areas of the conductors. Logic only, no screens.
// The fill percent for the number of conductors, each conductor's area and the conduit's allowed area are all read from
// the owner's book at run time. If any one cannot be read clearly, the answer is not sure.
import { PLACES, table, cellNumber, guard, done, round, NotSure } from './book.js?v=4aa3f35a';
import { sizeKey } from '../check-numbers.js?v=4aa3f35a';

const lower = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

// input: { conductorTable: the table of conductor areas for the insulation type, like the one for TW conductors,
//          conductors: [{ size: '10', count: 3, group: 'Stranded' }], conduit: { kind: 'rigid PVC conduit', size: '27' } }
export function conduitFill(ctx, { conductorTable, conductors = [], conduit = {} }) {
  return guard(() => {
    const P = PLACES.conduitFill;
    if (!P.areas.includes(conductorTable)) throw new NotSure('Pick the table of conductor areas for the insulation type.');
    if (!conductors.length) throw new NotSure('Give the conductors in the conduit.');
    if (!conduit.kind || !conduit.size) throw new NotSure('Give the kind and trade size of the conduit.');
    const steps = [];

    // 1. The area of each conductor, from the "1 conductor" area column.
    const areas = table(ctx, conductorTable);
    const one = areas.columns.filter((c) => /^1\s+Area\b/i.test(c.label));
    if (one.length !== 1) throw new NotSure(`Table ${conductorTable} has no single column for the area of one conductor.`);
    let total = 0;
    let count = 0;
    for (const { size, count: n, group } of conductors) {
      const want = sizeKey(String(size).replace(/^(#|No\.?\s*)/i, '').replace(/\s*(awg|kcmil)$/i, '').trim());
      const rows = areas.rows.filter((r) => sizeKey(r.label.trim()) === want && (!group || r.groups.some((g) => lower(g).startsWith(lower(group)))));
      if (rows.length !== 1) throw new NotSure(rows.length ? `Size ${size} has more than one row in Table ${conductorTable}. Say stranded or solid.` : `Table ${conductorTable} has no row for size ${size}.`);
      const a = cellNumber(areas, rows[0], one[0]);
      total += a * n;
      count += n;
      steps.push({ say: `${n} × size ${size}: the area of one.`, value: a, unit: 'mm²', ref: { type: 'table', id: conductorTable, page: rows[0].page } });
    }
    total = round(total);
    steps.push({ say: `All ${count} conductors together.`, value: total, unit: 'mm²', ref: null });

    // 2. The fill percent allowed for that many conductors.
    const fill = table(ctx, P.fill);
    const row = fill.rows.filter((r) => /not lead-sheathed/i.test(r.label));
    if (row.length !== 1) throw new NotSure(`Table ${P.fill} has no single row for conductors that are not lead-sheathed.`);
    const byCount = fill.columns.slice((fill.stub ?? 0) + 1).map((c) => {
      const over = c.label.match(/^Over\s+(\d+)$/i);
      return { c, from: over ? Number(over[1]) + 1 : Number(c.label), to: over ? Infinity : Number(c.label) };
    });
    const col = byCount.filter((x) => count >= x.from && count <= x.to);
    if (col.length !== 1) throw new NotSure(`Table ${P.fill} has no single column for ${count} conductors.`);
    const pct = cellNumber(fill, row[0], col[0].c);
    steps.push({ say: `For ${count} conductors the conduit may be filled to this percent.`, value: pct, unit: '%', ref: { type: 'table', id: P.fill, page: row[0].page } });

    // 3. The conduit's allowed area at that percent: the column for that kind of conduit and that percent.
    const hits = [];
    for (const id of P.conduits) {
      let t;
      try {
        t = table(ctx, id);
      } catch {
        continue;
      }
      for (const c of t.columns) {
        const kind = lower(c.groups[c.groups.length - 1] || '');
        if (kind.endsWith(` of ${lower(conduit.kind)}`) && new RegExp(`^${pct}%\\s*Area\\b`, 'i').test(c.label)) hits.push({ t, c });
      }
    }
    if (hits.length !== 1) throw new NotSure(hits.length ? 'More than one table gives that conduit at that fill.' : `No table that reads clearly gives ${conduit.kind} at ${pct}% fill.`);
    const { t, c } = hits[0];
    const sizeRow = t.rows.filter((r) => r.label.trim() === String(conduit.size).trim());
    if (sizeRow.length !== 1) throw new NotSure(`Table ${t.label} has no single row for trade size ${conduit.size}.`);
    const allowed = cellNumber(t, sizeRow[0], c);
    steps.push({ say: `Trade size ${conduit.size} ${conduit.kind}: the area allowed at ${pct}% fill.`, value: allowed, unit: 'mm²', ref: { type: 'table', id: t.label, page: sizeRow[0].page } });
    steps.push({ say: total <= allowed ? 'The conductors fit.' : 'The conductors do not fit. Try the next trade size.', value: total, unit: 'mm²', ref: null });
    return { ...done({ value: total, unit: 'mm²' }, steps), fits: total <= allowed, allowed, percent: pct };
  });
}

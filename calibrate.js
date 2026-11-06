// Measures how often each rating is right on graded questions, and says what percent, if any, the data can support.
// No page, no network. It reads only counts of right and wrong answers, never questions or book text.
//
// The percent it gives is a careful one: the lowest rate that fits the results at 95% confidence (the Wilson bound).
// With few answers that bound is low even when every answer was right, so a big number is only shown once it is earned.

export const MIN_ANSWERS = 30; // Fewer answers than this at a rating is too few to measure.

// The lowest right-rate that fits `right` out of `n` at 95% confidence.
export function wilsonLower(right, n, z = 1.96) {
  if (!n) return 0;
  const p = right / n;
  const z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n);
}

// byRating: { high: { right, wrong }, ... }. shown: the percent the answer screen shows today for each rating.
// Gives, for each rating, the counts, the measured rate, the careful bound, and whether the shown percent is supported.
export function measure(byRating, shown = {}, { min = MIN_ANSWERS } = {}) {
  const out = {};
  for (const [rating, { right = 0, wrong = 0 } = {}] of Object.entries(byRating)) {
    const n = right + wrong;
    const lower = wilsonLower(right, n);
    const enough = n >= min;
    out[rating] = {
      answered: n, right, wrong,
      rate: n ? right / n : null,
      lower: n ? lower : null,
      enough,
      // A percent can only be shown when there are enough answers, and then only as high as the careful bound.
      percent: enough ? Math.floor(lower * 100) : null,
      shown: shown[rating] ?? null,
      supported: enough && shown[rating] != null ? Math.floor(lower * 100) >= shown[rating] : false,
    };
  }
  return out;
}

// Plain words for one rating's measurement.
export function measureLine(rating, m) {
  if (!m.answered) return `${rating}: no graded answers yet, so nothing can be measured.`;
  const base = `${rating}: ${m.right} right and ${m.wrong} wrong out of ${m.answered}`;
  if (!m.enough) return `${base}. Too few to measure: at least ${MIN_ANSWERS} are needed. Even with none wrong, the data only backs ${Math.floor(m.lower * 100)}% so far.`;
  return `${base}. The data backs ${m.percent}%.${m.shown != null ? ` The screen shows ${m.shown}%, which is ${m.supported ? 'supported' : 'NOT supported'}.` : ''}`;
}

// Spots questions about subjects the Code does not cover, like a named act, council or office that the book never mentions.
// Plain code, no AI, and no outside facts. The test is general: a proper name in the question appears nowhere in the
// book's rules, definitions, Appendix B notes or Index. Then the reader is told to look elsewhere, and no choice is named.

// Names the book uses for itself and its parts. They never make a question outside.
const OWN = /^(?:ce|canadian|electrical|code|part|section|appendix|appendices|table|tables|rule|rules|csa|i|ii|the|of|and|in|a|an)$/i;

const tidy = (text) => ` ${String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

// Runs of two or more capitalised words inside a sentence, like a named act or council.
export function properNames(text) {
  const out = [];
  for (const sentence of String(text).split(/[.?!:\n]+/)) {
    const words = sentence.trim().split(/\s+/);
    let run = [];
    const close = () => {
      const kept = run.filter((w) => !OWN.test(w));
      if (run.length >= 2 && kept.length >= 2) out.push(run.join(' '));
      run = [];
    };
    words.forEach((raw, i) => {
      const w = raw.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
      // A word spelled in capitals, like a publication's name, counts alone.
      if (/^\p{Lu}{5,}$/u.test(w) && !OWN.test(w)) out.push(w);
      // The first word of a sentence is capitalised anyway, so it only counts when the next word is too.
      const capital = /^\p{Lu}[\p{L}'-]*$/u.test(w) && !/^\p{Lu}+$/u.test(w) && (i > 0 || /^\p{Lu}/u.test(words[1] || ''));
      const small = run.length && /^(?:of|in|and)$/.test(w) && /^\p{Lu}/u.test(words[i + 1] || '');
      if (capital || small) run.push(w);
      else close();
      // A comma ends a name, so "Mondays, Fridays" is two words, not one name.
      if (/[,;]$/.test(raw)) close();
    });
    close();
  }
  return [...new Set(out.map((n) => n.replace(/\s+(?:of|in|and)$/i, '')))];
}

// The book's own text, once per book: rule text, definitions, Appendix B notes and the Index.
const corpora = new WeakMap();
export function bookText(index, map) {
  if (corpora.has(index)) return corpora.get(index);
  const parts = [];
  for (const b of index?.blocks || []) parts.push(b.text);
  for (const d of map?.definitions?.values?.() || []) parts.push(`${d.term} ${d.text}`);
  for (const n of map?.notes || []) parts.push(`${n.label || ''} ${n.text || ''}`);
  for (const e of map?.index || []) parts.push(e.raw || e.term || '');
  const text = tidy(parts.join(' '));
  corpora.set(index, text);
  return text;
}

// f: the question, from findInBook, with its choices. Returns null when the book does cover it.
export function checkOutside(f, index, map) {
  const text = bookText(index, map);
  if (text.trim().length < 1000) return null;
  // Only the question itself counts. A choice that names something outside the Code is just a wrong choice.
  const names = properNames(f.stem);
  const missing = names.filter((n) => !text.includes(tidy(n)));
  if (!missing.length) return null;
  return {
    status: 'not-sure',
    choice: null,
    confidence: null,
    outside: true,
    because: `"${missing[0]}" is not in the Code, so the book cannot answer this. Look in your province's own rules or ask your teacher.`,
    evidence: [],
    why: [{ head: `"${missing[0]}"`, say: 'These words appear nowhere in the rules, definitions, notes or Index.' }],
    mistake: null,
  };
}

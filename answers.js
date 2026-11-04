// The scrambled answer list: answers researched by hand, carried in the app so nobody can read them on the public page.
// The list opens only with the key made from the book's own bytes, so it works only on a device that has the book.
// No page, no network. Plain code, no AI.

export const MAGIC = 'CEANS1';
const KEY_LABEL = 'ce-answers-v1';
const RANK = { low: 1, medium: 2, high: 3 };

// The question's words, lower case, with punctuation and extra spaces taken out. Two questions match only when these are equal.
export function normalize(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

async function keyFor(bookBytes) {
  const label = new TextEncoder().encode(KEY_LABEL);
  const book = new Uint8Array(bookBytes);
  const joined = new Uint8Array(label.length + book.length);
  joined.set(label);
  joined.set(book, label.length);
  const hash = await crypto.subtle.digest('SHA-256', joined);
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export function hasMagic(bytes) {
  const head = new Uint8Array(bytes).subarray(0, MAGIC.length);
  return new TextDecoder().decode(head) === MAGIC;
}

// Scrambles the list with the book as the key. Used by tools/build_answers.mjs.
export async function sealAnswers(list, bookBytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify({ version: 1, answers: list }));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(bookBytes), plain));
  const magic = new TextEncoder().encode(MAGIC);
  const out = new Uint8Array(magic.length + iv.length + sealed.length);
  out.set(magic);
  out.set(iv, magic.length);
  out.set(sealed, magic.length + iv.length);
  return out;
}

// Opens the list with the book on this device. A different book, or a damaged file, throws.
export async function openAnswers(bytes, bookBytes) {
  const all = new Uint8Array(bytes);
  if (!hasMagic(all)) throw new Error('This is not an answer list.');
  const iv = all.subarray(MAGIC.length, MAGIC.length + 12);
  const sealed = all.subarray(MAGIC.length + 12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await keyFor(bookBytes), sealed);
  const data = JSON.parse(new TextDecoder().decode(plain));
  return Array.isArray(data.answers) ? data.answers : [];
}

// Finds the stored answer for a pasted question. The words must match exactly and the stored answer's text must be one of
// the pasted choices. It gives back the letter that choice has in this paste, because choices can come in another order.
// parsed: { stem, options: [{ letter, text }] }. No near matches, ever.
export function matchAnswer(parsed, list) {
  if (!parsed || !Array.isArray(list)) return null;
  const words = normalize(parsed.stem);
  if (!words) return null;
  for (const item of list) {
    if (item.words !== words) continue;
    const pick = (parsed.options || []).filter((o) => normalize(o.text) === normalize(item.text));
    if (pick.length !== 1) continue;
    return { ...item, choice: pick[0].letter };
  }
  return null;
}

// Puts the checker's answer and the list's answer together into one result for the answer screen.
// Same choice: the higher rating. Only one answers: that one. They differ: the list's choice at low, and ask the teacher.
export function combineAnswers(checked, listed) {
  const fromList = listed && {
    status: 'answer',
    choice: listed.choice,
    confidence: listed.confidence || 'medium',
    because: listed.because || 'This answer was researched by hand.',
    outside: Boolean(listed.outside),
    places: listed.places || [],
    sources: listed.sources || [],
    fromList: true,
  };
  const checkerAnswers = checked && checked.status === 'answer' && checked.choice;
  if (!fromList) return checked;
  if (!checkerAnswers) return { ...(checked || {}), ...fromList, evidence: checked?.evidence || [], why: checked?.why || [] };
  if (checked.choice === fromList.choice) {
    const better = (RANK[fromList.confidence] || 0) > (RANK[checked.confidence] || 0) ? fromList : checked;
    return { ...checked, confidence: better.confidence, because: better.because, places: fromList.places, sources: fromList.sources, fromList: true };
  }
  return {
    ...checked,
    ...fromList,
    evidence: checked.evidence || [],
    why: [],
    confidence: 'low',
    because: 'Two sources disagree on this one. Check with your teacher.',
    disagree: { checker: checked.choice, list: fromList.choice },
  };
}

// The line shown under a rating. A low rating always says to ask the teacher.
// How sure the program is, as a percent. It is an estimate set by the kind of evidence, not measured odds.
export const PERCENTS = { high: 95, medium: 75, low: 50 };
export function percentOf(result) {
  return PERCENTS[result?.confidence] ?? PERCENTS.medium;
}

// What you picked beside what the program picks. It never calls your pick right or wrong.
export function pickWords(pick, result) {
  const verb = result?.confidence === 'low' ? 'leans to' : 'picks';
  return { picked: `You picked ${pick}`, program: `The program ${verb} ${result.choice}${pick === result.choice ? ' too' : ''}` };
}

export function ratingLine(result) {
  const because = String(result?.because || '').trim();
  if (result?.confidence !== 'low' || /teacher/i.test(because)) return because;
  return `${because}${because && !/[.!?]$/.test(because) ? '.' : ''} Ask your teacher to be sure.`.trim();
}

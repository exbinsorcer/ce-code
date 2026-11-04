// Answers questions about the Code itself: what it is for, how it is laid out, and what its appendices are for.
// Plain code, no AI. Those answers sit in pages that are not numbered rules: the pages before Section 0's rules, the
// Object, Scope and start of the definitions, the first page of each appendix, and the whole of each short appendix.
// The pages are read when asked, through pageData, and nothing is added to the saved book map.
import { checkParts } from './check-rule-words.js?v=005809e6';

const SHORT_APPENDIX = 25;
// Words that show a question is about the Code as a book, not about an installation.
const ABOUT = /\b(?:code|section\s*0|sections|appendi(?:x|ces)|tables?|diagrams?|index|contents|definitions?|object|scope|preface|headings?|sub-?headings?|rules?\s+are|arranged|divided|general\s+sections?)\b/i;

// The pages to read, from the book map's contents. The first numbered section's page marks the end of the front pages.
export function aboutPages(map) {
  const top = (map.contents || []).filter((c) => c.top && c.page);
  const first = top.find((c) => c.section !== null && c.section !== undefined);
  const pages = new Set();
  if (first) for (let n = 1; n <= first.page + 1; n++) pages.add(n);
  const appendices = top.filter((c) => /^appendix\b/i.test(c.title));
  appendices.forEach((a, i) => {
    const next = top.find((c) => c.page > a.page);
    const end = next ? next.page - 1 : a.page;
    pages.add(a.page);
    if (end - a.page + 1 <= SHORT_APPENDIX) for (let n = a.page; n <= end; n++) pages.add(n);
  });
  return [...pages].sort((a, b) => a - b);
}

// A page's text, in sentences.
export function sentencesOf(data) {
  const text = (data?.items || []).map((it) => it.str).join(' ').replace(/\s+/g, ' ');
  return text.split(/(?<=[.;:])\s+(?=[A-Z(])/).map((x) => x.trim()).filter((x) => x.length > 20);
}

// Each sentence alone, and each pair of sentences, so a statement split over two sentences can still be found.
export function partsOf(pageSentences) {
  const parts = [];
  for (const { page, sentences } of pageSentences) {
    sentences.forEach((t, i) => {
      parts.push({ rule: `p${page}`, kind: 'page', name: `page ${page}`, text: t, page });
      if (sentences[i + 1]) parts.push({ rule: `p${page}`, kind: 'page', name: `page ${page}`, text: `${t} ${sentences[i + 1]}`, page });
    });
  }
  return parts;
}

const notSure = (why) => ({ status: 'not-sure', choice: null, confidence: null, because: why, outside: false, evidence: [], why: [why] });

// f: the question, from findInBook. Reads the pages only when the question is about the Code as a book.
export async function checkAbout(f, { map, pageData }) {
  if (!ABOUT.test(f.stem)) return notSure('The question is not about the Code itself.');
  const pages = aboutPages(map);
  if (!pages.length) return notSure('The front pages and appendices could not be found.');
  const read = [];
  for (const n of pages) {
    const data = await pageData(n);
    // Contents pages are lists of titles with dot leaders, not explanations, so they are skipped.
    const text = (data?.items || []).map((it) => it.str).join(' ');
    if ((text.match(/\.{5,}|(?:\s\.){5,}/g) || []).length >= 5) continue;
    // Lists of names and titles are not explanations. A page needs at least three full sentences to be read.
    const sentences = sentencesOf(data).filter((x) => x.split(/\s+/).length >= 6 && /[.;:]$/.test(x));
    if (sentences.length >= 3) read.push({ page: n, sentences });
  }
  const result = checkParts(f, partsOf(read));
  if (result.status !== 'answer') return result;
  // These pages explain the Code; they are not rules. A match there is one step of reasoning at most.
  return { ...result, confidence: result.confidence === 'low' ? 'low' : 'medium', pattern: 'Questions about the Code itself: read the Preface, Object and Scope, and the first page of each appendix.' };
}

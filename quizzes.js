// A graded quiz pasted on the phone. It stays on the device until you copy it yourself. Nothing here sends anything.
import { parseQuestion } from './engine.js?v=4aa3f35a';

const HEADER = /^\s*Question\s+\d+\b/i;
const OPTION = /^[\s*•-]*\(?[A-H][).:]\s+\S/;

// Breaks a pasted quiz into its questions, with each one's stem and choices. Text that isn't a question is left out.
export function splitQuiz(text) {
  const lines = String(text || '').split(/\r?\n/);
  const blocks = [];
  let current = [];
  let choices = 0;
  const close = () => {
    if (current.length) blocks.push(current.join('\n'));
    current = [];
    choices = 0;
  };
  for (const line of lines) {
    const isOption = OPTION.test(line);
    // A new question starts at its heading, or at new words after a set of choices.
    if (HEADER.test(line) || (!isOption && line.trim() && choices >= 2)) close();
    if (isOption) choices++;
    if (line.trim()) current.push(line);
  }
  close();
  const out = [];
  for (const block of blocks) {
    const q = parseQuestion(block);
    if (q.stem && q.options.length >= 2) out.push({ stem: q.stem, options: q.options, pick: null, wrong: false });
  }
  return out;
}

// The text you paste into your Claude chat to add the quiz to the private question bank.
export function quizForClaude(items, allRight) {
  const parts = ['Graded quiz for the private question bank', allRight ? 'Grade: 100%' : 'Grade: missed some', ''];
  items.forEach((q, i) => {
    parts.push(`Q${i + 1}. ${q.stem}`);
    for (const o of q.options) parts.push(`${o.letter}) ${o.text}`);
    parts.push(q.pick ? `Picked: ${q.pick}. ${allRight || !q.wrong ? 'Right' : 'Wrong'}` : 'Picked: not given', '');
  });
  return parts.join('\n').trim();
}

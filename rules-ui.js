// The search page. The book is read on this device each time the page opens. No AI.
import * as store from './store.js?v=7e5a823c';
import * as viewer from './viewer.js?v=7e5a823c';
import { createIndexer, lookup, readPage, rulePreview, parseSectionNumber, lookupSection, searchSection } from './rules.js?v=7e5a823c';
import { createBookMap, lookupTable, parseTableNumber, rulesNamedIn, tablesNamedIn, watchWordsIn } from './map.js?v=7e5a823c';
import { prepareFinder, findInBook, hintsFor, markRanges } from './finder.js?v=7e5a823c';
import { checkQuestion } from './checker.js?v=7e5a823c';
import { openAnswers, matchAnswer, combineAnswers, ratingLine, percentOf, pickWords, resultWords, PERCENTS } from './answers.js?v=7e5a823c';
import { ruledOutBy } from './others.js?v=7e5a823c';
import { splitQuiz, quizForClaude } from './quizzes.js?v=7e5a823c';
import { GRADED, NEEDED } from './graded.js?v=7e5a823c';
import { patternOf, savePattern, loadPatterns, groupPatterns, deviceStore, drillDeck, noteDrill } from './patterns.js?v=7e5a823c';
import { TOTAL_PAGES } from './logic.js?v=7e5a823c';
import { createSpace } from './space.js?v=7e5a823c';
import { KINDS, kindName, guessKind, askedText, routeSteps, CALCULATORS, NEXT, SKIP } from './tree.js?v=7e5a823c';
import { SIGNS, MOST_PARTS, newWorking, addPart, checkWorking, bookGoals, judgeRoute, routeScore, replayDeck, newReplay, replayPick, replayDone, NEWS, NEWS_ID, hasNews } from './tree-extras.js?v=7e5a823c';
import { isLockedBook, unlockBook } from './crypt.js?v=7e5a823c';
import { packBook, unpackBook } from './snapshot.js?v=7e5a823c';

const $ = (id) => document.getElementById(id);
let index = null;
let map = null;
let ready = null;
let lockedBytes = null; // The scrambled book, kept so the page can lock itself again.
let lockedHere = false; // True when the locked book was made on this device.
let views = []; // Where you have been, so Back works from any screen.
let updateReady = false; // A new version is saved, and the page moves to it when you are not in the middle of something.
let locked = false; // Locked: Back cannot leave the app, and full screen comes back when you tap.
let tab = 'find'; // Which of the three tabs is showing: find, practice or quizzes.
let guarded = false; // True while an extra history entry is there to catch the phone's Back button.
let droppingGuard = false; // True while a leftover Back entry is on its way out.

const say = (t) => {
  $('say').textContent = t;
};

// While every page is read, a ring shows how far along it is, instead of one line of text.
function readingRing(total, remember) {
  const box = $('reading');
  const ring = box.querySelector('.rs-ring');
  say('');
  box.querySelector('.rs-once').hidden = !remember;
  box.hidden = false;
  const show = (n) => {
    const pct = Math.round((n / total) * 100);
    ring.style.setProperty('--p', pct);
    ring.setAttribute('aria-valuenow', String(pct));
    box.querySelector('.rs-ringpct').textContent = `${pct}%`;
    box.querySelector('.rs-ringcount').textContent = `Page ${n} of ${total}`;
  };
  show(0);
  return show;
}

// A saved map of the book opens at once. Without one, every page is read first.
async function readBook(blob, savedMap = null, remember = false) {
  const total = await viewer.openBook(blob);
  const saved = savedMap ? unpackBook(savedMap) : null;
  if (saved) {
    index = saved.index;
    map = saved.map;
  } else {
    const ix = createIndexer();
    const bm = createBookMap();
    const ring = readingRing(total, remember);
    try {
      for (let n = 1; n <= total; n++) {
        const pg = readPage(await viewer.pageData(n));
        ix.add(pg);
        bm.add(pg);
        if (n % 10 === 0 || n === total) {
          ring(n);
          await new Promise((r) => setTimeout(r));
        }
      }
    } finally {
      $('reading').hidden = true;
    }
    index = ix.finish();
    map = bm.finish(index);
    // Saved on this device, so the book opens at once next time.
    if (remember) {
      try {
        await store.kvSet('bookMap', packBook(index, map));
      } catch {
        // No room to keep it. The pages are read again next time.
      }
    }
  }
  ready = prepareFinder(index, map);
  say(total === TOTAL_PAGES ? 'Ready. Paste a question, or type a rule, section or table.' : `This file has ${total} pages, not ${TOTAL_PAGES}. It may not be your Code book.`);
  $('form').hidden = false;
  $('lockNow').hidden = !lockedBytes;
  $('q').disabled = false;
  $('go').disabled = false;
  enterSpace();
  drawTabs();
  resumeSession();
  if (hasNews(newsSeen()) && !tree && !views.length) openNews();
  else if (!views.length) $('q').focus();
}

/* ---------- Small pieces ---------- */
const PATHS = {
  repeat: '<path d="M4 9a7 7 0 0 1 12-3l3 3M19 4v5h-5M20 15a7 7 0 0 1-12 3l-3-3M5 20v-5h5"/>',
  back: '<path d="m15 5-7 7 7 7"/>', go: '<path d="m9 5 7 7-7 7"/>', up: '<path d="m5 15 7-7 7 7"/>', down: '<path d="m5 9 7 7 7-7"/>',
  word: '<path d="M4 4h8l8 8-8 8-8-8z"/><path d="M8.5 8.5h.01"/>', book: '<path d="M4 5c3-1 6-1 8 1 2-2 5-2 8-1v14c-3-1-6-1-8 1-2-2-5-2-8-1z"/><path d="M12 6v14"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>', search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>', rule: '<path d="M6 4h9l3 3v13H6z"/><path d="M9 11h6M9 15h6"/>',
  table: '<path d="M4 5h16v14H4zM4 10h16M4 15h16M10 5v14"/>', note: '<path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4M8 9h8M8 13h5"/>', page: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  zoom: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4M11 8.5v5M8.5 11h5"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', shrink: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>', check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', cross: '<path d="M6 6l12 12M18 6 6 18"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  route: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 6h6a3 3 0 0 1 0 6h-4a3 3 0 0 0 0 6h6"/>',
  tf: '<path d="m3 12 3 3 5-6"/><path d="m14 9 6 6M20 9l-6 6"/>', calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', left: '<path d="M19 12H5M11 6l-6 6 6 6"/>', right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>', up: '<path d="m6 15 6-6 6 6"/>',
};
function ic(name) {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name]}</svg>`;
  return t.content.firstChild;
}
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
function tapButton(cls, text, onTap) {
  const b = el('button', cls, text);
  b.type = 'button';
  b.onclick = onTap;
  return b;
}
function row(title, detail, iconName, onTap) {
  const b = tapButton('row', undefined, onTap);
  const tile = el('span', 'rs-tile');
  tile.append(ic(iconName));
  const t = el('span', 't');
  t.append(el('b', '', title));
  if (detail) t.append(el('small', '', detail));
  b.append(tile, t, ic('go'));
  return b;
}
const listBox = (parent) => {
  const box = el('div', 'card rows');
  parent.append(box);
  return box;
};
const chips = (words) => {
  const d = el('div', 'rs-chips');
  for (const w of words) d.append(el('span', 'rs-chip dark', w));
  return d;
};
const printedOn = (page) => {
  const p = index.info.get(page)?.printed;
  return p?.sure && p.value ? p.value : null;
};
const pageWords = (page) => (printedOn(page) ? `PDF ${page} · printed ${printedOn(page)}` : `PDF ${page}`);
function statsRow(stats) {
  const d = el('div', 'rs-stats');
  d.style.gridTemplateColumns = `repeat(${stats.length},1fr)`;
  for (const [value, label, sure] of stats) {
    const c = el('div');
    c.append(el('b', sure === false ? 'rs-unsure' : '', value), el('span', '', label));
    d.append(c);
  }
  return d;
}
function topBar(title, right) {
  const d = el('div', 'rs-top gut');
  const back = tapButton('rs-iconbtn rs-back', undefined, goBack);
  back.setAttribute('aria-label', 'Back');
  back.append(ic('back'));
  d.append(back, el('b', '', title));
  if (right) d.append(el('span', '', right));
  d.append(stayButton());
  return d;
}
const scrollArea = (root) => {
  const s = el('div', 'rs-scroll gut');
  root.append(s);
  return s;
};

/* ---------- Moving between screens ---------- */
let drawing = 0;
let refit = null;
function open(view) {
  views.push(view);
  draw();
}
function goBack() {
  views.pop();
  draw();
}
function draw() {
  drawing++;
  refit = null;
  const root = $('result');
  root.replaceChildren();
  root.hidden = !views.length;
  drawTabs();
  keepBack();
  saveSession();
  if (!views.length) {
    applyUpdate();
    if (tab === 'find') space?.refresh();
    return;
  }
  const v = views[views.length - 1];
  SCREENS[v.type](root, v);
}
const SCREENS = { section: showSection, refs: showRefs, missing: showMissing, patterns: showPatterns, replay: showReplay, addquiz: showAddQuiz, rule: showItem, table: showItem, note: showItem, definition: showItem, page: showItem };

/* ---------- A question: the space tree ---------- */
// The tree is kept as your picks only. Every box is drawn again from them, so each box lands in the same spot every time.
// tree: { text, dropped, kind, trail, pick, hints, locked, work, seen, showBook }, plus found and result, which are worked out again and never saved.
// work: your own working for a math question. seen: place boxes you peeked at and turned down. showBook: the book's path is drawn after Lock it in.
let tree = null;
let space = null;
let rootBox = null;

// The search box becomes the first box in space once the book is open.
function enterSpace() {
  if (space) return;
  rootBox = el('div', 'sp-box sp-q');
  rootBox.append(el('div', 'sp-tag', 'Your question'), $('form'), $('say'), $('lockNow'));
  $('space').hidden = false;
  $('home').classList.add('sp-on');
  space = createSpace($('space'));
  $('undo').append(ic('undo'));
  $('undo').onclick = undoTree;
  // Pinch or scroll to zoom. Only "fit all" stays as a button.
  $('zfit').append(ic('expand'));
  $('zfit').onclick = () => space.fitAll();
  showNewsDot();
  drawTree();
}
function leaveSpace() {
  if (!space) return;
  $('form').before($('say'));
  $('home').querySelector('.rs-homehead').after($('form'));
  $('home').querySelector('.rs-push').after($('lockNow'));
  $('space').hidden = true;
  $('home').classList.remove('sp-on');
}

// What the book says about the question. A true or false pick adds the two choices when the question has none.
function foundFor(t) {
  const key = `${t.kind}|${t.dropped.join('|')}`;
  if (t.found && t.foundKey === key) return t.found;
  const base = findInBook(t.text, index, map, ready, { dropped: t.dropped });
  t.base = base;
  t.found = t.kind === 'tf' && !base.options.length ? findInBook(askedText(t.text, 'tf', base), index, map, ready, { dropped: t.dropped }) : base;
  t.foundKey = key;
  return t.found;
}

function startTree(text) {
  tree = { text, dropped: [], kind: null, trail: [], pick: null, hints: 0, locked: false };
  openHints.clear();
  peek = null;
  views = [];
  space?.forget();
  draw();
  drawTree('last');
}
function startAgain() {
  tab = 'find';
  tree = null;
  peek = null;
  views = [];
  space?.forget();
  draw();
  drawTree();
  space?.home();
  $('q').value = '';
  say('Ready. Paste a question, or type a rule, section or table.');
  $('q').focus();
}
// Undo, and the phone's Back button, take back your last tap. With nothing left to take back, the question closes.
function undoTree() {
  if (!tree) return;
  if (peek) {
    closePeek();
    return;
  }
  const atWork = tree.kind && routeSteps(foundFor(tree), tree.kind)[tree.trail.length]?.type === 'work';
  if (atWork && tree.work?.parts.length > 2 && !tree.pick) {
    tree.work.parts.pop();
  } else if (tree.locked) {
    tree.locked = false;
    tree.result = null;
  } else if (tree.pick) {
    tree.pick = null;
    tree.hints = 0;
  } else if (tree.trail.length) tree.trail.pop();
  else if (tree.kind) tree.kind = null;
  else {
    startAgain();
    return;
  }
  keepBack();
  saveSession();
  drawTree('last');
}
// A short buzz on a pick and on Lock it in, on phones that can. Nothing happens where they cannot.
function buzz() {
  try {
    navigator.vibrate?.(12);
  } catch {
    // This browser cannot buzz.
  }
}

/* Press feel: a button sinks a little the moment you touch it, so you know the tap landed. */
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest?.('button,label.btn');
  if (b && !b.disabled) b.classList.add('down');
}, true);
const unpress = () => document.querySelectorAll('.down').forEach((b) => b.classList.remove('down'));
for (const t of ['pointerup', 'pointercancel']) addEventListener(t, unpress, true);

function changed(focus = 'last') {
  peek = null;
  saveSession();
  keepBack();
  drawTree(focus);
}

/* Boxes */
const box = (cls, ...kids) => {
  const d = el('div', `sp-box${cls ? ` ${cls}` : ''}`);
  d.append(...kids);
  return d;
};
// A step's hint shows its first sentence only. "More" opens the rest, and it stays open while the question is open.
const openHints = new Set();
function hintLines(id, text, extra, cls) {
  const [, first = text, more = ''] = String(text || '').match(/^(.+?[.!?])\s+(.+)$/s) || [];
  const rest = [more, extra].filter(Boolean);
  const out = [el(cls === 'p' ? 'p' : 'span', cls === 'p' ? 'rs-grey' : '', first)];
  if (!rest.length) return out;
  const hidden = rest.map((t) => el(cls === 'p' ? 'p' : 'span', `sp-rest${cls === 'p' ? ' rs-grey' : ''}`, t));
  const btn = tapButton('sp-more', undefined, () => {
    if (openHints.has(id)) openHints.delete(id);
    else openHints.add(id);
    show();
    space?.refresh();
  });
  const show = () => {
    const open_ = openHints.has(id);
    hidden.forEach((h) => (h.hidden = !open_));
    btn.replaceChildren(el('span', '', open_ ? 'Less' : 'More'), ic(open_ ? 'up' : 'down'));
    btn.setAttribute('aria-expanded', String(open_));
  };
  show();
  return [...out, ...hidden, btn];
}
const askPill = (st) => {
  const d = el('div', 'sp-ask');
  d.append(el('b', '', st.ask));
  if (st.why) d.append(...hintLines(st.id, st.why, st.type === 'places' ? st.note : ''));
  return d;
};
// mark: after Lock it in, "yes" or "no" on your pick. book: this is where the book went. note: one short line under it.
function optBox(title, lines, { icon, on, dim, best, onTap, letter, mark, book, note, cls }) {
  const b = tapButton(`sp-opt${on ? ' on' : ''}${dim && !book ? ' dim' : ''}${letter ? ' sp-letter' : ''}${book ? ' sp-bookpath' : ''}${cls ? ` ${cls}` : ''}`, undefined, onTap);
  b.setAttribute('aria-pressed', String(Boolean(on)));
  if (best) b.append(el('span', 'sp-best', 'Best guess'));
  if (book) b.append(el('span', 'sp-best', 'Book'));
  if (on) b.append(markBadge(mark === 'no' ? 'no' : 'yes'));
  if (icon) b.append(ic(icon));
  b.append(el('b', '', title));
  for (const line of lines.filter(Boolean)) b.append(el('small', '', line));
  if (note) b.append(el('small', `sp-note${mark === 'no' ? ' sp-try' : ''}`, note));
  return b;
}
function markBadge(mark) {
  const t = el('span', `sp-tick${mark === 'no' ? ' no' : ''}`);
  t.append(ic(mark === 'no' ? 'cross' : 'check'));
  t.setAttribute('role', 'img');
  t.setAttribute('aria-label', mark === 'no' ? 'Not the book\'s way' : 'Yes');
  return t;
}
const placeLines = (p) => [p.tag ? `${p.tag} section` : '', p.extra, p.refs ? refWords(p.refs) : p.page ? pageWords(p.page) : '', p.appendixB ? 'Appendix B' : ''];
function openPlace(p) {
  if (p.open.type === 'entry') openRef(p.open.entry);
  else open(p.open);
}
const nextButton = (onTap) => tapButton('btn sp-next', 'Next', onTap);

// One step that is a box of its own: key words, the book's own words, or what a math question gives.
function stepBox(st, f, current) {
  const d = box('sp-step', el('div', 'sp-tag', st.ask));
  const goOn = () => {
    tree.trail.push(NEXT);
    changed();
  };
  if (st.type === 'words') {
    d.append(el('p', 'rs-route', f.route.why));
    if (!f.keywords.length) d.append(el('p', 'rs-grey', 'I could not pick out any key words. Try other words.'));
    else if (current) d.append(el('p', 'rs-grey', 'Tap a word to leave it out.'));
    const chipsBox = el('div', 'rs-chips');
    for (const w of f.keywords) {
      const off = f.dropped.includes(w);
      const b = tapButton(`rs-chip rs-tap${off ? ' off' : ''}`, w, () => {
        tree.dropped = off ? tree.dropped.filter((x) => x !== w) : [...tree.dropped, w];
        changed(null);
      });
      b.setAttribute('aria-pressed', String(!off));
      b.disabled = !current;
      chipsBox.append(b);
    }
    d.append(chipsBox);
    if (f.watch.length) {
      d.append(el('p', 'rs-grey', 'Do not skip these words'), chips(f.watch));
      if (f.negated.length) d.append(el('p', 'rs-grey', `The question rules out: ${f.negated.join(', ')}.`));
    }
  }
  if (st.type === 'book') {
    for (const s of st.swaps) {
      const line = el('div', 'rs-swap');
      line.append(el('span', 'rs-chip dark', s.word), el('span', 'rs-grey', 'may be'), ...s.book.map((w) => el('span', 'rs-chip', w)));
      d.append(line);
    }
  }
  if (st.type === 'note') {
    d.append(...hintLines(st.id, st.why, '', 'p'));
    if (st.note) d.append(el('p', 'rs-small', st.note));
  }
  if (st.type === 'given') {
    d.append(el('p', 'rs-grey', st.calculator ? `Calculator: ${CALCULATORS[st.calculator]}` : 'Not sure. The calculators do not take this kind of question, so work it out by hand from the rule.'));
    if (st.numbers.length) d.append(chips(st.numbers));
    else d.append(el('p', 'rs-grey', 'The question gives no numbers.'));
    if (st.calculator) d.append(el('p', 'rs-small', 'After you lock in, the worked steps split into parts.'));
  }
  if (current) d.append(nextButton(goOn));
  return d;
}

// The last box before the answer. The answer stays hidden until you lock it in.
function lockBox(f) {
  const d = box('sp-lock');
  if (tree.locked) {
    d.append(el('p', 'rs-grey', tree.pick ? `Locked in: ${tree.pick}.` : 'Locked in.'));
    return d;
  }
  d.append(el('p', 'rs-grey', 'Sure? The answer stays hidden until you lock it in.'));
  const hints = hintsFor(f);
  if (tree.hints) {
    const [title, words] = hints[(tree.hints - 1) % hints.length];
    const tint = el('div', 'rs-tint');
    tint.append(el('b', '', `Hint ${((tree.hints - 1) % hints.length) + 1} of ${hints.length}: ${title}`), document.createTextNode(words));
    d.append(tint);
  }
  const words = !tree.hints ? 'Give me a hint' : tree.hints % hints.length === 0 ? 'First hint again' : 'Next hint';
  d.append(tapButton('btn soft', words, () => {
    tree.hints += 1;
    changed(['lock']);
  }));
  const lock = tapButton('btn', 'Lock it in', () => {
    buzz();
    tree.locked = true;
    tree.result = null;
    changed();
    runCheck(tree);
  });
  lock.id = 'lockIn';
  d.append(lock);
  return d;
}

/* Your own working, for a math question. You type each part; after Lock it in, each part is ticked for its own sum. */
const hasAnswer = (r) => r?.status === 'answer' || r?.status === 'worked';
// The numbers your total is checked against.
const bookNumber = (r) => {
  if (!hasAnswer(r)) return null;
  if (r.accept?.length) return r.accept;
  return typeof r.result?.value === 'number' ? r.result.value : null;
};
const roundish = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));
function numInput(value, label, onType, wide = false) {
  const i = el('input', `sp-num${wide ? ' wide' : ''}`);
  i.inputMode = 'decimal';
  i.autocomplete = 'off';
  i.value = value ?? '';
  i.disabled = Boolean(tree?.locked);
  i.setAttribute('aria-label', label);
  i.oninput = () => {
    onType(i.value);
    saveSession();
  };
  return i;
}
function workNodes(st, id, parent, current) {
  if (!tree.work) tree.work = newWorking();
  const w = tree.work;
  const marks = tree.locked && tree.result && !tree.result.error ? checkWorking(w, bookNumber(tree.result)) : null;
  const head = box('sp-step', el('div', 'sp-tag', st.ask), el('p', 'rs-grey', st.why));
  if (!tree.locked && w.parts.length < MOST_PARTS) {
    head.append(tapButton('btn soft', 'Add a part', () => {
      tree.work = addPart(tree.work);
      changed([`${id}-p${tree.work.parts.length - 1}`, `${id}-total`]);
    }));
  }
  const nodes = [{ id, parent, on: true, el: head }];
  const partIds = w.parts.map((_, j) => `${id}-p${j}`);
  w.parts.forEach((p, j) => nodes.push({ id: partIds[j], parent: id, on: true, el: partBox(p, j, marks?.parts[j]) }));
  const end = `${id}-total`;
  nodes.push({ id: end, joins: partIds, on: true, el: totalBox(w, marks?.total, current) });
  return { nodes, end };
}
function partBox(p, j, mark) {
  const d = box('sp-part sp-work');
  const head = el('div', 'sp-workhead');
  head.append(el('span', 'sp-tag', `Part ${j + 1}`));
  if (mark?.mark) head.append(markBadge(mark.mark));
  const sign = el('select', 'sp-sign');
  sign.setAttribute('aria-label', `Part ${j + 1} sign`);
  for (const o of SIGNS) {
    const opt = el('option', '', o);
    opt.selected = o === p.op;
    sign.append(opt);
  }
  sign.disabled = tree.locked;
  sign.onchange = () => {
    p.op = sign.value;
    saveSession();
  };
  const sum = el('div', 'sp-calc');
  sum.append(numInput(p.a, `Part ${j + 1} first number`, (v) => { p.a = v; }), sign, numInput(p.b, `Part ${j + 1} second number`, (v) => { p.b = v; }));
  const answer = el('div', 'sp-calc');
  answer.append(el('span', 'sp-eq', '='), numInput(p.r, `Part ${j + 1} answer`, (v) => { p.r = v; }, true));
  d.append(head, sum, answer);
  if (mark?.mark === 'no' && mark.want !== null) d.append(el('p', 'rs-small', `${p.a} ${p.op} ${p.b} = ${roundish(mark.want)}`));
  return d;
}
function totalBox(w, mark, current) {
  const d = box('sp-total sp-work');
  const head = el('div', 'sp-workhead');
  head.append(el('span', 'sp-tag', 'Your total'));
  if (mark === 'yes' || mark === 'no') head.append(markBadge(mark));
  if (mark === 'unsure') head.append(el('span', 'sp-unsure', 'Not sure'));
  const line = el('div', 'sp-calc');
  line.append(numInput(w.total, 'Your total', (v) => { w.total = v; }, true));
  d.append(head, line);
  if (mark === 'unsure') d.append(el('p', 'rs-small', 'The book gave no worked number to check it against.'));
  if (current) {
    d.append(nextButton(() => {
      tree.trail.push(NEXT);
      changed();
    }));
  }
  return d;
}
function markLine(mark, words, value) {
  const line = el('div');
  line.append(mark ? markBadge(mark) : el('span', 'sp-blankmark'), el('span', '', words));
  if (value) line.append(el('b', '', value));
  return line;
}
function workSummary(w, r) {
  const c = checkWorking(w, bookNumber(r));
  const d = el('div', 'sp-check');
  d.append(el('p', 'rs-small', 'Your working'));
  const lines = el('div', 'sp-lines');
  w.parts.forEach((p, j) => {
    if (![p.a, p.b, p.r].some((x) => String(x).trim())) return;
    lines.append(markLine(c.parts[j].mark, `Part ${j + 1}: ${p.a || '?'} ${p.op} ${p.b || '?'}`, p.r || '—'));
  });
  lines.append(markLine(c.total === 'unsure' ? null : c.total, 'Your total', c.total === 'unsure' ? `${w.total} · Not sure` : w.total || '—'));
  d.append(lines);
  const book = bookNumber(r);
  if (book !== null) d.append(el('p', 'rs-grey', `The book's worked answer: ${resultWords({ ...r.result, value: typeof r.result.value === 'number' ? roundish(r.result.value) : r.result.value })}.`));
  return d;
}

/* The route check, after Lock it in: each pick on your path gets a tick or a cross. */
const seeRules = (label) => map.tables.get(label)?.see || [];
function routeMarks(steps) {
  if (!tree.locked || !tree.result || tree.result.error) return null;
  return judgeRoute(steps, tree.trail, bookGoals(tree.result, seeRules));
}
function routeSummary(steps, judged) {
  const d = el('div', 'sp-check');
  d.append(el('p', 'rs-small', 'Your route'));
  if (!judged) {
    d.append(el('p', 'rs-grey', 'Not sure which way the book went, so your route is not checked.'));
    return d;
  }
  if (!judged.length) {
    d.append(el('p', 'rs-grey', 'You picked no places on the way, so there is nothing to check.'));
    return d;
  }
  const lines = el('div', 'sp-lines');
  for (const s of judged) {
    const st = steps[s.i];
    const mine = s.picked === SKIP ? st.skip : st.places[Number(s.picked)]?.title ?? '';
    lines.append(markLine(s.mark, mine, s.mark === 'no' && s.book !== null ? `Book: ${st.places[Number(s.book)].title}` : s.mark ? '' : 'Not sure'));
  }
  const { right, of } = routeScore(judged);
  d.append(lines, el('p', 'rs-grey', of ? `${right} of ${of} step${of === 1 ? '' : 's'} went the book's way.` : 'Not sure which steps the book took.'));
  const scope = judged.find((s) => s.id === 'scope' && s.mark === 'no');
  if (scope && steps[scope.i].places[Number(scope.picked)]?.tag === 'General' && steps[scope.i].places[Number(scope.book)]?.tag === 'Specific') {
    d.append(el('p', 'rs-grey', 'A specific section comes first when one fits.'));
  }
  if (judged.some((s) => s.mark === 'no')) {
    d.append(tapButton('btn soft', tree.showBook === false ? "Show the book's path" : "Hide the book's path", () => {
      tree.showBook = tree.showBook === false;
      changed(null);
    }));
  }
  return d;
}

/* Peeking at a page: it slides up over the tree, which stays right behind it. Never saved. */
let peek = null; // { i, key, p, current, full }
let peekDraw = 0;
function openPeek(i, key, p, current) {
  peek = { i, key, p, current, full: false };
  drawPeek();
}
function closePeek() {
  peek = null;
  drawPeek();
}
function drawPeek() {
  const host = $('space');
  host.querySelector('.sp-peek')?.remove();
  const mine = ++peekDraw;
  if (!peek) return;
  const { p } = peek;
  const sheet = el('div', 'sp-peek');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', `The page for ${p.title}`);
  // Swipe: drag the handle or the title down to close the page, or up to fill the screen.
  let swiped = false;
  let swipeEnd = 0;
  let start = null;
  const handle = tapButton('sp-handle', undefined, () => {
    // The tap that ends a drag does not count.
    if (performance.now() - swipeEnd < 400) return;
    peek.full = !peek.full;
    sheet.classList.toggle('full', peek.full);
    handle.setAttribute('aria-label', peek.full ? 'Show less of the page' : 'Show the whole page');
  });
  handle.setAttribute('aria-label', 'Show the whole page');
  const head = el('div', 'sp-peekhead');
  head.append(el('p', 'rs-grey', `${p.title} · ${pageWords(p.page)}`), el('h2', '', p.extra || p.title));
  const paper = el('div', 'sp-paper');
  paper.id = 'peekView';
  const canvas = el('canvas');
  canvas.id = 'peekCanvas';
  canvas.setAttribute('aria-label', `PDF page ${p.page}`);
  paper.append(canvas);
  // The page opens zoomed in on the marked words, big enough to read on a phone. "Whole page" is one tap away.
  const frame = el('div', 'sp-paperframe');
  const zoomBtn = tapButton('sp-wholebtn', undefined, () => {
    peek.whole = !peek.whole;
    paint();
  });
  zoomBtn.id = 'peekWhole';
  frame.append(paper, zoomBtn);
  const buttons = el('div', 'two');
  if (peek.current) {
    buttons.append(tapButton('btn soft', 'Not this one', () => {
      tree.seen = [...new Set([...(tree.seen || []), `${peek.i}-${peek.key}`])];
      changed(null);
    }), tapButton('btn', 'It fits', () => {
      tree.trail.push(peek.key);
      buzz();
      changed();
    }));
  } else buttons.append(tapButton('btn soft', 'Close', closePeek));
  const whole = tapButton(peek.current ? 'link' : 'btn', 'Open the full page', () => {
    const was = peek.p;
    closePeek();
    openPlace(was);
  });
  if (peek.current) sheet.append(handle, head, frame, buttons, whole);
  else {
    buttons.append(whole);
    sheet.append(handle, head, frame, buttons);
  }
  host.append(sheet);
  // Once the sheet has slid up, it can follow your finger. Only its own slide counts, not one inside it.
  sheet.addEventListener('animationend', (e) => {
    if (e.target === sheet) sheet.classList.add('sp-settled');
  });
  const grab = (e) => {
    swiped = false;
    start = { y: e.clientY, h: sheet.offsetHeight, id: e.pointerId };
    sheet.classList.remove('sp-easing');
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Followed without capture.
    }
  };
  const follow = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dy = e.clientY - start.y;
    if (Math.abs(dy) > 6) swiped = true;
    if (!swiped) return;
    sheet.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
    sheet.style.height = dy < 0 ? `${Math.min(host.clientHeight, start.h - dy)}px` : '';
  };
  const letGo = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dy = e.clientY - start.y;
    start = null;
    if (!swiped) return;
    swipeEnd = performance.now();
    sheet.classList.add('sp-easing');
    if (dy > 90) {
      sheet.style.transform = `translateY(${sheet.offsetHeight}px)`;
      setTimeout(() => {
        if (peek?.p === p) closePeek();
      }, 260);
      return;
    }
    sheet.style.transform = '';
    sheet.style.height = '';
    if (dy < -60) peek.full = true;
    else if (dy > 30) peek.full = false;
    sheet.classList.toggle('full', peek.full);
    handle.setAttribute('aria-label', peek.full ? 'Show less of the page' : 'Show the whole page');
  };
  for (const part of [handle, head]) {
    part.classList.add('sp-grab');
    part.addEventListener('pointerdown', grab);
    part.addEventListener('pointermove', follow);
    part.addEventListener('pointerup', letGo);
    part.addEventListener('pointercancel', letGo);
  }
  let painting = 0;
  const paint = () => {
    const run = ++painting;
    const near = !peek.whole;
    zoomBtn.replaceChildren(ic(near ? 'expand' : 'zoom'), el('span', '', near ? 'Whole page' : 'Zoom in'));
    zoomBtn.setAttribute('aria-pressed', String(!near));
    delete paper.dataset.ready;
    return (async () => {
      await new Promise((r) => requestAnimationFrame(r));
      const part = p.open.type === 'rule' ? rulePreview(index, p.open.rule) : null;
      const usable = part && !part.sideways && part.page === p.page ? part : null;
      // Zoomed in, the page is drawn about two and a half times the width of the sheet. A rule's own column fills at least that.
      const zoom = near ? (usable ? Math.min(2.5, Math.max(PEEK_ZOOM, 612 / Math.max(120, usable.x1 - usable.x0))) : PEEK_ZOOM) : 1;
      const done = await viewer.drawPage(canvas, p.page, (paper.clientWidth || 340) - 16, zoom);
      if (!done || mine !== peekDraw || run !== painting) return;
      const words = await viewer.pageItems(p.page);
      if (mine !== peekDraw || run !== painting) return;
      const marks = tree?.found ? new Set(tree.found.marks) : null;
      const first = marks?.size ? markWords(canvas, p.page, words, marks) : null;
      const [left, , right, top] = viewer.pageBox(p.page) || [0, 0, 612, 792];
      const k = parseFloat(canvas.style.width) / (right - left);
      paper.scrollLeft = 0;
      paper.scrollTop = 0;
      if (near) {
        // Start at the rule, the definition, or else the first marked word.
        const y = usable ? usable.top : p.open.type === 'definition' ? p.open.definition.y : null;
        const css = canvas.width / (parseFloat(canvas.style.width) || canvas.width);
        if (usable) paper.scrollLeft = Math.max(0, (usable.x0 - left) * k - 8);
        else if (first) paper.scrollLeft = Math.max(0, first.x / css - 24);
        if (y !== null && y !== undefined) paper.scrollTop = Math.max(0, (top - y - 14) * k);
        else if (first) paper.scrollTop = Math.max(0, first.y / css - 48);
      }
      paper.dataset.ready = '1';
    })().catch(() => {
      paper.replaceChildren(el('p', 'rs-grey', 'This page could not be shown here. Tap Open the full page.'));
    });
  };
  paint();
}
const PEEK_ZOOM = 2.4;

/* The ⋯ menu: night, full screen, the lock and What's new behind one button, so the top bar has fewer buttons.
   Each row taps the same button the app always had, so they work just as before. */
function moreButton() {
  const b = tapButton('rs-iconbtn rs-menubtn', undefined, () => ($('app').querySelector('.rs-menu') ? closeMenu() : openMenu()));
  b.id = 'moreBtn';
  b.setAttribute('aria-label', 'More');
  b.setAttribute('aria-haspopup', 'menu');
  const dot = el('span', 'sp-dot');
  dot.id = 'newsDot';
  dot.hidden = true;
  b.append(ic('more'), dot);
  return b;
}
function closeMenu() {
  for (const x of $('app').querySelectorAll('.rs-menu, .rs-shield')) x.remove();
  $('moreBtn').setAttribute('aria-expanded', 'false');
}
function openMenu() {
  closeMenu();
  const btn = $('moreBtn');
  const at = btn.getBoundingClientRect();
  const app = $('app').getBoundingClientRect();
  const menu = el('div', 'rs-menu');
  menu.setAttribute('role', 'menu');
  const row = (icon, words, act) => {
    const b = tapButton('rs-menuitem', undefined, () => {
      closeMenu();
      act();
    });
    b.setAttribute('role', 'menuitem');
    b.append(ic(icon), el('span', '', words));
    menu.append(b);
    return b;
  };
  const dark = document.documentElement.hasAttribute('data-night');
  row(dark ? 'sun' : 'moon', dark ? 'Day look' : 'Night look', () => $('night').click());
  if (canFill()) row(document.fullscreenElement ? 'shrink' : 'expand', document.fullscreenElement ? 'Leave full screen' : 'Full screen', () => $('fullscreen').click());
  row(locked ? 'lock' : 'unlock', locked ? 'Unlock' : 'Lock the app', () => $('home').querySelector('.rs-homeicons .rs-stay').click());
  if (space) {
    const news = row('spark', "What's new", openNews);
    if (hasNews(newsSeen())) news.append(el('span', 'sp-dot'));
  }
  menu.style.top = `${at.bottom - app.top + 8}px`;
  menu.style.right = `${Math.max(8, app.right - at.right)}px`;
  // A clear layer under the menu: a tap anywhere else closes it.
  const shield = el('div', 'rs-shield');
  shield.onclick = closeMenu;
  $('app').append(shield, menu);
  btn.setAttribute('aria-expanded', 'true');
  menu.querySelector('button').focus();
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('app').querySelector('.rs-menu')) {
    closeMenu();
    $('moreBtn').focus();
  }
});

/* What's new: a row in the ⋯ menu, with a dot on ⋯ until you have seen it. It opens by itself once after an update. */
const NEWS_SEEN = 'ce-news';
function newsSeen() {
  try {
    return localStorage.getItem(NEWS_SEEN);
  } catch {
    return NEWS_ID;
  }
}
function showNewsDot() {
  $('newsDot').hidden = !hasNews(newsSeen());
}
// The sheet adds no step to the phone's Back history, since a page reload would keep that step. Back still closes it when Back is caught.
function closeNews() {
  $('app').querySelector('.sp-layer')?.remove();
}
function openNews() {
  try {
    localStorage.setItem(NEWS_SEEN, NEWS_ID);
  } catch {
    // It shows again next time. Nothing else changes.
  }
  showNewsDot();
  $('app').querySelector('.sp-layer')?.remove();
  const layer = el('div', 'sp-layer');
  layer.onclick = (e) => {
    if (e.target === layer) closeNews();
  };
  const sheet = el('div', 'sp-sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', "What's new");
  sheet.append(el('span', 'sp-grip'), el('h2', '', "What's new"));
  const list = el('div', 'sp-news');
  for (const n of NEWS) {
    const item = el('div', 'sp-newsitem');
    const tile = el('span', 'rs-tile');
    tile.append(ic(n.icon));
    const t = el('span', 't');
    t.append(el('b', '', n.title), el('small', '', n.say));
    item.append(tile, t, tapButton('sp-show', 'Show me', () => {
      closeNews();
      showMe(n);
    }));
    list.append(item);
  }
  const done = tapButton('btn', 'Got it', closeNews);
  done.id = 'newsDone';
  sheet.append(list, done);
  layer.append(sheet);
  $('app').append(layer);
}
// "Show me" goes to the tab where the change lives, with one line on how to reach it.
function showMe(n) {
  views = [];
  tab = n.tab;
  draw();
  toast(n.tip);
}

// The answer list researched by hand, opened with the book on this device. Missing pieces mean no list, never an error.
let answerList;
async function answerListHere() {
  if (answerList !== undefined) return answerList;
  answerList = null;
  try {
    const saved = await store.kvGet('book');
    const blob = saved?.blob;
    if (!blob) return answerList;
    const res = await fetch('answers.enc');
    if (!res.ok) return answerList;
    answerList = await openAnswers(new Uint8Array(await res.arrayBuffer()), new Uint8Array(await blob.arrayBuffer()));
  } catch {
    answerList = null;
  }
  return answerList;
}
async function runCheck(t) {
  if (t.checking) return;
  t.checking = true;
  try {
    const f = foundFor(t);
    const checked = await checkQuestion(askedText(t.text, t.kind, t.base), { index, map, ready, pageData: viewer.tablePage });
    const list = await answerListHere();
    t.result = combineAnswers(checked, list ? matchAnswer(f, list) : null);
    // The route is kept on this device for the pattern book. It never holds the book's own words.
    deviceStore().then((kv) => savePattern(kv, f.stem, patternOf(f, t.result))).catch(() => {});
  } catch {
    t.result = { error: true };
  }
  t.checking = false;
  if (tree === t && t.locked) drawTree('last');
}

// The percent in words and one plain line saying why. Shown only after Lock it in, and never tappable.
function ratingBox(r) {
  const d = el('div', 'rs-rate');
  d.append(el('b', '', `${percentOf(r)}% sure`));
  const line = ratingLine(r);
  if (line) d.append(el('small', '', line));
  return d;
}
const viewOf = (kind, id) => (kind === 'table' ? { type: 'table', label: id } : { type: 'rule', rule: id });
// A place to check, as a box. Places outside the Code are named as plain text, since there is nothing to open.
function checkBox(p) {
  if (p.kind === 'table' || p.kind === 'rule') {
    const info = p.kind === 'table' ? map.tables.get(p.id) : lookup(index, p.id);
    const page = p.kind === 'table' ? info?.page : info?.pdfPage;
    return optBox(`${p.kind === 'table' ? 'Table' : 'Rule'} ${p.id}`, [info?.title ?? '', page ? pageWords(page) : ''], { icon: p.kind, onTap: () => open(viewOf(p.kind, p.id)) });
  }
  if (p.kind === 'outside') return box('sp-small', el('p', 'rs-grey', `Outside the Code: ${p.id}`));
  if (!p.page) return null;
  const name = p.kind === 'definition' ? `Definition: ${p.id}` : pageWords(p.page);
  return optBox(name, [p.kind === 'definition' ? pageWords(p.page) : ''], { icon: 'page', onTap: () => open({ type: 'page', page: p.page, name, sub: 'Where to check' }) });
}
function closestPlaceText(place) {
  if (place.kind === 'table') return { name: `Table ${place.id}`, text: ready.tables.find((t) => t.label === place.id)?.text || '' };
  return { name: `Rule ${place.id}`, text: ready.rules.get(place.id)?.text || '' };
}

// The answer, under the lock, with your own working and the route check added to its box.
function resultNodes(f, steps, judged) {
  const nodes = answerNodes(f);
  const r = tree.result;
  const main = nodes[0]?.el;
  if (!r || r.error || !main) return nodes;
  const extra = [];
  if (tree.work && steps.some((st) => st.type === 'work')) extra.push(workSummary(tree.work, r));
  if (steps.some((st) => st.type === 'places')) extra.push(routeSummary(steps, judged));
  const again = main.querySelector('.sp-again');
  for (const d of extra) (again ? again.before(d) : main.append(d));
  return nodes;
}
// The answer, under the lock. A worked answer splits into its parts, which join again into the result.
function answerNodes(f) {
  const r = tree.result;
  const again = () => tapButton('btn soft sp-again', 'Try another question', startAgain);
  if (!r) {
    if (!tree.checking) runCheck(tree);
    return [{ id: 'res', parent: 'lock', on: true, el: box('sp-result', el('p', 'rs-grey rs-wait', 'Checking the book')) }];
  }
  if (r.error) return [{ id: 'res', parent: 'lock', on: true, el: box('sp-result', el('p', 'rs-grey', 'This could not be checked. Try opening your book again.'), again()) }];
  const nodes = [];
  const main = box('sp-result');
  nodes.push({ id: 'res', parent: 'lock', on: true, el: main });
  if (!hasAnswer(r) && r.outside) {
    if (tree.pick) main.append(el('p', 'rs-grey', `You picked ${tree.pick}.`));
    main.append(el('h2', '', 'This is not in the Code'), el('p', 'rs-grey', r.because || 'The Code does not cover this. Ask your teacher where to look.'), again());
    return nodes;
  }
  if (!hasAnswer(r)) {
    if (tree.pick) main.append(el('p', 'rs-grey', `You picked ${tree.pick}`));
    main.append(el('h2', '', "The program isn't sure"));
    const unsettled = el('div', 'rs-tint');
    unsettled.append(el('b', '', "What it couldn't settle"), document.createTextNode(f.places.length || r.calculation ? r.because || 'The words alone could not decide it.' : 'The Index has no clear entry for these words. Try the Index under another word for the main thing being asked about, or ask your teacher.'));
    main.append(unsettled);
    if (f.places.length) {
      const { name, text } = closestPlaceText(f.places[0]);
      const out = ruledOutBy(f.options, text, name);
      if (out.length) {
        const card = el('div', 'card');
        for (const c of out) {
          const line = el('div', 'rs-way');
          const words = el('div');
          words.append(el('span', '', c.say));
          line.append(el('i', '', c.letter), words);
          card.append(line);
        }
        main.append(el('p', 'rs-small', 'Ruled out'), card, el('p', 'rs-grey', 'This goes by the closest place only, so check it yourself.'));
      }
    }
    main.append(again());
    if (f.places.length) main.append(el('p', 'rs-small', 'Where to read'));
    if (r.calculation && r.steps?.length) return [...nodes, ...partNodes(r, null)];
    f.places.forEach((p, i) => nodes.push({ id: `read-${i}`, parent: 'res', el: checkBox(p) }));
    return nodes;
  }
  const answer = f.options.find((o) => o.letter === r.choice);
  const top = el('div', 'rs-result');
  const percent = percentOf(r);
  const ring = el('span', 'rs-ring');
  ring.style.setProperty('--p', String(percent));
  ring.append(el('b', '', `${percent}%`));
  const said = r.status === 'worked' ? { picked: 'Worked out from the book', program: resultWords(r.result) } : pickWords(tree.pick, r);
  const words = el('span', 'rs-words');
  words.append(el('small', '', said.picked), el('b', '', said.program), el('small', '', answer ? `${answer.letter}) ${answer.text}` : ''));
  top.append(ring, words);
  main.append(top, ratingBox(r));
  const worked = r.calculation && r.steps?.length;
  if (!worked) {
    const why = (r.why || []).filter((w) => w && typeof w === 'object');
    if (why.length) {
      const card = el('div', 'card');
      why.forEach((w, i) => {
        const line = el('div', 'rs-way');
        const text = el('div');
        text.append(el('b', '', w.head), el('span', '', w.say));
        line.append(el('i', '', String(i + 1)), text);
        card.append(line);
      });
      main.append(card);
    } else main.append(el('p', 'rs-grey', r.because || 'See the places to check below.'));
  }
  if (r.mistake) {
    const tint = el('div', 'rs-tint');
    tint.append(el('b', '', 'Common mistake'), document.createTextNode(r.mistake));
    main.append(tint);
  }
  if (r.pattern) {
    const tint = el('div', 'rs-tint');
    tint.append(el('b', '', 'Pattern to remember'), document.createTextNode(r.pattern));
    main.append(tint);
  }
  for (const src of r.sources || []) main.append(el('p', 'rs-grey', src));
  main.append(el('p', 'rs-small', (r.evidence || []).length ? 'Checked against the book' : 'From the answer list'), again());
  if (worked) return [...nodes, ...partNodes(r, answer)];
  const places = [...(r.evidence || []).map((e) => ({ kind: e.kind, id: e.ref })), ...(r.places || [])];
  places.forEach((p, i) => {
    const b = checkBox(p);
    if (b) nodes.push({ id: `check-${i}`, parent: 'res', el: b });
  });
  return nodes;
}
// One worked step, as a box or as a line in the box that starts both methods.
const refName = (s) => (s.ref ? `${s.ref.type === 'table' ? 'Table' : 'Rule'} ${s.ref.id}` : '');
function fillStep(d, s) {
  d.append(el('p', '', s.say));
  if (s.value != null) d.append(el('div', 'sp-eq', resultWords({ value: s.value, unit: s.unit })));
  if (s.ref) d.append(tapButton('link', `Open ${refName(s)}`, () => open(viewOf(s.ref.type, s.ref.id))));
  return d;
}
const totalWords = (r, answer) => {
  if (answer) return `Matches ${answer.letter}) ${answer.text}`;
  return r.status === 'worked' ? resultWords(r.result) : 'The worked answer matches no choice, or more than one.';
};
// Each worked step is a part. The parts join into one box with the result.
function partNodes(r, answer) {
  if (r.methods) return methodNodes(r, answer);
  const ids = [];
  const nodes = r.steps.map((s, i) => {
    ids.push(`part-${i}`);
    return { id: `part-${i}`, parent: 'res', on: true, el: fillStep(box('sp-part', el('div', 'sp-tag', refName(s) || 'Work it out')), s) };
  });
  const total = box('sp-total', el('div', 'sp-tag', 'Worked answer'));
  total.append(el('p', '', totalWords(r, answer)));
  nodes.push({ id: 'total', joins: ids, on: true, el: total });
  return nodes;
}
// A question worked two ways: one box both start from, a line of boxes for each method, and one box where they meet.
function methodNodes(r, answer) {
  const { start, one, two } = r.methods;
  const nodes = [];
  let parent = 'res';
  if (start.length) {
    const d = box('sp-start', el('div', 'sp-tag', two.length ? 'Both methods start here' : 'Start here'));
    start.forEach((s) => d.append(fillStep(el('div', 'sp-startline'), s)));
    nodes.push({ id: 'start', parent, on: true, el: d });
    parent = 'start';
  }
  const ends = [];
  const chain = (steps, key, name) => {
    let from = parent;
    steps.forEach((s, i) => {
      const id = `${key}-${i}`;
      const tag = [name, refName(s)].filter(Boolean).join(' · ') || 'Work it out';
      nodes.push({ id, parent: from, on: true, el: fillStep(box('sp-part', el('div', 'sp-tag', tag)), s) });
      from = id;
    });
    if (steps.length) ends.push(from);
  };
  chain(one, 'one', two.length ? 'Method One' : '');
  chain(two, 'two', 'Method Two');
  const total = box('sp-total', el('div', 'sp-tag', 'Worked answer'));
  total.append(el('p', '', two.length && !answer ? `Both methods reach ${resultWords(r.result)}.` : totalWords(r, answer)));
  nodes.push({ id: 'total', joins: ends, on: true, el: total });
  return nodes;
}

function drawTree(focus = null) {
  if (!space) return;
  const nodes = [{ id: 'q', el: rootBox, on: true }];
  $('undo').hidden = !tree;
  if (!tree) {
    space.show(nodes, focus === 'last' ? ['q'] : focus);
    return;
  }
  let last = ['q'];
  foundFor(tree);
  const guess = guessKind(tree.base);
  nodes.push({ id: 'kind', parent: 'q', on: true, el: box('sp-kind', el('div', 'sp-tag', 'What kind?'), el('div', 'sp-big', `Looks like: ${kindName(guess)}`), el('div', 'rs-grey', 'Pick any one below.')) });
  for (const k of KINDS) {
    const on = tree.kind === k.k;
    nodes.push({
      id: `k-${k.k}`, parent: 'kind', on, dim: Boolean(tree.kind) && !on,
      el: optBox(k.name, [k.small], {
        icon: k.icon, on, dim: Boolean(tree.kind) && !on, best: k.k === guess,
        onTap: () => {
          if (tree.kind === k.k) return;
          if (tree.kind) {
            // Another kind starts the walk again under that box.
            tree.trail = [];
            tree.pick = null;
            tree.locked = false;
            tree.result = null;
          }
          tree.kind = k.k;
          buzz();
          changed();
        },
      }),
    });
  }
  last = ['kind', ...KINDS.map((k) => `k-${k.k}`)];
  if (tree.kind) {
    const f = foundFor(tree);
    const steps = routeSteps(f, tree.kind);
    const judged = routeMarks(steps);
    let parent = `k-${tree.kind}`;
    for (let i = 0; i < steps.length && i <= tree.trail.length; i++) {
      const st = steps[i];
      const id = `s${i}`;
      const current = i === tree.trail.length;
      const picked = tree.trail[i];
      if (st.type === 'words' || st.type === 'book' || st.type === 'given' || st.type === 'note') {
        nodes.push({ id, parent, on: true, el: stepBox(st, f, current) });
        last = [id];
        parent = id;
        continue;
      }
      if (st.type === 'places') {
        nodes.push({ id, parent, on: true, el: askPill(st) });
        last = [id];
        const choices = [...st.places.map((p, j) => [String(j), p]), [SKIP, null]];
        const check = judged?.find((x) => x.i === i);
        for (const [key, p] of choices) {
          const on = picked === key;
          const dim = picked !== undefined && !on;
          // A place box slides its page up over the tree. "It fits" picks it.
          const tap = () => {
            if (p?.page) {
              openPeek(i, key, p, current);
              return;
            }
            if (current) {
              tree.trail.push(key);
              buzz();
              changed();
            }
            if (p) openPlace(p);
          };
          const mark = on ? check?.mark : undefined;
          const book = Boolean(check && check.mark === 'no' && check.book === key && tree.showBook !== false);
          const seen = !on && (tree.seen || []).includes(`${i}-${key}`);
          const note = mark === 'no' && check.book !== null ? `The book went to ${st.places[Number(check.book)].title}` : on && check && !check.mark ? 'Not sure' : seen ? 'Seen · not this one' : '';
          const b = p ? optBox(p.title, placeLines(p), { icon: p.icon, on, dim, onTap: tap, mark, book, note }) : optBox(st.skip, [], { on, dim, onTap: tap, mark, book, note });
          if (!p) b.classList.add('sp-skip');
          nodes.push({ id: `${id}-${key}`, parent: id, on, dim: dim && !book, book, el: b });
          last.push(`${id}-${key}`);
        }
        if (picked === undefined) break;
        parent = `${id}-${picked}`;
        continue;
      }
      if (st.type === 'work') {
        const ids = workNodes(st, id, parent, current);
        nodes.push(...ids.nodes);
        last = current ? ids.nodes.map((n) => n.id) : [ids.end];
        parent = ids.end;
        continue;
      }
      if (st.type === 'lockWork') {
        nodes.push({ id: 'lock', parent, on: true, el: lockBox(f) });
        last = ['lock'];
        if (tree.locked) {
          const res = resultNodes(f, steps, judged);
          nodes.push(...res);
          last = res.map((n) => n.id);
        }
        break;
      }
      if (st.type === 'final') {
        nodes.push({ id, parent, on: true, el: askPill(st) });
        last = [id];
        for (const o of st.options) {
          const on = tree.pick === o.letter;
          const dim = tree.locked && !on;
          nodes.push({
            id: `${id}-${o.letter}`, parent: id, on, dim,
            el: optBox(o.letter, [o.text], {
              on, dim, letter: true,
              onTap: () => {
                if (tree.locked || tree.pick === o.letter) return;
                tree.pick = o.letter;
                buzz();
                changed(['lock', ...st.options.map((x) => `${id}-${x.letter}`)]);
              },
            }),
          });
          last.push(`${id}-${o.letter}`);
        }
        if (tree.pick) {
          nodes.push({ id: 'lock', parent: `${id}-${tree.pick}`, on: true, el: lockBox(f) });
          last = ['lock'];
        }
        if (tree.locked) {
          const res = resultNodes(f, steps, judged);
          nodes.push(...res);
          last = res.map((n) => n.id);
        }
        break;
      }
      const end = st.type === 'end'
        ? box('sp-step', el('div', 'sp-tag', st.ask), el('p', 'rs-grey', 'There are no choices to check, so read the place you picked and decide.'), tapButton('btn soft', 'Try another question', startAgain))
        : box('sp-step', el('div', 'sp-tag', st.ask), el('p', 'rs-grey', 'Paste the question with its choices, like A) and B), to pick an answer.'), tapButton('btn soft', 'Try another question', startAgain));
      nodes.push({ id, parent, on: true, el: end });
      last = [id];
    }
  }
  space.show(nodes, focus === 'last' ? last : focus);
  if (!peek) $('space').querySelector('.sp-peek')?.remove();
}

// The pattern book: a quiet list of routes from questions already asked. No timers, scores, streaks or new questions.
const SCOPE_WORDS = { general: 'General section', specific: 'Specific section' };
const placeWords = (p) => (p ? `${p.kind === 'table' ? 'Table' : p.kind === 'rule' ? 'Rule' : 'Page'} ${p.id}` : 'No one place');

const ASK_WORDS = { type: 'which type', size: 'a size', rating: 'a rating', distance: 'a distance', number: 'a number', meaning: 'a meaning', other: 'something else' };

function routeCard(p, hide) {
  const card = el('div', `card${hide ? ' rs-hidden-steps' : ''}`);
  [['What it asks', ASK_WORDS[p.asks] || p.asks], ['General or specific', SCOPE_WORDS[p.scope] || 'Not clear'], ['Index words', p.indexWords.join(', ') || 'None matched'], ['Where it ends', placeWords(p.place)]].forEach(([head, say], i) => {
    const line = el('div', 'rs-way');
    const text = el('div');
    text.append(el('b', '', head), el('span', '', say));
    line.append(el('i', '', String(i + 1)), text);
    card.append(line);
  });
  return card;
}

/* ---------- The three tabs ---------- */
const TABS = [['find', 'Find', 'search'], ['practice', 'Practice', 'repeat'], ['quizzes', 'Quizzes', 'list']];
function drawTabs() {
  const home = !views.length;
  const open_ = !$('form').hidden;
  $('home').hidden = !home || tab !== 'find';
  $('practice').hidden = !home || tab !== 'practice';
  $('quizzes').hidden = !home || tab !== 'quizzes';
  const bar = $('tabbar');
  bar.hidden = !home || !open_;
  if (!bar.children.length) {
    for (const [key, name, icon] of TABS) {
      const b = tapButton('rs-tabbtn', undefined, () => {
        tab = key;
        draw();
      });
      b.dataset.tab = key;
      b.setAttribute('role', 'tab');
      b.append(ic(icon), el('span', '', name));
      bar.append(b);
    }
  }
  for (const b of bar.children) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  if (!home) return;
  if (tab === 'find') (space ? $('spTop') : $('home').querySelector('.rs-homehead')).append(document.querySelector('.rs-homeicons'));
  if (tab === 'practice') drawPractice();
  if (tab === 'quizzes') drawQuizzes();
}
function tabHead(root, title) {
  const d = el('div', 'rs-homehead');
  d.append(el('h1', '', title), document.querySelector('.rs-homeicons'));
  root.replaceChildren(d);
}
let practiceDraw = 0;
async function drawPractice() {
  const root = $('practice');
  const mine = ++practiceDraw;
  tabHead(root, 'Practice');
  let groups = [];
  let missed = {};
  try {
    const kv = await deviceStore();
    groups = groupPatterns(await loadPatterns(kv));
    missed = (await kv.get(DRILL_MISSES)) || {};
  } catch {
    // Nothing saved can be read, so it shows as empty.
  }
  if (mine !== practiceDraw) return;
  if (!groups.length) {
    // Nothing yet: one card with a way to start, not a single grey line.
    const card = el('div', 'card rs-empty');
    const tile = el('div', 'rs-emptytile');
    tile.append(ic('repeat'));
    card.append(tile, el('div', 'rs-emptytitle', 'No routes yet'), el('p', 'rs-grey', 'Finish a question in Find, and its route shows up here.'), tapButton('btn', 'Go to Find', () => {
      tab = 'find';
      draw();
    }));
    root.append(card);
    return;
  }
  root.append(el('p', 'rs-grey', 'Routes from your own questions.'));
  const box = listBox(root);
  groups.forEach((g, i) => {
    const p = g.pattern;
    box.append(row(`Asks ${ASK_WORDS[p.asks] || p.asks}`, `${SCOPE_WORDS[p.scope] || 'Not clear'} · ${placeWords(p.place)}`, 'list', () => open({ type: 'patterns', pick: i })));
  });
  const routes = replayDeck(drillDeck(groups, missed).slice(0, DRILL_MOST), bookLists());
  if (routes.length) root.append(tapButton('btn', `Replay ${routes.length} route${routes.length === 1 ? '' : 's'} from memory`, () => open(newReplay(routes))));
}

/* ---------- Replay from memory ---------- */
// A route you solved comes back as blank boxes. Tap the next blank, then pick that step from memory.
// A route you missed comes first next time. No timers, scores or streaks.
const DRILL_MISSES = 'ce-drill-missed';
const DRILL_MOST = 10;
async function noteRoute(key, hadIt) {
  const kv = await deviceStore();
  await kv.set(DRILL_MISSES, noteDrill((await kv.get(DRILL_MISSES)) || {}, key, hadIt));
}
// Numbers from the book's own lists, used only for wrong picks when you have few routes.
function bookLists() {
  const rules = ready?.ruleList || [];
  return { rules, sections: [...new Set(rules.map((r) => Number(String(r).split('-')[0])).filter(Number.isFinite))], tables: map ? [...map.tables.keys()] : [] };
}
function showReplay(root, v) {
  const route = v.routes[v.r];
  root.append(topBar('Replay from memory', `${v.r + 1} of ${v.routes.length}`));
  const host = el('div', 'sp-host');
  host.id = 'replay';
  root.append(host);
  const sp = createSpace(host, { top: 16, bottom: 16, side: 16 });
  const zoom = el('div', 'sp-over sp-zoom');
  for (const [name, label, act] of [['expand', 'Fit all', () => sp.fitAll()]]) {
    const b = tapButton('sp-round', undefined, act);
    b.setAttribute('aria-label', label);
    b.append(ic(name));
    zoom.append(b);
  }
  host.append(zoom);
  const redraw = (focus) => {
    saveSession();
    sp.show(replayNodes(v, route, redraw), focus);
  };
  redraw(replayDone(v) ? ['done'] : v.open ? [`b${v.at}`, ...route.steps[v.at].opts.map((_, j) => `b${v.at}-${j}`)] : ['q', `b${v.at}`]);
}
function replayNodes(v, route, redraw) {
  const q = box('sp-q', el('div', 'sp-tag', `From memory · route ${v.r + 1} of ${v.routes.length}`), el('p', 'sp-qtext', route.question));
  const nodes = [{ id: 'q', on: true, el: q }];
  let parent = 'q';
  route.steps.forEach((st, i) => {
    if (i > v.at) return;
    const id = `b${i}`;
    if (i < v.at) nodes.push({ id, parent, on: true, el: optBox(st.opts[st.ok], [st.name], { on: true }) });
    else {
      const blank = optBox('?', [st.name], {
        cls: `sp-blank${v.open ? '' : ' now'}`,
        onTap: () => {
          if (v.open) return;
          v.open = true;
          redraw([id, ...st.opts.map((_, j) => `${id}-${j}`)]);
        },
      });
      blank.setAttribute('aria-label', `${st.name} Tap to pick from memory.`);
      nodes.push({ id, parent, on: true, el: blank });
      if (v.open) {
        st.opts.forEach((o, j) => {
          const crossed = v.wrong.includes(j);
          const b = optBox(o, [], {
            cls: crossed ? 'sp-crossed' : '', mark: crossed ? 'no' : undefined, note: crossed ? 'Try another' : '',
            onTap: () => {
              const was = v.at;
              Object.assign(v, replayPick(v, j));
              if (replayDone(v)) noteRoute(route.key, v.firstTry === route.steps.length).catch(() => {});
              redraw(v.at === was ? null : replayDone(v) ? ['done'] : [`b${v.at}`]);
            },
          });
          b.disabled = crossed;
          nodes.push({ id: `${id}-${j}`, parent: id, dim: crossed, el: b });
        });
      }
    }
    parent = id;
  });
  if (replayDone(v)) {
    const n = route.steps.length;
    const more = v.r + 1 < v.routes.length;
    const done = box('sp-step', el('div', 'sp-big', 'Route done'), el('p', 'rs-grey', `You had ${v.firstTry} of ${n} steps on the first try.${v.firstTry < n ? ' This route comes first next time.' : ''}`));
    done.append(tapButton('btn', more ? 'Next route' : 'Back to Practice', () => {
      if (!more) {
        goBack();
        return;
      }
      Object.assign(v, { r: v.r + 1, at: 0, open: false, wrong: [], missed: false, firstTry: 0 });
      draw();
    }));
    nodes.push({ id: 'done', parent, on: true, el: done });
  }
  return nodes;
}

/* ---------- Graded quizzes ---------- */
const SAVED_QUIZZES = 'ce-graded-quizzes';
let quizzesDraw = 0;
async function drawQuizzes() {
  const root = $('quizzes');
  const mine = ++quizzesDraw;
  tabHead(root, 'Quizzes');
  let saved = [];
  try {
    saved = (await (await deviceStore()).get(SAVED_QUIZZES)) || [];
  } catch {
    // Nothing saved can be read, so it shows as empty.
  }
  if (mine !== quizzesDraw) return;
  root.append(el('p', 'rs-grey', 'Graded answers back the percents.'), gradedCounts(), tapButton('btn', 'Add a graded quiz', () => open({ type: 'addquiz', step: 1, text: '', items: [], allRight: false })));
  if (saved.length) {
    const box = listBox(root);
    saved.forEach((text, i) => box.append(row(`Quiz ${i + 1} is saved on this phone`, 'Copy it again for Claude', 'list', () => open({ type: 'addquiz', step: 3, copy: text, saved: true }))));
  }
}
function gradedCounts() {
  const card = el('div', 'card rs-counts');
  for (const level of ['high', 'medium', 'low']) {
    const line = el('div', 'rs-count');
    const words = el('div', 'rs-countline');
    words.append(el('b', '', `${PERCENTS[level]}% answers`), el('span', 'rs-grey', `${GRADED[level]} of ${NEEDED}`));
    const meter = el('div', 'rs-meter');
    const fill = el('i');
    fill.style.width = `${Math.min(100, (GRADED[level] / NEEDED) * 100)}%`;
    meter.append(fill);
    line.append(words, meter);
    card.append(line);
  }
  return card;
}
function showAddQuiz(root, v) {
  root.append(topBar('Add a graded quiz', `Step ${v.step} of 3`));
  const body = scrollArea(root);
  const foot = el('div', 'rs-foot gut');
  if (v.step === 1) {
    const box = document.createElement('textarea');
    box.id = 'quizText';
    box.value = v.text;
    box.setAttribute('aria-label', 'Your quiz');
    box.placeholder = 'Paste your quiz here';
    const found = el('p', 'rs-grey', '');
    const next = tapButton('btn', 'Next', () => {
      v.items = splitQuiz(v.text);
      v.step = 2;
      draw();
    });
    const count = () => {
      const n = splitQuiz(v.text).length;
      found.textContent = v.text.trim() ? (n ? `Found ${n} question${n === 1 ? '' : 's'}.` : 'No questions found yet. Each one needs its choices.') : '';
      next.disabled = !n;
    };
    box.oninput = () => {
      v.text = box.value;
      count();
    };
    count();
    const card = el('div', 'card');
    card.append(box);
    body.append(el('h2', '', 'Paste your quiz'), el('p', 'rs-grey', 'Questions and choices, as they appear on the course site.'), card, found);
    foot.append(next);
  } else if (v.step === 2) {
    body.append(el('h2', '', 'What was your grade?'));
    const seg = el('div', 'rs-seg');
    for (const [all, name] of [[true, 'I got 100%'], [false, 'I missed some']]) {
      const b = tapButton('rs-segbtn', name, () => {
        v.allRight = all;
        draw();
      });
      b.setAttribute('aria-pressed', String(v.allRight === all));
      seg.append(b);
    }
    body.append(seg, el('p', 'rs-grey', v.allRight ? 'Tap your pick on each question. They all count as right.' : 'Tap your pick on each question, and mark the ones you got wrong. Only answers you know are right count.'));
    v.items.forEach((q, i) => {
      const card = el('div', 'card rs-quizq');
      card.append(el('p', '', `${i + 1}. ${q.stem}`));
      const picks = el('div', 'rs-picks');
      for (const o of q.options) {
        const b = tapButton('rs-picktap', o.letter, () => {
          q.pick = o.letter;
          for (const other of picks.querySelectorAll('.rs-picktap')) other.setAttribute('aria-pressed', String(other === b));
          saveSession();
        });
        b.setAttribute('aria-pressed', String(q.pick === o.letter));
        b.setAttribute('aria-label', `Question ${i + 1}, you picked ${o.letter}`);
        picks.append(b);
      }
      if (!v.allRight) {
        const wrong = tapButton('rs-picktap rs-wrongtap', 'Wrong', () => {
          q.wrong = !q.wrong;
          wrong.setAttribute('aria-pressed', String(q.wrong));
          saveSession();
        });
        wrong.setAttribute('aria-pressed', String(q.wrong));
        picks.append(wrong);
      }
      card.append(picks);
      body.append(card);
    });
    const save = async () => {
      v.copy = quizForClaude(v.items, v.allRight);
      v.step = 3;
      try {
        const kv = await deviceStore();
        await kv.set(SAVED_QUIZZES, [...((await kv.get(SAVED_QUIZZES)) || []), v.copy]);
        v.saved = true;
      } catch {
        v.saved = false;
      }
      draw();
    };
    foot.append(tapButton('btn soft', 'Back', () => {
      v.step = 1;
      draw();
    }), tapButton('btn', 'Next', save));
  } else {
    body.append(el('h2', '', v.saved ? 'Saved on this phone' : 'Ready to copy'), el('p', 'rs-grey', 'Nothing has left your phone. Copy it and paste it into your Claude chat, and it joins your private question bank.'));
    body.append(el('p', 'rs-small', 'Graded answers so far'), gradedCounts(), el('p', 'rs-tint', `The percents stay estimates until a rating reaches ${NEEDED}. These counts update after your quiz is added.`));
    const spare = document.createElement('textarea');
    spare.id = 'quizCopy';
    spare.readOnly = true;
    spare.hidden = true;
    spare.value = v.copy || '';
    spare.setAttribute('aria-label', 'Your quiz, to copy');
    body.append(spare);
    foot.append(tapButton('btn', 'Copy for Claude', async () => {
      try {
        await navigator.clipboard.writeText(v.copy);
        toast('Copied. Paste it into your Claude chat.');
      } catch {
        // The phone refused, so the text is shown to copy by hand.
        spare.hidden = false;
        spare.select();
        toast('Select all of this and copy it.');
      }
    }));
  }
  root.append(foot);
}

function showPatterns(root, v) {
  root.append(topBar('Pattern book'));
  const area = el('div', 'rs-body');
  root.append(area);
  const mine = drawing;
  (async () => {
    const groups = groupPatterns(await loadPatterns(await deviceStore()));
    if (mine !== drawing) return;
    const body = scrollArea(area);
    if (v.pick != null && groups[v.pick]) {
      const g = groups[v.pick];
      const p = g.pattern;
      const asks = ASK_WORDS[p.asks] || p.asks;
      body.append(el('h2', '', `Asks ${asks}`));
      body.append(el('p', 'rs-small', 'The route'));
      const card = routeCard(p, v.retrace);
      body.append(card);
      if (v.retrace) body.append(el('p', 'rs-tint', 'Say each step to yourself, then tap Show steps.'));
      if (!p.clear && p.why) body.append(el('p', 'rs-grey', p.why));
      body.append(el('p', 'rs-small', 'Your questions on this route'));
      const qs = el('div', 'card');
      for (const q of g.questions) qs.append(el('p', 'rs-saved-q', q));
      body.append(qs);
      const foot = el('div', 'rs-foot gut');
      foot.append(tapButton(v.retrace ? 'btn' : 'btn soft', v.retrace ? 'Show steps' : 'Retrace it from memory', () => {
        v.retrace = !v.retrace;
        draw();
      }));
      root.append(foot);
      return;
    }
    body.append(el('p', 'rs-grey', 'Routes from your own questions.'));
    if (!groups.length) return;
    const box = listBox(body);
    groups.forEach((g, i) => {
      const p = g.pattern;
      box.append(row(`Asks ${ASK_WORDS[p.asks] || p.asks}`, `${SCOPE_WORDS[p.scope] || 'Not clear'} · ${placeWords(p.place)}`, 'list', () => open({ type: 'patterns', pick: i })));
    });
  })().catch(() => {
    area.replaceChildren(el('p', 'rs-grey gut rs-wait', 'The pattern book could not be opened.'));
  });
}

function refWords(refs) {
  const parts = refs.slice(0, 5).map((r) => ({
    rule: r.rule, range: `${r.from} to ${r.to}`, table: `Table ${r.label}${r.to ? ` to ${r.to}` : ''}`, section: `Section ${r.section}`, appendix: `Appendix ${r.letter}`, diagram: `Diagram ${r.label}`, see: `See ${r.term}`,
  }[r.type]));
  return `${parts.join(', ')}${refs.length > 5 ? ` and ${refs.length - 5} more` : ''}` || 'Sub-entries only';
}

function openRef(e) {
  const r = e.refs[0];
  const asPage = { type: 'page', page: e.page, name: e.path.join(' › '), sub: 'From the Index' };
  if (!r) return open(asPage);
  if (e.refs.length > 1 || r.type === 'range' || r.type === 'see') return open({ type: 'refs', entry: e });
  if (r.type === 'rule') return open({ type: 'rule', rule: r.rule });
  if (r.type === 'table') return open({ type: 'table', label: r.label });
  if (r.type === 'section') return open({ type: 'section', section: r.section });
  return open(asPage);
}

const num = (rule) => rule.split('-').map(Number);
function inRange(rule, r) {
  const [s, n] = num(rule);
  const [fs, fn] = num(r.from);
  const [ts, tn] = num(r.to);
  return s >= fs && s <= ts && (s > fs || n >= fn) && (s < ts || n <= tn);
}

// One index entry often points to several places.
function showRefs(root, v) {
  const e = v.entry;
  root.append(topBar('From the Index', pageWords(e.page)));
  const body = scrollArea(root);
  body.append(el('h2', '', e.path.join(' › ')));
  const box = listBox(body);
  const ruleRow = (id) => {
    const x = lookup(index, id);
    box.append(row(`${id}  ${x.title ?? ''}`.trim(), x.pdfPage ? pageWords(x.pdfPage) : 'Not found in Sections 0 to 86', 'rule', () => open({ type: 'rule', rule: id })));
  };
  for (const r of e.refs) {
    if (r.type === 'rule') ruleRow(r.rule);
    else if (r.type === 'range') ready.ruleList.filter((k) => inRange(k, r)).forEach(ruleRow);
    else if (r.type === 'table') box.append(row(`Table ${r.label}${r.to ? ` to ${r.to}` : ''}`, map.tables.get(r.label)?.title, 'table', () => open({ type: 'table', label: r.label })));
    else if (r.type === 'section') box.append(row(`Section ${r.section}`, '', 'list', () => open({ type: 'section', section: r.section })));
    else if (r.type === 'see') {
      box.append(row(`See ${r.term}`, 'Search this word instead', 'search', () => {
        $('q').value = r.term;
        startTree(r.term);
      }));
    }
    else if (r.type === 'appendix') body.append(el('p', 'rs-grey', `Appendix ${r.letter}: open it from the Contents.`));
  }
}

function showMissing(root, v) {
  root.append(topBar(v.name));
  const body = scrollArea(root);
  body.append(el('h2', '', v.text));
  if (v.pages?.length) {
    body.append(el('p', 'rs-grey', 'This number is mentioned on these pages.'));
    const box = listBox(body);
    for (const p of v.pages.slice(0, 12)) box.append(row(pageWords(p), '', 'page', () => open({ type: 'page', page: p, name: v.name })));
  }
}

/* ---------- A section ---------- */
function showSection(root, v) {
  const s = lookupSection(index, v.section);
  root.append(topBar(`Section ${v.section}`));
  const body = scrollArea(root);
  if (s.status === 'missing') {
    body.append(el('h2', '', 'This section was not found in the book.'));
    return;
  }
  const host = el('div', 'card rs-host');
  host.append(el('div', 'rs-num', `Section ${v.section}`), el('div', s.title ? '' : 'rs-unsure', s.title ?? 'Title not sure'));
  const stats = [[String(s.firstPage), 'First PDF page'], [String(s.lastPage), 'Last PDF page'], [String(s.rules.length), s.rules.length === 1 ? 'Rule' : 'Rules']];
  host.append(statsRow(stats));
  body.append(host);
  if (s.status === 'unsure') body.append(el('p', 'rs-grey', `Not sure: ${s.reasons.join('. ')}. Open the page to check.`));
  body.append(tapButton('btn soft rs-grow0', `Open first page, PDF ${s.firstPage}`, () => open({ type: 'page', page: s.firstPage, name: `Section ${v.section}`, sub: s.title ?? '' })));

  const form = el('form', 'searchbar');
  form.autocomplete = 'off';
  const field = el('input', 'field');
  field.id = 'sectionWords';
  field.placeholder = 'Search this section';
  field.setAttribute('aria-label', `Search words in Section ${v.section}`);
  field.value = v.words || '';
  form.append(field, el('button', 'btn soft', 'Search'));
  body.append(form);
  const note = el('p', 'rs-grey');
  note.setAttribute('role', 'status');
  const box = el('div', 'card rows');
  body.append(note, box);

  const fill = () => {
    const text = field.value.trim();
    v.words = text;
    let items = s.rules;
    if (text) {
      const found = searchSection(index, v.section, text);
      items = found.hits;
      note.textContent = found.status === 'none'
        ? `No rule in Section ${v.section} uses all of those words. Try fewer or different words, or the Index.`
        : `${items.length} match${items.length === 1 ? '' : 'es'}. Words in a title come first.`;
    } else note.textContent = s.rules.length ? '' : 'This section has no numbered rules. Search its words above.';
    box.hidden = !items.length;
    box.replaceChildren(...items.map((it) => (it.rule
      ? row(`${it.rule}  ${it.title ?? 'Not sure'}`, `PDF ${it.page || it.pdfPage}${it.appendixB ? ' · Appendix B' : ''}`, 'rule', () => open({ type: 'rule', rule: it.rule }))
      : row(`PDF ${it.page}`, '', 'page', () => open({ type: 'page', page: it.page, name: `Section ${v.section}` })))));
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    fill();
  };
  fill();
}

/* ---------- The real page, with a sheet under it ---------- */
const printedStat = (page) => [printedOn(page) ?? 'None', 'Printed page'];

function itemFor(v) {
  if (v.type === 'rule') {
    const r = lookup(index, v.rule);
    const text = index.blocks.find((b) => b.rule === r.rule)?.text || '';
    const notes = map.notesByRule.get(r.rule) || [];
    const tables = tablesNamedIn(text).filter((t) => map.tables.has(t));
    for (const t of map.tables.values()) if (t.see?.includes(r.rule) && !tables.includes(t.label)) tables.push(t.label);
    const others = rulesNamedIn(text, r.rule).filter((o) => index.rules.has(o)).slice(0, 8);
    const elsewhere = r.notesPages.filter((p) => !notes.some((n) => n.page === p));
    const lines = [];
    if (r.status !== 'found') lines.push(`Not sure: ${r.reasons.join('. ')}. Check the page.`);
    if (r.candidates?.length > 1) lines.push(`Headings with this number are on PDF pages ${r.candidates.join(', ')}.`);
    if (r.appendixB && !notes.length) lines.push('The title points to Appendix B, but I could not find its note. Check Appendix B by hand.');
    if (elsewhere.length) lines.push(`Also mentioned in Appendix B on PDF page${elsewhere.length === 1 ? '' : 's'} ${elsewhere.join(', ')}.`);
    return {
      name: `Rule ${r.rule}`, title: r.title ?? 'Title not sure', home: r.pdfPage, part: rulePreview(index, r.rule), partLabel: 'Rule preview',
      stats: [printedStat(r.pdfPage), [String(r.pdfPage), 'PDF page'], [r.appendixB === null ? 'Not sure' : r.appendixB ? 'Yes' : 'No', 'Appendix B', r.appendixB !== null]],
      watch: watchWordsIn(text), lines,
      points: [
        ...notes.map((n) => ({ title: `Appendix B: ${n.label}`, detail: `A note, not a rule · ${pageWords(n.page)}`, icon: 'note', view: { type: 'note', note: n } })),
        ...tables.map((t) => ({ title: `Table ${t}`, detail: map.tables.get(t).title, icon: 'table', view: { type: 'table', label: t } })),
        ...others.map((o) => ({ title: `Rule ${o}`, detail: lookup(index, o).title, icon: 'rule', view: { type: 'rule', rule: o } })),
      ],
    };
  }
  if (v.type === 'table') {
    const t = lookupTable(map, v.label);
    if (t.status === 'missing') return null;
    return {
      name: `Table ${t.label}`, title: t.title || 'Title not sure', home: t.page, partLabel: '', tip: 'Check the row and the column on the page itself. Read the notes under the table too.',
      stats: [printedStat(t.page), [String(t.page), 'PDF page'], [String(t.see?.length || 0), t.see?.length === 1 ? 'Rule' : 'Rules']],
      watch: [], lines: [], pages: t.pages?.length > 1 ? t.pages : null,
      points: (t.see || []).map((r) => ({ title: `Rule ${r}`, detail: lookup(index, r).title, icon: 'rule', view: { type: 'rule', rule: r } })),
    };
  }
  if (v.type === 'note') {
    const n = v.note;
    const samePage = n.endPage === n.page && n.endY !== null;
    return {
      name: `Appendix B: ${n.label}`, title: 'A note, not a rule. The rule itself is what applies.', badge: 'Note, not a rule', home: n.page, partLabel: 'Note preview',
      part: { sideways: false, top: n.y, bottom: samePage ? n.endY : null, goesOn: !samePage, x0: 0, x1: index.info.get(n.page)?.columns.right ?? 612 },
      stats: [printedStat(n.page), [String(n.page), 'PDF page'], [String(n.rules.length), n.rules.length === 1 ? 'Rule' : 'Rules']], watch: [], lines: [],
      points: n.rules.map((r) => ({ title: `Rule ${r}`, detail: lookup(index, r).title, icon: 'rule', view: { type: 'rule', rule: r } })),
    };
  }
  if (v.type === 'definition') {
    const d = v.definition;
    const same = d.endY !== null && d.endY !== undefined;
    return {
      name: d.term, title: 'Definition, Section 0', home: d.page, partLabel: 'Definition',
      part: d.y === undefined ? null : { sideways: false, top: d.y, bottom: same ? d.endY : null, goesOn: !same, x0: 0, x1: index.info.get(d.page)?.columns.right ?? 612 },
      stats: [printedStat(d.page), [String(d.page), 'PDF page']], watch: [], lines: [], points: [],
    };
  }
  return { name: v.name || `PDF page ${v.page}`, title: v.sub || '', home: v.page, partLabel: '', stats: [printedStat(v.page), [String(v.page), 'PDF page']], watch: [], lines: [], points: [] };
}

// Marks your key words on the page, like a highlighter. The colour multiplies, so the words stay readable.
// Returns where the highest marked word starts, in canvas pixels, or null.
function markWords(canvas, page, items, marks) {
  let first = null;
  const g = canvas.getContext('2d');
  const ruler = document.createElement('canvas').getContext('2d');
  ruler.font = '100px sans-serif';
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = '#ffe27a';
  for (const it of items) {
    const ranges = markRanges(it.str, marks);
    if (!ranges.length) continue;
    const [a, b, c, d, e, f] = it.t;
    const along = Math.hypot(a, b) || 1;
    const up = Math.hypot(c, d) || along;
    const whole = ruler.measureText(it.str).width || 1;
    const spot = (s, h) => viewer.toCanvas(page, e + (a / along) * s + (c / up) * h, f + (b / along) * s + (d / up) * h);
    for (const { start, end } of ranges) {
      const from = (ruler.measureText(it.str.slice(0, start)).width / whole) * it.w;
      const to = (ruler.measureText(it.str.slice(0, end)).width / whole) * it.w;
      const corners = [spot(from, -0.22 * up), spot(to, -0.22 * up), spot(to, 0.95 * up), spot(from, 0.95 * up)];
      if (corners.some((pt) => !pt)) continue;
      const x = Math.min(...corners.map((c) => c[0]));
      const y = Math.min(...corners.map((c) => c[1]));
      if (!first || y < first.y - 2 || (Math.abs(y - first.y) <= 2 && x < first.x)) first = { x, y };
      g.beginPath();
      corners.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
    }
  }
  g.restore();
  return first;
}

function showItem(root, v) {
  if (v.type === 'rule') {
    const r = lookup(index, v.rule);
    if (r.status === 'missing') {
      showMissing(root, { name: `Rule ${r.rule}`, text: r.sectionHasRules === false ? `No numbered rules were found in Section ${r.section}.` : 'No rule heading with this number was found.', pages: r.mentionPages });
      return;
    }
  }
  const info = itemFor(v);
  if (!info) {
    showMissing(root, { name: `Table ${v.label}`, text: 'This table was not found in the book.' });
    return;
  }
  if (v.at === undefined) v.at = info.home;
  const onHome = v.at === info.home;
  // Rules and definitions open zoomed in, so they can be read right away. Everything else opens whole.
  const canRead = (v.type === 'rule' || v.type === 'definition') && onHome && info.part && !info.part.sideways;
  const levels = canRead ? ['whole', 'read', 1.6, 2.5] : ['whole', 1.6, 2.5];
  if (v.level === undefined) v.level = canRead ? 'read' : 'whole';
  if (!levels.includes(v.level)) v.level = 'whole';
  // Your key words are marked on the page while a question is open.
  const marks = tree?.found ? new Set(tree.found.marks) : null;
  root.append(topBar(`PDF ${v.at}`, info.badge || (printedOn(v.at) ? `Printed ${printedOn(v.at)}` : '')));
  const main = el('div', 'rs-body');
  const stage = el('div', 'rs-stage');
  stage.id = 'pageView';
  const canvas = el('canvas');
  canvas.id = 'canvas';
  canvas.setAttribute('aria-label', `PDF page ${v.at}`);
  stage.append(canvas);

  const sheet = el('div', 'rs-sheet');
  const arrow = el('span', 'rs-arrow');
  arrow.append(ic(v.open ? 'down' : 'up'));
  const more = el('div', 'rs-more gut');
  more.hidden = !v.open;
  const head = tapButton('rs-head gut', undefined, () => {
    v.open = !v.open;
    more.hidden = !v.open;
    arrow.replaceChildren(ic(v.open ? 'down' : 'up'));
    head.setAttribute('aria-expanded', String(v.open));
    refit?.();
  });
  head.setAttribute('aria-expanded', String(Boolean(v.open)));
  const t = el('span', 't');
  t.append(el('b', '', info.name));
  if (info.title) t.append(el('small', '', info.title));
  head.append(t, arrow);

  more.append(statsRow(info.stats));
  for (const line of info.lines) more.append(el('p', 'rs-grey', line));
  if (info.tip) more.append(el('p', 'rs-route', info.tip));
  if (info.watch.length) {
    more.append(el('p', 'rs-grey', 'Read for these words'), chips(info.watch), el('p', 'rs-grey', '"Shall" means you must. "May" means you are allowed to, not that you have to.'));
  }
  const preview = el('div', 'rs-preview');
  preview.hidden = true;
  const crop = el('canvas');
  crop.id = 'ruleCanvas';
  const cropNote = el('p', 'rs-small');
  preview.append(el('p', 'rs-grey', info.partLabel), crop, cropNote);
  more.append(preview);
  if (info.points.length) {
    more.append(el('p', 'rs-grey', 'Does it point somewhere else?'));
    const box = listBox(more);
    for (const p of info.points) box.append(row(p.title, p.detail, p.icon, () => open(p.view)));
  }
  if (info.pages) {
    more.append(el('p', 'rs-grey', 'This table goes over several pages.'));
    const box = listBox(more);
    for (const p of info.pages) {
      box.append(row(pageWords(p), '', 'page', () => {
        v.at = p;
        draw();
      }));
    }
  }

  const tools = el('div', 'rs-tools');
  const tool = (name, label, disabled, onTap) => {
    const b = tapButton('', undefined, onTap);
    b.setAttribute('aria-label', label);
    b.disabled = disabled;
    b.append(ic(name));
    tools.append(b);
    return b;
  };
  const turn = (by) => {
    v.at += by;
    draw();
  };
  tool('left', 'Previous page', v.at <= 1, () => turn(-1));
  tool('right', 'Next page', v.at >= index.total, () => turn(1));
  const smaller = tool('minus', 'Smaller', v.level === 'whole', () => setLevel(levels[levels.indexOf(v.level) - 1]));
  const bigger = tool('plus', 'Bigger', v.level === levels[levels.length - 1], () => setLevel(levels[levels.indexOf(v.level) + 1]));
  let wide = null;
  if (canRead) {
    tools.classList.add('five');
    wide = tapButton('', undefined, () => setLevel(v.level === 'whole' ? 'read' : 'whole'));
    wide.id = 'wholePage';
    tools.append(wide);
  }
  const showWide = () => wide?.replaceChildren(ic(v.level === 'whole' ? 'zoom' : 'page'), document.createTextNode(v.level === 'whole' ? 'Zoom in' : 'Whole page'));
  showWide();
  sheet.append(head, more);
  if (tree && views.length > 1) {
    const ready = el('div', 'rs-ready gut');
    ready.append(tapButton('btn', 'Back to your tree', () => {
      views = [];
      draw();
    }));
    sheet.append(ready);
  }
  sheet.append(tools);
  main.append(stage, sheet);
  root.append(main);

  let partSpot = null;
  let span = null; // Where the rule's own words start and end across the page.
  let pageLeft = 0;
  let pageWide = 612;
  // Sizes the page to the space left above the sheet. Nothing ever sits on top of it.
  const fit = () => {
    if (!canvas.width || canvas.width <= 300) return;
    const room = [stage.clientWidth - 16, stage.clientHeight - 16];
    const ratio = canvas.width / canvas.height;
    let width = room[0] * (typeof v.level === 'number' ? v.level : 1);
    if (v.level === 'whole') width = Math.min(room[0], room[1] * ratio);
    if (v.level === 'read') width = span ? (room[0] * pageWide) / (span.x1 - span.x0) : room[0] * 1.3;
    canvas.style.width = `${Math.round(width)}px`;
    canvas.style.height = `${Math.round(width / ratio)}px`;
  };
  refit = fit;
  // Going bigger lands on the rule, not the corner of the page.
  const place = () => {
    const across = parseFloat(canvas.style.width) / pageWide;
    stage.scrollTop = v.level !== 'whole' && partSpot !== null ? partSpot * parseFloat(canvas.style.height) : 0;
    stage.scrollLeft = v.level !== 'whole' && span ? (span.x0 - pageLeft) * across : 0;
  };
  function setLevel(level) {
    v.level = level;
    smaller.disabled = level === 'whole';
    bigger.disabled = level === levels[levels.length - 1];
    showWide();
    fit();
    place();
  }

  (async () => {
    const mine = drawing;
    const done = await viewer.drawPage(canvas, v.at, stage.clientWidth || 320, 2);
    if (!done || mine !== drawing) return;
    const [left, bottom, right, top] = viewer.pageBox(v.at) || [0, 0, 612, 792];
    pageLeft = left;
    pageWide = right - left;
    const words = await viewer.pageItems(v.at);
    if (mine !== drawing) return;
    if (marks?.size) markWords(canvas, v.at, words, marks);
    if (onHome && info.part && !info.part.sideways) {
      // Fit the box and the zoom to the rule's own words, not the page margins.
      const floor = (info.part.bottom === null ? bottom + 40 : info.part.bottom) + 1;
      const own = words.filter((it) => Math.abs(it.t[1]) < 0.01 && it.t[5] <= info.part.top + 3 && it.t[5] > floor && it.t[4] >= info.part.x0 - 24 && it.t[4] < info.part.x1);
      if (own.length) span = { x0: Math.min(...own.map((it) => it.t[4])) - 6, x1: Math.max(...own.map((it) => it.t[4] + it.w)) + 6 };
      const k = canvas.width / (right - left);
      const x = ((span ? span.x0 : info.part.x0) - left) * k;
      const w = ((span ? span.x1 : info.part.x1) - (span ? span.x0 : info.part.x0)) * k;
      const y = Math.max(0, (top - info.part.top - 11) * k);
      const end = info.part.bottom === null ? (top - bottom - 40) * k : (top - info.part.bottom - 10) * k;
      const h = Math.max(1, end - y);
      crop.width = Math.round(w);
      crop.height = Math.round(h);
      crop.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
      cropNote.textContent = info.part.goesOn ? 'This may go on past this part. Check the whole page and the next one.' : '';
      preview.hidden = false;
      const g = canvas.getContext('2d');
      g.strokeStyle = '#111214';
      g.lineWidth = Math.max(2, canvas.width / 300);
      g.strokeRect(x + 2, y, w - 4, h);
      partSpot = y / canvas.height;
    }
    fit();
    place();
    stage.dataset.ready = '1';
  })().catch(() => {
    stage.replaceChildren(el('p', 'rs-grey', 'This page could not be shown. Try opening your book again.'));
  });
}

/* ---------- The search box ---------- */
function searchFor(text) {
  const asked = parseSectionNumber(text);
  if (asked !== null) {
    const s = lookupSection(index, asked);
    return s.status === 'invalid' ? { type: 'message', text: s.reason } : { type: 'section', section: asked };
  }
  const table = parseTableNumber(text);
  if (table) return { type: 'table', label: table };
  if (/^\s*\d{1,3}\s*[-‐‑–]\s*\d+\s*$/.test(text)) {
    const r = lookup(index, text);
    return r.status === 'invalid' ? { type: 'message', text: r.reason } : { type: 'rule', rule: r.rule };
  }
  if (!/\p{L}{2}/u.test(text)) return { type: 'message', text: 'Type a rule like 2-328, a section like 32, a table like Table 65, or paste a question.' };
  return { type: 'tree', text };
}

$('form').onsubmit = (e) => {
  e.preventDefault();
  if (!index) return;
  const next = searchFor($('q').value);
  if (next.type === 'message') {
    say(next.text);
    return;
  }
  say('Ready. Paste a question, or type a rule, section or table.');
  if (next.type === 'tree') {
    startTree(next.text);
    return;
  }
  tree = null;
  views = [];
  drawTree();
  open(next);
};
$('q').onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('form').requestSubmit();
  }
};
addEventListener('resize', () => refit?.());

/* ---------- Full screen, the lock and the phone's Back button ---------- */
const LOCK = 'ce-locked';
const canFill = () => Boolean(document.documentElement.requestFullscreen && document.fullscreenEnabled);
async function fillScreen(on) {
  try {
    if (on) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    else if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    // The browser said no. The app still works.
  }
}
function toast(words) {
  $('app').querySelector('.rs-toast')?.remove();
  const t = el('div', 'rs-toast', words);
  t.setAttribute('role', 'status');
  t.onanimationend = () => t.remove();
  $('app').append(t);
}
function showStay(b) {
  b.replaceChildren(ic(locked ? 'lock' : 'unlock'));
  b.setAttribute('aria-label', locked ? 'Unlock' : 'Lock the app so Back cannot leave it');
  b.setAttribute('aria-pressed', String(locked));
}
function stayButton() {
  const b = tapButton('rs-iconbtn rs-stay', undefined, () => setLocked(!locked));
  showStay(b);
  return b;
}
function setLocked(on) {
  locked = on;
  try {
    localStorage.setItem(LOCK, on ? 'on' : 'off');
  } catch {
    // It still works for now. It just is not remembered.
  }
  for (const b of document.querySelectorAll('.rs-stay')) showStay(b);
  keepBack();
  if (on && canFill()) fillScreen(true);
  toast(on ? 'Locked. Back stays in the app.' : 'Unlocked.');
}
function showFullScreen() {
  const b = $('fullscreen');
  const on = Boolean(document.fullscreenElement);
  b.hidden = !canFill();
  b.replaceChildren(ic(on ? 'shrink' : 'expand'));
  b.setAttribute('aria-label', on ? 'Leave full screen' : 'Use the full screen');
  b.setAttribute('aria-pressed', String(on));
}
$('fullscreen').onclick = () => fillScreen(!document.fullscreenElement);
document.addEventListener('fullscreenchange', showFullScreen);
// The phone can drop full screen by itself. While locked, the next tap brings it back.
document.addEventListener('click', (e) => {
  if (locked && canFill() && !document.fullscreenElement && !e.target.closest('.rs-stay, #fullscreen')) fillScreen(true);
}, true);

// An extra history entry catches the phone's Back button, so Back moves through the app instead of leaving it.
// Back at the start with nothing to catch leaves the app on the first press, so a leftover entry is taken away.
function keepBack() {
  const need = views.length > 0 || Boolean(tree) || locked || tab !== 'find';
  if (need && !guarded) {
    history.pushState({ ceBack: true }, '');
    guarded = true;
  } else if (!need && guarded) {
    guarded = false;
    droppingGuard = true;
    history.back();
  }
}
addEventListener('popstate', () => {
  guarded = false;
  if (droppingGuard) {
    droppingGuard = false;
    keepBack();
    return;
  }
  if ($('app').querySelector('.rs-menu')) closeMenu();
  else if ($('app').querySelector('.sp-layer')) closeNews();
  else if (views.length) goBack();
  else if (tab !== 'find') {
    tab = 'find';
    draw();
  } else if (tree) undoTree();
  else if (locked) toast('Locked. Tap the lock to leave.');
  keepBack();
});

/* ---------- Coming back to where you were ---------- */
// Kept on this device only, so leaving the app does not lose your place.
const SESSION = 'ce-session';
const UNSAVED = new Set(['found', 'base', 'foundKey', 'result', 'checking']);
function saveSession() {
  try {
    if (views.length || tree) localStorage.setItem(SESSION, JSON.stringify({ views, tree }, (k, value) => (UNSAVED.has(k) ? undefined : value)));
    else localStorage.removeItem(SESSION);
  } catch {
    // Your place is not kept this time.
  }
}
function resumeSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION) || 'null');
    // A place kept by an older version, from before the tree, is not brought back.
    if (!saved || Array.isArray(saved)) return;
    tree = saved.tree || null;
    views = (saved.views || []).filter((v) => SCREENS[v?.type]);
    if (tree?.text) $('q').value = tree.text;
    draw();
    drawTree('last');
  } catch {
    tree = null;
    views = [];
    draw();
  }
}
addEventListener('pagehide', saveSession);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveSession();
});
try {
  locked = localStorage.getItem(LOCK) === 'on';
} catch {
  // Nothing was remembered.
}
$('home').querySelector('.rs-homeicons').append(stayButton(), moreButton());
showFullScreen();

/* ---------- Night mode ---------- */
// It starts by following the phone's dark mode. Once you tap the button, your choice is remembered.
const NIGHT = 'ce-night';
function showNight() {
  const on = document.documentElement.hasAttribute('data-night');
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', on ? '#000000' : '#f6f6f3');
  $('night').replaceChildren(ic(on ? 'sun' : 'moon'));
  $('night').setAttribute('aria-label', on ? 'Use the day look' : 'Use the black night look');
  $('night').setAttribute('aria-pressed', String(on));
}
$('night').onclick = () => {
  const on = document.documentElement.toggleAttribute('data-night');
  try {
    localStorage.setItem(NIGHT, on ? 'on' : 'off');
  } catch {
    // It still works for now. It just is not remembered.
  }
  showNight();
};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  let chosen = null;
  try {
    chosen = localStorage.getItem(NIGHT);
  } catch {
    // Nothing was remembered.
  }
  if (chosen === null) {
    document.documentElement.toggleAttribute('data-night', e.matches);
    showNight();
  }
});
try {
  const chosen = localStorage.getItem(NIGHT);
  if (chosen) document.documentElement.toggleAttribute('data-night', chosen === 'on');
} catch {
  // Nothing was remembered, so the phone's setting stands.
}
showNight();

/* ---------- Getting the book ---------- */
// You choose the PDF once. It is kept in this browser on this device, so it opens by itself after that.
$('file').onchange = async () => {
  const file = $('file').files[0];
  if (!file) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (String.fromCharCode(...bytes.subarray(0, 4)) !== '%PDF') {
      say('That file is not a PDF. Choose your Code PDF.');
      return;
    }
    $('pick').hidden = true;
    say('Opening your book');
    const blob = new Blob([bytes], { type: 'application/pdf' });
    let kept = true;
    try {
      await store.kvSet('book', { blob, name: file.name });
      await store.kvDel('bookMap');
      store.askToKeep();
    } catch {
      kept = false;
    }
    await readBook(blob, null, kept);
    if (!kept) say('There is no room to keep your book here. It is open for now, and you will need to choose it again next time.');
  } catch {
    try {
      await store.kvDel('book');
    } catch {
      // Nothing was kept.
    }
    say('That PDF could not be opened. Choose your Code PDF.');
    $('pick').hidden = false;
  }
};

async function fetchBytes(name) {
  try {
    const res = await fetch(name);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function askPassword(locked, here) {
  lockedBytes = locked;
  lockedHere = here;
  $('lock').hidden = false;
  $('forgot').hidden = !here;
  say(here ? 'Enter your password to open your book.' : 'Enter your password to open your book. You only do this once on each device.');
  $('password').focus();
  $('lock').onsubmit = async (e) => {
    e.preventDefault();
    const password = $('password').value;
    if (!password) return;
    $('unlock').disabled = true;
    say('Unlocking');
    const pdf = await unlockBook(locked, password);
    $('password').value = '';
    $('unlock').disabled = false;
    if (!pdf) {
      say('That password did not work. Try again.');
      $('password').focus();
      return;
    }
    $('lock').hidden = true;
    $('forgot').hidden = true;
    $('forgotAsk').hidden = true;
    const blob = new Blob([pdf], { type: 'application/pdf' });
    // Once it is open, the book is kept on this device, so it opens by itself from now on.
    let kept = false;
    try {
      await store.kvSet('book', { blob, name: 'Code book' });
      await store.kvDel('lockedBook');
      store.askToKeep();
      lockedBytes = null;
      kept = true;
    } catch {
      // It stays locked. Nothing is lost.
    }
    try {
      await readBook(blob, null, kept);
    } catch {
      say('Your book could not be opened.');
    }
  };
}

$('forgot').onclick = () => {
  $('forgot').hidden = true;
  $('lock').hidden = true;
  $('forgotAsk').hidden = false;
  say('');
};
$('keepBook').onclick = () => {
  $('forgotAsk').hidden = true;
  askPassword(lockedBytes, lockedHere);
};
$('removeBook').onclick = async () => {
  try {
    await store.kvDel('lockedBook');
  } catch {
    // Nothing was kept.
  }
  lockedBytes = null;
  $('forgotAsk').hidden = true;
  say('Choose your Code PDF. You only do this once.');
  $('pick').hidden = false;
};

// Closes the book and clears it from the screen. The password is needed to open it again.
$('lockNow').onclick = async () => {
  index = null;
  map = null;
  ready = null;
  views = [];
  tree = null;
  leaveSpace();
  draw();
  $('q').value = '';
  $('q').disabled = true;
  $('go').disabled = true;
  $('form').hidden = true;
  $('lockNow').hidden = true;
  await viewer.closeBook();
  askPassword(lockedBytes, lockedHere);
};

$('retry').onclick = () => location.reload();

const TYPED = 'ce-typed';

// Moves to a saved new version, never in the middle of a question or over a password you are typing.
function applyUpdate() {
  if (!updateReady || document.hidden || views.length || tree || tab !== 'find') return;
  if (document.querySelector('input[type=password]')?.value) return;
  updateReady = false;
  // What is in the question box comes back after the move.
  try {
    sessionStorage.setItem(TYPED, $('q').value);
  } catch {
    // It is not kept this time.
  }
  location.reload();
}

function watchForUpdates() {
  // The first version on a device takes over with nothing to replace, so that is not an update.
  const hadOne = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadOne) return;
    updateReady = true;
    applyUpdate();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    // A tab left open looks for a new version each time you come back to it.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      applyUpdate();
      reg.update().catch(() => {});
    });
  }).catch(() => {});
}

async function start() {
  try {
    const typed = sessionStorage.getItem(TYPED);
    if (typed) $('q').value = typed;
    sessionStorage.removeItem(TYPED);
  } catch {
    // Nothing was kept.
  }
  if ('serviceWorker' in navigator) watchForUpdates();
  // In the Android app and on your own PC the book is already here, so nothing needs choosing.
  say('Opening your book');
  const builtIn = await fetchBytes('book.pdf');
  if (builtIn && String.fromCharCode(...builtIn.subarray(0, 4)) === '%PDF') {
    const savedMap = await fetchBytes('book-index.json');
    await readBook(new Blob([builtIn], { type: 'application/pdf' }), savedMap ? new TextDecoder().decode(savedMap) : null);
    return undefined;
  }
  // The web app carries the book, scrambled, so no PDF is ever chosen there.
  const carried = Boolean(document.querySelector('meta[name=ce-book]'));
  let own = null;
  let saved = null;
  try {
    own = await store.kvGet('lockedBook');
    saved = await store.kvGet('book');
  } catch {
    // This browser cannot keep anything, so the book is opened again each time.
  }
  if (own && isLockedBook(own)) return askPassword(own, true);
  if (saved?.blob) {
    try {
      let savedMap = null;
      try {
        savedMap = await store.kvGet('bookMap');
      } catch {
        // The pages are read instead.
      }
      await readBook(saved.blob, savedMap, true);
      return undefined;
    } catch {
      if (!carried) {
        say('Your saved PDF could not be opened. Choose it again.');
        $('pick').hidden = false;
        return undefined;
      }
      // The copy on this device is damaged, so get the book again.
      try {
        await store.kvDel('book');
        await store.kvDel('bookMap');
      } catch {
        // Nothing more can be done here.
      }
    }
  }
  if (carried) say('Getting your book');
  const served = await fetchBytes('book.enc');
  if (served && isLockedBook(served)) return askPassword(served, false);
  if (carried) {
    say('Your book could not be downloaded. Check your internet, then try again. You only need internet this one time.');
    $('retry').hidden = false;
    return undefined;
  }
  say('Choose your Code PDF. You only do this once.');
  $('pick').hidden = false;
  return undefined;
}
start();

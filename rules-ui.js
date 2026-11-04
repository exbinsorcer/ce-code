// The search page. The book is read on this device each time the page opens. No AI.
import * as store from './store.js?v=a8290e52';
import * as viewer from './viewer.js?v=a8290e52';
import { createIndexer, lookup, readPage, rulePreview, parseSectionNumber, lookupSection, searchSection } from './rules.js?v=a8290e52';
import { createBookMap, lookupTable, parseTableNumber, rulesNamedIn, tablesNamedIn, watchWordsIn } from './map.js?v=a8290e52';
import { prepareFinder, findInBook, hintsFor, markRanges } from './finder.js?v=a8290e52';
import { checkQuestion } from './checker.js?v=a8290e52';
import { openAnswers, matchAnswer, combineAnswers, ratingLine, percentOf, pickWords, PERCENTS } from './answers.js?v=a8290e52';
import { ruledOutBy } from './others.js?v=a8290e52';
import { splitQuiz, quizForClaude } from './quizzes.js?v=a8290e52';
import { GRADED, NEEDED } from './graded.js?v=a8290e52';
import { patternOf, savePattern, loadPatterns, groupPatterns, deviceStore, drillDeck, noteDrill } from './patterns.js?v=a8290e52';
import { TOTAL_PAGES } from './logic.js?v=a8290e52';
import { isLockedBook, unlockBook } from './crypt.js?v=a8290e52';
import { packBook, unpackBook } from './snapshot.js?v=a8290e52';

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
    for (let n = 1; n <= total; n++) {
      const pg = readPage(await viewer.pageData(n));
      ix.add(pg);
      bm.add(pg);
      if (n % 10 === 0 || n === total) {
        say(`Reading your book: page ${n} of ${total}`);
        await new Promise((r) => setTimeout(r));
      }
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
  drawTabs();
  resumeSession();
  if (!views.length) $('q').focus();
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
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', left: '<path d="M19 12H5M11 6l-6 6 6 6"/>', right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
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
  // In a question, Back goes one step at a time, the same from every Back control. Only the first step leaves.
  const top = views[views.length - 1];
  if (top?.type === 'walk' && top.at > 0) top.at -= 1;
  else views.pop();
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
    return;
  }
  const v = views[views.length - 1];
  ({ walk: showWalk, section: showSection, refs: showRefs, missing: showMissing, answer: showAnswer, patterns: showPatterns, drill: showDrill, addquiz: showAddQuiz, rule: showItem, table: showItem, note: showItem, definition: showItem, page: showItem })[v.type](root, v);
}

/* ---------- A question: one step at a time ---------- */
function stepsFor(f, v) {
  const steps = [{
    ask: 'Which words matter?',
    why: f.keywords.length ? 'Tap a word to leave it out.' : 'I could not pick out any key words. Try other words.',
    fill(body) {
      const d = el('div', 'rs-chips');
      for (const w of f.keywords) {
        const off = f.dropped.includes(w);
        const b = tapButton(`rs-chip rs-tap${off ? ' off' : ''}`, w, () => {
          v.dropped = off ? v.dropped.filter((x) => x !== w) : [...v.dropped, w];
          draw();
        });
        b.setAttribute('aria-pressed', String(!off));
        d.append(b);
      }
      body.append(d);
      if (f.watch.length) {
        body.append(el('p', 'rs-grey', 'Do not skip these words'), chips(f.watch));
        if (f.negated.length) body.append(el('p', 'rs-grey', `The question rules out: ${f.negated.join(', ')}.`));
      }
    },
  }];
  if (f.bookWords.length) {
    steps.push({
      ask: 'Does the book use another word?',
      why: 'Look for the book\'s word when you search.',
      fill(body) {
        const card = el('div', 'card');
        for (const b of f.bookWords) {
          const line = el('div', 'rs-swap');
          line.append(el('span', 'rs-chip dark', b.word), el('span', 'rs-grey', 'may be'), ...b.book.map((w) => el('span', 'rs-chip', w)));
          card.append(line);
        }
        body.append(card);
      },
    });
  }
  if (f.definitions.length) {
    steps.push({
      ask: 'Do you know every word?',
      why: 'If not, start with Definitions.',
      fill(body) {
        const box = listBox(body);
        for (const d of f.definitions) box.append(row(d.term, pageWords(d.page), 'word', () => open({ type: 'definition', definition: d })));
      },
    });
  }
  const sectionRows = (body, list) => {
    const box = listBox(body);
    for (const s of list) box.append(row(`Section ${s.section}: ${s.title}`, s.page ? pageWords(s.page) : '', 'list', () => open({ type: 'section', section: s.section })));
  };
  steps.push({
    ask: 'General or specific?',
    why: 'Sections 0 to 16 and 26 are general. The rest only add to or change them, so if one fits your question, read it first.',
    fill(body) {
      const { specific, general } = f.scope;
      body.append(el('p', 'rs-small', 'Specific sections'));
      if (specific.length) sectionRows(body, specific);
      else body.append(el('p', 'rs-grey', 'None of them match your words.'));
      body.append(el('p', 'rs-small', 'General sections'));
      if (general.length) sectionRows(body, general);
      else body.append(el('p', 'rs-grey', specific.length ? `The general rules still count unless Section ${specific[0].section} changes them.` : 'None stand out. Try the Index next.'));
      body.append(el('p', 'rs-small', 'Found through the Contents and Index'));
    },
  });
  if (f.headings.length) {
    steps.push({
      ask: 'Do these headings point to a section?',
      why: 'These come from the Contents.',
      fill(body) {
        const box = listBox(body);
        for (const h of f.headings) {
          const name = h.top ? `Section ${h.section}: ${h.title}` : h.title;
          const where = h.page ? `Section ${h.section} · ${pageWords(h.page)}` : `Section ${h.section}`;
          box.append(row(name, where, 'list', () => open(h.top || !h.page ? { type: 'section', section: h.section } : { type: 'page', page: h.page, name: h.title, sub: `Section ${h.section}` })));
        }
      },
    });
  }
  if (f.entries.length) {
    steps.push({
      ask: 'Look up your key words in the Index.',
      why: 'These entries match.',
      fill(body) {
        const box = listBox(body);
        for (const e of f.entries) box.append(row(e.path.join(' › '), refWords(e.refs), 'search', () => openRef(e)));
      },
    });
  }
  const places = [...f.tables.slice(0, 3).map((t) => ({ title: `Table ${t.label}`, detail: t.title, icon: 'table', view: { type: 'table', label: t.label } })),
    ...f.rules.slice(0, 5).map((r) => ({ title: `${r.rule}  ${r.title ?? 'Not sure'}`, detail: `${pageWords(r.pdfPage)}${r.appendixB ? ' · Appendix B' : ''}`, icon: 'rule', view: { type: 'rule', rule: r.rule } }))];
  steps.push({
    ask: places.length ? 'Does a title fit?' : 'I could not find a place for this',
    why: places.length ? 'Check the title first. Read the rule only if it fits.' : 'Try other words, or check the Index by hand.',
    first: places[0] || null,
    fill(body) {
      if (!places.length) return;
      const box = listBox(body);
      for (const p of places) box.append(row(p.title, p.detail, p.icon, () => open(p.view)));
      body.append(el('p', 'rs-small', 'These are places to look, not the answer. Read the rule and decide.'));
    },
  });
  if (f.options.length >= 2) {
    steps.push({
      ask: 'What is your final choice?',
      final: true,
      fill(body) {
        const hints = hintsFor(f);
        if (v.hints) {
          const [title, words] = hints[(v.hints - 1) % hints.length];
          const tint = el('div', 'rs-tint');
          tint.append(el('b', '', `Hint ${((v.hints - 1) % hints.length) + 1} of ${hints.length}: ${title}`), document.createTextNode(words));
          body.append(tint);
        } else body.append(el('p', 'rs-grey', 'Take your time. Go back to the book as often as you like.'));
        const box = listBox(body);
        box.setAttribute('role', 'radiogroup');
        box.setAttribute('aria-label', 'Answer choices');
        for (const o of f.options) {
          const b = tapButton('rs-opt', undefined, () => {
            v.pick = o.letter;
            for (const other of box.children) other.setAttribute('aria-checked', String(other === b));
            $('lockIn').disabled = false;
          });
          b.setAttribute('role', 'radio');
          b.setAttribute('aria-checked', String(v.pick === o.letter));
          b.append(el('span', 'rs-dot'), el('span', '', `${o.letter}) ${o.text}`));
          box.append(b);
        }
      },
    });
  }
  return steps;
}

// The answer stays hidden until you say yes here.
function askToLock(root, v) {
  const scrim = el('div', 'rs-scrim');
  const pop = el('div', 'rs-pop gut');
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'true');
  const buttons = el('div', 'rs-foot');
  const keep = tapButton('btn soft', 'Keep looking', () => scrim.remove());
  buttons.append(keep, tapButton('btn', 'Yes, show me', () => open({ type: 'answer', text: v.text, pick: v.pick, found: v.found })));
  pop.append(el('h2', '', `Is ${v.pick} your final answer?`), el('p', 'rs-grey', 'You will see the answer next, so keep looking if you are not sure.'), buttons);
  scrim.append(pop);
  root.append(scrim);
  keep.focus();
}

function showWalk(root, v) {
  const f = findInBook(v.text, index, map, ready, { dropped: v.dropped });
  v.found = f;
  const steps = stepsFor(f, v);
  v.at = Math.min(v.at, steps.length - 1);
  const st = steps[v.at];
  root.append(topBar('How to find it', `Step ${v.at + 1} of ${steps.length}`));
  const segs = el('div', 'rs-segs gut');
  segs.style.gridTemplateColumns = `repeat(${steps.length},1fr)`;
  steps.forEach((_, i) => segs.append(el('i', i <= v.at ? 'on' : '')));
  root.append(segs);
  const body = scrollArea(root);
  // The whole question stays on screen, because a word like "not" can come last.
  body.append(el('p', 'rs-grey', f.stem));
  if (v.at === 0) body.append(el('p', 'rs-route', f.route.why));
  body.append(el('h2', '', st.ask));
  if (st.why) body.append(el('p', 'rs-grey', st.why));
  st.fill(body);
  const foot = el('div', 'rs-foot gut');
  if (st.final) {
    const hints = hintsFor(f).length;
    const words = !v.hints ? 'Give me a hint' : v.hints % hints === 0 ? 'First hint again' : 'Next hint';
    body.append(tapButton('btn soft', words, () => {
      v.hints = (v.hints || 0) + 1;
      draw();
    }));
    const before = tapButton('btn soft', 'Back', goBack);
    before.disabled = v.at === 0;
    foot.append(before);
    const lock = tapButton('btn', 'Lock it in', () => askToLock(root, v));
    lock.id = 'lockIn';
    lock.disabled = !v.pick;
    foot.append(lock);
    root.append(foot);
    return;
  }
  const prev = tapButton('btn soft', 'Back', () => {
    v.at -= 1;
    draw();
  });
  prev.disabled = v.at === 0;
  foot.append(prev);
  if (v.at + 1 < steps.length) {
    foot.append(tapButton('btn rs-next', 'Next', () => {
      v.at += 1;
      draw();
    }));
  } else if (st.first) foot.append(tapButton('btn', `Open ${st.first.view.type === 'table' ? st.first.title : `Rule ${st.first.view.rule}`}`, () => open(st.first.view)));
  root.append(foot);
}

/* ---------- The answer ---------- */
function startAgain() {
  tab = 'find';
  views = [];
  draw();
  $('q').value = '';
  say('Ready. Paste a question, or type a rule, section or table.');
  $('q').focus();
}
const placeRow = (kind, id, box) => {
  if (kind === 'table') {
    const t = map.tables.get(id);
    box.append(row(`Table ${id}`, t?.page ? pageWords(t.page) : '', 'table', () => open({ type: 'table', label: id })));
  } else {
    const r = lookup(index, id);
    box.append(row(`Rule ${id}`, r.pdfPage ? pageWords(r.pdfPage) : '', 'rule', () => open({ type: 'rule', rule: id })));
  }
};

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

// The percent in words and one plain line saying why. Shown only after Lock it in, and never tappable.
function ratingBox(r) {
  const box = el('div', 'rs-rate gut');
  box.append(el('b', '', `${percentOf(r)}% sure`));
  const line = ratingLine(r);
  if (line) box.append(el('small', '', line));
  return box;
}

// A place from the answer list. Places outside the Code are named as plain text, since there is nothing to open.
function listPlaceRow(p, box, body) {
  if (p.kind === 'outside') return body.append(el('p', 'rs-grey', `Outside the Code: ${p.id}`));
  if (p.kind === 'table' || p.kind === 'rule') return placeRow(p.kind, p.id, box);
  if (p.page) box.append(row(p.kind === 'definition' ? `Definition: ${p.id}` : pageWords(p.page), p.kind === 'definition' ? pageWords(p.page) : '', 'page', () => open({ type: 'page', page: p.page, name: p.kind === 'definition' ? p.id : pageWords(p.page), sub: 'Where to check' })));
}

// Not sure: help finishing the question by hand, and never a hint at an answer nobody has proven.
function closestPlaceText(place) {
  if (place.kind === 'table') return { name: `Table ${place.id}`, text: ready.tables.find((t) => t.label === place.id)?.text || '' };
  return { name: `Rule ${place.id}`, text: ready.rules.get(place.id)?.text || '' };
}
function showNotSure(body, v) {
  const f = v.found;
  const unsettled = el('div', 'rs-tint');
  unsettled.append(el('b', '', "What it couldn't settle"), document.createTextNode(v.result.because || 'The words alone could not decide it.'));
  body.append(el('p', 'rs-grey', `You picked ${v.pick}`), el('h2', '', "The program isn't sure"));
  if (!f.places.length) {
    const none = el('div', 'rs-tint');
    none.append(el('b', '', "What it couldn't settle"), document.createTextNode('The Index has no clear entry for these words. Try the Index under another word for the main thing being asked about, or ask your teacher.'));
    body.append(none);
    return;
  }
  const tabs = el('div', 'rs-tabs rs-bleed');
  tabs.setAttribute('role', 'tablist');
  const panel = el('div', 'rs-panel');
  const fill = () => {
    v.tab = v.tab || 'read';
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === v.tab));
    panel.replaceChildren();
    if (v.tab === 'read') {
      const box = listBox(panel);
      for (const p of f.places) placeRow(p.kind, p.id, box);
      return;
    }
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
      panel.append(card, el('p', 'rs-grey', 'This goes by the closest place only, so check it yourself.'));
    } else panel.append(el('p', 'rs-grey', 'Nothing could be ruled out from the closest place.'));
    panel.append(unsettled);
  };
  for (const [key, name] of [['read', 'Where to read'], ['out', 'Ruled out']]) {
    const b = tapButton('rs-tab', name, () => {
      v.tab = key;
      fill();
    });
    b.dataset.tab = key;
    b.setAttribute('role', 'tab');
    tabs.append(b);
  }
  body.append(tabs, panel);
  fill();
}

function showAnswer(root, v) {
  root.append(topBar('The answer'));
  const area = el('div', 'rs-body');
  area.append(el('p', 'rs-grey gut rs-wait', 'Checking the book'));
  root.append(area);
  const foot = el('div', 'rs-foot gut');
  foot.append(tapButton('btn', 'Try another question', startAgain));
  root.append(foot);
  const mine = drawing;
  (async () => {
    if (!v.result) {
      const checked = await checkQuestion(v.text, { index, map, ready, pageData: viewer.tablePage });
      const list = await answerListHere();
      v.result = combineAnswers(checked, list ? matchAnswer(v.found, list) : null);
    }
    if (mine !== drawing) return;
    area.replaceChildren();
    // The route is kept on this device for the pattern book. It never holds the book's own words.
    deviceStore().then((kv) => savePattern(kv, v.found.stem, patternOf(v.found, v.result))).catch(() => {});
    if (v.result.status !== 'answer') {
      const body = scrollArea(area);
      if (v.result.outside) {
        body.append(el('p', 'rs-grey', `You picked ${v.pick}.`), el('h2', '', 'This is not in the Code'), el('p', 'rs-grey', v.result.because || 'The Code does not cover this. Ask your teacher where to look.'));
        return;
      }
      showNotSure(body, v);
      return;
    }
    const r = v.result;
    const answer = v.found.options.find((o) => o.letter === r.choice);
    const top = el('div', 'rs-result gut');
    const percent = percentOf(r);
    const ring = el('span', 'rs-ring');
    ring.style.setProperty('--p', String(percent));
    ring.append(el('b', '', `${percent}%`));
    const said = pickWords(v.pick, r);
    const words = el('span', 'rs-words');
    words.append(el('small', '', said.picked), el('b', '', said.program), el('small', '', answer ? `${answer.letter}) ${answer.text}` : ''));
    top.append(ring, words);
    const tabs = el('div', 'rs-tabs');
    tabs.setAttribute('role', 'tablist');
    const panel = el('div', 'rs-scroll gut');
    const fill = () => {
      v.tab = v.tab || 'why';
      for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === v.tab));
      panel.replaceChildren();
      if (v.tab === 'why') {
        const card = el('div', 'card');
        const why = (r.why || []).filter((w) => w && typeof w === 'object');
        why.forEach((w, i) => {
          const line = el('div', 'rs-way');
          const text = el('div');
          text.append(el('b', '', w.head), el('span', '', w.say));
          line.append(el('i', '', String(i + 1)), text);
          const worked = r.steps?.[i];
          if (worked?.value != null) line.append(el('em', 'rs-val', `${worked.value}${worked.unit ? ` ${worked.unit}` : ''}`));
          card.append(line);
        });
        if (!why.length) card.append(el('p', 'rs-grey', r.because || 'See Where to check for the places to read.'));
        panel.append(card);
        if (r.mistake) {
          const tint = el('div', 'rs-tint');
          tint.append(el('b', '', 'Common mistake'), document.createTextNode(r.mistake));
          panel.append(tint);
        }
      } else {
        const box = listBox(panel);
        for (const e of r.evidence || []) placeRow(e.kind, e.ref, box);
        for (const p of r.places || []) listPlaceRow(p, box, panel);
        if (!box.children.length) box.remove();
        for (const src of r.sources || []) panel.append(el('p', 'rs-grey', src));
        panel.append(el('p', 'rs-small', (r.evidence || []).length ? 'Checked against the book' : 'From the answer list'));
        if (r.pattern) {
          const tint = el('div', 'rs-tint');
          tint.append(el('b', '', 'Pattern to remember'), document.createTextNode(r.pattern));
          panel.append(tint);
        }
      }
    };
    for (const [key, name] of [['why', r.calculation ? 'Worked steps' : 'Why'], ['where', 'Where to check']]) {
      const b = tapButton('rs-tab', name, () => {
        v.tab = key;
        fill();
      });
      b.dataset.tab = key;
      b.setAttribute('role', 'tab');
      tabs.append(b);
    }
    area.append(top, ratingBox(r), tabs, panel);
    fill();
  })().catch(() => {
    area.replaceChildren(el('p', 'rs-grey gut rs-wait', 'This could not be checked. Try opening your book again.'));
  });
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
  if (tab === 'find') $('home').querySelector('.rs-homehead').append(document.querySelector('.rs-homeicons'));
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
  root.append(el('p', 'rs-grey', groups.length ? 'Routes from your own questions.' : 'Finish a question in Find, and its route shows up here.'));
  if (!groups.length) return;
  const box = listBox(root);
  groups.forEach((g, i) => {
    const p = g.pattern;
    box.append(row(`Asks ${ASK_WORDS[p.asks] || p.asks}`, `${SCOPE_WORDS[p.scope] || 'Not clear'} · ${placeWords(p.place)}`, 'list', () => open({ type: 'patterns', pick: i })));
  });
  const deck = drillDeck(groups, missed).slice(0, DRILL_MOST);
  if (deck.length) root.append(tapButton('btn', `Practise ${deck.length} route${deck.length === 1 ? '' : 's'}`, () => open(newDrill(deck))));
}

/* ---------- The pattern drill ---------- */
const DRILL_MISSES = 'ce-drill-missed';
const DRILL_MOST = 10;
const newDrill = (deck) => ({ type: 'drill', deck, total: deck.length, had: 0, missed: [], shown: false });
async function noteRoute(key, hadIt) {
  const kv = await deviceStore();
  await kv.set(DRILL_MISSES, noteDrill((await kv.get(DRILL_MISSES)) || {}, key, hadIt));
}
function showDrill(root, v) {
  if (!v.deck.length) {
    root.append(topBar('Pattern drill'));
    const body = scrollArea(root);
    const again = v.missed.length;
    body.append(el('h2', '', 'Done for now'), el('p', 'rs-grey', `You had ${v.had} of ${v.total} route${v.total === 1 ? '' : 's'} from memory on the first try.${again ? ` ${again} came back and will show up first next time.` : ''}`));
    const foot = el('div', 'rs-foot gut');
    foot.append(tapButton('btn soft', 'Practise again', async () => {
      const kv = await deviceStore();
      const deck = drillDeck(groupPatterns(await loadPatterns(kv)), (await kv.get(DRILL_MISSES)) || {}).slice(0, DRILL_MOST);
      views[views.length - 1] = newDrill(deck);
      draw();
    }), tapButton('btn', 'Back to Practice', goBack));
    root.append(foot);
    return;
  }
  const done = Math.min(v.total - 1, v.total - v.deck.length);
  root.append(topBar('Pattern drill', `${done + 1} of ${v.total}`));
  const body = scrollArea(root);
  const c = v.deck[0];
  const meter = el('div', 'rs-meter');
  meter.setAttribute('role', 'img');
  meter.setAttribute('aria-label', `${done} of ${v.total} done`);
  const fill = el('i');
  fill.style.width = `${(done / v.total) * 100}%`;
  meter.append(fill);
  body.append(meter, el('p', 'rs-drillq', c.question), routeCard(c.pattern, !v.shown));
  if (!v.shown) body.append(el('p', 'rs-tint', 'Say each step to yourself, then tap Show route.'));
  const foot = el('div', 'rs-foot gut');
  if (!v.shown) {
    foot.append(tapButton('btn', 'Show route', () => {
      v.shown = true;
      draw();
    }));
  } else {
    const mark = (hadIt) => {
      const first = !v.missed.includes(c.key);
      v.deck.shift();
      v.shown = false;
      if (hadIt && first) v.had += 1;
      if (!hadIt && first) {
        v.missed.push(c.key);
        v.deck.push(c); // It comes back once, later in this drill.
      }
      if (first) noteRoute(c.key, hadIt).catch(() => {});
      draw();
    };
    foot.append(tapButton('btn soft', 'I missed it', () => mark(false)), tapButton('btn', 'I had it', () => mark(true)));
  }
  root.append(foot);
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
    else if (r.type === 'see') box.append(row(`See ${r.term}`, 'Search this word instead', 'search', () => open({ type: 'walk', text: r.term, dropped: [], at: 0 })));
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
function markWords(canvas, page, items, marks) {
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
      g.beginPath();
      corners.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
    }
  }
  g.restore();
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
  const walk = [...views].reverse().find((x) => x.type === 'walk');
  const marks = walk?.found ? new Set(walk.found.marks) : null;
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
  if (walk?.found?.options.length >= 2) {
    const ready = el('div', 'rs-ready gut');
    if (walk.at + 1 < stepsFor(walk.found, walk).length - 1) {
      ready.append(tapButton('btn soft', 'Next step', () => {
        views.length = views.indexOf(walk) + 1;
        walk.at += 1;
        draw();
      }));
    }
    ready.append(tapButton('btn', "I'm ready to choose", () => {
      views.length = views.indexOf(walk) + 1;
      walk.at = Number.MAX_SAFE_INTEGER;
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
  return { type: 'walk', text, dropped: [], at: 0 };
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
  views = [];
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
  const need = views.length > 0 || locked || tab !== 'find';
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
  if (views.length) goBack();
  else if (tab !== 'find') {
    tab = 'find';
    draw();
  } else if (locked) toast('Locked. Tap the lock to leave.');
  keepBack();
});

/* ---------- Coming back to where you were ---------- */
// Kept on this device only, so leaving the app does not lose your place.
const SESSION = 'ce-session';
function saveSession() {
  try {
    if (views.length) localStorage.setItem(SESSION, JSON.stringify(views, (k, value) => (k === 'found' || k === 'result' ? undefined : value)));
    else localStorage.removeItem(SESSION);
  } catch {
    // Your place is not kept this time.
  }
}
function resumeSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION) || 'null');
    if (!Array.isArray(saved) || !saved.length) return;
    for (const v of saved) if (v.type === 'walk' || v.type === 'answer') v.found = findInBook(v.text, index, map, ready, { dropped: v.dropped || [] });
    views = saved;
    draw();
  } catch {
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
$('home').querySelector('.rs-homeicons').append(stayButton());
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
  if (!updateReady || document.hidden || views.length || tab !== 'find') return;
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

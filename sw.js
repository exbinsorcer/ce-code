// Keeps the app's own files on the device so it opens with no internet.
// Your book is not handled here. It stays in this device's browser storage.
const CACHE = 'ce-code-a8290e52';
const FILES = ["./answers.js","./calibrate.js","./check-about.js","./check-definition-statements.js","./check-definitions.js","./check-negative.js","./check-numbers.js","./check-outside.js","./check-rule-structure.js","./check-rule-words.js","./check-rules.js","./check-situations.js","./check-which-rule.js","./checker.js","./crypt.js","./engine.js","./finder.js","./graded.js","./index.html","./logic.js","./manifest.webmanifest","./map.js","./others.js","./patterns.js","./quizzes.js","./rule-structure.js","./rules-ui.js","./rules.js","./snapshot.js","./store.js","./styles.css","./tables.js","./viewer.js","./calc/book.js","./calc/box-fill.js","./calc/check.js","./calc/conduit-fill.js","./calc/correction.js","./calc/dwelling.js","./calc/motor.js","./icons/icon-192.png","./icons/icon-512.png","./vendor/figtree/figtree-latin-400-normal.woff2","./vendor/figtree/figtree-latin-500-normal.woff2","./vendor/figtree/figtree-latin-600-normal.woff2","./vendor/figtree/figtree-latin-700-normal.woff2","./vendor/figtree/LICENSE.txt","./vendor/pdfjs/LICENSE.txt","./vendor/pdfjs/pdf.min.mjs","./vendor/pdfjs/pdf.worker.min.mjs","./vendor/pdfjs/standard_fonts/FoxitDingbats.pfb","./vendor/pdfjs/standard_fonts/FoxitFixed.pfb","./vendor/pdfjs/standard_fonts/FoxitFixedBold.pfb","./vendor/pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb","./vendor/pdfjs/standard_fonts/FoxitFixedItalic.pfb","./vendor/pdfjs/standard_fonts/FoxitSerif.pfb","./vendor/pdfjs/standard_fonts/FoxitSerifBold.pfb","./vendor/pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb","./vendor/pdfjs/standard_fonts/FoxitSerifItalic.pfb","./vendor/pdfjs/standard_fonts/FoxitSymbol.pfb","./vendor/pdfjs/standard_fonts/LiberationSans-Bold.ttf","./vendor/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf","./vendor/pdfjs/standard_fonts/LiberationSans-Italic.ttf","./vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf","./vendor/pdfjs/standard_fonts/LICENSE_FOXIT","./vendor/pdfjs/standard_fonts/LICENSE_LIBERATION","./answers.enc"];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(caches.match('./index.html').then((hit) => hit || fetch(e.request)));
    return;
  }
  // Only the app's own files come from here, so a missing book file simply stays missing.
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});

// Shows the PDF and searches it. The page text is held in memory only and never saved.
import { normalizeText } from './logic.js?v=4aa3f35a';
import { readRulings } from './tables.js?v=4aa3f35a';

let pdfjs;
let doc = null;
let pageText = null;
let rawText = null;
let renderTask = null;

async function lib() {
  if (!pdfjs) {
    pdfjs = await import('./vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  return pdfjs;
}

export async function openBook(blob) {
  await closeBook();
  const { getDocument } = await lib();
  const data = new Uint8Array(await blob.arrayBuffer());
  doc = await getDocument({
    data,
    standardFontDataUrl: new URL('./vendor/pdfjs/standard_fonts/', import.meta.url).href,
    isEvalSupported: false,
    enableXfa: false,
  }).promise;
  return doc.numPages;
}

export async function closeBook() {
  pageText = null;
  rawText = null;
  if (doc) await doc.destroy();
  doc = null;
}

export const pageCount = () => (doc ? doc.numPages : 0);

let lastBox = null;
export const pageBox = (n) => (lastBox && lastBox.n === n ? lastBox.view : null);

export async function drawPage(canvas, n, width, zoom) {
  if (renderTask) {
    renderTask.cancel();
    renderTask = null;
  }
  const page = await doc.getPage(n);
  lastBox = { n, view: page.view };
  const base = page.getViewport({ scale: 1 });
  const css = (width / base.width) * zoom;
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  const view = page.getViewport({ scale: css * ratio });
  lastBox.viewport = view;
  const off = document.createElement('canvas');
  off.width = Math.floor(view.width);
  off.height = Math.floor(view.height);
  const task = page.render({ canvasContext: off.getContext('2d'), viewport: view });
  renderTask = task;
  try {
    await task.promise;
  } catch (e) {
    if (e?.name === 'RenderingCancelledException') return false;
    throw e;
  }
  if (renderTask === task) renderTask = null;
  canvas.width = off.width;
  canvas.height = off.height;
  canvas.style.width = `${Math.floor(view.width / ratio)}px`;
  canvas.style.height = `${Math.floor(view.height / ratio)}px`;
  canvas.getContext('2d').drawImage(off, 0, 0);
  return true;
}

// Where a point on the book page lands on the canvas last drawn for that page.
export const toCanvas = (n, x, y) => (lastBox && lastBox.n === n && lastBox.viewport ? lastBox.viewport.convertToViewportPoint(x, y) : null);

// The text pieces on a page with their positions, for marking words. Held in memory only.
export async function pageItems(n) {
  const page = await doc.getPage(n);
  const { items } = await page.getTextContent();
  return items.filter((it) => it.str && it.str.trim()).map((it) => ({ str: it.str, t: it.transform, w: it.width }));
}

// One page's text with its positions, grouped into lines from the top down.
export async function pageLines(n) {
  const page = await doc.getPage(n);
  const content = await page.getTextContent();
  const lines = [];
  const items = content.items.filter((it) => it.str && it.str.trim());
  // Wide tables are printed sideways. When most text runs up or down the page, read it as if the page were turned.
  const sideways = items.filter((it) => Math.abs(it.transform[1]) > Math.abs(it.transform[0])).length > items.length / 2;
  for (const it of items) {
    const [a, b, , , px, py] = it.transform;
    const turned = Math.abs(b) > Math.abs(a);
    if (turned !== sideways) continue;
    const x = !sideways ? px : b > 0 ? py : -py;
    const y = !sideways ? py : b > 0 ? -px : px;
    let line = lines.find((l) => Math.abs(l.y - y) < 2);
    if (!line) {
      line = { y, items: [] };
      lines.push(line);
    }
    line.items.push({ x, str: it.str });
  }
  page.cleanup();
  return lines.sort((a, b) => b.y - a.y);
}

export function bookText() {
  return { norm: pageText, raw: rawText, lines: pageLines, total: doc.numPages };
}

// Reads every page once per session. onProgress gets (pages done, total).
export async function readAllText(onProgress) {
  if (pageText) return pageText;
  const out = [];
  const raws = [];
  const total = doc.numPages;
  for (let n = 1; n <= total; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const text = content.items.map((it) => (it.hasEOL ? `${it.str} ` : it.str)).join(' ');
    raws.push(text);
    out.push(normalizeText(text));
    page.cleanup();
    if (n % 10 === 0 || n === total) {
      onProgress?.(n, total);
      await new Promise((r) => setTimeout(r));
    }
  }
  pageText = out;
  rawText = raws;
  return out;
}

// One page's text pieces with their font names and positions, for the rule search. Held in memory only.
export async function pageData(n, source = doc) {
  return readPageData(source, n);
}

// One page for the table reader: its text plus the thin lines drawn between cells.
export async function tablePage(n) {
  const data = await readPageData(doc, n);
  return { ...data, lines: await readRulings(await doc.getPage(n)) };
}

export async function readPageData(pdf, n) {
  const page = await pdf.getPage(n);
  // The font names are only known after the page's drawing steps are read.
  await page.getOperatorList();
  const content = await page.getTextContent();
  const fonts = {};
  for (const key of Object.keys(content.styles)) {
    try {
      const f = page.commonObjs.get(key);
      fonts[key] = f ? { name: f.name || '', bold: f.bold } : null;
    } catch {
      fonts[key] = null;
    }
  }
  const items = content.items
    .filter((it) => typeof it.str === 'string')
    .map((it) => ({ str: it.str, t: it.transform, w: it.width, font: fonts[it.fontName] ?? null }));
  const view = page.view;
  page.cleanup();
  return { n, view, items };
}

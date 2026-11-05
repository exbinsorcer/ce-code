// The endless space the question tree sits in. Boxes stay where they are put; only the view moves.
// Drag to move, pinch or scroll to zoom. Lines go down, across, then down, like a tree chart. No AI.

const GAP = 56; // Space between rows of boxes.
const SIDE_GAP = 14; // Space between boxes in one row.
const MIN = 0.25;
const MAX = 2.5;

// host: an empty element that fills the screen. room: the part of it not covered by floating buttons.
export function createSpace(host, room = { top: 68, bottom: 16, side: 16 }) {
  host.classList.add('sp');
  const stars = document.createElement('canvas');
  stars.className = 'sp-stars';
  stars.setAttribute('aria-hidden', 'true');
  const world = document.createElement('div');
  world.className = 'sp-world';
  const holder = document.createElement('div');
  holder.innerHTML = '<svg class="sp-edges" aria-hidden="true"></svg>';
  const edges = holder.firstChild;
  const layer = document.createElement('div');
  layer.className = 'sp-nodes';
  world.append(edges, layer);
  host.prepend(stars, world);

  const V = { x: 0, y: 0, s: 1 };
  let placed = false; // The view is set once the first box has a size.
  let list = [];
  const pos = new Map(); // Where each box sits in space.
  let glideRun = 0;
  let wanted = null; // Boxes to show once the space can be seen again.
  const known = new Set(); // Boxes already shown once.

  const apply = () => {
    world.style.transform = `translate(${V.x}px,${V.y}px) scale(${V.s})`;
    drawStars();
  };
  const visible = () => host.clientWidth > 0 && host.clientHeight > 0;

  /* Laying out the tree. A box sits one row below its parent, and a row of brothers is centred under the parent. */
  function layout() {
    const box = new Map();
    for (const n of list) box.set(n.id, { w: n.el.offsetWidth, h: n.el.offsetHeight, d: 0, cx: 0 });
    for (const n of list) {
      const b = box.get(n.id);
      if (n.joins) b.d = Math.max(...n.joins.map((j) => box.get(j)?.d ?? 0)) + 1;
      else if (n.parent && box.has(n.parent)) b.d = box.get(n.parent).d + 1;
    }
    const rowH = [];
    for (const b of box.values()) rowH[b.d] = Math.max(rowH[b.d] || 0, b.h);
    const top = [0];
    for (let d = 1; d < rowH.length; d++) top[d] = top[d - 1] + (rowH[d - 1] || 0) + GAP;
    for (const n of list) {
      const b = box.get(n.id);
      if (n.joins) b.cx = n.joins.reduce((s, j) => s + (box.get(j)?.cx ?? 0), 0) / n.joins.length;
      const kids = list.filter((c) => c.parent === n.id && !c.joins);
      if (!kids.length) continue;
      const total = kids.reduce((s, c) => s + box.get(c.id).w, 0) + SIDE_GAP * (kids.length - 1);
      let x = b.cx - total / 2;
      for (const c of kids) {
        box.get(c.id).cx = x + box.get(c.id).w / 2;
        x += box.get(c.id).w + SIDE_GAP;
      }
    }
    pos.clear();
    for (const n of list) {
      const b = box.get(n.id);
      const p = { x: b.cx - b.w / 2, y: top[b.d], w: b.w, h: b.h };
      pos.set(n.id, p);
      n.el.style.left = `${p.x}px`;
      n.el.style.top = `${p.y}px`;
    }
    drawEdges();
  }
  function elbow(x1, y1, x2, y2) {
    const m = y2 - GAP / 2;
    if (Math.abs(x2 - x1) < 1) return `M${x1} ${y1}V${y2}`;
    const dir = x2 > x1 ? 1 : -1;
    const r = Math.max(0, Math.min(12, Math.abs(x2 - x1) / 2, m - y1, y2 - m));
    return `M${x1} ${y1}V${m - r}Q${x1} ${m} ${x1 + dir * r} ${m}H${x2 - dir * r}Q${x2} ${m} ${x2} ${m + r}V${y2}`;
  }
  function drawEdges() {
    const paths = [];
    for (const n of list) {
      for (const from of n.joins || (n.parent ? [n.parent] : [])) {
        const a = pos.get(from);
        const b = pos.get(n.id);
        if (!a || !b) continue;
        // book: where the book went instead of your pick, drawn dashed after Lock it in.
        paths.push({ cls: n.book ? 'book' : n.on ? 'on' : n.dim ? 'dim' : '', d: elbow(a.x + a.w / 2, a.y + a.h, b.x + b.w / 2, b.y) });
      }
    }
    // Your own path is drawn last, so it sits on top.
    const top = (p) => Number(p.cls === 'on' || p.cls === 'book');
    paths.sort((p, q) => top(p) - top(q));
    edges.innerHTML = paths.map((p) => `<path class="${p.cls}" d="${p.d}"/>`).join('');
  }

  /* Moving the view */
  function zoomAt(f, sx, sy) {
    const s = Math.min(MAX, Math.max(MIN, V.s * f));
    V.x = sx - (sx - V.x) * (s / V.s);
    V.y = sy - (sy - V.y) * (s / V.s);
    V.s = s;
    apply();
  }
  function bounds(ids) {
    const ps = ids.map((id) => pos.get(id)).filter(Boolean);
    if (!ps.length) return null;
    return {
      x1: Math.min(...ps.map((p) => p.x)), y1: Math.min(...ps.map((p) => p.y)),
      x2: Math.max(...ps.map((p) => p.x + p.w)), y2: Math.max(...ps.map((p) => p.y + p.h)),
    };
  }
  function target(b, maxS = 1, minS = 0.5) {
    const w = host.clientWidth;
    const h = host.clientHeight;
    const tall = b.y2 - b.y1;
    const s = Math.min(maxS, Math.max(minS, Math.min((w - 2 * room.side) / (b.x2 - b.x1), (h - room.top - room.bottom) / tall)));
    const fits = tall * s <= h - room.top - room.bottom;
    const y = fits ? room.top + (h - room.top - room.bottom - tall * s) / 2 - b.y1 * s : room.top - b.y1 * s;
    return { x: w / 2 - ((b.x1 + b.x2) / 2) * s, y, s };
  }
  function glide(to) {
    const from = { ...V };
    const run = ++glideRun;
    const ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 480;
    const start = performance.now();
    const step = (now) => {
      if (run !== glideRun) return;
      const t = ms ? Math.min(1, (now - start) / ms) : 1;
      const e = 1 - (1 - t) ** 3;
      V.x = from.x + (to.x - from.x) * e;
      V.y = from.y + (to.y - from.y) * e;
      V.s = from.s + (to.s - from.s) * e;
      apply();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function glideTo(ids) {
    if (!visible()) {
      wanted = ids;
      return;
    }
    const b = bounds(ids);
    if (b) glide(target(b));
  }
  function fitAll() {
    const b = bounds(list.map((n) => n.id));
    if (b) glide(target(b, 1, MIN));
  }
  // The first box starts near the top, at full size.
  function home() {
    const first = pos.get(list[0]?.id);
    if (!first) return;
    V.s = 1;
    V.x = host.clientWidth / 2 - (first.x + first.w / 2);
    V.y = room.top + 8 - first.y;
    apply();
  }

  /* Drag, pinch and scroll. A drag never counts as a tap on a box. */
  const pts = new Map();
  let drag = null;
  let swallow = false;
  host.addEventListener('pointerdown', (e) => {
    if (e.target.closest('textarea,input,select,.sp-over,.sp-peek')) return;
    glideRun++;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, moved: false };
    else if (drag) {
      drag.moved = true;
      host.setPointerCapture(e.pointerId);
    }
  });
  host.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId);
    const now = { x: e.clientX, y: e.clientY };
    if (pts.size === 1 && drag) {
      if (!drag.moved && Math.hypot(now.x - drag.x, now.y - drag.y) > 6) {
        drag.moved = true;
        host.setPointerCapture(e.pointerId);
        host.classList.add('grabbing');
      }
      if (drag.moved) {
        V.x += now.x - prev.x;
        V.y += now.y - prev.y;
        apply();
      }
    } else if (pts.size === 2) {
      const other = [...pts.entries()].find(([id]) => id !== e.pointerId)[1];
      const r = host.getBoundingClientRect();
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
      const d1 = Math.hypot(now.x - other.x, now.y - other.y);
      const m0 = { x: (prev.x + other.x) / 2 - r.left, y: (prev.y + other.y) / 2 - r.top };
      const m1 = { x: (now.x + other.x) / 2 - r.left, y: (now.y + other.y) / 2 - r.top };
      V.x += m1.x - m0.x;
      V.y += m1.y - m0.y;
      if (d0 > 0) zoomAt(d1 / d0, m1.x, m1.y);
      else apply();
    }
    pts.set(e.pointerId, now);
  });
  const lift = (e) => {
    if (!pts.delete(e.pointerId) || pts.size) return;
    if (drag?.moved) {
      swallow = true;
      setTimeout(() => {
        swallow = false;
      });
    }
    drag = null;
    host.classList.remove('grabbing');
  };
  host.addEventListener('pointerup', lift);
  host.addEventListener('pointercancel', lift);
  host.addEventListener('click', (e) => {
    if (!swallow) return;
    e.stopPropagation();
    e.preventDefault();
    swallow = false;
  }, true);
  host.addEventListener('wheel', (e) => {
    if (e.target.closest('textarea,.sp-peek')) return;
    e.preventDefault();
    glideRun++;
    const r = host.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  /* Stars: faint dots that move slower than the boxes, so the space feels deep. */
  const TILE = 700;
  const starList = (() => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    return Array.from({ length: 70 }, () => ({ x: rnd() * TILE, y: rnd() * TILE, r: 0.5 + rnd() * 1.1, a: 0.18 + rnd() * 0.45 }));
  })();
  function drawStars() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    if (stars.width !== Math.round(w * dpr) || stars.height !== Math.round(h * dpr)) {
      stars.width = Math.round(w * dpr);
      stars.height = Math.round(h * dpr);
    }
    const g = stars.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const rgb = getComputedStyle(host).getPropertyValue('--star').trim() || '128,128,128';
    const k = Math.sqrt(V.s);
    const T = TILE * k;
    const ox = (((V.x * 0.55) % T) + T) % T;
    const oy = (((V.y * 0.55) % T) + T) % T;
    for (let tx = ox - T; tx < w; tx += T) {
      for (let ty = oy - T; ty < h; ty += T) {
        for (const s of starList) {
          const x = tx + s.x * k;
          const y = ty + s.y * k;
          if (x < -2 || y < -2 || x > w + 2 || y > h + 2) continue;
          g.fillStyle = `rgba(${rgb},${s.a})`;
          g.beginPath();
          g.arc(x, y, s.r * (0.7 + 0.3 * k), 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  }

  // Lays out again once the space can be seen, since a hidden box has no size.
  function refresh() {
    if (!visible()) return;
    layout();
    if (!placed && list.length) {
      placed = true;
      home();
    }
    if (wanted) {
      const ids = wanted;
      wanted = null;
      glideTo(ids);
    }
    apply();
  }
  new ResizeObserver(refresh).observe(host);

  return {
    // nodes: [{ id, el, parent?, joins?, on?, dim?, book? }]. The boxes are put in space in this order.
    show(nodes, focus = null) {
      list = nodes;
      layer.replaceChildren(...nodes.map((n) => {
        n.el.classList.add('sp-node');
        // Only a box that was not there before fades in.
        if (!known.has(n.id)) n.el.classList.add('sp-new');
        known.add(n.id);
        n.el.dataset.id = n.id;
        return n.el;
      }));
      if (focus) wanted = focus;
      refresh();
    },
    // A new question: every box fades in again.
    forget: () => known.clear(),
    glideTo,
    fitAll,
    home,
    refresh,
    zoomBy(f) {
      glideRun++;
      zoomAt(f, host.clientWidth / 2, host.clientHeight / 2);
    },
    // For checks: where each box sits, and the view.
    where: () => ({ view: { ...V }, boxes: Object.fromEntries(pos) }),
  };
}

// First-visit tutorial. On the first visit a welcome card asks whether to take the tour;
// if yes, it opens the Mars map and walks through the main tools, highlighting each one in
// blue with a short explanation. A click anywhere moves on to the next step, until the end.
// "Skip" ends it at any time. It's shown once per browser (remembered in localStorage).
const SEEN_KEY = 'exploration-tutorial-seen';
const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function seen() {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private window: show again next time */ }
}

// Wait until an element exists and is visible (e.g. after the map has opened)
async function until(test, ms = 8000) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    if (test()) return true;
    await wait(80);
  }
  return false;
}
// Windows, panels and buttons the tutorial card must not cover
const OBSTACLES = ['.top-buttons > *', '.zoom-bar', '#switch-world', '#menu', '#select-panel', '#area-panel',
  '#analog-banner', '#ruler-panel', '.legend', '.map-settings', '.zoom-readout', '.leaflet-control-attribution', '.home-help'];
const visible = (el) => el && !el.hidden && el.offsetParent !== null && el.getBoundingClientRect().width > 0;

/**
 * app: hooks into the app -
 *   openBody(key)          open a map (e.g. 'mars')
 *   openMenu(open)         open / close the View panel
 *   selectPoint(lat, lon)  select an area, as if the map were clicked
 *   bodyName()             name of the body on screen ('Mars', 'Moon')
 */
export function maybeStartTutorial(app) {
  if (seen()) return;
  showWelcome(app);
}

/** Show the welcome card (also usable to restart the tour later). */
export function showWelcome(app) {
  const box = document.createElement('div');
  box.className = 'tut-welcome';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'tut-welcome-title');
  box.innerHTML = `
    <div class="tut-welcome-card">
      <h2 id="tut-welcome-title">Welcome to Exploration app</h2>
      <p>A tool designed to plan space missions to Mars and the Moon.</p>
      <p class="tut-question">Do you want a tutorial?</p>
      <div class="tut-welcome-actions">
        <button type="button" class="tut-no">No, thanks</button>
        <button type="button" class="tut-yes">Yes, show me</button>
      </div>
    </div>`;
  document.body.append(box);
  box.querySelector('.tut-yes').focus();
  const close = () => { markSeen(); box.remove(); };
  box.querySelector('.tut-no').onclick = close;
  box.querySelector('.tut-yes').onclick = () => { close(); runTour(app); };
}

/** Start the tour straight away (the "?" buttons). */
export function startTour(app) {
  markSeen();
  if (!document.querySelector('.tut-layer')) runTour(app);
}

async function runTour(app) {
  // the tour runs on the Moon or Mars map: stay on the one that's open, else open Mars
  const here = app.currentBody?.();
  if (here !== 'moon' && here !== 'mars') app.openBody('mars');
  await until(() => visible($('menu-btn')));
  await wait(300);
  app.zoomOut(); // every tour starts from the whole planet, nothing selected
  await wait(400);

  const steps = [
    { target: () => [$('menu-btn')], text: '<strong>Click the View button.</strong> This is the View area.' },
    {
      before: async () => { app.openMenu(true); await wait(250); },
      target: () => [$('menu')],
      text: 'You can explore planet data and adjust the map projection.',
      after: () => app.openMenu(false),
    },
    // waits for a real click on the map (clicks on buttons and panels are ignored)
    { mapClick: true, target: () => [], text: '<strong>Click a point on the map</strong> to select an area.' },
    {
      before: async () => {
        await until(() => visible($('area-panel')));
        const panel = $('area-panel');
        if (panel.classList.contains('collapsed')) $('area-collapse').click(); // phones
        await wait(500);
      },
      target: () => [$('area-panel'), document.querySelector('.radius-row')],
      text: 'These are all the parameters around the selected area. You can select the radius manually.',
    },
    { target: () => [$('ruler-btn')], text: 'This is the <strong>ruler</strong> tool, meant to measure distance.' },
    // shown once the route planner exists (a button with id "plan-route")
    {
      when: () => visible($('plan-route')),
      target: () => [$('plan-route')],
      text: 'This option lets you plan an efficient path between 2 points in a space mission.',
    },
    {
      target: () => [$('find-analogs')],
      text: 'This is the way to search places on <strong>Earth</strong> to simulate the mission conditions.',
    },
    {
      target: () => [$('find-similar')],
      text: () => `This tool finds similar places to the selected area on ${app.bodyName() === 'Moon' ? 'the Moon' : 'Mars'}.`,
    },
    { target: () => [], text: '<strong>That’s it!</strong> Click anywhere to start exploring.' },
  ].filter((s) => !s.when || s.when());

  const layer = document.createElement('div');
  layer.className = 'tut-layer';
  layer.innerHTML = `
    <div class="tut-shade"></div>
    <div class="tut-card" role="dialog" aria-live="polite">
      <div class="tut-text"></div>
      <div class="tut-foot"><span class="tut-count"></span><button type="button" class="tut-skip">Skip tutorial</button></div>
    </div>`;
  document.body.append(layer);
  const card = layer.querySelector('.tut-card');
  let boxes = [];
  let hidden = []; // windows hidden for the current step, to keep the card off them
  const unhide = () => { for (const el of hidden) el.classList.remove('tut-hide'); hidden = []; };
  let index = -1;
  let busy = false;

  function place() {
    for (const b of boxes) b.remove();
    boxes = [];
    const step = steps[index];
    const targets = step.target().filter(visible);
    // one dimming layer with a see-through hole for every highlighted element
    const W0 = window.innerWidth; const H0 = window.innerHeight;
    let path = `M0 0H${W0}V${H0}H0Z`;
    const PAD = 5;
    targets.forEach((el) => {
      const r = el.getBoundingClientRect();
      const x = r.left - PAD; const y = r.top - PAD; const w = r.width + 2 * PAD; const h = r.height + 2 * PAD;
      // same rounding as the element itself (plus the padding), so the highlight hugs its shape
      const own = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      const k = Math.min(own + PAD, w / 2, h / 2);
      path += `M${x + k} ${y}H${x + w - k}A${k} ${k} 0 0 1 ${x + w} ${y + k}V${y + h - k}A${k} ${k} 0 0 1 ${x + w - k} ${y + h}`
        + `H${x + k}A${k} ${k} 0 0 1 ${x} ${y + h - k}V${y + k}A${k} ${k} 0 0 1 ${x + k} ${y}Z`;
      const b = document.createElement('div');
      b.className = 'tut-spot';
      Object.assign(b.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, borderRadius: `${k}px` });
      layer.append(b);
      boxes.push(b);
    });
    const shade = layer.querySelector('.tut-shade');
    shade.style.clipPath = `path(evenodd, '${path}')`;
    shade.hidden = !!step.mapClick;
    layer.classList.toggle('tut-pick', !!step.mapClick);
    // card: the spot nearest the highlighted element that covers no window, button or panel
    // (scanned over the whole screen); if none is free (small phones), the one covering least.
    const W = window.innerWidth; const H = window.innerHeight;
    const cw = Math.min(340, W - 24);
    card.style.width = `${cw}px`;
    const ch = card.offsetHeight;
    const M = 12; // margin from the screen edge
    const GAP = 14; // space around obstacles
    unhide();
    const obstacles = OBSTACLES.flatMap((sel) => [...document.querySelectorAll(sel)])
      .filter((el) => visible(el) && !targets.some((t) => t === el || t.contains(el)))
      // a window that holds a highlighted element is avoided too, but never hidden
      .map((el) => ({ el, r: el.getBoundingClientRect(), keep: targets.some((t) => el.contains(t)) }))
      .concat(targets.map((el) => ({ el: null, r: el.getBoundingClientRect() }))); // never cover the highlight
    const overlap = (x, y, r) => {
      const ox = Math.min(x + cw, r.right + GAP) - Math.max(x, r.left - GAP);
      const oy = Math.min(y + ch, r.bottom + GAP) - Math.max(y, r.top - GAP);
      return ox > 0 && oy > 0 ? ox * oy : 0;
    };
    // covering the highlighted element counts far more than covering another window
    const covered = (x, y) => obstacles.reduce((sum, o) => sum + overlap(x, y, o.r) * (!o.el ? 50 : o.keep ? 10 : 1), 0);
    const t = targets[0]?.getBoundingClientRect();
    // with nothing highlighted: the middle of the screen, except when asking for a map click,
    // where the card goes up top so the map stays open
    const cx = t ? t.left + t.width / 2 : W / 2;
    const cy = t ? t.top + t.height / 2 : step.mapClick ? 0 : H / 2;
    let best = null;
    const tryAt = (x, y) => {
      x = Math.min(Math.max(M, x), W - cw - M); y = Math.min(Math.max(M, y), H - ch - M);
      const score = covered(x, y) * 1000 + Math.hypot(x + cw / 2 - cx, y + ch / 2 - cy);
      if (!best || score < best.score) best = { x, y, score };
    };
    if (t) { // right next to the target first: below, above, left, right
      tryAt(cx - cw / 2, t.bottom + GAP + 4); tryAt(cx - cw / 2, t.top - GAP - 4 - ch);
      tryAt(t.left - GAP - 4 - cw, cy - ch / 2); tryAt(t.right + GAP + 4, cy - ch / 2);
    }
    for (let y = M; y <= H - ch - M; y += 16) for (let x = M; x <= W - cw - M; x += 16) tryAt(x, y);
    tryAt((W - cw) / 2, (H - ch) / 2);
    const left = best.x; const top = best.y;
    // small screens: no free spot. Hide (for this step only) the windows the card would cover.
    for (const o of obstacles) {
      if (o.el && !o.keep && overlap(left, top, o.r) > 0) { o.el.classList.add('tut-hide'); hidden.push(o.el); }
    }
    Object.assign(card.style, { left: `${left}px`, top: `${top}px` });
  }

  async function go(next) {
    if (busy) return;
    busy = true;
    if (index >= 0) steps[index].after?.();
    index = next;
    if (index >= steps.length) { end(); return; }
    const step = steps[index];
    await step.before?.();
    layer.querySelector('.tut-text').innerHTML = typeof step.text === 'function' ? step.text() : step.text;
    layer.querySelector('.tut-count').textContent = `${index + 1} / ${steps.length}`;
    place();
    busy = false;
  }
  function end() {
    unhide();
    window.removeEventListener('resize', place);
    layer.remove();
    busy = false;
  }

  // every click anywhere moves on (the layer covers the page, so nothing underneath reacts)
  // Is this screen point on the map itself (not on a button, panel or control)?
  function onMap(x, y) {
    layer.style.pointerEvents = 'none';
    const el = document.elementFromPoint(x, y);
    layer.style.pointerEvents = '';
    return !!el?.closest('#map') && !el.closest('.leaflet-control, .zoom-bar, .panel, .leaflet-marker-icon');
  }

  layer.addEventListener('click', (e) => {
    if (e.target.closest('.tut-skip')) { steps[index]?.after?.(); end(); return; }
    if (steps[index]?.mapClick) {
      // only a click on the map counts here; it selects the point, then the tour goes on
      if (busy || e.target.closest('.tut-card') || !onMap(e.clientX, e.clientY)) return;
      if (app.selectAt(e.clientX, e.clientY)) go(index + 1);
      return;
    }
    go(index + 1);
  });
  window.addEventListener('resize', place);
  go(0);
}

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

async function runTour(app) {
  // the tour runs on the Mars map
  app.openBody('mars');
  await until(() => visible($('menu-btn')));
  await wait(400);

  const steps = [
    { target: () => [$('menu-btn')], text: '<strong>Click the View button.</strong> This is the View area.' },
    {
      before: async () => { app.openMenu(true); await wait(250); },
      target: () => [$('menu')],
      text: 'You can explore planet data and adjust the map projection.',
      after: () => app.openMenu(false),
    },
    {
      before: async () => {
        app.selectPoint(18.4, 77.5); // Jezero crater, Perseverance's landing site
        await until(() => visible($('area-panel')));
        const panel = $('area-panel');
        if (panel.classList.contains('collapsed')) $('area-collapse').click(); // phones
        await wait(500);
      },
      target: () => [$('area-panel'), document.querySelector('.radius-row')],
      text: '<strong>Click a point</strong> on the map. These are all the parameters around a selected area. '
        + 'You can select the radius manually.',
    },
    { target: () => [document.querySelector('.ruler-btn')], text: 'This is the <strong>ruler</strong> tool, meant to measure distance.' },
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
    targets.forEach((el) => {
      const r = el.getBoundingClientRect();
      const x = r.left - 6; const y = r.top - 6; const w = r.width + 12; const h = r.height + 12;
      path += `M${x} ${y}h${w}v${h}h${-w}Z`;
      const b = document.createElement('div');
      b.className = 'tut-spot';
      Object.assign(b.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
      layer.append(b);
      boxes.push(b);
    });
    layer.querySelector('.tut-shade').style.clipPath = `path(evenodd, '${path}')`;
    // card: below the first target if there's room, else above it, else in the middle
    const W = window.innerWidth; const H = window.innerHeight;
    const cw = Math.min(340, W - 24);
    card.style.width = `${cw}px`;
    const ch = card.offsetHeight;
    let left = (W - cw) / 2; let top = (H - ch) / 2;
    if (targets.length) {
      const r = targets[0].getBoundingClientRect();
      left = Math.min(Math.max(12, r.left + r.width / 2 - cw / 2), W - cw - 12);
      if (r.bottom + 18 + ch < H - 12) top = r.bottom + 18;
      else if (r.top - 18 - ch > 12) top = r.top - 18 - ch;
      else { // a tall target (a panel): beside it
        top = Math.min(Math.max(12, r.top), H - ch - 12);
        left = r.left > W / 2 ? Math.max(12, r.left - cw - 18) : Math.min(W - cw - 12, r.right + 18);
      }
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
    window.removeEventListener('resize', place);
    layer.remove();
    busy = false;
  }

  // every click anywhere moves on (the layer covers the page, so nothing underneath reacts)
  layer.addEventListener('click', (e) => {
    if (e.target.closest('.tut-skip')) { steps[index]?.after?.(); end(); return; }
    go(index + 1);
  });
  window.addEventListener('resize', place);
  go(0);
}

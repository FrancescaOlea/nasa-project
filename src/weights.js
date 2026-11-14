// The "how much should each characteristic count?" screen, shown before an
// analog / similar-spot search. Weights are relative: only their ratios matter.
import { VIEWS } from './overlays.js';

export const STEPS = [0, 0.5, 1, 2, 3];
export const DEFAULT_WEIGHT = 1;

// "slope:2,elevation:0.5" <-> { slope: 2, elevation: 0.5 }
export function parseWeights(text) {
  const out = {};
  for (const part of (text ?? '').split(',')) {
    const [k, v] = part.split(':');
    const w = Number(v);
    if (VIEWS[k] && STEPS.includes(w)) out[k] = w;
  }
  return out;
}
export const formatWeights = (w) => Object.entries(w).map(([k, v]) => `${k}:${v}`).join(',');

const fmt = (w) => (w === 0 ? 'off' : `×${w}`);

/**
 * Show the weights dialog. `layers` are the characteristics (view keys), or `items`
 * [{ key, name, help }] for any other list; `steps` the allowed weights; `initial` any
 * saved weights. With `mode` ({ value, options: [[id, label, help]] }) a switch is shown
 * above the list. Resolves with the chosen weights (plus `mode` when used), or null if
 * cancelled.
 */
export function askWeights({ heading, subheading, action, layers, items, steps = STEPS, initial = {}, mode = null, defaults = null, count = null }) {
  items ??= layers.map((k) => ({ key: k, name: VIEWS[k].name }));
  layers = items.map((it) => it.key);
  const dialog = document.getElementById('weights');
  const list = dialog.querySelector('.w-list');
  const go = dialog.querySelector('.w-go');
  const warning = dialog.querySelector('.w-warning');
  dialog.querySelector('.w-heading').textContent = heading;
  dialog.querySelector('.w-subheading').textContent = subheading;
  go.textContent = action;

  const weights = Object.fromEntries(layers.map((k) => [k, initial[k] ?? DEFAULT_WEIGHT]));
  const rows = items.map(({ key: k, name: label, help }) => {
    const row = document.createElement('div');
    row.className = 'w-row';
    row.innerHTML = `
      <label class="w-name"></label>
      <input type="range" min="0" max="${steps.length - 1}" step="1">
      <output class="w-value"></output>
      <span class="w-share"></span>`;
    const id = `w-${k}`;
    const name = row.querySelector('.w-name');
    name.textContent = label;
    if (help) {
      const small = document.createElement('small');
      small.textContent = help;
      name.append(small);
    }
    name.htmlFor = id;
    const input = row.querySelector('input');
    input.id = id;
    input.value = steps.indexOf(weights[k]);
    input.setAttribute('aria-valuetext', fmt(weights[k]));
    input.oninput = () => {
      weights[k] = steps[input.value];
      input.setAttribute('aria-valuetext', fmt(weights[k]));
      update();
    };
    return { k, row, input };
  });
  list.replaceChildren(...rows.map((r) => r.row));

  function update() {
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    for (const { k, row, input } of rows) {
      input.value = steps.indexOf(weights[k]);
      row.querySelector('.w-value').textContent = fmt(weights[k]);
      row.querySelector('.w-share').textContent = total > 0 ? `${Math.round((weights[k] / total) * 1000) / 10}%` : '–';
      row.classList.toggle('off', weights[k] === 0);
    }
    const badCount = count && !countOk();
    go.disabled = total === 0 || badCount;
    warning.hidden = total > 0 && !badCount;
    warning.textContent = total === 0 ? 'Turn on at least one characteristic to continue.'
      : `Choose between ${count?.min} and ${count?.max} places.`;
    countBox.classList.toggle('bad', !!badCount);
  }
  // optional switch (e.g. "Match my site" / "Most extreme")
  const modeBox = dialog.querySelector('.w-mode');
  let modeValue = mode?.value;
  let showMode = null;
  modeBox.hidden = !mode;
  if (mode) {
    const buttons = mode.options.map(([id, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.textContent = label;
      b.onclick = () => { modeValue = id; showMode(); };
      return b;
    });
    modeBox.querySelector('.w-mode-buttons').replaceChildren(...buttons);
    showMode = () => {
      mode.options.forEach(([id], i) => buttons[i].setAttribute('aria-checked', id === modeValue));
      modeBox.querySelector('.w-mode-help').textContent = mode.options.find(([id]) => id === modeValue)?.[2] ?? '';
    };
    showMode();
  }

  const reset = dialog.querySelector('.w-all-1');
  reset.textContent = defaults ? 'Defaults' : 'All ×1';
  // optional number of results (e.g. 1-10)
  const countBox = dialog.querySelector('.w-count');
  const countInput = countBox.querySelector('input');
  countBox.hidden = !count;
  const countOk = () => {
    const n = Number(countInput.value);
    return Number.isInteger(n) && n >= count.min && n <= count.max;
  };
  if (count) {
    countInput.min = count.min;
    countInput.max = count.max;
    countInput.value = count.value;
    countBox.querySelector('.w-count-help').textContent = `Whole number from ${count.min} to ${count.max}.`;
    countInput.oninput = () => update();
  }
  reset.onclick = () => {
    for (const k of layers) weights[k] = defaults?.[k] ?? 1;
    if (mode?.default) { modeValue = mode.default; showMode?.(); }
    if (count) countInput.value = count.default ?? count.value;
    update();
  };
  dialog.querySelector('.w-all-0').onclick = () => { for (const k of layers) weights[k] = 0; update(); };
  update();

  return new Promise((resolve) => {
    const finish = (result) => {
      dialog.onclose = null;
      dialog.close();
      resolve(result);
    };
    go.onclick = () => finish({ ...weights, ...(mode ? { mode: modeValue } : {}),
      ...(count ? { count: Number(countInput.value) } : {}) });
    dialog.querySelector('.w-cancel').onclick = () => finish(null);
    dialog.onclose = () => resolve(null); // Esc key
    dialog.showModal();
  });
}

// The "how much should each characteristic count?" screen, shown before an
// analog / similar-spot search. Weights are relative: only their ratios matter.
import { VIEWS } from './overlays.js';

export const STEPS = [0, 0.1, 0.5, 1, 2, 3, 5, 10];
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
 * Show the weights dialog. `layers` are the characteristics available for the
 * body (view keys); `initial` any saved weights. Resolves with the chosen
 * weights, or null if cancelled.
 */
export function askWeights({ heading, subheading, action, layers, initial = {} }) {
  const dialog = document.getElementById('weights');
  const list = dialog.querySelector('.w-list');
  const go = dialog.querySelector('.w-go');
  const warning = dialog.querySelector('.w-warning');
  dialog.querySelector('.w-heading').textContent = heading;
  dialog.querySelector('.w-subheading').textContent = subheading;
  go.textContent = action;

  const weights = Object.fromEntries(layers.map((k) => [k, initial[k] ?? DEFAULT_WEIGHT]));
  const rows = layers.map((k) => {
    const row = document.createElement('div');
    row.className = 'w-row';
    row.innerHTML = `
      <label class="w-name"></label>
      <input type="range" min="0" max="${STEPS.length - 1}" step="1">
      <output class="w-value"></output>
      <span class="w-share"></span>`;
    const id = `w-${k}`;
    const name = row.querySelector('.w-name');
    name.textContent = VIEWS[k].name;
    name.htmlFor = id;
    const input = row.querySelector('input');
    input.id = id;
    input.value = STEPS.indexOf(weights[k]);
    input.setAttribute('aria-valuetext', fmt(weights[k]));
    input.oninput = () => {
      weights[k] = STEPS[input.value];
      input.setAttribute('aria-valuetext', fmt(weights[k]));
      update();
    };
    return { k, row, input };
  });
  list.replaceChildren(...rows.map((r) => r.row));

  function update() {
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    for (const { k, row, input } of rows) {
      input.value = STEPS.indexOf(weights[k]);
      row.querySelector('.w-value').textContent = fmt(weights[k]);
      row.querySelector('.w-share').textContent = total > 0 ? `${Math.round((weights[k] / total) * 1000) / 10}%` : '–';
      row.classList.toggle('off', weights[k] === 0);
    }
    go.disabled = total === 0;
    warning.hidden = total > 0;
  }
  dialog.querySelector('.w-all-1').onclick = () => { for (const k of layers) weights[k] = 1; update(); };
  dialog.querySelector('.w-all-0').onclick = () => { for (const k of layers) weights[k] = 0; update(); };
  update();

  return new Promise((resolve) => {
    const finish = (result) => {
      dialog.onclose = null;
      dialog.close();
      resolve(result);
    };
    go.onclick = () => finish({ ...weights });
    dialog.querySelector('.w-cancel').onclick = () => finish(null);
    dialog.onclose = () => resolve(null); // Esc key
    dialog.showModal();
  });
}

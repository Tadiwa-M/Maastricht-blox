// A suggestion list under a text field (place search): type, see the best places, tap one. Works
// with touch, mouse and the keyboard (up/down, Enter, Escape). The picked place is kept on the
// input (input.place) until the text changes. DOM only; the search is places.js.

const CSS = `
.sg-list { position: absolute; z-index: 30; left: 0; right: 0; top: 100%; margin-top: 4px; background: #1d2247; border-radius: 10px;
  box-shadow: 0 8px 22px rgba(0,0,0,.45); overflow: hidden; font: 14px/1.3 system-ui, sans-serif; color: #f6f3ea; }
.sg-list[hidden] { display: none; }
.sg-item { padding: 9px 12px; cursor: pointer; display: flex; gap: 8px; align-items: baseline; }
.sg-item:hover, .sg-item.on { background: #2c335f; }
.sg-item .k { color: #aeb2c6; font-size: 12px; margin-left: auto; white-space: nowrap; }
.sg-wrap { position: relative; flex: 1 1 0; min-width: 0; display: flex; }
`;
const ICON = { stop: '🚏', station: '🚉', poi: '📍', landmark: '🏛️', street: '🛣️', address: '🏠', park: '🌳' };
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let styled = false;

/**
 * Attach suggestions to `input`. getIndex() -> PlaceIndex (or null while loading); onPick(place)
 * after a pick. Returns { close }.
 */
export function attachSuggest(input, getIndex, onPick = () => {}) {
  if (!styled && typeof document !== 'undefined') { document.head.append(Object.assign(document.createElement('style'), { textContent: CSS })); styled = true; }
  const wrap = document.createElement('div');
  wrap.className = 'sg-wrap';
  input.replaceWith(wrap);
  wrap.append(input);
  input.removeAttribute('list');
  input.setAttribute('autocomplete', 'off');
  const list = Object.assign(document.createElement('div'), { className: 'sg-list', hidden: true });
  wrap.append(list);
  let items = [], on = -1;

  function render() {
    list.innerHTML = items.map((p, i) => `<div class="sg-item${i === on ? ' on' : ''}" data-i="${i}"><span>${ICON[p.kind] || '📍'}</span>
      <span>${esc(p.name)}</span><span class="k">${esc(p.sub)}</span></div>`).join('');
    list.hidden = !items.length;
  }
  function pick(i) {
    const p = items[i];
    if (!p) return;
    input.value = p.name; input.place = p;
    items = []; on = -1; render();
    onPick(p);
  }
  input.addEventListener('input', () => {
    input.place = null;
    const idx = getIndex();
    items = idx ? idx.search(input.value, 8) : [];
    on = -1; render();
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // typing must not walk the player
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { on = Math.min(items.length - 1, on + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { on = Math.max(0, on - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter' && on >= 0) { pick(on); e.preventDefault(); }
    else if (e.key === 'Escape') { items = []; render(); }
  });
  list.addEventListener('pointerdown', (e) => { const el = e.target.closest('.sg-item'); if (el) { e.preventDefault(); pick(+el.dataset.i); } });
  input.addEventListener('blur', () => setTimeout(() => { items = []; render(); }, 150));
  return { close: () => { items = []; render(); } };
}

/** The place for an input: the one picked, else the best match of its text (or null). */
export function resolvePlace(input, index) {
  if (input.place) return input.place;
  const t = input.value.trim();
  return t && index ? index.search(t, 1)[0] || null : null;
}

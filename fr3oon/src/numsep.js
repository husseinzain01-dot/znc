// Thousands separators in the amount boxes (prices, payments, balances):
// 1500000 shows as 1,500,000 while it is typed. Every box with
// inputmode="numeric" gets them, unless it says data-plain (invoice numbers,
// copy counts). Whoever reads such a box drops the commas first.

const BOX = 'input[inputmode="numeric"]:not([data-plain])';

// "1500000.5" → "1,500,000.5"; anything but digits, one minus and one point goes
export function groupDigits(text) {
  let s = String(text ?? '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[^\d.-]/g, '');
  const neg = s.startsWith('-');
  s = s.replace(/-/g, '');
  const dot = s.indexOf('.');
  let int = dot < 0 ? s : s.slice(0, dot);
  const frac = dot < 0 ? '' : '.' + s.slice(dot + 1).replace(/\./g, '');
  int = int.replace(/^0+(?=\d)/, '');
  return (neg ? '-' : '') + int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + frac;
}

function format(el) {
  const old = el.value;
  const next = groupDigits(old);
  if (next === old) return;
  // keep the caret after the same digit it followed
  const caret = el === document.activeElement ? el.selectionStart : null;
  const digitsBefore = caret == null ? 0 : old.slice(0, caret).replace(/[^\d٠-٩.-]/g, '').length;
  el.value = next;
  if (caret == null) return;
  let pos = 0;
  for (let seen = 0; pos < next.length && seen < digitsBefore; pos++) if (/[\d.-]/.test(next[pos])) seen++;
  try {
    el.setSelectionRange(pos, pos);
  } catch {
    /* not focused any more */
  }
}

function formatIn(node) {
  if (node.nodeType !== 1) return;
  if (node.matches(BOX)) format(node);
  node.querySelectorAll?.(BOX).forEach(format);
}

export function setupNumberSeparators(root = document) {
  // typed, pasted or scanned: in the capture phase, so the box's own handler
  // already sees the grouped text
  root.addEventListener('input', (e) => e.target.matches?.(BOX) && format(e.target), true);
  // a value put in by code (a unit change, a price filled in) changes it too
  root.addEventListener('change', (e) => e.target.matches?.(BOX) && format(e.target), true);
  // boxes drawn with a plain number in them
  new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach(formatIn))).observe(root.body || root, { childList: true, subtree: true });
  formatIn(root.body || root);
}

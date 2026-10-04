// Barcode scanners type the code very fast and press Enter. Wherever the
// focus happens to be (an item button, the quantity box, the customer
// box…), a scan should add the item, not click the button again or end up
// in the quantity. Typed by hand (slower), keys behave as usual.
//
// getTarget() says where scans go right now: { input, onScan(code) }, or
// null to leave the keyboard alone.

const FAST_MS = 35; // average time between a scanner's keys
const GAP_MS = 80; // longer pause: a new burst starts

const isText = (el) =>
  el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|file|range|color)$/i.test(el.type)));

export function installScanner(getTarget) {
  let buf = '';
  let first = 0;
  let last = 0;
  let startEl = null;
  let snapshot = null;
  const reset = () => {
    buf = '';
    startEl = null;
    snapshot = null;
  };

  document.addEventListener(
    'keydown',
    (e) => {
      if (!e.isTrusted || e.ctrlKey || e.altKey || e.metaKey) return reset();
      const t = getTarget();
      if (!t || !t.input) return reset();
      const now = performance.now();
      if (e.key === 'Enter') {
        const scanned = buf.length >= 3 && (now - first) / buf.length < FAST_MS;
        // keys that landed on a button went to the box below; their Enter
        // must not click that button
        const redirected = buf && !isText(startEl);
        if (scanned || redirected) {
          e.preventDefault();
          e.stopPropagation();
          // put back what the scan typed into another box (quantity, price…)
          if (scanned && isText(startEl) && startEl !== t.input && snapshot != null) {
            startEl.value = snapshot;
            startEl.dispatchEvent(new Event('input', { bubbles: true }));
          }
          const code = buf;
          reset();
          t.input.value = '';
          t.input.dispatchEvent(new Event('input', { bubbles: true }));
          t.input.focus();
          t.onScan(code);
          return;
        }
        return reset();
      }
      if (e.key === 'Shift') return;
      if (e.key.length !== 1) return reset();
      if (buf && now - last > GAP_MS) reset();
      if (!buf) {
        first = now;
        startEl = e.target;
        snapshot = isText(startEl) ? startEl.value : null;
      }
      buf += e.key;
      last = now;
      // typing while a button or a list has the focus: into the search box
      if (!isText(e.target)) {
        e.preventDefault();
        t.input.focus();
        t.input.value += e.key;
        t.input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    },
    true,
  );
}

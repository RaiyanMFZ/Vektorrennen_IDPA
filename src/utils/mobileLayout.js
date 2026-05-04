// RM
/**
 * Mobile / Tablet (pointer: coarse): Im Hochformat Vollbild-Hinweis „Quer halten“
 * inkl. portrait-lock — für Start, Lobby, Join und Rennen einheitlich.
 * Optional screen.orientation.lock nach User-Geste.
 */

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function isPortrait() {
  if (window.matchMedia('(orientation: portrait)').matches) return true;
  return window.innerHeight > window.innerWidth;
}

function isCoarsePointer() {
  return window.matchMedia('(pointer: coarse)').matches;
}

function updateLandscapeHint() {
  const el = document.getElementById('landscape-hint');
  if (!el) return;
  const portrait = isPortrait();
  const show = portrait && isCoarsePointer();
  el.classList.toggle('hidden', !show);
  document.body.classList.toggle('portrait-lock', show);
}

let lockTried = false;

/** Nach Nutzerinteraktion (Klick/Touch): Landscape lock wo der Browser es erlaubt. */
export function tryLockLandscapeOrientation() {
  if (lockTried) return;
  const o = screen.orientation;
  if (!o || typeof o.lock !== 'function') return;
  lockTried = true;
  o.lock('landscape').catch(() => {
    lockTried = false;
  });
}

export function initMobileLayout() {
  updateLandscapeHint();
  const onChange = debounce(updateLandscapeHint, 120);
  window.addEventListener('resize', onChange);
  window.addEventListener('orientationchange', () => setTimeout(updateLandscapeHint, 200));
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onChange);
  }

  document.addEventListener(
    'pointerdown',
    () => tryLockLandscapeOrientation(),
    { passive: true, capture: true, once: true }
  );
}

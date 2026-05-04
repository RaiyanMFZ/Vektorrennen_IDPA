// OP / RM
/**
 * InputManager - Verwaltet alle Eingaben (Tastatur + Touch-Buttons).
 * 
 * Tastatursteuerung:
 *   W / ArrowUp    → Gas geben
 *   S / ArrowDown  → Bremsen / Rückwärts
 *   A / ArrowLeft  → Links lenken
 *   D / ArrowRight → Rechts lenken
 * 
 * Mobile Steuerung:
 *   Touch-Buttons im Spielfeld unten rechts (D-Pad)
 */
export class InputManager {
  constructor() {
    this.keys = {
      w: false,
      a: false,
      s: false,
      d: false
    };

    this.bindEvents();
  }

  bindEvents() {
    // ─── Tastatursteuerung ────────────────────────────────────────────────────
    window.addEventListener('keydown', (e) => {
      // Tastatur nicht stehlen, wenn Nutzer in Formularfeldern tippt (Chat, Namen, …)
      const ae = document.activeElement;
      const tag = ae && ae.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        return;
      }

      // Pfeiltasten-Scroll verhindern
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) {
        e.preventDefault();
      }

      switch (e.key.toLowerCase()) {
        case 'w': case 'arrowup':    this.keys.w = true; break;
        case 's': case 'arrowdown':  this.keys.s = true; break;
        case 'a': case 'arrowleft':  this.keys.a = true; break;
        case 'd': case 'arrowright': this.keys.d = true; break;
      }
    });

    window.addEventListener('keyup', (e) => {
      switch (e.key.toLowerCase()) {
        case 'w': case 'arrowup':    this.keys.w = false; break;
        case 's': case 'arrowdown':  this.keys.s = false; break;
        case 'a': case 'arrowleft':  this.keys.a = false; break;
        case 'd': case 'arrowright': this.keys.d = false; break;
      }
    });

    // ─── Touch / Maus-Buttons ─────────────────────────────────────────────────
    const touchBtns = {
      'btn-up':    'w',
      'btn-down':  's',
      'btn-left':  'a',
      'btn-right': 'd'
    };

    for (const [id, key] of Object.entries(touchBtns)) {
      const btn = document.getElementById(id);
      if (!btn) continue;

      const setKey = (val) => {
        this.keys[key] = val;
        if (val) btn.classList.add('pressed');
        else     btn.classList.remove('pressed');
      };

      // Touch (Mobile)
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        setKey(true);
      }, { passive: false });

      btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        setKey(false);
      }, { passive: false });

      btn.addEventListener('touchcancel', () => setKey(false));

      // Maus (Desktop-Test)
      btn.addEventListener('mousedown',  () => setKey(true));
      btn.addEventListener('mouseup',    () => setKey(false));
      btn.addEventListener('mouseleave', () => setKey(false));
    }
  }

  /** Nach Lobby / vor GO: keine „klebenden“ Tasten aus der Menüphase */
  resetKeys() {
    this.keys.w = false;
    this.keys.a = false;
    this.keys.s = false;
    this.keys.d = false;
    for (const id of ['btn-up', 'btn-down', 'btn-left', 'btn-right']) {
      const btn = document.getElementById(id);
      if (btn) btn.classList.remove('pressed');
    }
  }

  getInputs(enabled = true) {
    if (!enabled) {
      return { accelerate: false, brake: false, left: false, right: false };
    }
    return {
      accelerate: this.keys.w,
      brake: this.keys.s,
      left: this.keys.a,
      right: this.keys.d
    };
  }
}

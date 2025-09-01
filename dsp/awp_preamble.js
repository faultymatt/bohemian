/* PREAMBLE v3: ensure `self` / `window` / `location` exist in AudioWorklet scope */
/* eslint-disable no-var, no-redeclare */
var self   = (typeof self   !== 'undefined') ? self   : (typeof globalThis !== 'undefined' ? globalThis : this);
var window = (typeof window !== 'undefined') ? window : self;

// Emscripten が self.location.href を参照する場合がある → 無い実装ではダミーを付与
try {
  if (typeof self.location === 'undefined') { self.location = { href: '' }; }
} catch (e) { /* ignore */ }

// ついでに `location` 変数も同じものを指すように
var location = (typeof location !== 'undefined') ? location : self.location;
/* eslint-enable no-var, no-redeclare */

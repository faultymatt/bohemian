// audio/engine.js
// Bohemian audio engine — poly synth (2 wavetable slots), FX (WASM reverb), meter

// ===== Engine state =====
let ctx;
let master, dry, wet, out;
let analyser;
let shaper;          // light distortion (pre-reverb)
let wasmRev = null;  // AudioWorkletNode (WASM Reverb)

// Synth params (shared across voices)
const SLOT_COUNT = 2;
const slotParams = [
  { shape: 'sine',  gain: 0.5, pitch: { oct:0, sem:0, fin:0, crs:0 } },
  { shape: 'saw',   gain: 0.5, pitch: { oct:0, sem:0, fin:0, crs:0 } },
];

// Active voices by MIDI note number
const voices = new Map();

// ===== Utilities =====
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// 押しっぱなし保険：keyupが欠落してもこれ以上鳴らさない
const MAX_HOLD_MS = 1800; // 1.8秒（好みで調整）

// Convert slot pitch offsets into cents
function slotCents(slot) {
  const p = slotParams[slot]?.pitch || { oct:0, sem:0, fin:0, crs:0 };
  return (p.oct * 1200) + (p.sem * 100) + (p.crs) + (p.fin); // all in cents
}

// Create oscillator for a slot with given frequency
function makeOsc(shape, freq) {
  const osc = ctx.createOscillator();
  osc.type = (shape === 'saw' ? 'sawtooth' : (shape === 'square' ? 'square' : 'sine'));
  osc.frequency.value = freq;
  return osc;
}

function emitPoly() {
  const n = voices.size;
  dispatchEvent(new CustomEvent('bohemian:polychange', { detail: { count: n }}));
  window.__polyCount = n;
}
export function getPolyCount() { return voices.size; }

// ===== Voice class =====
// リリース・定数
const ATTACK_S = 0.003;
const RELEASE_S = 0.06;  // ここは好み

class Voice {
  constructor(midi) {
    this.midi = midi;
    this.freqBase = midiToHz(midi);
    this.g = ctx.createGain();
    this.g.gain.value = 0.0001;  // デノーマル回避用に必ず極小値以上
    this.oscs = [];
    this.slotGains = [];
    this._stops = [];      // 予約された stop 時刻を管理
    this._alive = true;

    for (let s = 0; s < SLOT_COUNT; s++) {
      const cents = slotCents(s);
      const f = this.freqBase * Math.pow(2, cents / 1200);
      const osc = makeOsc(slotParams[s].shape, f);
      const sg  = ctx.createGain(); sg.gain.value = slotParams[s].gain;
      osc.connect(sg).connect(this.g);
      osc.start();
      this.oscs.push(osc); this.slotGains.push(sg);
    }

    this.g.connect(master);
    this._attack();    // 初回アタック
  }

  _attack() {
    const t = ctx.currentTime;
    // 直前の全オートメーション＆stop予約をキャンセル
    this._cancelStops();
    this.g.gain.cancelScheduledValues(t);
    this.g.gain.setValueAtTime(Math.max(this.g.gain.value, 0.0001), t);
    this.g.gain.linearRampToValueAtTime(1.0, t + ATTACK_S);
  }

  retrigger() { this._attack(); }

  noteOff() {
    if (!this._alive) return;
    const t = ctx.currentTime;
    const end = t + RELEASE_S;

    // 先にゲインを確実に下げ切る（0にはしない: 1e-5）
    this.g.gain.cancelScheduledValues(t);
    this.g.gain.setTargetAtTime(0.00001, t, RELEASE_S / 3);

    // すべてのOscを "オーディオ時間" で停止予約
    for (const osc of this.oscs) {
      try { osc.stop(end); } catch(_) {}
    }
    this._stops.push(end);
    // “物理切断” は stop 後の安全サイドで
    this._armCleanup(end + 0.02);
  }

  updateForSlot(slot) {
    const cents = slotCents(slot);
    const f = this.freqBase * Math.pow(2, cents / 1200);
    const osc = this.oscs[slot];
    osc.type  = (slotParams[slot].shape === 'saw' ? 'sawtooth' :
                (slotParams[slot].shape === 'square' ? 'square' : 'sine'));
    osc.frequency.setValueAtTime(f, ctx.currentTime);
    this.slotGains[slot].gain.setValueAtTime(clamp(slotParams[slot].gain, 0, 1), ctx.currentTime);
  }

  _armCleanup(atAudioTime) {
    // requestAnimationFrame で “オーディオ時間” を監視して安全に破棄
    const check = () => {
      if (!this._alive) return;
      if (ctx.currentTime >= atAudioTime) {
        this.dispose();
        return;
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }

  _cancelStops() {
    // retrigger時に stop 予約が残っていたら無効化（新規アタックを殺さない）
    this._stops.length = 0;
  }

  dispose() {
    if (!this._alive) return;
    this._alive = false;
    try {
      for (const o of this.oscs) { try { o.disconnect(); } catch(_) {} }
      this.g.disconnect();
    } catch(_) {}
  }
}


// ===== FX wiring =====
async function setupFxChain() {
  out = ctx.createGain();     out.gain.value = 1.0;
  dry = ctx.createGain();     dry.gain.value = 1.0;
  wet = ctx.createGain();     wet.gain.value = 0.5;
  master = ctx.createGain();  master.gain.value = 0.9;

  master.connect(dry).connect(out);
  master.connect(wet);
  out.connect(ctx.destination);
  wet.connect(out);

  shaper = ctx.createWaveShaper();
  function makeCurve(amount){
    const n=2048, c=new Float32Array(n); const k=amount*100;
    for (let i=0;i<n;i++){ const x=i/(n-1)*2-1; c[i]=(1+k)*x/(1+k*Math.abs(x)); }
    return c;
  }
  shaper.curve = makeCurve(0.15);
  shaper.oversample = '4x';

  try {
    await ctx.audioWorklet.addModule('dsp/reverb-worklet.js');
    wasmRev = new AudioWorkletNode(ctx, 'wasm-reverb', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2]
    });
    master.disconnect();
    master.connect(shaper).connect(wasmRev).connect(wet);
    master.connect(dry);

    wasmRev.port.onmessage = (e) => {
      if (e.data?.ready) console.debug('[FX] Reverb ready');
      if (e.data?.error) console.error('[FX] Reverb error:', e.data.error);
    };
  } catch (err) {
    console.warn('[FX] Reverb worklet failed, bypassing reverb:', err);
    master.disconnect();
    master.connect(shaper).connect(wet);
    master.connect(dry);
  }

  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  out.connect(analyser);

  window.__bohemianAnalyser = analyser;

  window.__setFx = {
    reverb: ({ size, damp, mix } = {}) => {
      if (mix  != null) wet.gain.value = clamp(+mix, 0, 1);
      if (wasmRev && (size != null || damp != null || mix != null)) {
        wasmRev.port.postMessage({
          room: (size != null ? clamp(+size, 0.1, 4.0)   : undefined),
          damp: (damp != null ? clamp(+damp, 0.0, 0.99)  : undefined),
          mix:  (mix  != null ? clamp(+mix,  0.0, 1.0)   : undefined),
        });
      }
    }
  };
}

// ===== Public API =====
export async function initAudioEngine() {
  if (ctx) return { ctx, noteOn, noteOff };
  ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  await setupFxChain();
  startVoiceSweeper();

  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') panic();
  });
  addEventListener('blur', () => panic());

  window.__bohemianCtx = ctx;
  window.__bohemianMaster = master;
  return { ctx, noteOn, noteOff };
}

export function noteOn(midi) {
  if (!ctx) return;
  if (voices.has(midi)) return;      // ← すでに鳴ってたら発火しない
  const v = new Voice(midi);
  voices.set(midi, v);
  emitPoly();                        // Poly = 押してる数
}

export function noteOff(midi) {
  const v = voices.get(midi);
  if (!v) return;
  v.noteOff();                       // 内部はすぐ無音に
  voices.delete(midi);               // ← 即座にカウントを戻す
  emitPoly();
}

export function panic() {
  if (!ctx) return;
  voices.forEach((v) => {
    try {
      v.g.gain.cancelScheduledValues(ctx.currentTime);
      v.g.gain.value = 0;
      v.dispose();
    } catch (_) {}
  });
  voices.clear();
  emitPoly();
}
if (typeof window !== 'undefined') window.__panic = panic;

// ==== Voice sweeper ====
const MAX_VOICE_MS   = 8000;
const SWEEP_MS       = 300;
let sweepTimer = null;

function startVoiceSweeper() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = performance.now();
    let changed = false;
    voices.forEach((v, midi) => {
      if (!v._envActive && v._killTimer == null) return;
      if (now - v._born > MAX_VOICE_MS) {
        try { v.dispose(); } catch (_) {}
        voices.delete(midi);
        changed = true;
      }
    });
    if (changed) emitPoly();
  }, SWEEP_MS);
}

// ===== Wave / pitch setters =====
export function setWaveShape(slot, shape) {
  const s = clamp(slot|0, 0, SLOT_COUNT-1);
  const shp = (shape === 'saw' ? 'saw' : (shape === 'square' ? 'square' : 'sine'));
  slotParams[s].shape = shp;
  voices.forEach(v => v.updateForSlot(s));
}

export function setWaveMix(slot, gain) {
  const s = clamp(slot|0, 0, SLOT_COUNT-1);
  slotParams[s].gain = clamp(+gain, 0, 1);
  voices.forEach(v => v.updateForSlot(s));
}

export function setSlotPitch(slot, { oct, sem, fin, crs } = {}) {
  const s = clamp(slot|0, 0, SLOT_COUNT-1);
  const p = slotParams[s].pitch;
  if (oct != null) p.oct = (oct|0);
  if (sem != null) p.sem = (sem|0);
  if (fin != null) p.fin = (+fin|0);
  if (crs != null) p.crs = (+crs|0);
  voices.forEach(v => v.updateForSlot(s));
}

// ===== FX UI binding =====
export function bindFxUI({ sizeId='fx-size', dampId='fx-damp', mixId='fx-mix' } = {}) {
  const sizeEl = document.getElementById(sizeId);
  const dampEl = document.getElementById(dampId);
  const mixEl  = document.getElementById(mixId);

  const onInput = () => {
    window.__setFx?.reverb({
      size: sizeEl ? +sizeEl.value : undefined,
      damp: dampEl ? +dampEl.value : undefined,
      mix:  mixEl  ? +mixEl.value  : undefined,
    });
  };
  if (sizeEl) sizeEl.oninput = onInput;
  if (dampEl) dampEl.oninput = onInput;
  if (mixEl)  mixEl.oninput  = onInput;
  onInput();
}

export function getAnalyser() { return analyser; }

// ---- Export API ----
const api = {
  initAudioEngine,
  noteOn,
  noteOff,
  setWaveShape,
  setWaveMix,
  setSlotPitch,
  bindFxUI,
  getAnalyser,
};
if (typeof window !== 'undefined') {
  window.__setPitch = (slot, params) => {
    try { setSlotPitch(slot, params); } catch (_) {}
  };
}
export default api;
export { api as engine };
window.engine = api;

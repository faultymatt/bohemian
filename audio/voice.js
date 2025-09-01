// voice.js — safer voices (retrigger, audio-time stops, correct pitch math, safety killer)

export class VoiceManager {
  constructor(ctx, out, wavetableSlots, { lfo } = {}) {
    this.ctx = ctx; this.out = out; this.slots = wavetableSlots;
    this.slotGains = [0.5, 0.5];
    this.pitch = [
      { oct:0, sem:0, fin:0, crs:0 },
      { oct:0, sem:0, fin:0, crs:0 },
    ];
    this.maxPoly = 8;
    this.voices = new Map();
    this.lfo = lfo || null; // {osc,out,target}

    this._startSweeper();
  }

  setSlotGain(slot, g) {
    this.slotGains[slot] = Math.min(1, Math.max(0, g));
    // 生存中のボイスに反映
    for (const v of this.voices.values()) v.updateGains(this.slotGains);
  }

  setPitch(slot, p) {
    this.pitch[slot] = { ...this.pitch[slot], ...p };
    this.updateAllFrequencies();
  }

  setMaxPoly(n) {
    this.maxPoly = Math.min(32, Math.max(1, n|0));
  }

  activeCount() { return this.voices.size; }

  // ===== Note handling =====
  noteOn(midi) {
    let v = this.voices.get(midi);
    if (v) {
      v.retrigger();                    // ★ 既存ボイスを再アタック
    } else {
      // 簡易ボイススティール（最古）
      if (this.voices.size >= this.maxPoly) {
        const [oldKey, oldest] = this.voices.entries().next().value;
        oldest.forceStop(() => this.voices.delete(oldKey));
      }
      v = new Voice(this.ctx, this.out, this.slots, this.slotGains, this.pitch, midi);
      if (this.lfo) v.applyLfo(this.lfo);
      v.start();
      this.voices.set(midi, v);
    }
    this._emitPoly();
  }

  noteOff(midi) {
    const v = this.voices.get(midi);
    if (!v) return;
    v.stop(() => {
      this.voices.delete(midi);
      this._emitPoly();
    });
  }

  // LFO / Pitch live updates
  refreshLfoRouting() { if (!this.lfo) return; for (const v of this.voices.values()) v.applyLfo(this.lfo); }
  updateAllFrequencies() { for (const v of this.voices.values()) v.updatePitch(this.pitch); }

  // ===== Safety & UX =====
  panic() {
    for (const [k, v] of this.voices.entries()) v.forceStop(() => this.voices.delete(k));
    this._emitPoly();
  }

  _emitPoly() {
    const n = this.activeCount();
    const o = document.getElementById('poly-out'); if (o) o.textContent = String(n);
    dispatchEvent(new CustomEvent('bohemian:polychange', { detail: { count: n }}));
  }

  _startSweeper() {
    if (this._sweep) return;
    const SWEEP_MS = 250;
    this._sweep = setInterval(() => {
      let changed = false;
      for (const [m, v] of this.voices.entries()) {
        if (!v.alive) { this.voices.delete(m); changed = true; }
      }
      if (changed) this._emitPoly();
    }, SWEEP_MS);

    // ページ遷移・フォーカス喪失の保険
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.panic();
    });
    addEventListener('blur', () => this.panic());
  }
}

class Voice {
  constructor(ctx, out, slots, slotGains, pitch, midi) {
    this.ctx = ctx; this.out = out; this.midi = midi; this.pitch = pitch;
    this.gain = ctx.createGain(); this.gain.gain.value = 0.0001; // デノーマル回避
    this.gain.connect(out);

    // build 2-slot osc chain
    this.oscs = slots.map((slot, i) => {
      const osc = ctx.createOscillator();
      if (slot?.wave) osc.setPeriodicWave(slot.wave);
      else osc.type = i === 0 ? 'sine' : 'sawtooth';
      const g = ctx.createGain(); g.gain.value = slotGains[i];
      osc.connect(g).connect(this.gain);
      return { osc, g, slot: i };
    });

    this._armedStopAt = null;
    this._cleanupArmed = false;
    this._alive = true;
    this._bornT = ctx.currentTime;

    // 自動安全キル（長鳴き保険）
    this._maxLifeSec = 8.0;
  }

  get alive() { return this._alive; }

  start() {
    const t = this.ctx.currentTime;
    this.updatePitch(this.pitch);
    for (const { osc } of this.oscs) osc.start(t);

    // ADS (超シンプル)
    const A = 0.003, D = 0.06, S = 0.85;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(Math.max(this.gain.gain.value, 0.0001), t);
    this.gain.gain.linearRampToValueAtTime(1.0, t + A);
    this.gain.gain.linearRampToValueAtTime(S, t + A + D);

    // 自動キル予約（AudioTime基準）
    const killAt = this._bornT + this._maxLifeSec;
    this._armCleanup(killAt);
  }

  retrigger() {
    // 既存の stop 予約を無効化し、即再アタック
    this._armedStopAt = null;
    const t = this.ctx.currentTime;
    const A = 0.003;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(Math.max(this.gain.gain.value, 0.0001), t);
    this.gain.gain.linearRampToValueAtTime(1.0, t + A);
    this._bornT = t; // 寿命もリセット
    this._armCleanup(t + this._maxLifeSec);
  }

  stop(done) {
    if (!this._alive) { done?.(); return; }
    const t = this.ctx.currentTime;
    const R = 0.08;
    // ゲインは 0 ではなく極小まで（残留/デノーマル対策）
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(0.00001, t, R / 3);

    // Oscillator はオーディオ時間で停止予約
    const end = t + R;
    for (const { osc } of this.oscs) {
      try { osc.stop(end); } catch {}
    }
    this._armCleanup(end + 0.02, done); // 物理切断は安全時間後
  }

  forceStop(done) {
    if (!this._alive) { done?.(); return; }
    const t = this.ctx.currentTime + 0.01;
    try {
      this.gain.gain.cancelScheduledValues(t);
      this.gain.gain.setValueAtTime(0.00001, t);
    } catch {}
    for (const { osc } of this.oscs) {
      try { osc.stop(t); } catch {}
    }
    this._armCleanup(t + 0.02, done);
  }

  updatePitch(pitch) {
    const base = 440 * Math.pow(2, (this.midi - 69) / 12);
    const t = this.ctx.currentTime;
    this.oscs.forEach(({ osc, slot }) => {
      const p = pitch[slot] || { oct:0, sem:0, fin:0, crs:0 };
      // ★ CRS は “粗ピッチ=cent”、SEM は半音
      const semis = (p.oct|0) * 12 + (p.sem|0);
      const cents = (p.fin|0) + (p.crs|0);
      const freq = base
        * Math.pow(2, semis / 12)
        * Math.pow(2, cents / 1200);
      osc.frequency.setValueAtTime(freq, t);
    });
  }

  updateGains(slotGains) {
    const t = this.ctx.currentTime;
    this.oscs.forEach(({ g }, i) => {
      g.gain.setValueAtTime(Math.min(1, Math.max(0, slotGains[i] ?? 0.5)), t);
    });
  }

  applyLfo(lfo) { // LFO out(cents) → detune(cents)
    this.oscs.forEach(({ osc }) => { try { lfo.out.disconnect(osc.detune); } catch {} });
    const target = lfo.target || 'both';
    this.oscs.forEach(({ osc, slot }) => {
      if (target === 'both' || (target === 'a' && slot === 0) || (target === 'b' && slot === 1)) {
        try { lfo.out.connect(osc.detune); } catch {}
      }
    });
  }

  _armCleanup(atAudioTime, done) {
    this._armedStopAt = atAudioTime;
    if (this._cleanupArmed) return;
    this._cleanupArmed = true;

    const tick = () => {
      if (!this._alive) return; // 既に破棄済み
      const now = this.ctx.currentTime;
      // stop 予約経過 or 安全寿命超過
      if ((this._armedStopAt && now >= this._armedStopAt) || now >= this._bornT + this._maxLifeSec) {
        this._dispose();
        done?.();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  _dispose() {
    if (!this._alive) return;
    this._alive = false;
    try { for (const { osc, g } of this.oscs) { try { osc.disconnect(); } catch{} try{ g.disconnect(); }catch{} } } catch{}
    try { this.gain.disconnect(); } catch {}
  }
}

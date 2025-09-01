// dsp/reverb-worklet.js
// Minimal stereo reverb (FDN-ish) for verification. Params via port: {room,damp,mix}
class SimpleReverb extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready = true;

    // params
    this.room = 1.6; // 0.2..4
    this.damp = 0.2; // 0..0.99
    this.mix  = 0.35; // 0..1

    // simple delay network (sample-rate agnostic)
    const sr = sampleRate;
    const ms = m => Math.max(1, Math.floor(m * sr / 1000));

    // 4 comb per channel + 1 allpass per channel (軽量)
    this.delayL = [
      new Delay(ms(29.7)), new Delay(ms(37.1)),
      new Delay(ms(41.1)), new Delay(ms(43.7))
    ];
    this.delayR = [
      new Delay(ms(30.3)), new Delay(ms(33.9)),
      new Delay(ms(39.7)), new Delay(ms(45.1))
    ];
    this.apL = new Allpass(ms(7.5), 0.7);
    this.apR = new Allpass(ms(6.3), 0.7);

    // feedback gains（roomに連動）
    this._updateFeedback();

    // messages
    this.port.onmessage = (e) => {
      const { room, damp, mix } = e.data || {};
      if (room != null) { this.room = clamp(+room, 0.2, 4.0); this._updateFeedback(); }
      if (damp != null) { this.damp = clamp(+damp, 0.0, 0.99); }
      if (mix  != null) { this.mix  = clamp(+mix,  0.0, 1.0); }
      this.port.postMessage({ ack: { room: this.room, damp: this.damp, mix: this.mix } });
    };

    // announce
    this.port.postMessage({ ready: true });
  }

  _updateFeedback() {
    // room 0.2..4.0 -> fb 0.6..0.93 程度
    const fb = 0.55 + 0.1 * Math.log2(this.room + 1); // 滑らかに
    this.fb = clamp(fb, 0.6, 0.93);
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const out = outputs[0];
    if (!out) return true;

    const L = input[0] || silence;
    const R = input[1] || L;
    const oL = out[0];
    const oR = out[1] || oL;

    const N = oL.length;
    const dryMix = 1 - this.mix;
    const wetMix = this.mix;
    const fb = this.fb;
    const damp = this.damp;

    for (let i = 0; i < N; i++) {
      // comb network
      let accL = 0, accR = 0;
      for (let j = 0; j < 4; j++) {
        accL += this.delayL[j].tick(L[i], fb, damp);
        accR += this.delayR[j].tick(R[i], fb, damp);
      }
      // allpass smoothing
      const rl = this.apL.tick(accL);
      const rr = this.apR.tick(accR);

      // mix
      oL[i] = L[i] * dryMix + rl * wetMix;
      oR[i] = R[i] * dryMix + rr * wetMix;
    }

    return true;
  }
}

const silence = new Float32Array(128);

class Delay {
  constructor(len) {
    this.buf = new Float32Array(len);
    this.len = len;
    this.w = 0;
    this.lp = 0; // simple one-pole for damp
  }
  tick(x, fb, damp) {
    // read
    const r = (this.w + 1) % this.len;
    const y = this.buf[r];

    // one-pole lowpass inside feedback path (damping)
    this.lp = this.lp + damp * (y - this.lp);
    const fbIn = x + this.lp * fb;

    // write
    this.buf[this.w] = fbIn;
    this.w = r;

    return y;
  }
}

class Allpass {
  constructor(len, g) {
    this.buf = new Float32Array(len);
    this.len = len;
    this.g = g;
    this.w = 0;
  }
  tick(x) {
    const r = (this.w + 1) % this.len;
    const y = this.buf[r];
    const out = -this.g * x + y;
    this.buf[this.w] = x + this.g * y;
    this.w = r;
    return out;
  }
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

registerProcessor('wasm-reverb', SimpleReverb); // 同じ名前で登録（engine側を変えない）

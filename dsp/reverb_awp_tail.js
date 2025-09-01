// === tail: AudioWorklet wrapper around ReverbModuleFactory (init-safe) ===
class WasmReverbProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return []; }

  constructor() {
    super();
    this.ready = false;
    this.frame = 128;

    const start = (mod) => {
      const init = () => {
        try {
          this.mod = mod;
          this._bind(mod);
          this.c_init(sampleRate | 0);
          this._set(1.6, 0.2, 0.25); // room, damp, mix
          this.ready = true;
          this.port.postMessage({ ready: true });
        } catch (e) {
          this.port.postMessage({ error: String(e) });
        }
      };
      if (mod && mod.HEAPF32 && mod._malloc) init();
      else mod.onRuntimeInitialized = init;
    };

    ReverbModuleFactory().then(start).catch(e => {
      this.port.postMessage({ error: String(e) });
    });

    this.port.onmessage = (e) => {
      if (!this.ready) return;
      const { room, damp, mix } = e.data || {};
      this._set(
        room ?? this._room ?? 1.6,
        damp ?? this._damp ?? 0.2,
        mix  ?? this._mix  ?? 0.25
      );
      this.port.postMessage({ ack: { room: this._room, damp: this._damp, mix: this._mix } });
    };
  } // ← ← ← これ！ constructor をここで閉じる

  _bind(m){
    this.c_init = m.cwrap('init', null, ['number']);
    this.c_set  = m.cwrap('set_params', null, ['number','number','number']);
    this.c_proc = m.cwrap('process', null, ['number','number','number','number','number']);

    const n = this.frame;
    this.ptrInL  = m._malloc(n*4);
    this.ptrInR  = m._malloc(n*4);
    this.ptrOutL = m._malloc(n*4);
    this.ptrOutR = m._malloc(n*4);

    this.memInL  = m.HEAPF32.subarray(this.ptrInL  >> 2, (this.ptrInL  >> 2) + n);
    this.memInR  = m.HEAPF32.subarray(this.ptrInR  >> 2, (this.ptrInR  >> 2) + n);
    this.memOutL = m.HEAPF32.subarray(this.ptrOutL >> 2, (this.ptrOutL >> 2) + n);
    this.memOutR = m.HEAPF32.subarray(this.ptrOutR >> 2, (this.ptrOutR >> 2) + n);
  }

  _set(room, damp, mix){ this._room=room; this._damp=damp; this._mix=mix; this.c_set(room,damp,mix); }

  process(inputs, outputs) {
    if (!this.ready) {
      const out = outputs[0];
      if (out?.[0]) out[0].fill(0);
      if (out?.[1]) out[1].fill(0);
      return true;
    }
    const input = inputs[0] || [];
    const inL = input[0] || new Float32Array(this.frame);
    const inR = input[1] || inL;

    this.memInL.set(inL);
    this.memInR.set(inR);
    this.c_proc(this.ptrInL, this.ptrInR, this.ptrOutL, this.ptrOutR, inL.length);

    const out = outputs[0];
    if (out[0]) out[0].set(this.memOutL);
    if (out[1]) out[1].set(this.memOutR);
    return true;
  }
}

registerProcessor('wasm-reverb', WasmReverbProcessor);

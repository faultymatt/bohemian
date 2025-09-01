class BohemianWasmProcessor extends AudioWorkletProcessor{
constructor(){
super();
this.port.onmessage = (e)=>{ /* load WASM, set params */ };
this.phase = 0;
this.ready = false; this.wasm = null;
}
process(inputs, outputs, params){
const out = outputs[0][0]; if (!out) return true;
if (!this.ready){ out.fill(0); return true; }
// call WASM render(out, N, freq, sr, phase, &phase)
return true;
}
}
registerProcessor('bohemian-wasm', BohemianWasmProcessor);

export function bindControls({ onShapeChange, onGainChange }){
  const Ashape=document.getElementById('wtA-shape');
  const Bshape=document.getElementById('wtB-shape');
  const Again=document.getElementById('wtA-gain');
  const Bgain=document.getElementById('wtB-gain');

  const emitShape=(slot,el)=> onShapeChange({slot, shape: el.value});
  const emitGain =(slot,el)=> onGainChange({slot, gain: parseFloat(el.value)});

  Ashape?.addEventListener('change', ()=>{ emitShape(0,Ashape); drawScope(0); });
  Bshape?.addEventListener('change', ()=>{ emitShape(1,Bshape); drawScope(1); });
  Again?.addEventListener('input', ()=> emitGain(0,Again));
  Bgain?.addEventListener('input', ()=> emitGain(1,Bgain));

  // Pitch steppers
  document.querySelectorAll('.stepper button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const out=document.getElementById(btn.dataset.target);
      if(!out) return;
      const slot=+out.dataset.slot; const param=out.dataset.param; const delta=parseInt(btn.dataset.delta,10);
      const val=(parseInt(out.textContent||'0',10)+delta);
      out.textContent=String(val);
      if(window.__setPitch) window.__setPitch(slot, { [param]: val });
    });
  });

  // init
  if (Ashape) emitShape(0,Ashape);
  if (Bshape) emitShape(1,Bshape);
  if (Again)  emitGain(0,Again);
  if (Bgain)  emitGain(1,Bgain);
  drawScope(0); drawScope(1);

  // Meter loop
  const meter=document.getElementById('meter'); if(!meter) return;
  const mctx=meter.getContext('2d');
  const analyser=window.__bohemianAnalyser; const buf=new Float32Array(analyser? analyser.fftSize:2048);
  (function tick(){
    mctx.clearRect(0,0,meter.width,meter.height);
    let rms=0;
    if(analyser){ analyser.getFloatTimeDomainData(buf); let s=0; for(let i=0;i<buf.length;i++) s+=buf[i]*buf[i]; rms=Math.sqrt(s/buf.length); }
    const w=Math.min(meter.width, rms* meter.width * 3);
    mctx.fillStyle='rgba(255,255,255,0.85)'; mctx.fillRect(0,0,w,meter.height);
    requestAnimationFrame(tick);
  })();
}

// Simple waveform preview
function drawScope(slot){
  const shape=(slot===0? document.getElementById('wtA-shape'):document.getElementById('wtB-shape'))?.value || 'sine';
  const cvs  =(slot===0? document.getElementById('wtA-scope'):document.getElementById('wtB-scope'));
  if(!cvs) return;
  const ctx=cvs.getContext('2d'); const W=cvs.width, H=cvs.height;
  ctx.clearRect(0,0,W,H); ctx.strokeStyle='rgba(255,255,255,0.9)'; ctx.lineWidth=2; ctx.beginPath();
  const N=256;
  for(let i=0;i<N;i++){
    const t=i/(N-1);
    let y=0; if(shape==='sine') y=Math.sin(2*Math.PI*t);
    else if(shape==='saw') y=2*(t-0.5);
    else if(shape==='square') y=(t<0.5?1:-1);
    const x=i*(W-2)/(N-1)+1; const yy=(H/2) - y*(H*0.42);
    if(i===0) ctx.moveTo(x,yy); else ctx.lineTo(x,yy);
  }
  ctx.stroke();
}

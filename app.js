import { initAudioEngine, setWaveMix, setWaveShape } from './audio/engine.js';
import { initTabs } from './ui/tabs.js';
import { mountKeyboard } from './ui/keyboard.js';
import { bindControls } from './ui/controls.js';
import { startScopes } from './ui/scope.js';

// SW（ローカルでも動く）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(console.warn);
  });
}

const loading = document.getElementById('loading');
let engine;
let stopScopes = null;

function initTriangles(){
  const cvs = document.getElementById('bg-tris'); if (!cvs) return;
  const ctx = cvs.getContext('2d');
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  function resize(){ cvs.width = innerWidth*DPR; cvs.height = innerHeight*DPR; cvs.style.width=innerWidth+'px'; cvs.style.height=innerHeight+'px'; }
  resize(); addEventListener('resize', resize);
  function draw(){
    ctx.clearRect(0,0,cvs.width,cvs.height);
    const n = Math.max(6, Math.floor((innerWidth*innerHeight)/80000));
    for (let i=0;i<n;i++){
      const x=Math.random()*cvs.width, y=Math.random()*cvs.height, s=(20+Math.random()*60)*DPR, a=Math.random()*Math.PI*2;
      ctx.save(); ctx.translate(x,y); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(-s/2, s/2); ctx.lineTo(0,-s/2); ctx.lineTo(s/2, s/2); ctx.closePath();
      ctx.strokeStyle='rgba(200,230,255,0.14)'; ctx.lineWidth=1; ctx.stroke(); ctx.restore();
    }
  }
  draw(); setInterval(draw, 4000 + Math.random()*2000);
}

// ---- View initializers ----
async function initOSC(){
  if (!engine) engine = await initAudioEngine();
  mountKeyboard({
    onNoteOn:  (midi) => engine.noteOn(midi),
    onNoteOff: (midi) => engine.noteOff(midi),
  });
  bindControls({
    onShapeChange: ({ slot, shape }) => setWaveShape(slot, shape),
    onGainChange:  ({ slot, gain  }) => setWaveMix(slot, gain),
  });
    // ミックスの波形を A/B 両方のスコープに描画（同じ内容を表示）
  if (!stopScopes) {
    stopScopes = startScopes(['wtA-scope', 'wtB-scope']);
  }
}
function bindPolyOut() {
  const el = document.getElementById('poly-out');
  if (!el) return;

  // 即時反映
  const put = (n) => { el.textContent = String(n); };
  put(window.__polyCount ?? 0);

  // エンジンのイベントを受け取って更新
  addEventListener('bohemian:polychange', (e) => put(e.detail?.count ?? 0));

  // 念のため、可視化後に一度同期（初期ボイス無しでも数値を確定）
  queueMicrotask(() => put((window.engine?.getPolyCount?.() ?? window.__polyCount) ?? 0));
}

// どこかの初期化で呼ぶ
bindPolyOut();
// ---- 置き換え：二重バインド防止のステッパー結線（イベント委譲）----
function bindPitchSteppers() {
  // 親コンテナ（wavetables セクション）に1本だけ付ける
  const root = document.querySelector('.wavetables');
  if (!root || root.__pitchBound) return;   // ★ 再バインド防止
  root.__pitchBound = true;

  root.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.stepper button');
    if (!btn || !root.contains(btn)) return;

    const targetId = btn.dataset.target;          // 例: "wtA-oct"
    const outEl = document.getElementById(targetId);
    if (!outEl) return;

    const slot  = +(outEl.dataset.slot || 0);     // 0 or 1
    const param = outEl.dataset.param;            // "oct" | "sem" | "fin" | "crs"
    const delta = +btn.dataset.delta || 0;

    // 現在値を更新（範囲クリップ）
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    let val = parseInt(outEl.textContent, 10) || 0;
    val += delta;

    if (param === 'oct')      val = clamp(val, -4,   4);     // ±4 oct
    else if (param === 'sem') val = clamp(val, -12, 12);     // ±12 semitone
    else if (param === 'fin') val = clamp(val, -100, 100);   // ±100 cent
    else if (param === 'crs') val = clamp(val, -1200, 1200); // ±1200 cent

    outEl.textContent = String(val);

    // エンジンへ送る（どの呼び方でもOK）
    const payload = { [param]: val };
    if (window.engine?.setSlotPitch) {
      window.engine.setSlotPitch(slot, payload);
    } else if (typeof window.__setPitch === 'function') {
      window.__setPitch(slot, payload);
    }
  });
}

// これはそのまま一回だけ呼べばOK（重複呼び出しでも再バインドされない）


// 初期化のどこかで一度だけ呼ぶ
// 例: main() や initOSC() の最後に


async function initModules(){
  const shape = document.getElementById('lfo-shape');
  const rate  = document.getElementById('lfo-rate');
  const depth = document.getElementById('lfo-depth');
  const target= document.getElementById('lfo-target');

  const emit = () => window.__setLfo && window.__setLfo({
    shape: shape.value,
    rate: +rate.value,
    depth: +depth.value,
    target: target.value
  });

  [shape, rate, depth, target].forEach(el => el?.addEventListener('input', emit));
  emit();
}

async function initFX(){
  const size  = document.getElementById('rvb-size');
  const mix   = document.getElementById('rvb-mix');
  const drive = document.getElementById('dst-drive');
  const dmix  = document.getElementById('dst-mix');

  const emit = () => {
    if (!window.__setFx) return;
    window.__setFx.reverb({ size: +size.value, mix: +mix.value });
    window.__setFx.distortion({ drive: +drive.value, mix: +dmix.value });
  };

  [size, mix, drive, dmix].forEach(el => el?.addEventListener('input', emit));
  emit();
}

// ---- Boot ----
(async function main(){
  try{
    initTriangles();
    initTabs({
      onShow: async (name) => {
        if (name === 'osc')     await initOSC();
        if (name === 'modules') await initModules();
        if (name === 'fx')      await initFX();
      }
    });
  }catch(err){
    console.error('[Bohemian] init error:', err);
  }finally{
    if (loading) {
      requestAnimationFrame(()=> loading.style.opacity = '0');
      setTimeout(()=> loading.style.display = 'none', 400);
    }
  }
})();

// ローダーフェイルセーフ
window.addEventListener('load', () => {
  if (loading && loading.style.display !== 'none') {
    loading.style.opacity = '0';
    setTimeout(() => (loading.style.display = 'none'), 400);
  }
});
window.addEventListener('error',             () => loading && (loading.style.display = 'none'));
window.addEventListener('unhandledrejection',() => loading && (loading.style.display = 'none'));

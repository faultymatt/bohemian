// ui/scope.js — mixのリアルタイム波形を任意の複数canvasに描画
export function startScopes(canvasIds = []) {
  const analyser = window.__bohemianAnalyser;
  if (!analyser) {
    console.warn('[scope] analyser not ready yet'); 
    return () => {};
  }

  const DPR = Math.min(2, window.devicePixelRatio || 1);
  const cvsList = canvasIds
    .map(id => document.getElementById(id))
    .filter(Boolean)
    .map(cvs => {
      const ctx = cvs.getContext('2d');
      const resize = () => {
        const { clientWidth:w, clientHeight:h } = cvs;
        cvs.width  = Math.max(2, Math.floor(w * DPR));
        cvs.height = Math.max(2, Math.floor(h * DPR));
      };
      resize();
      new ResizeObserver(resize).observe(cvs);
      return { cvs, ctx };
    });

  const buf = new Float32Array(analyser.fftSize);
  let raf = 0;

  const draw = () => {
    analyser.getFloatTimeDomainData(buf);
    cvsList.forEach(({ cvs, ctx }) => {
      const W = cvs.width, H = cvs.height;
      ctx.clearRect(0, 0, W, H);

      // 目盛り（中央ライン）
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W, H / 2);
      ctx.stroke();

      // 波形
      ctx.strokeStyle = 'rgba(255,255,255,0.90)';
      ctx.lineWidth = Math.max(1, W / 400);
      ctx.beginPath();
      const n = buf.length;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * (W - 2) + 1;
        const y = H * 0.5 - buf[i] * H * 0.42;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
    raf = requestAnimationFrame(draw);
  };

  draw();
  return () => cancelAnimationFrame(raf);
}

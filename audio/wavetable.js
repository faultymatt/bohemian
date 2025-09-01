export function createWavetable(ctx){
  let current = 'sine';
  const waves = {
    sine: buildWave(ctx, { sine: true }),
    saw: buildWave(ctx, { saw: true }),
    square: buildWave(ctx, { square: true })
  };
  return {
    get wave(){ return waves[current]; },
    setShape(shape){ current = shape in waves ? shape : 'sine'; }
  };
}

function buildWave(ctx, { sine=false, saw=false, square=false }){
  const fftSize = 2048;
  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);

  const harmonics = 64;
  for (let n=1; n<=harmonics; n++){
    if (sine){ if (n===1) imag[n] = 1; }
    if (saw){ imag[n] += ((n%2===1? 1 : -1) * (1/n)); }
    if (square){ if (n%2===1) imag[n] += (1/n); }
  }
  for (let n=1;n<imag.length;n++){ imag[n] *= 1 / (1 + Math.pow(n/24, 2)); }

  return ctx.createPeriodicWave(real, imag, { disableNormalization:false });
}

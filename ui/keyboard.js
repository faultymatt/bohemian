const WHITE = ['Z','X','C','V','B','N','M',',','.','/'];
const BLACK_POS = { 'S':1,'D':2,'G':4,'H':5,'J':6 };
const MIDI_BASE = 60; // C4

export function mountKeyboard({ onNoteOn, onNoteOff }) {
  const root = document.getElementById('keyboard');
  if (!root) return;
  root.innerHTML = '';

  renderWhites(root);
  renderBlacks(root);

  const toMidi=(k)=>{
    const K=k.length===1?k.toUpperCase():k;
    if(WHITE.includes(K)){
      const i=WHITE.indexOf(K);
      const W=[0,2,4,5,7,9,11,12,14,16];
      return MIDI_BASE+W[i];
    }
    if(K in BLACK_POS){
      const S={1:1,2:3,4:6,5:8,6:10};
      return MIDI_BASE + S[BLACK_POS[K]];
    }
    return null;
  };

  addEventListener('keydown', (e)=>{ if(e.repeat) return; const m=toMidi(e.key); if(m==null) return; onNoteOn?.(m); flash(true,m); });
  addEventListener('keyup',   (e)=>{ const m=toMidi(e.key); if(m==null) return; onNoteOff?.(m); flash(false,m); });

  root.addEventListener('pointerdown', (e)=>{
    const el=e.target.closest('.key'); if(!el) return;
    const m=+el.dataset.midi; onNoteOn?.(m); el.classList.add('active');
    const up=()=>{ onNoteOff?.(m); el.classList.remove('active'); removeEventListener('pointerup',up); removeEventListener('pointercancel',up); };
    addEventListener('pointerup', up); addEventListener('pointercancel', up);
  });

  function renderWhites(root){
    const W=[0,2,4,5,7,9,11,12,14,16];
    let x=16, y=12;
    WHITE.forEach((label,i)=>{
      const el=document.createElement('div');
      el.className='key white';
      el.style.left=x+'px'; el.style.bottom=y+'px'; el.style.width='38px';
      el.dataset.midi=MIDI_BASE+W[i];
      el.innerHTML=`<span class="label">${label}</span>`;
      root.appendChild(el); x+=40;
    });
  }
  function renderBlacks(root){
    const wx=(k)=>16+40*k, y=12;
    const pos={1:0.7,2:1.7,4:3.7,5:4.7,6:5.7};
    Object.entries(BLACK_POS).forEach(([label,p])=>{
      const k=pos[p]??0.7;
      const el=document.createElement('div');
      el.className='key black';
      el.style.left=(wx(k))+'px'; el.style.bottom=(y+55)+'px';
      el.dataset.midi=MIDI_BASE+({1:1,2:3,4:6,5:8,6:10}[p]);
      el.innerHTML=`<span class="label">${label}</span>`;
      root.appendChild(el);
    });
  }
  function flash(on,m){ const el=root.querySelector(`.key[data-midi="${m}"]`); if(el) el.classList.toggle('active', on); }
}

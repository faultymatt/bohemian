export function initTabs({ onShow }) {
  const btns = Array.from(document.querySelectorAll('.tabbtn'));
  const names = btns.map(b => b.dataset.tab).filter(Boolean);
  if (names.length === 0) {
    console.warn('[tabs] no tab buttons (.tabbtn) found.');
    return;
  }

  // view-<name> を探し、無ければ自動生成（空でもOK）
  const container = document.querySelector('main.container') || document.body;
  const views = {};
  names.forEach((name, i) => {
    let el = document.getElementById(`view-${name}`);
    if (!el) {
      el = document.createElement('section');
      el.id = `view-${name}`;
      el.className = 'view';
      if (i !== 0) el.setAttribute('hidden', '');
      container.appendChild(el);
      console.info(`[tabs] created missing view: #view-${name}`);
    }
    views[name] = el;
  });

  const LS_KEY = 'bohemian.activeTab';
  let active = localStorage.getItem(LS_KEY) || names[0];
  if (!names.includes(active)) active = names[0];

  const show = (name) => {
    if (!names.includes(name)) name = names[0];
    // buttons
    btns.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    // views
    names.forEach(n => {
      const el = views[n];
      if (!el) return;
      if (n === name) { el.removeAttribute('hidden'); el.classList.add('is-active'); }
      else            { el.setAttribute('hidden','');  el.classList.remove('is-active'); }
    });
    localStorage.setItem(LS_KEY, name);
    const el = views[name];
    if (el && !el.dataset._inited) {
      el.dataset._inited = '1';
      try { onShow && onShow(name); } catch (e) { console.error('[tabs] onShow error:', e); }
    }
  };

  btns.forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
  show(active);
}

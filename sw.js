const CACHE = 'bohemian-v1';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'sw.js',
  'audio/engine.js',
  'audio/wavetable.js',
  'audio/voice.js',
  'ui/keyboard.js',
  'ui/controls.js',
  'ui/tabs.js',   // ← 追加
  'favicon.ico',
  'dsp/reverb.mjs',
  'dsp/reverb.wasm',
  'dsp/reverb-worklet.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (
    request.method === 'GET' &&
    new URL(request.url).origin === location.origin
  ) {
    e.respondWith(
      caches.match(request).then(
        (r) =>
          r ||
          fetch(request).then((resp) => {
            const cp = resp.clone();
            caches.open(CACHE).then((c) => c.put(request, cp));
            return resp;
          })
      )
    );
  }
});

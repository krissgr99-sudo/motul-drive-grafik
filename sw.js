/* MOTUL-DRIVE · service worker — офлайн-оболочка (задача Н4).
   Зачем: чтобы при недоступности GitHub Pages чистая вкладка открывала инструмент из кэша,
   а не «нет сети». Кэшируем ТОЛЬКО своё (same-origin); внешних доменов не трогаем — веб-шрифт
   грузится сетью и офлайн деградирует до системного (КЛ3: единственная внешняя зависимость — шрифт).

   Стратегия — network-first для навигаций и своих GET: свежий деплой всегда доходит до онлайн-
   пользователя (нет «залипшей» старой оболочки), кэш — только страховка на офлайн. Публикация нового
   ядра требует смены версии кэша ниже — старые версии сносятся при activate. */
const CACHE = "motul-drive-v13";

self.addEventListener("install", e => {
  // Предкэш корня scope (на Pages это index.html). Если недоступен — не валим установку.
  e.waitUntil(
    caches.open(CACHE).then(c => c.add("./"))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  // Чистим только СВОИ прежние версии (префикс motul-drive-), не трогая кэши соседних
  // проектов на общем origin *.github.io.
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("motul-drive-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;                          // POST выводов/заметок в Apps Script — только сеть, SW не трогает
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;           // шрифт и прочее внешнее — мимо SW (сеть, деградация офлайн)

  if (req.mode === "navigate") {                             // открытие/переход вкладки → оболочка
    e.respondWith(
      fetch(req)
        .then(res => { cachePut(req, res); return res; })
        .catch(() => caches.match(req, { ignoreSearch: true }).then(m => m || caches.match("./")))
    );
    return;
  }
  // прочие same-origin GET (manifest.webmanifest, sales.json и т.п.): сеть, при офлайне — кэш
  e.respondWith(
    fetch(req)
      .then(res => { cachePut(req, res); return res; })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});

// В кэш кладём только успешные same-origin ответы (opaque/ошибки — мимо). Клон обязателен: тело читается один раз.
function cachePut(req, res) {
  try {
    if (res && res.ok && res.type === "basic") {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
    }
  } catch (e) { /* кэш недоступен — не критично, дальше работает сеть */ }
}

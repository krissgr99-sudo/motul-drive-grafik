/* MOTUL-DRIVE · service worker СТРАНИЦЫ МАСТЕРОВ (/yama/).
   Зачем отдельный, а не общий с порталом: в яме связь плохая, а страница нужна каждую смену —
   ярлык на домашнем экране должен открываться и без сети. Скоуп у него свой (папка /yama/),
   и он специфичнее скоупа портала, поэтому для этих адресов выигрывает именно он.

   ИМЯ КЭША НЕ НАЧИНАЕТСЯ С "motul-drive-" НАМЕРЕННО: SW портала при активации сносит все
   кэши с этим префиксом, кроме своего, — и снёс бы заодно наш.

   Стратегия та же, что у портала: network-first (свежий деплой доходит до онлайн-мастера),
   кэш — страховка на офлайн. Меняешь yama.html — подними версию ниже.

   Версия семантическая, как у портала: МАЖОР.МИНОР.ПАТЧ (мелкое / заметное / крупное),
   у ямы свой счёт. Литералом в одну строку — deploy.ps1 ищет её регуляркой в тексте файла.
   NOTE — строка «что нового» для плашки обновления, меняется вместе с версией. */
const CACHE = "md-yama-v1.0.0";
const VERSION = CACHE.replace("md-yama-v", "");
const NOTE = "Страница сама сообщает о новых версиях";

self.addEventListener("install", e => {
  /* Без skipWaiting намеренно: мастер обновляется сам, кнопкой в плашке, а не посреди работы.
     Первую установку это не задерживает — вытеснять пока некого. */
  e.waitUntil(caches.open(CACHE).then(c => c.add("./")).catch(() => {}));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("md-yama-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Разговор со страницей (плашка обновления), один в один с порталом:
   version → кто мы по версии и что нового; apply-update → мастер нажал «Обновить». */
self.addEventListener("message", e => {
  const type = e.data && e.data.type;
  if (type === "version") {
    const port = e.ports && e.ports[0];
    if (port) port.postMessage({ version: VERSION, note: NOTE });
  } else if (type === "apply-update") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;                          // POST имени мастера — только сеть
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;           // шрифт и Apps Script — мимо SW

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then(res => { cachePut(req, res); return res; })
        .catch(() => caches.match(req, { ignoreSearch: true }).then(m => m || caches.match("./")))
    );
    return;
  }
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

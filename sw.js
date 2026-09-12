/* MOTUL-DRIVE · service worker — офлайн-оболочка (задача Н4).
   Зачем: чтобы при недоступности GitHub Pages чистая вкладка открывала инструмент из кэша,
   а не «нет сети». Кэшируем ТОЛЬКО своё (same-origin); внешних доменов не трогаем — веб-шрифт
   грузится сетью и офлайн деградирует до системного (КЛ3: единственная внешняя зависимость — шрифт).

   Стратегия — network-first для навигаций и своих GET: свежий деплой всегда доходит до онлайн-
   пользователя (нет «залипшей» старой оболочки), кэш — только страховка на офлайн. Публикация нового
   ядра требует смены версии кэша ниже — старые версии сносятся при activate. */

/* Версия портала — семантическая, МАЖОР.МИНОР.ПАТЧ (решение владельца 09.09.2026):
     ПАТЧ  — мелкое: цена, текст, точечный фикс;
     МИНОР — заметное: новый вариант, новая кнопка, поведение раздела;
     МАЖОР — крупное: новый раздел, переработка.
   Она же имя кэша и она же то, что человек видит в плашке «вышло обновление». Пишем литералом
   в одну строку (а не склейкой "motul-drive-v" + VERSION) намеренно: deploy.ps1 ищет версию
   регуляркой прямо в тексте файла и на склейке нашёл бы пустоту, то есть страж публикации
   молча перестал бы работать. NOTE — строка «что нового» для той же плашки: меняется вместе
   с версией, поэтому протухнуть не может. */
const CACHE = "motul-drive-v1.6.1";
const VERSION = CACHE.replace("motul-drive-v", "");
const NOTE = "Шаблоны: Aisin TR80SD 0C8 — итого 42 500 ₽";

self.addEventListener("install", e => {
  /* Предкэш корня scope (на Pages это index.html). Если недоступен — не валим установку.
     skipWaiting() здесь НЕТ намеренно: новая версия ждёт в очереди, пока человек не нажмёт
     «Обновить» в плашке — иначе оболочка сменится посреди работы. Первую установку это не
     задерживает: пока нет активного service worker, вытеснять некого и версия встаёт сразу. */
  e.waitUntil(caches.open(CACHE).then(c => c.add("./")).catch(() => {}));
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

/* Разговор со страницей — из-за него плашка вообще может назвать цифры:
     version      → отвечаем в присланный порт (MessageChannel), кто мы по версии и что нового.
                    Спрашивают двоих: активного («было») и ждущего в очереди («стало»);
     apply-update → человек нажал «Обновить». Только теперь вытесняем старую версию;
                    страница поймает controllerchange и перезагрузится сама. */
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
  if (req.method !== "GET") return;                          // POST выводов/заметок в Apps Script — только сеть, SW не трогает
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;           // шрифт и прочее внешнее — мимо SW (сеть, деградация офлайн)

  if (req.mode === "navigate") {                             // открытие/переход вкладки → оболочка
    /* Фолбэк на корень scope — только для самого портала. Скоуп "./" накрывает и соседнюю
       страницу мастеров /yama/, а она отдельный инструмент со своим SW: подменять её
       офлайн-оболочкой портала нельзя — мастер увидел бы у себя ровно то, от чего эта
       страница и отделена (цены, продажи, штрафы). Нет своей копии в кэше — честный офлайн. */
    const inYama = /\/yama(\/|$)/.test(url.pathname);
    e.respondWith(
      fetch(req)
        .then(res => { cachePut(req, res); return res; })
        .catch(() => caches.match(req, { ignoreSearch: true })
          .then(m => m || (inYama ? Response.error() : caches.match("./"))))
    );
    return;
  }
  // прочие same-origin GET (manifest.webmanifest и т.п.): сеть, при офлайне — кэш
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

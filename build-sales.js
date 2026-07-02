/* LiveSklad → sales.json. Запускается роботом GitHub Actions раз в день.
   Считает продажи промывки по дням и дописывает их в sales.json (старые дни сохраняются).
   Только читает LiveSklad, ничего там не меняет.

   Переменные окружения:
     LIVESKLAD_LOGIN, LIVESKLAD_PASSWORD — учётка API (в GitHub Secrets).
     DAYS — сколько последних дней пересчитать (по умолчанию 2: вчера финализируем, сегодня — предварительно).
     TZ  — часовой пояс для дат (workflow ставит Europe/Moscow).

   Локальный запуск для проверки:
     $env:LIVESKLAD_LOGIN="..."; $env:LIVESKLAD_PASSWORD="..."; node build-sales.js */

const https = require("https");
const fs = require("fs");
const path = require("path");

const PRODUCT = "Промывка двигателя Liqui Moly Engine Flush (0,3л)";
const NOMENCLATURE_ID = "68f3543ada76333f49f97ded"; // стабильный id товара
const CODE = 112678;                                 // артикул
const DAYS = Number(process.env.DAYS || 2);
const OUT = path.join(__dirname, "sales.json");
const PAGE_SIZE = 50, DELAY_MS = 120, TIMEOUT_MS = 15000;

const sleep = ms => new Promise(r=>setTimeout(r,ms));
const norm = s => (s||"").trim().toLowerCase();
const localDate = iso => { const d=new Date(iso); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };

function req(method, urlPath, headers, body){
  return new Promise((resolve,reject)=>{
    const data = body||"";
    const r = https.request({ hostname:"api.livesklad.com", path:urlPath, method,
      headers:{ ...headers, ...(data?{"Content-Length":Buffer.byteLength(data)}:{}) } },
      res=>{ let buf=""; res.on("data",c=>buf+=c); res.on("end",()=>resolve({status:res.statusCode,body:buf})); });
    r.setTimeout(TIMEOUT_MS, ()=>r.destroy(new Error("timeout")));
    r.on("error",reject); if(data) r.write(data); r.end();
  });
}
async function rr(m,u,h,b){ try{ return await req(m,u,h,b); } catch(e){ await sleep(600); return await req(m,u,h,b); } }

(async()=>{
  const login = process.env.LIVESKLAD_LOGIN, password = process.env.LIVESKLAD_PASSWORD;
  if(!login || !password){ console.error("❌ Нет LIVESKLAD_LOGIN/LIVESKLAD_PASSWORD в окружении."); process.exit(1); }

  const auth = await rr("POST","/auth",{ "Content-Type":"application/x-www-form-urlencoded" },
    "login="+encodeURIComponent(login)+"&password="+encodeURIComponent(password));
  let token; try{ token = JSON.parse(auth.body).token; }catch(e){}
  if(!token){ console.error("❌ Авторизация не удалась:", auth.status, auth.body.slice(0,200)); process.exit(1); }
  console.log("✅ Авторизованы.");

  const windowStart = new Date(); windowStart.setHours(0,0,0,0); windowStart.setDate(windowStart.getDate()-(DAYS-1));
  console.log(`Считаю продажи с ${localDate(windowStart.toISOString())} (последние ${DAYS} дн.)`);

  // 1) собрать заказы окна (список — новые сверху)
  const orders=[]; let page=1,total=Infinity,remain=100,stop=false;
  while(!stop){
    const res = await rr("GET",`/company/orders?pageSize=${PAGE_SIZE}&page=${page}`,{ "Authorization":token });
    if(res.status!==200){ console.error("Ошибка списка:", res.status, res.body.slice(0,160)); process.exit(1); }
    const p=JSON.parse(res.body); const batch=p.data||[]; total=p.total??total; remain=p.remainRequest??remain;
    for(const o of batch){ if(new Date(o.dateCreate)<windowStart){ stop=true; break; } orders.push({id:o.id,number:o.number,dateCreate:o.dateCreate}); }
    if(batch.length<PAGE_SIZE || page*PAGE_SIZE>=total) stop=true; page++;
    if(remain<=3) break; await sleep(DELAY_MS);
  }
  console.log(`Заказов в окне: ${orders.length}. Читаю детали…`);

  // 2) детали → ищем промывку по id/артикулу/имени
  const byDate={}; let hits=0;
  for(const o of orders){
    let res; try{ res = await rr("GET",`/orders/${o.id}`,{ "Authorization":token }); }catch(e){ continue; }
    if(res.status===429){ console.warn("⚠ Лимит API (429) — сохраняю, что успел."); break; }
    if(res.status!==200) continue;
    let d; try{ d=JSON.parse(res.body); }catch(e){ continue; }
    const ord = d.data || d; remain = d.remainRequest ?? ord.remainRequest ?? remain;
    let count=0, sum=0;
    for(const pos of (ord.positions||[])){
      if(pos.nomenclatureId===NOMENCLATURE_ID || pos.code===CODE || norm(pos.name)===norm(PRODUCT)){
        count += pos.count||0; sum += (pos.soldPrice||0)*(pos.count||0);
      }
    }
    if(count>0){ const ds=localDate(o.dateCreate); (byDate[ds]=byDate[ds]||[]).push([String(o.number),count,sum]); hits++; }
    if(remain<=3){ console.warn("⚠ Лимит API — сохраняю, что успел."); break; }
    await sleep(DELAY_MS);
  }

  // 3) слить с существующим sales.json (дни окна перезаписываем свежими, прочие храним)
  let prev={ product:PRODUCT, updated:null, days:[] };
  try{ if(fs.existsSync(OUT)) prev=JSON.parse(fs.readFileSync(OUT,"utf8")); }catch(e){}
  const map={}; for(const day of (prev.days||[])) map[day.date]=day.orders||[];
  // важное: если в день окна продаж не было, надо очистить старое значение (могли отменить заказ)
  for(let k=0;k<DAYS;k++){ const dd=new Date(windowStart); dd.setDate(dd.getDate()+k); const ds=localDate(dd.toISOString()); if(!byDate[ds]) delete map[ds]; }
  for(const ds of Object.keys(byDate)) map[ds]=byDate[ds];
  const days=Object.keys(map).sort().map(date=>({date,orders:map[date]}));
  const out={ product:PRODUCT, updated:localDate(new Date().toISOString()), days };
  fs.writeFileSync(OUT, JSON.stringify(out,null,2)+"\n", "utf8");

  const totQty=days.reduce((s,d)=>s+d.orders.reduce((a,o)=>a+o[1],0),0);
  const totSum=days.reduce((s,d)=>s+d.orders.reduce((a,o)=>a+o[2],0),0);
  console.log(`Готово. Заказов с промывкой в окне: ${hits}. В файле дней: ${days.length}. Всего за историю: ${totQty} шт, ${totSum} ₽.`);
})();

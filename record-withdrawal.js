/* Записывает факт вывода копилки. Запускается роботом GitHub Actions по новому issue
   с маркером "md-withdraw-v1" от владельца репозитория (workflow withdraw.yml).
   Считает текущую копилку = все продажи из sales.json − прошлые выводы, и дописывает
   {date: сегодня, amount: копилка} в withdrawals.json. Всегда "под ноль": сумма
   вывода = вся накопленная копилка. Если копилка ≤ 0 — ничего не пишет.
   Только читает данные, во внешние сервисы не ходит.

   TZ=Europe/Moscow ставит workflow, поэтому "сегодня" — по Москве.

   Локальная проверка:  node record-withdrawal.js */
const fs = require("fs");
const path = require("path");

const SALES = path.join(__dirname, "sales.json");
const OUT   = path.join(__dirname, "withdrawals.json");
const localDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch(e){ return fb; } };

const sales = readJson(SALES, { days:[] });
const totalSales = (sales.days || []).reduce((s,d)=> s + (d.orders || []).reduce((a,o)=> a + (o[2]||0), 0), 0);

const wd = readJson(OUT, { updated:null, withdrawals:[] });
if(!Array.isArray(wd.withdrawals)) wd.withdrawals = [];
const totalWithdrawn = wd.withdrawals.reduce((s,w)=> s + (Number(w.amount)||0), 0);

const pot = totalSales - totalWithdrawn;
const today = localDate(new Date());

if(pot <= 0){
  console.log(`Копилка пуста: продажи ${totalSales} − выведено ${totalWithdrawn} = ${pot} ₽. Вывод не записан.`);
  process.exit(0);
}

wd.withdrawals.push({ date: today, amount: pot });
wd.updated = today;
fs.writeFileSync(OUT, JSON.stringify(wd, null, 2) + "\n", "utf8");
console.log(`Записан вывод ${pot} ₽ за ${today}. Копилка обнулена.`);

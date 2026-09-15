/* NEON CASINO MiniApp */
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }
const qs = new URLSearchParams(location.search);
let API = qs.get('api') || (location.protocol.startsWith('http') ? location.origin : 'http://localhost:8000');
API = API.replace(/\/$/, '');
const ADMIN_IDS = [6665950252];

let TG_ID = 0, USERNAME = '', FIRST = 'Игрок';
if (tg?.initDataUnsafe?.user) {
  TG_ID = tg.initDataUnsafe.user.id;
  USERNAME = tg.initDataUnsafe.user.username || '';
  FIRST = tg.initDataUnsafe.user.first_name || 'Игрок';
} else {
  TG_ID = parseInt(localStorage.getItem('demo_id') || '0');
  if (!TG_ID) { TG_ID = 6665950252; localStorage.setItem('demo_id', String(TG_ID)); }
  USERNAME = 'demo'; FIRST = 'Тестер';
}
let ME = { balance: 1000, total_tapped: 0, taps_today: 0, level: 1, total_wagered: 0, total_won: 0, games_played: 0, inventory: [] };
let OFFLINE = false;

const $ = id => document.getElementById(id);
function toast(t) { const d = document.createElement('div'); d.className = 'toast-msg'; d.textContent = t; $('toast').appendChild(d); setTimeout(() => d.remove(), 2600); }
function vibrate(ms = 15) { try { tg?.HapticFeedback?.impactOccurred('medium'); navigator.vibrate?.(ms); } catch (e) {} }
function fmt(n) { return Math.floor(n).toLocaleString('ru-RU'); }
// баланс может быть дробным (тап 0.5): показываем копейки только если они есть
function fmtB(n) {
  const v = Math.floor(n * 10) / 10;
  return Number.isInteger(v) ? fmt(v) : v.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
function setBalance(v, bump = true) {
  ME.balance = v; $('balance').textContent = fmtB(v);
  if (bump) { const p = $('balance-pill'); p.classList.remove('bump'); void p.offsetWidth; p.classList.add('bump'); }
}
function winModal(title, sub, emoji = '🎉') {
  $('win-title').textContent = title; $('win-sub').textContent = sub || ''; $('win-emoji').textContent = emoji;
  $('win-modal').classList.add('show'); coinRain(30); vibrate(60);
}
$('win-ok').onclick = () => $('win-modal').classList.remove('show');

async function api(path, opts = {}) {
  const res = await fetch(API + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function initUser() {
  try {
    const u = await api('/api/user/init', { method: 'POST', body: JSON.stringify({ tg_id: TG_ID, username: USERNAME, first_name: FIRST }) });
    Object.assign(ME, u); setBalance(ME.balance, false); OFFLINE = false;
  } catch (e) {
    OFFLINE = true;
    ME.balance = parseInt(localStorage.getItem('coins') || '1000');
    setBalance(ME.balance, false);
    toast('⚠️ Офлайн демо-режим (запусти backend)');
  }
  renderProfile(); updateTapUI();
}
async function refreshMe() {
  try { const u = await api('/api/user/' + TG_ID); Object.assign(ME, u); setBalance(ME.balance, false); updateTapUI(); renderProfile(); } catch (e) {}
}
async function doBet(game, bet, win) {
  bet = Math.floor(bet); win = Math.floor(win);
  if (OFFLINE) {
    if (ME.balance < bet) { toast('⛔ Не хватает монет, потапай!'); return null; }
    ME.balance = ME.balance - bet + win;
    localStorage.setItem('coins', ME.balance); setBalance(ME.balance);
    return { ok: true, balance: ME.balance, profit: win - bet };
  }
  try {
    const r = await api('/api/bet', { method: 'POST', body: JSON.stringify({ tg_id: TG_ID, game, bet, win }) });
    setBalance(r.balance); refreshMe(); return r;
  } catch (e) { toast('⛔ ' + (String(e.message).includes('no_money') ? 'Не хватает монет!' : 'Ошибка ставки')); return null; }
}

// ---------- фон: монеты ----------
const cv = $('bg-coins'), ctx = cv.getContext('2d');
let parts = [];
function bgInit() {
  cv.width = innerWidth; cv.height = innerHeight;
  parts = Array.from({ length: 28 }, () => ({ x: Math.random() * cv.width, y: Math.random() * cv.height, s: 10 + Math.random() * 16, v: .3 + Math.random() * .8, e: ['🪙', '💎', '🎰', '✨'][Math.floor(Math.random() * 4)] }));
  (function loop() { ctx.clearRect(0, 0, cv.width, cv.height); ctx.font = '16px serif'; for (const p of parts) { ctx.globalAlpha = .35; ctx.fillText(p.e, p.x, p.y); p.y += p.v; if (p.y > cv.height) { p.y = -20; p.x = Math.random() * cv.width; } } ctx.globalAlpha = 1; requestAnimationFrame(loop); })();
}
function coinRain(n = 20) {
  const box = $('coin-rain');
  for (let i = 0; i < n; i++) {
    const s = document.createElement('div'); s.className = 'falling-coin';
    s.textContent = ['🪙', '💰', '💎', '🎉'][Math.floor(Math.random() * 4)];
    s.style.left = Math.random() * 100 + 'vw'; s.style.fontSize = (14 + Math.random() * 26) + 'px';
    s.style.animationDuration = (1.5 + Math.random() * 2) + 's';
    box.appendChild(s); setTimeout(() => s.remove(), 3800);
  }
}

// ---------- табы ----------
document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
  t.classList.add('active'); $('page-' + t.dataset.page).classList.add('active'); vibrate(10);
  if (t.dataset.page === 'online') loadOnline();
  if (t.dataset.page === 'cases') loadCases();
  if (t.dataset.page === 'profile') refreshMe();
});

// ---------- ТАПАЛКА ----------
let combo = 0, comboTimer = null;
function updateTapUI() { $('taps').textContent = fmt(ME.total_tapped || 0); $('level').textContent = ME.level || 1; }
$('big-coin').addEventListener('pointerdown', async e => {
  vibrate(10); combo = Math.min(combo + 1, 50);
  $('combo-fill').style.width = (5 + combo * 1.9) + '%';
  $('combo-text').textContent = 'КОМБО x' + (1 + Math.floor(combo / 10));
  clearTimeout(comboTimer); comboTimer = setTimeout(() => { combo = 0; $('combo-fill').style.width = '5%'; $('combo-text').textContent = 'КОМБО x1'; }, 2500);
  const fl = document.createElement('div'); fl.className = 'float-plus';
  fl.style.left = (e.clientX - 10) + 'px'; fl.style.top = (e.clientY - 30) + 'px';
  document.body.appendChild(fl);
  if (!OFFLINE) {
    try {
      const r = await api('/api/tap', { method: 'POST', body: JSON.stringify({ tg_id: TG_ID }) });
      setBalance(r.balance); ME.total_tapped++; ME.taps_today = r.taps_today; ME.level = r.level; updateTapUI();
      fl.textContent = '+' + r.gain; fl.style.color = r.crit ? '#fbbf24' : '#4ade80';
      fl.style.fontSize = r.crit ? '30px' : '22px';
      if (r.crit) { coinRain(6); }
    } catch (err) { fl.textContent = '+2'; fl.style.color = '#4ade80'; }
  } else {
    ME.balance += 0.5; ME.total_tapped++; localStorage.setItem('coins', ME.balance); setBalance(ME.balance); updateTapUI();
    fl.textContent = '+0.5'; fl.style.color = '#4ade80';
  }
  setTimeout(() => fl.remove(), 900);
});

// дейли через виртуальный подарок-роза (500)
$('daily-btn').onclick = async () => {
  const last = parseInt(localStorage.getItem('daily') || '0');
  const now = Date.now();
  if (now - last < 20 * 3600 * 1000) { const h = Math.ceil((20 * 3600 * 1000 - (now - last)) / 3600000); toast(`⏳ Следующий через ~${h} ч.`); return; }
  try { const r = await api('/api/gift/deposit', { method: 'POST', body: JSON.stringify({ tg_id: TG_ID, gift: 'rose' }) }); setBalance(r.balance); localStorage.setItem('daily', String(now)); winModal('+500', 'Дейли-бонус забран! Возвращайся завтра 🎁', '🎁'); }
  catch (e) { toast('Ошибка дейли'); }
};

// ---------- ИГРЫ ----------
let curBet = 100;
function betControls(def = 100) {
  return `<div class="bet-row"><input id="g-bet" type="number" value="${def}" min="10" step="10"></div>
  <div class="bet-chips">
    <button class="chip" data-b="50">50</button><button class="chip" data-b="100">100</button>
    <button class="chip" data-b="500">500</button><button class="chip" data-b="1000">1K</button>
    <button class="chip" data-x="2">2X</button><button class="chip" data-x="4">4X</button>
    <button class="chip hot" data-max="1">MAX</button>
  </div>`;
}
function wireBetChips() {
  document.querySelectorAll('#game-area .chip').forEach(c => c.onclick = () => {
    const inp = $('g-bet'); let v = parseInt(inp.value || '100');
    if (c.dataset.b) inp.value = c.dataset.b;
    if (c.dataset.x) inp.value = Math.min(v * +c.dataset.x, ME.balance);
    if (c.dataset.max) inp.value = Math.min(Math.max(ME.balance, 10), 10000);
    vibrate(10);
  });
}
const getBet = () => Math.max(10, Math.min(parseInt($('g-bet')?.value || '100'), ME.balance || 100000));

document.querySelectorAll('.game-card').forEach(b => b.onclick = () => {
  document.querySelectorAll('.game-card').forEach(x => x.classList.remove('selected'));
  b.classList.add('selected'); vibrate(10);
  ({ slots: renderSlots, dice: renderDice, roulette: renderRoulette, mines: renderMines, crash: renderCrash, blackjack: renderBJ })[b.dataset.game]();
});

// СЛОТЫ
function renderSlots() {
  $('game-area').innerHTML = `<h3>🎰 СЛОТЫ</h3>${betControls(100)}<div class="slots"><div class="slot" id="s0">🍒</div><div class="slot" id="s1">💎</div><div class="slot" id="s2">7️⃣</div></div><button class="btn gold" id="spin" style="width:100%">КРУТИТЬ</button><div class="small" id="slot-out">3 одинаковых = x6 • два 7️⃣ = x2 • пара = возврат</div>`;
  wireBetChips();
  $('spin').onclick = async () => {
    const bet = getBet(); if (ME.balance < bet) return toast('⛔ Мало монет!');
    const em = ['🍒', '🍋', '💎', '7️⃣', '⭐', '🔔'];
    ['s0', 's1', 's2'].forEach(id => $(id).classList.add('spin'));
    $('spin').disabled = true;
    const res = [em[Math.floor(Math.random() * em.length)], em[Math.floor(Math.random() * em.length)], em[Math.floor(Math.random() * em.length)]];
    for (let i = 0; i < 8; i++) { ['s0', 's1', 's2'].forEach(id => $(id).textContent = em[Math.floor(Math.random() * em.length)]); await new Promise(r => setTimeout(r, 90)); }
    ['s0', 's1', 's2'].forEach((id, i) => { $(id).classList.remove('spin'); $(id).textContent = res[i]; });
    let win = 0;
    if (res[0] === res[1] && res[1] === res[2]) win = bet * (res[0] === '7️⃣' ? 20 : res[0] === '💎' ? 10 : 6);
    else if (res[0] === res[1] || res[1] === res[2] || res[0] === res[2]) win = (res.includes('7️⃣')) ? bet * 2 : bet;
    const r = await doBet('slots', bet, win);
    if (r) { $('slot-out').textContent = win > bet ? `🎉 ВЫИГРЫШ +${fmt(win - bet)}!` : win === bet ? '↩️ Возврат ставки' : '😅 Не повезло, крути ещё!'; if (win > bet) winModal('+' + fmt(win - bet), 'Слоты принесли занос! 🎰'); }
    $('spin').disabled = false;
  };
}

// ДАЙС как в CaseBattle: кнопки 25/50/75 + 2x/4x
let diceChance = 50;
function renderDice() {
  const mult = (95 / diceChance).toFixed(2);
  $('game-area').innerHTML = `<h3>🎲 ДАЙС <span class="small">CaseBattle-стиль</span></h3>${betControls(100)}
  <div class="bet-chips"><button class="chip ${diceChance === 25 ? 'hot' : ''}" id="ch25">25%</button><button class="chip ${diceChance === 50 ? 'hot' : ''}" id="ch50">50%</button><button class="chip ${diceChance === 75 ? 'hot' : ''}" id="ch75">75%</button></div>
  <div class="small">Шанс: <b>${diceChance}%</b> • Выплата: <b>x${mult}</b></div>
  <div class="slots"><div class="slot" id="dice-num" style="width:120px">🎲</div></div>
  <button class="btn gold" id="roll" style="width:100%">РОЛЛ (выигрыш ~${fmt(100 * mult)})</button><div class="small" id="dice-out">Выпадет &lt; ${diceChance} — победа</div>`;
  wireBetChips();
  $('ch25').onclick = () => { diceChance = 25; renderDice(); }; $('ch50').onclick = () => { diceChance = 50; renderDice(); }; $('ch75').onclick = () => { diceChance = 75; renderDice(); };
  $('roll').onclick = async () => {
    const bet = getBet(); if (ME.balance < bet) return toast('⛔ Мало монет!');
    const roll = Math.random() * 100; $('dice-num').textContent = roll.toFixed(1);
    const win = roll < diceChance ? Math.floor(bet * 95 / diceChance) : 0;
    const r = await doBet('dice', bet, win);
    if (r) { $('dice-out').textContent = win ? `✅ ${roll.toFixed(1)} < ${diceChance} — +${fmt(win - bet)}!` : `❌ Выпало ${roll.toFixed(1)} — мимо`; if (win) winModal('+' + fmt(win - bet), `Дайс ${roll.toFixed(1)} 🎲`); }
  };
}

// РУЛЕТКА
function renderRoulette() {
  $('game-area').innerHTML = `<h3>🎡 РУЛЕТКА</h3>${betControls(100)}
  <div class="bet-chips"><button class="chip hot" id="r-red">🔴 x2</button><button class="chip" id="r-black">⚫ x2</button><button class="chip" id="r-green">🟢 x14</button></div>
  <div class="roulette-wheel" id="wheel">🎡</div>
  <div class="small" id="roul-out">Выбери цвет и жми!</div>
  <button class="btn gold" id="roul-go" style="width:100%">КРУТИТЬ</button>`;
  wireBetChips();
  let pick = 'red';
  const sel = p => { pick = p; ['r-red', 'r-black', 'r-green'].forEach(id => $(id).classList.remove('hot')); $({ red: 'r-red', black: 'r-black', green: 'r-green' }[p]).classList.add('hot'); };
  $('r-red').onclick = () => sel('red'); $('r-black').onclick = () => sel('black'); $('r-green').onclick = () => sel('green');
  $('roul-go').onclick = async () => {
    const bet = getBet(); if (ME.balance < bet) return toast('⛔ Мало монет!');
    const n = Math.floor(Math.random() * 37);
    const color = n === 0 ? 'green' : ([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(n) ? 'red' : 'black');
    $('wheel').style.transform = `rotate(${1080 + n * 37}deg)`;
    $('roul-out').textContent = 'Крутится...';
    await new Promise(r => setTimeout(r, 2900));
    $('wheel').textContent = n;
    const win = color === pick ? bet * (pick === 'green' ? 14 : 2) : 0;
    const r = await doBet('roulette', bet, win);
    if (r) { $('roul-out').textContent = win ? `🎉 ${n} (${color}) — +${fmt(win - bet)}!` : `😅 Выпало ${n} (${color}) — мимо`; if (win) winModal('+' + fmt(win - bet), `Рулетка: ${n} ${color === 'red' ? '🔴' : color === 'black' ? '⚫' : '🟢'}`); }
  };
}

// МИНЫ 5x5
let minesState = null;
function renderMines() {
  $('game-area').innerHTML = `<h3>💣 МИНЫ</h3>${betControls(100)}
  <div class="bet-chips"><button class="chip" data-m="1">1 мина</button><button class="chip" data-m="3">3</button><button class="chip" data-m="5">5</button><button class="chip" data-m="10">10 🔥</button></div>
  <button class="btn neon" id="m-start" style="width:100%">НАЧАТЬ ИГРУ</button><div id="m-field"></div><div class="small" id="m-out"></div>`;
  wireBetChips();
  let mCount = 3;
  document.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { mCount = +b.dataset.m; toast(`💣 Мин: ${mCount}`); });
  $('m-start').onclick = () => {
    const bet = getBet(); if (ME.balance < bet) return toast('⛔ Мало монет!');
    const cells = Array.from({ length: 25 }, (_, i) => i);
    const mines = new Set(); while (mines.size < mCount) mines.add(Math.floor(Math.random() * 25));
    minesState = { bet, mines, opened: 0, over: false, mCount };
    let html = '<div class="mines-grid">';
    for (let i = 0; i < 25; i++) html += `<button class="mine-cell" data-i="${i}">❔</button>`;
    html += '</div><button class="btn gold" id="m-cash" style="width:100%">ЗАБРАТЬ x1.00</button>';
    $('m-field').innerHTML = html;
    document.querySelectorAll('.mine-cell').forEach(c => c.onclick = () => openMine(+c.dataset.i, c));
    $('m-cash').onclick = cashMines;
    $('m-out').textContent = `Открывай клетки! Мин: ${mCount}`;
  };
}
function mineMult(opened, total, mines) { let m = 1; for (let i = 0; i < opened; i++) m *= (total - i) / (total - mines - i); return m * 0.95; }
async function openMine(i, el) {
  const s = minesState; if (!s || s.over || el.classList.contains('open-good')) return;
  if (s.mines.has(i)) {
    s.over = true; el.classList.add('open-bad'); el.textContent = '💥';
    document.querySelectorAll('.mine-cell').forEach((c, idx) => { if (s.mines.has(idx)) { c.textContent = '💣'; } });
    await doBet('mines', s.bet, 0); $('m-out').textContent = '💥 БУМ! Ставка сгорела.';
  } else {
    s.opened++; el.classList.add('open-good'); el.textContent = '💎';
    const m = mineMult(s.opened, 25, s.mCount);
    $('m-cash').textContent = `ЗАБРАТЬ x${m.toFixed(2)} (+${fmt(s.bet * m - s.bet)})`;
    vibrate(10);
  }
}
async function cashMines() {
  const s = minesState; if (!s || s.over || s.opened === 0) return toast('Открой хоть одну клетку!');
  s.over = true; const m = mineMult(s.opened, 25, s.mCount); const win = Math.floor(s.bet * m);
  const r = await doBet('mines', s.bet, win);
  if (r) { $('m-out').textContent = `✅ Кэшаут x${m.toFixed(2)}: +${fmt(win - s.bet)}!`; winModal('+' + fmt(win - s.bet), `Мины: ${s.opened} клеток 💎`); }
}

// КРАШ
let crashTimer = null;
function renderCrash() {
  $('game-area').innerHTML = `<h3>🚀 КРАШ</h3>${betControls(100)}
  <div class="crash-graph"><div class="crash-mult" id="c-mult">x1.00</div></div>
  <div class="row" style="display:flex;gap:8px;margin-top:8px"><button class="btn neon" id="c-start" style="flex:1">СТАРТ</button><button class="btn gold" id="c-cash" style="flex:1" disabled>ЗАБРАТЬ</button></div>
  <div class="small" id="c-out">Успей забрать до краха!</div>`;
  wireBetChips();
  let live = false, mult = 1, bet = 0, crashAt = 2, cashed = false;
  $('c-start').onclick = () => {
    if (live) return; bet = getBet(); if (ME.balance < bet) return toast('⛔ Мало монет!');
    const r = Math.random(); crashAt = Math.max(1.05, 0.97 / (1 - r * 0.97)); // ~5% мгновенный крах
    if (Math.random() < 0.05) crashAt = 1.0;
    live = true; cashed = false; mult = 1;
    $('c-start').disabled = true; $('c-cash').disabled = false;
    $('c-mult').classList.remove('crashed'); $('c-out').textContent = 'Летим... 🚀';
    clearInterval(crashTimer);
    crashTimer = setInterval(async () => {
      mult += mult * 0.06 + 0.01; $('c-mult').textContent = 'x' + mult.toFixed(2);
      if (mult >= crashAt) {
        clearInterval(crashTimer); live = false;
        $('c-mult').classList.add('crashed'); $('c-mult').textContent = '💥 x' + crashAt.toFixed(2);
        $('c-start').disabled = false; $('c-cash').disabled = true;
        if (!cashed) { await doBet('crash', bet, 0); $('c-out').textContent = `💥 Крах на x${crashAt.toFixed(2)} — ставка сгорела`; }
      }
    }, 120);
  };
  $('c-cash').onclick = async () => {
    if (!live || cashed) return; cashed = true; clearInterval(crashTimer); live = false;
    const win = Math.floor(bet * mult);
    $('c-start').disabled = false; $('c-cash').disabled = true;
    const rr = await doBet('crash', bet, win);
    if (rr) { $('c-out').textContent = `✅ Кэшаут x${mult.toFixed(2)}: +${fmt(win - bet)}!`; winModal('+' + fmt(win - bet), `Краш x${mult.toFixed(2)} 🚀`); }
  };
}

// БЛЕКДЖЕК
function renderBJ() {
  $('game-area').innerHTML = `<h3>🃏 БЛЕКДЖЕК</h3>${betControls(100)}
  <div class="small">Дилер: <span id="bj-d-score"></span></div><div class="cards" id="bj-d"></div>
  <div class="small">Ты: <span id="bj-p-score"></span></div><div class="cards" id="bj-p"></div>
  <div class="row" style="display:flex;gap:8px"><button class="btn neon" id="bj-deal" style="flex:1">РАЗДАТЬ</button><button class="btn ghost" id="bj-hit" style="flex:1" disabled>ЕЩЁ</button><button class="btn gold" id="bj-stand" style="flex:1" disabled>ХВАТИТ</button></div>
  <div class="small" id="bj-out">Набери 21, но не больше!</div>`;
  wireBetChips();
  const suits = ['♠', '♥', '♦', '♣'], ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  let deck = [], P = [], D = [], bet = 0, done = true;
  const val = h => { let s = 0, a = 0; for (const c of h) { const r = c.slice(0, -1); if (r === 'A') { s += 11; a++; } else if (['J', 'Q', 'K'].includes(r)) s += 10; else s += +r; } while (s > 21 && a) { s -= 10; a--; } return s; };
  const show = () => { $('bj-p').innerHTML = P.map(c => `<div class="card">${c}</div>`).join(''); $('bj-d').innerHTML = D.map(c => `<div class="card">${c}</div>`).join(''); $('bj-p-score').textContent = val(P); $('bj-d-score').textContent = val(D); };
  $('bj-deal').onclick = () => {
    bet = getBet(); if (ME.balance < bet) return toast('⛔ Мало монет!');
    deck = []; for (const s of suits) for (const r of ranks) deck.push(r + s);
    deck.sort(() => Math.random() - .5);
    P = [deck.pop(), deck.pop()]; D = [deck.pop(), deck.pop()]; done = false; show();
    $('bj-hit').disabled = false; $('bj-stand').disabled = false;
    if (val(P) === 21) $('bj-stand').click();
    else $('bj-out').textContent = 'Ещё или хватит?';
  };
  $('bj-hit').onclick = () => { if (done) return; P.push(deck.pop()); show(); if (val(P) > 21) finish(); };
  $('bj-stand').onclick = () => finish();
  async function finish() {
    if (done) return; done = true; $('bj-hit').disabled = true; $('bj-stand').disabled = true;
    while (val(D) < 17) { D.push(deck.pop()); show(); }
    const p = val(P), d = val(D); let win = 0, msg = '';
    if (p > 21) { win = 0; msg = `💥 Перебор ${p} — мимо`; }
    else if (d > 21) { win = bet * 2; msg = `🎉 Дилер перебрал ${d} — +${fmt(bet)}!`; }
    else if (p === 21 && P.length === 2 && d !== 21) { win = Math.floor(bet * 2.5); msg = `🃏 БЛЕКДЖЕК! +${fmt(win - bet)}!`; }
    else if (p > d) { win = bet * 2; msg = `✅ ${p} vs ${d} — +${fmt(bet)}!`; }
    else if (p === d) { win = bet; msg = `🤝 Ничья ${p} — возврат`; }
    else { win = 0; msg = `😅 ${p} vs ${d} — дилер выиграл`; }
    const r = await doBet('blackjack', bet, win);
    if (r) { $('bj-out').textContent = msg; if (win > bet) winModal('+' + fmt(win - bet), msg); }
  }
}

// ---------- КЕЙСЫ ----------
let CASES = [];
async function loadCases() {
  try {
    const d = await api('/api/cases'); CASES = d.cases;
    $('gift-row').innerHTML = Object.entries(d.gifts).map(([k, g]) => `<button class="gift" data-g="${k}">🎁 ${g.name}<br><b>+${fmt(g.coins)}</b></button>`).join('');
    document.querySelectorAll('.gift').forEach(b => b.onclick = async () => {
      const r = await api('/api/gift/deposit', { method: 'POST', body: JSON.stringify({ tg_id: TG_ID, gift: b.dataset.g }) });
      setBalance(r.balance); toast(`🎁 ${r.name}: +${fmt(r.coins)}!`); coinRain(15); refreshMe();
    });
  } catch (e) { CASES = [{ id: 'start', name: 'СТАРТ', price: 100, emoji: '📦' }, { id: 'neon', name: 'NEON', price: 500, emoji: '💠' }, { id: 'whale', name: 'WHALE', price: 2000, emoji: '🐋' }]; }
  $('cases-list').innerHTML = CASES.map(c => `<div class="case-card"><div class="case-emoji">${c.emoji}</div><div><b>${c.name}</b><br><span class="small">Цена: ${fmt(c.price)} • дроп до ${c.drops ? fmt(Math.max(...c.drops.map(x => x.price))) : '?'}</span></div><button class="btn gold" data-case="${c.id}">ОТКРЫТЬ</button></div>`).join('');
  document.querySelectorAll('[data-case]').forEach(b => b.onclick = () => openCase(b.dataset.case));
  renderInv();
}
function renderInv() {
  const inv = ME.inventory || [];
  $('inventory').innerHTML = inv.length ? inv.map(it => `<div class="inv-item rarity-${it.rarity}"><div class="e">${it.emoji}</div><b>${it.name}</b><br>${fmt(it.price)}<br><button class="chip" data-sell="${it.id}">Продать</button></div>`).join('') : '<div class="small">Пусто. Открой кейс!</div>';
  document.querySelectorAll('[data-sell]').forEach(b => b.onclick = async () => {
    try { const r = await api('/api/case/sell', { method: 'POST', body: JSON.stringify({ tg_id: TG_ID, item_id: +b.dataset.sell }) }); setBalance(r.balance); toast(`💰 Продано за ${fmt(r.price)}!`); refreshMe(); } catch (e) { toast('Ошибка продажи'); }
  });
}
async function openCase(caseId) {
  const c = CASES.find(x => x.id === caseId);
  if (ME.balance < (c?.price || 100)) return toast('⛔ Мало монет, потапай!');
  $('case-open-area').innerHTML = '<div class="strip" id="strip"></div><div class="small">Крутится...</div>';
  const emojis = ['🎈', '🧢', '☕', '🎧', '⌚', '🐱', '📱', '🚗', '🐉', '💎', '🏎️', '🏝️'];
  const strip = $('strip');
  for (let i = 0; i < 24; i++) strip.innerHTML += `<div class="strip-item">${emojis[Math.floor(Math.random() * emojis.length)]}</div>`;
  strip.scrollLeft = 0;
  let x = 0; const slide = setInterval(() => { x += 30; strip.scrollLeft = x; }, 50);
  try {
    const r = await api('/api/case/open', { method: 'POST', body: JSON.stringify({ tg_id: TG_ID, case_id: caseId }) });
    setTimeout(() => {
      clearInterval(slide);
      strip.innerHTML = `<div class="strip-item win">${r.item.emoji} ${r.item.name}</div>`;
      $('case-open-area').innerHTML += `<div class="small">${r.item.rarity.toUpperCase()} • цена продажи ${fmt(r.item.price)}</div>`;
      setBalance(r.balance); refreshMe();
      if (r.item.price >= (c?.price || 100)) winModal(r.item.emoji + ' ' + r.item.name, `Окупаемость! Продажа за ${fmt(r.item.price)} 💰`, r.item.emoji);
      else toast(`${r.item.emoji} ${r.item.name} (${fmt(r.item.price)})`);
    }, 1600);
  } catch (e) { clearInterval(slide); toast('⛔ ' + (String(e.message).includes('no_money') ? 'Не хватает монет!' : 'Ошибка')); $('case-open-area').innerHTML = ''; }
}

// ---------- ОНЛАЙН ----------
async function loadOnline() { await Promise.all([loadDuels(), loadTop(), loadChat(), loadLive()]); }
async function loadDuels() {
  try {
    const d = await api('/api/duels/open');
    $('duels-list').innerHTML = d.duels.length ? d.duels.map(x => `<div class="duel"><span>${x.game === 'coinflip' ? '🪙' : x.game === 'rps' ? '✊' : '🎲'} <b>${fmt(x.bet)}</b> от ${x.creator_name}</span><button class="btn neon" data-join="${x.id}">В БОЙ</button></div>`).join('') : '<div class="small">Нет открытых дуэлей — создай первую!</div>';
    document.querySelectorAll('[data-join]').forEach(b => b.onclick = async () => {
      try { const r = await api('/api/duels/join', { method: 'POST', body: JSON.stringify({ duel_id: +b.dataset.join, user_id: TG_ID, user_name: FIRST }) }); setBalance(ME.balance); refreshMe(); loadDuels(); r.you_won ? winModal('+' + fmt(r.bank), 'Ты выиграл дуэль! ⚔️', '⚔️') : toast('😅 Дуэль проиграна...'); }
      catch (e) { toast('⛔ ' + e.message.slice(0, 60)); }
    });
  } catch (e) { $('duels-list').innerHTML = '<div class="small">Офлайн</div>'; }
}
$('duel-create-btn').onclick = async () => {
  const bet = Math.max(10, parseInt($('duel-bet').value || '100'));
  try { await api('/api/duels/create', { method: 'POST', body: JSON.stringify({ creator_id: TG_ID, creator_name: FIRST, game: $('duel-game').value, bet }) }); toast('⚔️ Дуэль создана! Жди соперника.'); refreshMe(); loadDuels(); } catch (e) { toast('⛔ ' + e.message.slice(0, 80)); }
};
async function loadTop() {
  try { const d = await api('/api/leaderboard?limit=10'); $('leaderboard').innerHTML = d.top.map((u, i) => `<div class="lb-row"><span>${['🥇', '🥈', '🥉'][i] || '▪️'} ${(u.username ? '@' + u.username : u.first_name || u.tg_id)}${u.tg_id === TG_ID ? ' (ты)' : ''}</span><b>${fmt(u.balance)}</b></div>`).join(''); }
  catch (e) { $('leaderboard').innerHTML = '<div class="small">Офлайн</div>'; }
}
async function loadLive() {
  try {
    const d = await api('/api/live?limit=8');
    $('live-track').textContent = d.feed.map(f => `${f.username ? '@' + f.username : f.first_name || 'Игрок'} ${f.win > f.bet ? `выиграл ${fmt(f.win - f.bet)}` : 'слил ' + fmt(f.bet)} в ${f.game}`).join('  •  ') || '🎰 Делай ставки — попадёшь в ленту!';
  } catch (e) {}
}
async function loadChat() {
  try { const d = await api('/api/chat?limit=20'); $('chat-box').innerHTML = d.messages.map(m => `<div><b>${m.name}:</b> ${m.text.replace(/</g, '&lt;')}</div>`).join(''); $('chat-box').scrollTop = 9999; } catch (e) {}
}
$('chat-btn').onclick = async () => {
  const t = $('chat-input').value.trim(); if (!t) return;
  $('chat-input').value = '';
  try { await api('/api/chat', { method: 'POST', body: JSON.stringify({ tg_id: TG_ID, name: FIRST, text: t }) }); loadChat(); } catch (e) { toast('Офлайн'); }
};

// ---------- ПРОФИЛЬ + АДМИН ----------
function renderProfile() {
  $('pname').textContent = FIRST + (USERNAME ? ' (@' + USERNAME + ')' : '');
  $('pid').textContent = 'ID: ' + TG_ID;
  $('profile-stats').innerHTML = `<div class="pstat">💰<br><b>${fmtB(ME.balance)}</b><br>баланс</div><div class="pstat">👆<br><b>${fmt(ME.total_tapped || 0)}</b><br>тапов</div><div class="pstat">🎲<br><b>${ME.games_played || 0}</b><br>игр</div><div class="pstat">📊<br><b>${fmt(ME.total_wagered || 0)}</b><br>проставлено</div>`;
  if (ADMIN_IDS.includes(TG_ID)) { $('admin-panel').style.display = 'block'; $('admin-id').textContent = TG_ID; }
}
$('adm-give').onclick = async () => {
  const t = parseInt($('adm-target').value), a = parseInt($('adm-amount').value);
  if (!t || !a) return toast('Введи ID и сумму');
  try { const r = await api('/api/admin/give', { method: 'POST', body: JSON.stringify({ admin_id: TG_ID, target_id: t, amount: a }) }); $('adm-out').textContent = `✅ Выдано. Баланс ${t}: ${fmt(r.balance)}`; if (t === TG_ID) setBalance(r.balance); } catch (e) { $('adm-out').textContent = '❌ ' + e.message.slice(0, 100); }
};
$('adm-take').onclick = async () => {
  const t = parseInt($('adm-target').value), a = parseInt($('adm-amount').value);
  if (!t || !a) return toast('Введи ID и сумму');
  try { const r = await api('/api/admin/take', { method: 'POST', body: JSON.stringify({ admin_id: TG_ID, target_id: t, amount: a }) }); $('adm-out').textContent = `✅ Забрано. Баланс ${t}: ${fmt(r.balance)}`; if (t === TG_ID) setBalance(r.balance); } catch (e) { $('adm-out').textContent = '❌ ' + e.message.slice(0, 100); }
};
$('adm-stats').onclick = async () => {
  try { const r = await api(`/api/admin/stats?admin_id=${TG_ID}`); $('adm-out').textContent = `👥 ${r.users} юзеров • 💰 ${fmt(r.total_balance)} монет • 🎲 ${fmt(r.total_wagered)} проставлено`; } catch (e) { $('adm-out').textContent = '❌ Ошибка'; }
};

// ---------- старт ----------
bgInit(); initUser(); renderSlots();
setInterval(() => { loadLive(); }, 10000);
setInterval(() => { if ($('page-online').classList.contains('active')) loadOnline(); }, 8000);

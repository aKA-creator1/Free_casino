"""Backend казино: FastAPI + SQLite. Запуск: uvicorn main:app --app-dir backend --port 8000"""
import os
import sys
import time
import random
sys.path.insert(0, os.path.dirname(__file__))
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

try:
    import db as database
except ModuleNotFoundError:
    from backend import db as database

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))
ADMIN_IDS = set()
for x in os.getenv("ADMIN_IDS", "6665950252").split(","):
    x = x.strip()
    if x.isdigit():
        ADMIN_IDS.add(int(x))

START_BONUS = int(os.getenv("START_BONUS", "1000"))

app = FastAPI(title="Casino MiniApp Backend")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

database.init_db()

# ---------- модели ----------
class InitUser(BaseModel):
    tg_id: int
    username: str = ""
    first_name: str = ""

class TapReq(BaseModel):
    tg_id: int

class BetReq(BaseModel):
    tg_id: int
    game: str = "game"
    bet: int = 0
    win: int = 0

class CaseOpen(BaseModel):
    tg_id: int
    case_id: str = "start"

class SellReq(BaseModel):
    tg_id: int
    item_id: int

class DuelCreate(BaseModel):
    creator_id: int
    creator_name: str = "Игрок"
    game: str = "coinflip"
    bet: int = 100

class DuelJoin(BaseModel):
    duel_id: int
    user_id: int
    user_name: str = "Игрок"

class AdminGive(BaseModel):
    admin_id: int
    target_id: int
    amount: int

class ChatPost(BaseModel):
    tg_id: int
    name: str = "Игрок"
    text: str = ""

class GiftDeposit(BaseModel):
    tg_id: int
    gift: str = "rose"

# ---------- кейсы и подарки (как CaseBattle) ----------
CASES = {
    "start": {"name": "СТАРТ", "price": 100, "emoji": "📦", "color": "#38bdf8"},
    "neon": {"name": "NEON", "price": 500, "emoji": "💠", "color": "#a78bfa"},
    "whale": {"name": "WHALE", "price": 2000, "emoji": "🐋", "color": "#fbbf24"},
}
# (название, эмодзи, редкость, шанс, цена продажи)
CASE_DROPS = {
    "start": [
        ("Стикер", "🎈", "common", 45, 40),
        ("Кепка", "🧢", "common", 30, 80),
        ("Кружка", "☕", "uncommon", 15, 180),
        ("Наушники", "🎧", "rare", 7, 400),
        ("Часы", "⌚", "epic", 2.5, 1200),
        ("NFT Кот", "🐱", "legendary", 0.5, 5000),
    ],
    "neon": [
        ("Неон-брелок", "🔑", "common", 40, 200),
        ("Кроссовки", "👟", "common", 30, 400),
        ("Геймпад", "🎮", "uncommon", 15, 900),
        ("Айфон", "📱", "rare", 9, 2000),
        ("Тесла", "🚗", "epic", 4.5, 6000),
        ("Дракон", "🐉", "legendary", 1.5, 25000),
    ],
    "whale": [
        ("Голда", "🪙", "common", 35, 800),
        ("Ролекс", "⌚", "uncommon", 30, 1800),
        ("Подарок TG", "🎁", "rare", 18, 4500),
        ("Premium год", "💎", "epic", 12, 12000),
        ("Ламбо", "🏎️", "legendary", 4, 40000),
        ("Остров", "🏝️", "mythic", 1, 150000),
    ],
}
GIFTS = {  # "депозит" подарка ТГ -> монеты (всё виртуально)
    "rose": {"name": "Роза 🌹", "coins": 500},
    "cake": {"name": "Торт 🎂", "coins": 1200},
    "rocket": {"name": "Ракета 🚀", "coins": 5500},
    "ring": {"name": "Кольцо 💍", "coins": 22000},
    "bear": {"name": "Мишка 🧸", "coins": 3000},
}

def roll_case(case_id):
    drops = CASE_DROPS.get(case_id, CASE_DROPS["start"])
    r = random.random() * 100
    acc = 0
    for name, emoji, rarity, chance, price in drops:
        acc += chance
        if r <= acc:
            return {"name": name, "emoji": emoji, "rarity": rarity, "price": price}
    name, emoji, rarity, chance, price = drops[0]
    return {"name": name, "emoji": emoji, "rarity": rarity, "price": price}

def user_public(u: dict):
    inv = database.get_inventory(u["tg_id"])
    return {
        "tg_id": u["tg_id"], "username": u.get("username", ""),
        "first_name": u.get("first_name", ""), "balance": u["balance"],
        "level": u.get("level", 1), "total_tapped": u.get("total_tapped", 0),
        "taps_today": u.get("taps_today", 0),
        "total_wagered": u.get("total_wagered", 0),
        "total_won": u.get("total_won", 0),
        "games_played": u.get("games_played", 0),
        "inventory": inv,
    }

# ---------- routes ----------
@app.get("/api/health")
def health():
    return {"ok": True, "time": int(time.time())}

@app.post("/api/user/init")
def api_init(u: InitUser):
    user = database.get_or_create_user(u.tg_id, u.username, u.first_name)
    return user_public(user)

@app.get("/api/user/{tg_id}")
def api_user(tg_id: int):
    u = database.get_user(tg_id)
    if not u:
        raise HTTPException(404, "no_user")
    return user_public(u)

@app.post("/api/tap")
def api_tap(r: TapReq):
    res = database.tap(r.tg_id)
    if not res:
        raise HTTPException(404, "no_user — сначала /api/user/init")
    return res

@app.post("/api/bet")
def api_bet(r: BetReq):
    # защита от накрутки: win не может быть абсурдным (макс x100 от ставки)
    if r.win > r.bet * 100:
        raise HTTPException(400, "suspicious_win")
    res = database.apply_bet(r.tg_id, r.game[:32], int(r.bet), int(r.win))
    if not res.get("ok"):
        raise HTTPException(400, res.get("error", "bet_failed"))
    return res

@app.get("/api/leaderboard")
def api_top(limit: int = 20):
    return {"top": database.leaderboard(min(limit, 50))}

@app.get("/api/live")
def api_live(limit: int = 15):
    return {"feed": database.live_feed(min(limit, 30))}

@app.get("/api/cases")
def api_cases():
    out = []
    for cid, c in CASES.items():
        out.append({"id": cid, **c, "drops": [
            {"name": n, "emoji": e, "rarity": r, "price": p} for n, e, r, ch, p in CASE_DROPS[cid]]})
    return {"cases": out, "gifts": GIFTS}

@app.post("/api/case/open")
def api_case_open(r: CaseOpen):
    case = CASES.get(r.case_id)
    if not case:
        raise HTTPException(400, "bad_case")
    u = database.get_user(r.tg_id)
    if not u:
        raise HTTPException(404, "no_user")
    if u["balance"] < case["price"]:
        raise HTTPException(400, "no_money")
    item = roll_case(r.case_id)
    res = database.apply_bet(r.tg_id, f"case_{r.case_id}", case["price"], 0)
    if not res.get("ok"):
        raise HTTPException(400, "no_money")
    item_id = database.add_item(r.tg_id, item["name"], item["emoji"], item["rarity"], item["price"])
    return {"ok": True, "item": {**item, "id": item_id}, "balance": res["balance"]}

@app.post("/api/case/sell")
def api_sell(r: SellReq):
    res = database.sell_item(r.tg_id, r.item_id)
    if not res:
        raise HTTPException(400, "no_item")
    return {"ok": True, **res}

@app.post("/api/gift/deposit")
def api_gift(g: GiftDeposit):
    gift = GIFTS.get(g.gift)
    if not gift:
        raise HTTPException(400, "bad_gift")
    u = database.get_user(g.tg_id)
    if not u:
        raise HTTPException(404, "no_user")
    # виртуальный депозит подарка: +монеты
    updated = database.admin_add(g.tg_id, gift["coins"])
    # пометим в историю как gift
    return {"ok": True, "coins": gift["coins"], "balance": updated["balance"], "name": gift["name"]}

# ----- PvP дуэли -----
@app.post("/api/duels/create")
def duel_create(r: DuelCreate):
    if r.bet < 10:
        raise HTTPException(400, "min_bet_10")
    u = database.get_user(r.creator_id)
    if not u or u["balance"] < r.bet:
        raise HTTPException(400, "no_money")
    database.apply_bet(r.creator_id, f"duel_{r.game}_create", r.bet, 0)
    import sqlite3 as _s
    with database._lock:
        c = database.get_conn()
        cur = c.execute("INSERT INTO duels(game,bet,creator_id,creator_name,created_at) VALUES(?,?,?,?,?)",
                        (r.game[:16], int(r.bet), r.creator_id, r.creator_name[:32], int(time.time())))
        c.commit()
        did = cur.lastrowid
    return {"ok": True, "duel_id": did}

@app.get("/api/duels/open")
def duel_open():
    with database._lock:
        c = database.get_conn()
        rows = c.execute("SELECT * FROM duels WHERE status='waiting' ORDER BY id DESC LIMIT 20").fetchall()
        return {"duels": [dict(r) for r in rows]}

@app.post("/api/duels/join")
def duel_join(r: DuelJoin):
    with database._lock:
        c = database.get_conn()
        d = c.execute("SELECT * FROM duels WHERE id=?", (r.duel_id,)).fetchone()
        if not d:
            raise HTTPException(404, "no_duel")
        d = dict(d)
        if d["status"] != "waiting":
            raise HTTPException(400, "already_taken")
        if d["creator_id"] == r.user_id:
            raise HTTPException(400, "self_join")
    u = database.get_user(r.user_id)
    if not u or u["balance"] < d["bet"]:
        raise HTTPException(400, "no_money")
    database.apply_bet(r.user_id, "duel_join", d["bet"], 0)
    # разыгрываем: 50/50, комиссия 5% (сжигаем — анти-инфляция для лудомании)
    winner = d["creator_id"] if random.random() < 0.5 else r.user_id
    bank = int(d["bet"] * 2 * 0.95)
    database.admin_add(winner, bank)
    with database._lock:
        c = database.get_conn()
        c.execute("UPDATE duels SET status='done', opponent_id=?, winner_id=? WHERE id=?",
                  (r.user_id, winner, r.duel_id))
        c.commit()
    # чистим старые дуэли
    with database._lock:
        c = database.get_conn()
        c.execute("DELETE FROM duels WHERE status='done' AND id NOT IN (SELECT id FROM duels ORDER BY id DESC LIMIT 30)")
        c.execute("DELETE FROM duels WHERE status='waiting' AND created_at < ?", (int(time.time()) - 3600,))
        c.commit()
    return {"ok": True, "winner_id": winner, "bank": bank, "you_won": winner == r.user_id}

# ----- чат -----
@app.get("/api/chat")
def chat_get(limit: int = 20):
    with database._lock:
        c = database.get_conn()
        rows = c.execute("SELECT * FROM chat ORDER BY id DESC LIMIT ?", (min(limit, 30),)).fetchall()
        return {"messages": list(reversed([dict(r) for r in rows]))}

@app.post("/api/chat")
def chat_post(m: ChatPost):
    text = m.text.strip()[:200]
    if not text:
        raise HTTPException(400, "empty")
    with database._lock:
        c = database.get_conn()
        c.execute("INSERT INTO chat(tg_id,name,text,created_at) VALUES(?,?,?,?)",
                  (m.tg_id, m.name[:32], text, int(time.time())))
        c.execute("DELETE FROM chat WHERE id NOT IN (SELECT id FROM chat ORDER BY id DESC LIMIT 50)")
        c.commit()
    return {"ok": True}

# ----- админка -----
def need_admin(admin_id: int):
    if admin_id not in ADMIN_IDS:
        raise HTTPException(403, "not_admin")

@app.post("/api/admin/give")
def admin_give(r: AdminGive):
    need_admin(r.admin_id)
    u = database.admin_add(r.target_id, int(r.amount))
    return {"ok": True, "balance": u["balance"], "user": user_public(u)}

@app.post("/api/admin/take")
def admin_take(r: AdminGive):
    need_admin(r.admin_id)
    u = database.admin_add(r.target_id, -int(r.amount))
    if u["balance"] < 0:
        database.admin_add(r.target_id, -u["balance"])
        u = database.get_user(r.target_id)
    return {"ok": True, "balance": u["balance"]}

@app.get("/api/admin/stats")
def admin_stats(admin_id: int):
    need_admin(admin_id)
    return {"ok": True, **database.admin_stats()}

# раздача фронтенда (когда запускаем один процесс)
FRONT = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(FRONT):
    app.mount("/", StaticFiles(directory=FRONT, html=True), name="front")

"""SQLite слой для казино. Без реальных денег."""
import sqlite3
import threading
import time
import json
import os

def _default_db():
    env = os.getenv("DATABASE_PATH")
    if env:
        return env
    # На Bothost персистентна только /app/data — база переживёт redeploy
    if os.path.isdir("/app/data"):
        return "/app/data/casino.db"
    return os.path.join(os.path.dirname(__file__), "casino.db")


DB_PATH = _default_db()
try:
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)
except Exception:
    pass
_lock = threading.Lock()
_conn = None


def get_conn():
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
    return _conn


def init_db():
    with _lock:
        c = get_conn()
        c.execute("""CREATE TABLE IF NOT EXISTS users(
            tg_id INTEGER PRIMARY KEY,
            username TEXT DEFAULT '',
            first_name TEXT DEFAULT '',
            balance INTEGER DEFAULT 1000,
            total_tapped INTEGER DEFAULT 0,
            taps_today INTEGER DEFAULT 0,
            tap_day TEXT DEFAULT '',
            total_wagered INTEGER DEFAULT 0,
            total_won INTEGER DEFAULT 0,
            games_played INTEGER DEFAULT 0,
            level INTEGER DEFAULT 1,
            created_at INTEGER DEFAULT 0
        )""")
        c.execute("""CREATE TABLE IF NOT EXISTS inventory(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tg_id INTEGER,
            name TEXT,
            emoji TEXT,
            rarity TEXT,
            price INTEGER,
            sold INTEGER DEFAULT 0,
            created_at INTEGER DEFAULT 0
        )""")
        c.execute("""CREATE TABLE IF NOT EXISTS duels(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game TEXT,
            bet INTEGER,
            creator_id INTEGER,
            creator_name TEXT,
            opponent_id INTEGER DEFAULT 0,
            status TEXT DEFAULT 'waiting',
            winner_id INTEGER DEFAULT 0,
            created_at INTEGER DEFAULT 0
        )""")
        c.execute("""CREATE TABLE IF NOT EXISTS history(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tg_id INTEGER,
            game TEXT,
            bet INTEGER,
            win INTEGER,
            created_at INTEGER DEFAULT 0
        )""")
        c.execute("""CREATE TABLE IF NOT EXISTS chat(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tg_id INTEGER,
            name TEXT,
            text TEXT,
            created_at INTEGER DEFAULT 0
        )""")
        c.commit()


def _today():
    return time.strftime("%Y-%m-%d")


def get_or_create_user(tg_id: int, username="", first_name=""):
    with _lock:
        c = get_conn()
        row = c.execute("SELECT * FROM users WHERE tg_id=?", (tg_id,)).fetchone()
        if row:
            # обновим ник если поменялся
            if username and row["username"] != username:
                c.execute("UPDATE users SET username=?, first_name=? WHERE tg_id=?",
                          (username, first_name, tg_id))
                c.commit()
            return dict(row)
        now = int(time.time())
        c.execute("INSERT INTO users(tg_id,username,first_name,balance,created_at,tap_day) VALUES(?,?,?,?,?,?)",
                  (tg_id, username, first_name, 1000, now, _today()))
        c.commit()
        row = c.execute("SELECT * FROM users WHERE tg_id=?", (tg_id,)).fetchone()
        # приветственный бонус в историю
        c.execute("INSERT INTO history(tg_id,game,bet,win,created_at) VALUES(?,?,?,?,?)",
                  (tg_id, "bonus_start", 0, 1000, now))
        c.commit()
        return dict(row)


def get_user(tg_id: int):
    with _lock:
        c = get_conn()
        row = c.execute("SELECT * FROM users WHERE tg_id=?", (tg_id,)).fetchone()
        return dict(row) if row else None


def tap(tg_id: int):
    """Тапалка с безлимитной энергией, но анти-зажор:
    база 0.5 монеты, 10% шанс x5, 1% шанс x20.
    За ~5 мин активного тапа выходит ~500-600 монет — на первый деп.
    После 1000 тапов в день база 0.25, после 3000 криты урезаются.
    Баланс хранится дробным, отображение округляет вниз."""
    import random
    with _lock:
        c = get_conn()
        row = c.execute("SELECT * FROM users WHERE tg_id=?", (tg_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        today = _today()
        taps_today = d["taps_today"] if d["tap_day"] == today else 0
        base = 0.5 if taps_today < 1000 else 0.25
        roll = random.random()
        if taps_today >= 3000:
            mult, crit = (5, True) if roll < 0.02 else (1, False)
        else:
            if roll < 0.01:
                mult, crit = 20, True
            elif roll < 0.11:
                mult, crit = 5, True
            else:
                mult, crit = 1, False
        gain = base * mult
        # уровень: каждые 500 тапов +1, каждый уровень +0 (просто понты + бонус к дейли)
        total_tapped = d["total_tapped"] + 1
        level = total_tapped // 500 + 1
        new_bal = d["balance"] + gain
        c.execute("UPDATE users SET balance=?, total_tapped=?, taps_today=?, tap_day=?, level=? WHERE tg_id=?",
                  (new_bal, total_tapped, taps_today + 1, today, level, tg_id))
        c.commit()
        return {"gain": gain, "balance": new_bal, "crit": crit, "mult": mult,
                "taps_today": taps_today + 1, "level": level}


def apply_bet(tg_id: int, game: str, bet: int, win: int):
    """Списывает ставку и начисляет выигрыш. win=0 => проигрыш."""
    with _lock:
        c = get_conn()
        row = c.execute("SELECT * FROM users WHERE tg_id=?", (tg_id,)).fetchone()
        if not row:
            return {"ok": False, "error": "no_user"}
        d = dict(row)
        if bet <= 0:
            return {"ok": False, "error": "bad_bet"}
        if d["balance"] < bet:
            return {"ok": False, "error": "no_money"}
        new_bal = d["balance"] - bet + win
        c.execute("UPDATE users SET balance=?, total_wagered=total_wagered+?, total_won=total_won+?, games_played=games_played+1 WHERE tg_id=?",
                  (new_bal, bet, win, tg_id))
        c.execute("INSERT INTO history(tg_id,game,bet,win,created_at) VALUES(?,?,?,?,?)",
                  (tg_id, game, bet, win, int(time.time())))
        # держим историю короткой
        c.execute("DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT 60)")
        c.commit()
        return {"ok": True, "balance": new_bal, "profit": win - bet}


def leaderboard(limit=20):
    with _lock:
        c = get_conn()
        rows = c.execute("SELECT tg_id,username,first_name,balance,level FROM users ORDER BY balance DESC LIMIT ?",
                         (limit,)).fetchall()
        return [dict(r) for r in rows]


def live_feed(limit=15):
    with _lock:
        c = get_conn()
        rows = c.execute("""SELECT h.game,h.bet,h.win,h.created_at,u.username,u.first_name
            FROM history h LEFT JOIN users u ON u.tg_id=h.tg_id
            ORDER BY h.id DESC LIMIT ?""", (limit,)).fetchall()
        return [dict(r) for r in rows]


def get_inventory(tg_id: int):
    with _lock:
        c = get_conn()
        rows = c.execute("SELECT * FROM inventory WHERE tg_id=? AND sold=0 ORDER BY id DESC", (tg_id,)).fetchall()
        return [dict(r) for r in rows]


def add_item(tg_id, name, emoji, rarity, price):
    with _lock:
        c = get_conn()
        cur = c.execute("INSERT INTO inventory(tg_id,name,emoji,rarity,price,created_at) VALUES(?,?,?,?,?,?)",
                        (tg_id, name, emoji, rarity, price, int(time.time())))
        c.commit()
        return cur.lastrowid


def sell_item(tg_id, item_id):
    with _lock:
        c = get_conn()
        row = c.execute("SELECT * FROM inventory WHERE id=? AND tg_id=? AND sold=0", (item_id, tg_id)).fetchone()
        if not row:
            return None
        d = dict(row)
        c.execute("UPDATE inventory SET sold=1 WHERE id=?", (item_id,))
        c.execute("UPDATE users SET balance=balance+? WHERE tg_id=?", (d["price"], tg_id))
        bal = c.execute("SELECT balance FROM users WHERE tg_id=?", (tg_id,)).fetchone()["balance"]
        c.commit()
        return {"price": d["price"], "balance": bal}


def admin_add(target_id, amount):
    with _lock:
        c = get_conn()
        row = c.execute("SELECT * FROM users WHERE tg_id=?", (target_id,)).fetchone()
        if not row:
            # создадим пустого юзера чтобы было кому дать
            now = int(time.time())
            c.execute("INSERT INTO users(tg_id,username,balance,created_at,tap_day) VALUES(?,?,?, ?,?)",
                      (target_id, "", amount if amount > 0 else 1000, now, _today()))
            c.commit()
            r2 = c.execute("SELECT * FROM users WHERE tg_id=?", (target_id,)).fetchone()
            return dict(r2)
        c.execute("UPDATE users SET balance=balance+? WHERE tg_id=?", (amount, target_id))
        c.execute("INSERT INTO history(tg_id,game,bet,win,created_at) VALUES(?,?,?,?,?)",
                  (target_id, "admin_give", 0, amount, int(time.time())))
        c.commit()
        r = c.execute("SELECT * FROM users WHERE tg_id=?", (target_id,)).fetchone()
        return dict(r)


def admin_stats():
    with _lock:
        c = get_conn()
        n = c.execute("SELECT COUNT(*) c FROM users").fetchone()["c"]
        s = c.execute("SELECT COALESCE(SUM(balance),0) s FROM users").fetchone()["s"]
        w = c.execute("SELECT COALESCE(SUM(total_wagered),0) s FROM users").fetchone()["s"]
        return {"users": n, "total_balance": s, "total_wagered": w}

"""Telegram-бот казино (aiogram 3). Без реальных денег — только виртуальные монеты."""
import os
import sys
import asyncio
# чтобы эмодзи в print не роняли бота в консоли Windows (cp1251)
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass
from aiogram import Bot, Dispatcher, F
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from aiogram.filters import Command
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

TOKEN = os.getenv("BOT_TOKEN", "ВСТАВЬ_ТОКЕН_СЮДА")
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://твой-домен/miniapp/")
ADMIN_IDS = {int(x) for x in os.getenv("ADMIN_IDS", "6665950252").split(",") if x.strip().isdigit()}
START_BONUS = os.getenv("START_BONUS", "1000")

bot = Bot(TOKEN)
dp = Dispatcher()

def coins(v):
    """Красивый вывод баланса (тап 0.5 даёт дробные хвосты)."""
    try:
        f = float(v)
        return str(int(f)) if f.is_integer() else str(round(f, 1)).replace(".", ",")
    except Exception:
        return str(v)

# backend-доступ напрямую через sqlite (бот и API живут рядом)
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
import db as database
database.init_db()


def webapp_kb():
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="🎰 ОТКРЫТЬ КАЗИНО", web_app=WebAppInfo(url=WEBAPP_URL))
    ], [
        InlineKeyboardButton(text="👤 Баланс", callback_data="balance"),
        InlineKeyboardButton(text="🏆 Топ", callback_data="top"),
    ]])


@dp.message(Command("start"))
async def start(m: Message):
    u = database.get_or_create_user(m.from_user.id, m.from_user.username or "", m.from_user.first_name or "")
    await m.answer(
        f"🎰 <b>NEON CASINO</b> — привет, {m.from_user.first_name}!\n\n"
        f"💰 У тебя <b>{coins(u['balance'])}</b> монет (стартовый бонус {START_BONUS})\n"
        f"👆 Тапай монетку в мини-аппе и фарми на первый деп\n"
        f"🎲 7 игр: слоты, дайс, рулетка, мины, краш, блекджек, кейсы\n"
        f"⚔️ PvP-дуэли, рейтинг, live-лента, чат\n\n"
        f"⚠️ <i>Всё виртуально, без реальных денег. Просто лудомания для фана.</i>",
        parse_mode="HTML", reply_markup=webapp_kb())


@dp.message(Command("balance"))
async def balance(m: Message):
    u = database.get_or_create_user(m.from_user.id, m.from_user.username or "", m.from_user.first_name or "")
    await m.answer(f"💰 Баланс: <b>{coins(u['balance'])}</b> монет\n👆 Тапов: {u['total_tapped']} | 🎮 Игр: {u['games_played']}",
                   parse_mode="HTML")


@dp.message(Command("top"))
async def top(m: Message):
    rows = database.leaderboard(10)
    txt = "🏆 <b>ТОП-10 БОГАЧЕЙ:</b>\n\n"
    medals = ["🥇", "🥈", "🥉"] + ["▪️"] * 7
    for i, r in enumerate(rows):
        name = r["username"] and ("@" + r["username"]) or (r["first_name"] or str(r["tg_id"]))
        you = " ← ТЫ" if r["tg_id"] == m.from_user.id else ""
        txt += f"{medals[i]} {name} — <b>{r['balance']}</b>{you}\n"
    await m.answer(txt, parse_mode="HTML")


@dp.message(Command("daily"))
async def daily(m: Message):
    import time
    # простой дейли-бонус 500: выдаём через историю ставок нельзя — даём напрямую
    u = database.get_or_create_user(m.from_user.id, m.from_user.username or "", m.from_user.first_name or "")
    # кулдаун через файл? проще: даём если последняя history daily была >20ч назад
    await m.answer("🎁 Дейли-бонус: забирай в мини-аппе во вкладке Профиль (там кнопка с таймером)!")


def is_admin(uid: int):
    return uid in ADMIN_IDS


@dp.message(Command("give"))
async def give(m: Message):
    """Админ: /give 123456 5000  или ответом на сообщение"""
    if not is_admin(m.from_user.id):
        return await m.answer("⛔ Только для админа.")
    parts = m.text.split()
    target = None
    amount = None
    if m.reply_to_message:
        target = m.reply_to_message.from_user.id
        amount = int(parts[1]) if len(parts) > 1 and parts[1].lstrip("-").isdigit() else None
    elif len(parts) >= 3 and parts[1].isdigit() and parts[2].lstrip("-").isdigit():
        target, amount = int(parts[1]), int(parts[2])
    if not target or amount is None:
        return await m.answer("Использование: <code>/give &lt;tg_id&gt; &lt;сумма&gt;</code>\nили ответом на сообщение: <code>/give 5000</code>", parse_mode="HTML")
    u = database.admin_add(target, amount)
    await m.answer(f"✅ Выдано <b>{amount}</b> монет юзеру <code>{target}</code>\n💰 Новый баланс: <b>{coins(u['balance'])}</b>", parse_mode="HTML")
    try:
        await bot.send_message(target, f"🎁 Админ начислил тебе <b>{amount}</b> монет!\n💰 Баланс: <b>{coins(u['balance'])}</b>", parse_mode="HTML")
    except Exception:
        pass


@dp.message(Command("take"))
async def take(m: Message):
    if not is_admin(m.from_user.id):
        return await m.answer("⛔ Только для админа.")
    parts = m.text.split()
    target, amount = None, None
    if m.reply_to_message:
        target = m.reply_to_message.from_user.id
        amount = int(parts[1]) if len(parts) > 1 and parts[1].lstrip("-").isdigit() else None
    elif len(parts) >= 3 and parts[1].isdigit() and parts[2].lstrip("-").isdigit():
        target, amount = int(parts[1]), int(parts[2])
    if not target or amount is None:
        return await m.answer("Использование: <code>/take &lt;tg_id&gt; &lt;сумма&gt;</code>", parse_mode="HTML")
    u = database.admin_add(target, -amount)
    if u["balance"] < 0:
        database.admin_add(target, -u["balance"])
        u = database.get_user(target)
    await m.answer(f"✅ Забрано <b>{amount}</b> у <code>{target}</code>\n💰 Баланс: <b>{coins(u['balance'])}</b>", parse_mode="HTML")


@dp.message(Command("stats"))
async def stats(m: Message):
    if not is_admin(m.from_user.id):
        return await m.answer("⛔ Только для админа.")
    s = database.admin_stats()
    await m.answer(f"📊 <b>Статистика:</b>\n👥 Юзеров: {s['users']}\n💰 Всего монет: {s['total_balance']}\n🎲 Проставлено: {s['total_wagered']}", parse_mode="HTML")


@dp.message(Command("help"))
async def help_cmd(m: Message):
    txt = ("📖 <b>Команды:</b>\n/start — открыть казино\n/balance — баланс\n/top — топ игроков\n"
           "/daily — про дейли\n/help — помощь")
    if is_admin(m.from_user.id):
        txt += "\n\n🛠 <b>Админ:</b>\n/give &lt;id&gt; &lt;сумма&gt;\n/take &lt;id&gt; &lt;сумма&gt;\n/stats"
    await m.answer(txt, parse_mode="HTML")


async def main():
    if TOKEN.startswith("ВСТАВЬ"):
        print("❌ Вставь BOT_TOKEN в файл .env (возьми у @BotFather)")
        return
    print("🤖 Бот запущен...")
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())

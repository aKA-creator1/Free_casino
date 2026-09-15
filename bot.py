"""NEON CASINO — единая точка входа.
Запускает backend (API + мини-апп) и Telegram-бота в одном процессе.

Оптимизация под Bothost:
- файл в корне с именем bot.py — автоопределение находит его само,
  галочка Dockerfile тоже подходит (CMD уже настроен);
- порт берётся из переменной PORT (дефолт 5005);
- база берётся из DATABASE_PATH, иначе /app/data/casino.db (если есть),
  иначе локальный backend/casino.db — данные переживают redeploy.

Локально:  python bot.py
"""
import asyncio
import os
import sys
import threading

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(BASE, "backend"))
sys.path.insert(0, os.path.join(BASE, "bot"))

try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=os.path.join(BASE, ".env"))
except Exception:
    pass

PORT = int(os.getenv("PORT", "5005"))


def load_module(name, path):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def main():
    print(f"[entry] backend + bot starting, PORT={PORT}", flush=True)
    backend = load_module("casino_backend", os.path.join(BASE, "backend", "main.py"))

    import uvicorn
    server = uvicorn.Server(uvicorn.Config(
        backend.app, host="0.0.0.0", port=PORT, log_level="info",
    ))

    token = os.getenv("BOT_TOKEN", "")
    if not token or token.startswith("ВСТАВЬ"):
        print("[entry] BOT_TOKEN не задан — работаю только как веб-сервер", flush=True)
        server.run()
        return

    botmod = load_module("casino_bot", os.path.join(BASE, "bot", "bot.py"))
    threading.Thread(target=server.run, daemon=True).start()
    asyncio.run(botmod.main())


if __name__ == "__main__":
    main()

@echo off
chcp 65001 >nul
title NEON CASINO launcher
cd /d "%~dp0"
if not exist .env ( copy .env.example .env >nul & echo [i] Создан .env - вставь BOT_TOKEN! )
if not exist backend\casino.db ( echo [i] База создастся сама при старте )
python -m pip install -r requirements.txt
start "casino" cmd /k "chcp 65001 >nul & python -u bot.py"
echo.
echo ============================================
echo  Всё в одном окне: backend + мини-апп + бот
echo  Мини-апп: http://localhost:5005/ (открой в браузере)
echo  Для Telegram: пробрось через ngrok: ngrok http 5005
echo  и вставь https-ссылку в .env как WEBAPP_URL, затем /setmenubutton у BotFather
echo ============================================
pause

#!/bin/sh
# ТОЧКА ВХОДА (запасной вариант): один процесс backend + бот.
# Порт берётся из PORT (дефолт 5005) внутри bot.py.
exec python -u bot.py

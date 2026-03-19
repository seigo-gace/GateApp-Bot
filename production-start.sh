#!/bin/bash
(while true; do
  echo "[BOT] Starting Telegram Gate Bot..."
  node artifacts/bot/dist/index.cjs
  EXIT_CODE=$?
  echo "[BOT] Bot exited with code $EXIT_CODE. Restarting in 3 seconds..."
  sleep 3
done) &
BOT_PID=$!
echo "[STARTUP] Bot loop PID: $BOT_PID"

exec node artifacts/api-server/dist/index.cjs

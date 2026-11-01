#!/usr/bin/env bash
# Проверка «жив ли Premier» раз в минуту (premier-health.timer). Если сервер дважды подряд не ответил —
# перезапуск сервиса и оповещение в Telegram (ALERT_TELEGRAM_TOKEN / ALERT_TELEGRAM_CHAT из /etc/premier/premier.env).
# Нужен потому, что зависший или упавший сервер сам о себе сообщить не может.
set -u
ENV=${PREMIER_ENV:-/etc/premier/premier.env}
[ -r "$ENV" ] && set -a && . "$ENV" && set +a
PORT=${PORT:-3000}; STATE=${HEALTH_STATE:-/run/premier-health}; NAME=${ALERT_NAME:-$(hostname)}
notify() {
  [ -n "${ALERT_TELEGRAM_TOKEN:-}" ] && [ -n "${ALERT_TELEGRAM_CHAT:-}" ] && curl -fsS -m 10 "https://api.telegram.org/bot$ALERT_TELEGRAM_TOKEN/sendMessage" \
    --data-urlencode "chat_id=$ALERT_TELEGRAM_CHAT" --data-urlencode "text=$1" >/dev/null 2>&1
  [ -n "${ALERT_WEBHOOK_URL:-}" ] && curl -fsS -m 10 -H 'Content-Type: application/json' -d "{\"text\":\"$1\"}" "$ALERT_WEBHOOK_URL" >/dev/null 2>&1
  return 0
}
fails=$(cat "$STATE" 2>/dev/null || echo 0)
if curl -fsS -m 10 "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
  [ "$fails" -ge 2 ] && notify "✅ Premier ($NAME) снова работает"
  echo 0 > "$STATE"; exit 0
fi
fails=$((fails + 1)); echo "$fails" > "$STATE"
if [ "$fails" -eq 2 ]; then
  notify "🔴 Premier ($NAME) не отвечает 2 минуты — перезапускаю"
  systemctl restart premier
elif [ "$fails" -eq 10 ]; then
  notify "🔴 Premier ($NAME) не отвечает уже 10 минут даже после перезапуска. Логи: journalctl -u premier -n 100"
fi
exit 0

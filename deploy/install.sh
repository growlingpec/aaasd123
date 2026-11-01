#!/usr/bin/env bash
# Установка Premier на чистый сервер Ubuntu/Debian. Запуск из папки проекта:
#   sudo bash deploy/install.sh example.ru
# Делает: пользователь premier, копия в /opt/premier, сервис systemd, Caddy с HTTPS,
# фаервол (только 22, 80, 443), ежедневный бэкап data/. Повторный запуск безопасен.
set -euo pipefail
DOMAIN="${1:-}"; [ -n "$DOMAIN" ] || { echo "Укажите домен: sudo bash deploy/install.sh example.ru"; exit 1; }
[ "$(id -u)" = 0 ] || { echo "Запустите через sudo"; exit 1; }
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/premier

echo "1/7 Node.js"
apt-get update -qq && apt-get install -y -qq rsync curl ca-certificates >/dev/null
# нужен Node.js 22.13+ (встроенная база SQLite)
command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' || {
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs; }

echo "2/7 Пользователь premier (без входа по SSH и без sudo)"
id premier >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/premier --shell /usr/sbin/nologin premier

echo "3/7 Файлы → $APP"
mkdir -p "$APP"
rsync -a --delete --exclude data --exclude node_modules --exclude .git "$SRC/" "$APP/"
[ -d "$SRC/data" ] && [ ! -d "$APP/data" ] && cp -a "$SRC/data" "$APP/data"   # перенос существующих данных
mkdir -p "$APP/data"
chown -R root:root "$APP"; chown -R premier:premier "$APP/data"; chmod 700 "$APP/data"
# озвучка: голос Vosk (скачивается ~750 МБ) + запасной RHVoice; на слабом сервере: tts/setup.sh --no-vosk
bash "$APP/tts/setup.sh" && echo "Озвучка: голоса готовы" || echo "Озвучка: частично не установилась — см. вывод выше"
# системные библиотеки для Chromium (имена пакетов отличаются между версиями — ставим, что есть)
for pkg in libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 libasound2t64 fonts-liberation fonts-noto-color-emoji; do
  apt-get install -y -qq "$pkg" >/dev/null 2>&1 || true; done
# зависимости ставит root (сервис их только читает); Chromium для puppeteer — в папку проекта
( cd "$APP" && PUPPETEER_CACHE_DIR="$APP/.cache/puppeteer" npm install --omit=dev --no-audit --no-fund ) \
  || echo "  (puppeteer не установился — поиск в интернете будет работать без браузера)"

echo "4/7 Настройки /etc/premier/premier.env"
mkdir -p /etc/premier
if [ ! -f /etc/premier/premier.env ]; then
  PW=$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 20)
  sed "s#https://example.ru#https://$DOMAIN#; s#^ADMIN_PASSWORD=.*#ADMIN_PASSWORD=$PW#" "$APP/deploy/premier.env.example" > /etc/premier/premier.env
  echo "   Пароль панели /panelp: $PW  (сохраните; поменять — в /etc/premier/premier.env)"
fi
chown root:premier /etc/premier/premier.env; chmod 640 /etc/premier/premier.env

echo "5/7 Сервис systemd"
cp "$APP/deploy/premier.service" /etc/systemd/system/premier.service
systemctl daemon-reload; systemctl enable --now premier; systemctl restart premier

echo "6/7 Caddy (HTTPS)"
command -v caddy >/dev/null || {
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy; }
sed "s/example\.ru/$DOMAIN/g" "$APP/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

echo "7/7 Фаервол, бэкапы и проверка, что сайт жив"
command -v ufw >/dev/null || apt-get install -y ufw
# открываем все порты, на которых реально слушает SSH, — чтобы не потерять доступ к серверу
for p in $(sshd -T 2>/dev/null | awk '/^port /{print $2}'); do ufw allow "$p/tcp"; done
ufw allow OpenSSH; ufw allow 80/tcp; ufw allow 443/tcp; ufw deny 3000/tcp; ufw --force enable
chmod +x "$APP/deploy/backup.sh" "$APP/deploy/healthcheck.sh"
cp "$APP/deploy/premier-backup.service" "$APP/deploy/premier-backup.timer" "$APP/deploy/premier-health.service" "$APP/deploy/premier-health.timer" /etc/systemd/system/
systemctl daemon-reload; systemctl enable --now premier-backup.timer premier-health.timer

echo
echo "Готово: https://$DOMAIN"
echo "Настройки: sudo nano /etc/premier/premier.env, затем sudo systemctl restart premier"
echo "Логи:      sudo journalctl -u premier -f"
echo "Python в песочнице — см. DEPLOY.md, шаг 6 (rootless Docker)."

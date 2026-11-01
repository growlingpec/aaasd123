#!/usr/bin/env bash
# Ежедневный бэкап Premier: снимок базы SQLite (целостный, без остановки сервиса) + остальные файлы data/
# (картинки, файлы, опубликованные сайты). Хранит 14 последних копий локально
# и (если задано) копирует на другой сервер: BACKUP_REMOTE=user@host:/backups/premier
set -euo pipefail
SRC=${PREMIER_DATA_DIR:-/opt/premier/data}
DEST=${BACKUP_DIR:-/var/backups/premier}
KEEP=14
mkdir -p "$DEST"; chmod 700 "$DEST"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
SNAP=()
if [ -f "$SRC/premier.db" ]; then
  node --no-warnings "$(dirname "$0")/db-snapshot.js" "$SRC/premier.db" "$TMP/snap.db" && SNAP=(-C "$TMP" --transform 's|^snap\.db$|data/premier.db|' snap.db)
fi
f="$DEST/premier-$(date +%F-%H%M).tar.gz"
tar -czf "$f" --exclude='data/premier.db' --exclude='data/premier.db-wal' --exclude='data/premier.db-shm' --exclude='data/run' \
  -C "$(dirname "$SRC")" "$(basename "$SRC")" "${SNAP[@]}"
chmod 600 "$f"
ls -1t "$DEST"/premier-*.tar.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f
if [ -n "${BACKUP_REMOTE:-}" ]; then
  rsync -a -e "ssh -o BatchMode=yes" "$f" "$BACKUP_REMOTE/"
fi
echo "Бэкап готов: $f ($(du -h "$f" | cut -f1))"
# Восстановление: systemctl stop premier; rm -f /opt/premier/data/premier.db-wal /opt/premier/data/premier.db-shm; tar -xzf ФАЙЛ -C /opt/premier; chown -R premier:premier /opt/premier/data; systemctl start premier

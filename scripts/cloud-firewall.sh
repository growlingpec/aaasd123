#!/usr/bin/env bash
# Облачный компьютер: не пускать контейнеры пользователей к самому серверу (его порты, SSH, базы) и во внутренние
# сети (метаданные облака 169.254.169.254, соседние машины). В интернет — можно.
# Запуск от root после установки, и после каждой перезагрузки — или сохранить правила:
#   apt install iptables-persistent && netfilter-persistent save
set -euo pipefail
NET="${CLOUD_NETWORK:-premier-cloud}"
if [ "$NET" = none ]; then echo "CLOUD_NETWORK=none — у контейнеров нет сети, правила не нужны"; exit 0; fi
# та же сеть, что создаёт cloud.js: без связи между контейнерами
docker network inspect "$NET" >/dev/null 2>&1 || docker network create --driver bridge -o com.docker.network.bridge.enable_icc=false --label premier.pc=1 "$NET" >/dev/null
BR=$(docker network inspect -f '{{index .Options "com.docker.network.bridge.name"}}' "$NET")
[ -n "$BR" ] || BR="br-$(docker network inspect -f '{{.Id}}' "$NET" | cut -c1-12)"
rule() { iptables -C "$@" 2>/dev/null || iptables -I "$@"; }
rule INPUT -i "$BR" -j DROP
for dst in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10; do rule DOCKER-USER -i "$BR" -d "$dst" -j DROP; done
echo "Готово: контейнеры сети $NET ($BR) не видят сервер и внутренние сети"

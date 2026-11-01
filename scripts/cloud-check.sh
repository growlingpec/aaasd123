#!/usr/bin/env bash
# Проверка «Облачного компьютера» в Docker-режиме на этом сервере: собирает образ premier-cloud и запускает
# тест с настоящими контейнерами (изоляция, лимиты, сохранность файлов). Запуск из папки проекта:
#   bash scripts/cloud-check.sh
set -euo pipefail
cd "$(dirname "$0")/.."
docker info >/dev/null
docker build -t "${CLOUD_IMAGE:-premier-cloud}" -f sandbox/cloud.Dockerfile sandbox
CLOUD_DOCKER_TEST=1 node --test --test-reporter=spec test/cloud-docker.test.js

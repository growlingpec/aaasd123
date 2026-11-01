# Облачный компьютер Premier: образ для постоянных контейнеров пользователей (см. cloud.js).
# Сборка (один раз, из папки проекта): docker build -t premier-cloud -f sandbox/cloud.Dockerfile sandbox
# Контейнер запускается без root, с файловой системой только для чтения: пользователь ставит пакеты в домашнюю
# папку (pip install / npm install — см. PIP_USER и NPM_CONFIG_PREFIX в cloud.js).
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv git curl wget ca-certificates zip unzip xz-utils nano less procps file jq sqlite3 build-essential fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* && ln -s /usr/bin/python3 /usr/local/bin/python
RUN pip install --no-cache-dir --break-system-packages numpy pandas matplotlib requests openpyxl python-docx python-pptx reportlab pillow \
    && python3 -c "import matplotlib.pyplot"
WORKDIR /home/premier

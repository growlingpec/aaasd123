# Образ для выполнения Python-кода моделью. Сборка (один раз, из папки проекта):
#   docker build -t premier-python sandbox
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir numpy pandas matplotlib seaborn scipy openpyxl xlsxwriter python-docx python-pptx reportlab pillow tabulate
RUN python -c "import matplotlib.pyplot"
WORKDIR /work

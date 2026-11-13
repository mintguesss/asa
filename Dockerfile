FROM python:3.13-slim

# Alarm times are local times, so the container needs a real time zone (set TZ in docker-compose.yml).
RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app

ENV PYTHONUNBUFFERED=1 PORT=8787
EXPOSE 8787
VOLUME /app/data
CMD ["sh", "-c", "exec python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]

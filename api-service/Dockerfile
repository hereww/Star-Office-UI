ARG PYTHON_BASE=python:3.11-slim
FROM ${PYTHON_BASE}
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY api-service/requirements.txt /app/requirements.txt
RUN python -m pip install --no-cache-dir -r /app/requirements.txt \
    && mkdir -p /data && chown 10001:10001 /data
COPY api_service /app/api_service
COPY backend/team_telemetry.py /app/backend/team_telemetry.py
USER 10001:10001
ENV API_DATA_FILE=/data/telemetry.sqlite3 API_AUTH_MODE=key
EXPOSE 19100
CMD ["gunicorn","--workers","2","--threads","4","--bind","0.0.0.0:19100","--access-logfile","/dev/null","api_service.wsgi:app"]

# Star Office UI Quickstart image.
# Online build:   docker compose build --pull
# Offline build:  docker compose build --pull=false --build-arg OFFLINE_BUILD=1
#
# Offline builds never resolve packages from the network. They require a cached
# Python 3.11 base image and the matching wheelhouse shipped with the bundle.
ARG PYTHON_BASE=python:3.11-slim
FROM ${PYTHON_BASE}

ARG OFFLINE_BUILD=0
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_ROOT_USER_ACTION=ignore

WORKDIR /app

COPY deploy/quickstart/requirements.txt /tmp/requirements.txt
COPY wheelhouse /opt/wheelhouse

RUN if [ "$OFFLINE_BUILD" = "1" ]; then \
      python -m pip install --no-index --find-links=/opt/wheelhouse -r /tmp/requirements.txt; \
    else \
      python -m pip install --no-cache-dir -r /tmp/requirements.txt; \
    fi \
    && rm -rf /opt/wheelhouse /root/.cache/pip /tmp/requirements.txt \
    && groupadd --system --gid 10001 staroffice \
    && useradd --system --uid 10001 --gid 10001 --home-dir /app --no-create-home staroffice \
    && mkdir -p /data \
    && chown -R 10001:10001 /data /app

COPY backend /app/backend
COPY frontend /app/frontend
COPY deploy/quickstart/entrypoint.py /app/deploy/quickstart/entrypoint.py
COPY VERSION /app/VERSION
COPY asset-defaults.json asset-positions.json runtime-config.sample.json state.sample.json join-keys.sample.json /app/
COPY assets/room-reference.webp assets/room-reference.png /app/assets/

RUN chown -R 10001:10001 /app

USER 10001:10001
EXPOSE 19000

HEALTHCHECK --interval=10s --timeout=4s --start-period=15s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:19000/health', timeout=3).read()"

ENTRYPOINT ["python", "/app/deploy/quickstart/entrypoint.py"]
CMD ["web"]

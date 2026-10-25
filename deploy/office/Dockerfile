# The operator must supply an already-cached Python 3.11 image (prefer digest).
# Build with --pull=false --network=none. No apt, curl or online pip fallback.
ARG PYTHON_BASE
FROM ${PYTHON_BASE}
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_INDEX=1 \
    PYTHONPATH=/app/backend:/app STAR_OFFICE_ENV=production
WORKDIR /app
COPY wheelhouse /wheelhouse
COPY deploy/office/requirements.txt /tmp/requirements.txt
RUN python -c 'import sys; assert sys.version_info[:2] == (3, 11), "Python 3.11 required"' \
 && python -m pip install --no-index --find-links=/wheelhouse -r /tmp/requirements.txt \
 && rm -rf /wheelhouse /root/.cache/pip \
 && mkdir -p /data/office /data/legacy \
 && chown -R 10001:10001 /data/office /data/legacy
COPY release-manifest.json /app/release-manifest.json
COPY --chown=10001:10001 backend /app/backend
COPY --chown=10001:10001 frontend /app/frontend
COPY --chown=10001:10001 deploy/office /app/deploy/office
RUN python /app/deploy/office/verify_image.py
USER 10001:10001
ENTRYPOINT ["python", "/app/deploy/office/entrypoint.py"]
CMD ["office-web"]

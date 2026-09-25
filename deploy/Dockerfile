# Build the site, then serve it from the navigator backend.
FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=web /web/dist /app/dist
ENV FRONTEND_DIST=/app/dist RASTER_CACHE_DIR=/app/cache
RUN mkdir -p /app/cache
EXPOSE 8010
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8010/api/health', timeout=4).status==200 else 1)"
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8010", "--workers", "2", "--proxy-headers", "--forwarded-allow-ips", "*"]

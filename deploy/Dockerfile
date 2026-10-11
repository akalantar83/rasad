FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 RASAD_DB=/data/rasad.db
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY rasad ./rasad
COPY web ./web
COPY sources.yaml .
RUN useradd -r -u 10001 rasad && mkdir -p /data && chown rasad /data
USER rasad
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8080/healthz')"
CMD ["python", "-m", "rasad", "serve", "--host", "0.0.0.0", "--port", "8080"]

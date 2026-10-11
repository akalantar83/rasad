PY ?= python3
.PHONY: install dev serve run-once test docker
install: ; $(PY) -m pip install -r requirements.txt
dev: install ; $(PY) -m pip install -r requirements-dev.txt
serve: ; $(PY) -m rasad serve --port 8080
run-once: ; $(PY) -m rasad run-once
test: ; $(PY) -m pytest -q tests
docker: ; docker compose -f deploy/docker-compose.yml up -d --build

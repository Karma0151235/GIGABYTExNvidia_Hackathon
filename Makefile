.DEFAULT_GOAL := help

.PHONY: help setup dev dev-down db db-migrate demo-seed stop status

help:
	@printf '%s\n' \
	  'make dev     Configure dependencies, start PostgreSQL, API, and frontend' \
	  'make dev-down Stop API, frontend, and PostgreSQL for this project' \
	  'make setup   Configure dependencies and start PostgreSQL only' \
	  'make db      Start PostgreSQL only' \
	  'make db-migrate  Apply the existing backend schema migrations' \
	  'make demo-seed  Populate the hackathon simulation when it is empty' \
	  'make stop    Stop PostgreSQL' \
	  'make status  Show PostgreSQL status'

setup: db
	@test -f backend/.env || cp backend/.env.example backend/.env
	cd backend && uv sync
	cd frontend && npm install

db:
	docker compose up -d --wait anwar-postgres

db-migrate: db
	@test -f backend/.env || cp backend/.env.example backend/.env
	@set -a; . backend/.env; set +a; \
	uv run --project backend python -c 'from importlib import import_module; [getattr(import_module(module), store)().migrate() for module, store in (("backend.modules.signal-fusion.services.store", "PostgresFusionStore"), ("backend.modules.command-center.services.store", "PostgresCommandCenterStore"), ("backend.modules.live-dispatch.services.dispatch_store", "PostgresDispatchStore"), ("backend.modules.dispatch-assistant.services.store", "PostgresAssistantStore"))]'

demo-seed: db-migrate
	@set -a; . backend/.env; set +a; uv run --project backend python backend/scripts/seed_hackathon_demo.py

dev: setup db-migrate demo-seed
	@set -e; \
	( cd backend && set -a && . ./.env && set +a && exec uv run python -m uvicorn server:app --reload --host 127.0.0.1 --port 8000 ) & backend_pid=$$!; \
	( cd frontend && exec npm run dev ) & frontend_pid=$$!; \
	trap 'kill $$backend_pid $$frontend_pid 2>/dev/null || true' EXIT INT TERM; \
	wait $$backend_pid $$frontend_pid

dev-down:
	@pkill -f '$(CURDIR)/backend.*uvicorn.*server:app' 2>/dev/null || true
	@pkill -f '$(CURDIR)/frontend/node_modules/.bin/next dev' 2>/dev/null || true
	docker compose stop anwar-postgres

stop:
	docker compose stop anwar-postgres

status:
	docker compose ps

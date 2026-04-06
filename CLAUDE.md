# CLAUDE.md — Garden Godmother

## Project Overview
Self-hosted garden management app — Next.js 15 frontend + Python FastAPI backend + SQLite database.
Runs on Raspberry Pi via Docker Compose. PWA-first mobile experience.

## Architecture
```
Browser → garden-web (Next.js :3400) → garden-api (FastAPI :3402) → SQLite
```

| Directory | Purpose |
|---|---|
| `garden-api/` | Python FastAPI backend (routes, services, migrations) |
| `garden-web/` | Next.js 15 App Router frontend (TypeScript + Tailwind) |
| `scripts/` | Utility scripts (auto-update, screenshots) |
| `docs/` | Screenshots and documentation assets |

## Development Setup

### Backend
```bash
cd garden-api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 3402
```

### Frontend
```bash
cd garden-web
npm install
echo "NEXT_PUBLIC_API_URL=http://localhost:3402" > .env.local
npm run dev    # Runs on :3401
```

### Docker (full stack)
```bash
cp .env.example .env
docker compose up -d --build
# Frontend: http://localhost:3400  |  API: http://localhost:3402
```

## Running Tests

### Backend (pytest)
```bash
cd garden-api
python -m pytest tests/ -v
python -m pytest tests/test_tasks.py -v   # Single file
```

Config in `garden-api/pytest.ini`. Tests live in `garden-api/tests/`.

## Linting & Formatting

### Python — Ruff
```bash
cd garden-api
ruff check .
ruff format .
```
Config: `garden-api/ruff.toml`. Long lines (E501) are allowed.

### TypeScript — Prettier
```bash
cd garden-web
npx prettier --check "app/**/*.{ts,tsx}"
npx prettier --write "app/**/*.{ts,tsx}"
```

### Next.js Lint
```bash
cd garden-web
npm run lint
```

## Code Conventions

### Python (Backend)
- FastAPI route modules in `garden-api/routes/` — one file per domain (plants, tasks, harvest, etc.)
- Services in `garden-api/services/` — integration logic (notifications, Home Assistant, etc.)
- SQLite migrations in `garden-api/migrations/` — numbered, never re-run
- Ruff for linting/formatting (double quotes, space indent)
- `argon2-cffi` for password hashing

### TypeScript (Frontend)
- Next.js 15 App Router with file-based routing
- Tailwind CSS for styling
- Custom `toast(msg, type, options?)` — positional args, NOT shadcn object pattern
- Import `useToast` from `../toast` and destructure `{ toast }`
- Types defined in `garden-web/app/types.ts`
- API client in `garden-web/app/api.ts`
- Components in `garden-web/app/components/`

### Toast Pattern (important)
```ts
// CORRECT
toast('Saved!', 'success');
toast('Error occurred', 'error');

// WRONG — do NOT use shadcn object pattern
toast({ title: 'Saved!' });  // ❌
```

## Database
- SQLite with 38+ numbered migrations
- Hourly backups with 14-day retention
- Data volume mounted at `/app/data/garden.db` in Docker

## Key Features
- 273+ plants, 354 varieties, 1,156 companion relationships
- Smart watering rules (10 factors: soil, sun, container, season, weather)
- AI photo analysis via GPT-4o
- Garden Co-op federation between instances
- Meshtastic LoRa off-grid mesh support
- Multi-user with session auth and role-based access
- 4 notification channels (Email, Discord, Web Push, Pushbullet)
- Rachio irrigation, Home Assistant sensors, multiple weather providers

## Branch Strategy
- `main` is the production branch
- Feature branches: `feature/description`
- Keep PRs focused on a single change
- Test on mobile viewport (PWA-first)

## Secrets
- No API keys in config files — integrations configured via Settings UI
- Environment variables only for deployment config (CORS, cookie domain)
- `.env` files are gitignored

# Contributing to Garden Godmother

Thanks for your interest in contributing! This guide covers how to set up a local dev environment, run the project, and submit changes.

---

## Development Setup

### Prerequisites

- **Python 3.11+** (backend)
- **Node.js 18+** (frontend)
- **Docker & Docker Compose** (optional, for production-like setup)

### Backend (FastAPI)

```bash
cd garden-api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 3402
```

The API will be available at `http://localhost:3402`. A SQLite database is created automatically on first run.

### Frontend (Next.js)

```bash
cd garden-web
npm install
echo "NEXT_PUBLIC_API_URL=http://localhost:3402" > .env.local
npm run dev
```

The frontend will be available at `http://localhost:3000`.

### Docker Compose (full stack)

```bash
cp .env.example .env
docker compose up -d --build
# Frontend: http://localhost:3400
# API: http://localhost:3402
```

---

## Running Locally

1. Start the API first (`uvicorn` or `docker compose up garden-api`)
2. Start the frontend (`npm run dev` or `docker compose up garden-web`)
3. Open `http://localhost:3000` (dev) or `http://localhost:3400` (Docker)
4. On first run, the onboarding wizard walks you through setup

Default admin credentials are logged in the API output on first startup.

---

## Submitting Changes

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run linting (see below)
5. Commit with a clear message describing what and why
6. Push and open a Pull Request against `main`

### PR Guidelines

- Keep PRs focused on a single change
- Include a description of what the PR does and why
- Add screenshots for UI changes
- Test on mobile viewport (the app is PWA-first)

---

## Frontend Conventions

### Toast Notifications

Garden Godmother uses a custom `toast` function with **positional arguments**. Do **not** use the shadcn/ui object pattern.

```ts
// CORRECT — positional arguments
toast('Saved!', 'success');
toast('Something went wrong', 'error');
toast('Loading…', 'info');

// With an undo action
toast('Item deleted', 'success', {
  action: { label: 'Undo', onClick: () => undoAction() },
});

// WRONG — do not use the shadcn/ui object pattern
toast({ title: 'Saved!', variant: 'default' });       // ❌
toast({ title: 'Error', variant: 'destructive' });     // ❌
```

**Full signature:** `toast(msg: string, type?: 'success' | 'error' | 'info', options?: { action?: { label: string; onClick: () => void }; duration?: number })`

**Variant mapping** (if porting from shadcn patterns):

| shadcn pattern | GG equivalent |
|---|---|
| `variant: 'destructive'` | `'error'` |
| `variant: 'default'` | `'success'` |
| (no variant) | `'success'` |

**Usage:** Import `useToast` from `../toast` (or the appropriate relative path) and destructure `toast` from it:

```ts
import { useToast } from '../toast';

function MyComponent() {
  const { toast } = useToast();
  // ...
  toast('Done!', 'success');
}
```

---

## Code Style

### Python (Backend)

We use [Ruff](https://github.com/astral-sh/ruff) for linting and formatting.

```bash
cd garden-api
ruff check .
ruff format .
```

Configuration is in `garden-api/ruff.toml`.

### TypeScript (Frontend)

We use [Prettier](https://prettier.io/) for formatting.

```bash
cd garden-web
npx prettier --check "app/**/*.{ts,tsx}"
npx prettier --write "app/**/*.{ts,tsx}"
```

---

## Issue Labels

| Label | Description |
|-------|-------------|
| `bug` | Something is broken |
| `feature-request` | A well-defined feature proposal |
| `idea` | A rough idea or suggestion for discussion |
| `good-first-issue` | Good for newcomers to the codebase |
| `help-wanted` | Extra attention needed |

---

## Project Structure

```
garden-god-mother/
  garden-api/          # Python FastAPI backend
    routes/            # API route modules
    services/          # Integration services (HA, Rachio, etc.)
    migrations/        # SQLite migration system
    plant_knowledge.py # Extended plant database
    constants.py       # Shared constants and helpers
  garden-web/          # Next.js frontend
    app/               # App router pages and components
    public/            # Static assets and PWA manifest
  scripts/             # Utility scripts (auto-update, screenshots)
  docker-compose.yml   # Production deployment config
```

---

## Questions?

Open a GitHub Issue or start a Discussion. We're happy to help.

# Changelog

## v1.5.0 (2026-03-24)

### Weather & Monitoring
- **Weather provider selector** — Tempest WeatherFlow, Open-Meteo (free), OpenWeatherMap, NWS
- **Home Assistant entity selector** — browse HA entities, map to sensor roles
- **Plant health AI monitoring** — GPT-4o photo analysis, health dashboard, auto-notifications
- **Tempest direct integration** — forecast from your station, not just HA passthrough

### Features
- **AI journal summaries** — weekly garden recap via GPT-4o-mini
- **Garden bed templates** — Salsa Garden, Three Sisters, Pizza, Herb, Pollinator, Desert Salad
- **Seed inventory typeahead** — search dropdown like all other plant selectors
- **Ground plants detail page** — dedicated /ground-plants/{id} with amendments, irrigation, tasks

### Code Quality
- **main.py split into modules** — 14,867 lines → 116 lines + 25 organized files
- **Proper migration system** — 38 numbered migrations, never re-run
- **Ruff + Prettier configs** — code formatting standards
- **Security fixes** — Next.js, Pillow, python-multipart version bumps

### Bugs Fixed
- Zone 9b hardcoded references removed from UI
- Settings page shows Rachio/Weather connected status correctly
- Tempest forecast epoch timestamp parsing
- Vertical bed migration no longer wipes planter data

## v1.4.0 (2026-03-24)

### Open Source Preparation
- **MIT License** added
- **CONTRIBUTING.md** — dev setup, code style, PR guidelines
- **Full PII/security audit** — removed all hardcoded domains, IPs, and personal identifiers
- **Environment-driven configuration** — CORS origins, cookie domain, HA URL, and API base URL now configurable via env vars
- **Dynamic iCal URLs** — calendar feed URLs derived from request host instead of hardcoded domain
- **Generic iCal UIDs** — `@garden-godmother` domain suffix instead of personal domain
- **Updated .env.example** — documents all production env vars (CORS_ORIGINS, COOKIE_DOMAIN, HA_URL)
- **docker-compose.yml** — passes through new env vars with sensible defaults

## v1.3.0 (2026-03-24)

### Tier 3: Deployability
- **Onboarding wizard** — multi-step setup for new deployments (location, frost dates, integrations)
- **Multi-zone USDA support** — dynamic frost dates, zone-aware calendars, works for any USDA zone
- **Auto-update system** — check for updates, one-click deploy, configurable schedule (daily/weekly)
- **GitHub repo** — issue templates, README with screenshots, changelog

## v1.2.0 (2026-03-24)

### Tier 2: Smart Features
- **Weather-based task scheduling** — multi-day forecast awareness, heat wave prep, wind adjustments
- **Notification preferences matrix** — event type x channel checkbox grid
- **Water usage tracking** — Rachio gallons per zone with usage dashboard
- **Frost alert auto-tasks** — auto-generates protection tasks when forecast drops below 40°F

## v1.1.0 (2026-03-24)

### Tier 1: UX Improvements
- **Ground plants & trays parity** — soil amendment logs, irrigation detail sections
- **Map zones / areas unification** — zones link to areas, auto-assigns area from map position
- **Upcoming harvest list** — color-coded countdown badges at /harvest/upcoming
- **Harvest → journal linking** — auto-creates journal entry when logging harvests
- **Multi-user auth** — session cookies, Argon2id, invite codes, role-based access
- **Audit logging** — tracks all user actions, 90-day retention
- **Notification system** — email (SMTP), Discord (webhook), web push (VAPID), Pushbullet
- **Integration settings** — configurable API keys for Rachio, HA, OpenAI, OpenPlantBook
- **Toast confirmations** — green notification on save across all pages
- **Irrigation type cleanup** — Rachio Controller / Hose Timer with clean labels
- **PII scrub** — removed all personal info from codebase

## v1.0.0 (2026-03-24)

### Initial Release
- 273 plants, 354 varieties, 1,156 companion relationships
- Property map with sun tracking and shadow calculations
- Planter grid management with multiple types
- Seed tray and ground plant tracking
- Smart task generation with 10 watering rules
- Lifecycle planner (seed-to-harvest)
- iCal subscription feeds
- PWA support
- Hourly backup system

# Changelog

## v2.1.0 (2026-03-27)

### Dashboard & UX
- **Dashboard redesign** — quick actions bar, recent activity feed, garden at-a-glance with fill bars
- **Pull-to-refresh** on 6 key mobile pages
- **Smart Journal mockup** — context-aware suggestion cards, photo-first flow, voice note UI prototype
- **Companion Planting demo** — multi-plant cell visualization with suggestion engine

### Bug Fixes
- Harvest logging updates plant status (final harvest checkbox)
- Planter counts now include 'planned' plants
- Plant picker: all plants directly clickable on mobile (48px tap targets)
- Pepper varieties selectable without going through generic 'Pepper'
- "Died" button added to planter actions with reason dropdown
- Vacant spaces count corrected

### Data & Features
- Added Mini Carnation, Sweet Banana Pepper, Pinto Bean to plant database
- Added 6 Zinnia varieties (Profusion Orange, Cherry, Double Mix, Benary's Giant, Zahara, Cut and Come Again)
- Cascading soil amendments — plant instances show inherited container amendments
- 49 plantings updated from 'planned' to 'growing' with correct dates

## v2.0.0 (2026-03-26)

### Plant Instance Model
- **Unified plant identity** — every physical plant gets its own persistent ID and detail page (`/plant/{id}`)
- **Location tracking** — tracks where each plant lives (planter cell, ground spot, tray cell) with full transplant history
- **Automatic migration** — all existing plantings, ground plants, and tray cells converted to instances
- **My Plantings links to instance pages** — click any plant for the unified detail view

### v1.9 — Polish & Refinement
- **Tempest local UDP receiver** — real-time weather data from your Tempest station via LAN broadcast, zero cloud dependency
- **Enhanced journal** — plant timeline on detail pages, quick-add journal from planter/ground detail, plant context in journal form
- **My Plantings history toggle** — show/hide completed, removed, and harvested plants

### v1.8 — Quality & Testing
- **82 automated tests** — pytest suite covering auth, plants, beds, tasks, journal, harvest, settings
- **Plant data separation** — reference DB (`plants_reference.db`) vs user DB (`garden.db`) with transparent ATTACH+VIEW
- **Proper migration system** — 44 numbered migrations, never re-run

### v1.7 — Sensor Intelligence
- **Per-planter moisture sensors** — assign HA sensor entities to specific planters/ground plants/trays
- **Pest & disease tracker** — log incidents, track patterns, treatment history
- **AI seasonal patterns** — garden analytics with GPT-4o-mini insights, success rates, monthly trends

### v1.6 — UX Overhaul
- **Shared detail components** — SoilAmendments, IrrigationSettings, RelatedTasks, AuditHistory, EntityPhotos
- **"Ground Plants" → "Ground"** — cleaner naming
- **My Plantings** — unified view of all plantings across planters, ground, and trays
- **Adaptive journal** — planting-centric with entry type cards (observation, harvest, problem, milestone)
- **Upcoming harvests inline** — collapsible section on the harvest page with countdown badges

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

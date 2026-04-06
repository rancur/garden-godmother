# Garden Godmother — Roadmap

Tracked features and improvements, roughly prioritized. Items move to CHANGELOG.md when shipped.

---

## In Progress

- [ ] **Seasonal planting templates** — pre-built planting plans per USDA zone and season (spring cool-crop, summer heat, fall succession, winter cover)
- [ ] **Batch task actions** — multi-select tasks for bulk complete, snooze, or reassign

## Up Next

### Data & Intelligence
- [ ] **Weather history analytics** — chart temperature, rainfall, and humidity trends over time; correlate with harvest yields
- [ ] **Soil amendment tracker** — log amendments (compost, fertilizer, lime, sulfur) per bed with pH/nutrient targets and reapplication reminders
- [ ] **Companion planting score on planter view** — show a compatibility score for current bed layout, flag bad neighbors
- [ ] **Harvest yield predictions** — ML-lite model using historical harvest data, weather, and plant variety to estimate expected yield
- [ ] **Plant succession calculator** — auto-suggest staggered planting dates for continuous harvest of lettuce, beans, radishes, etc.

### Photo & Visual
- [ ] **Time-lapse photo grid** — show plant growth over time as a grid/slideshow from photo history
- [ ] **Before/after comparison** — side-by-side photo viewer for a planting slot across dates
- [ ] **Photo tagging** — tag photos with growth stage (seedling, vegetative, flowering, fruiting, harvest)

### Irrigation & Sensors
- [ ] **Irrigation zone mapping** — visually assign Rachio zones to bed areas on the property map
- [ ] **Soil moisture threshold alerts** — trigger notifications when HA soil sensors drop below configurable thresholds
- [ ] **Water budget dashboard** — track monthly water usage vs. targets with cost estimates
- [ ] **Rain barrel integration** — track rain barrel levels and auto-suggest when to use stored water

### Planning & Calendar
- [ ] **Multi-year crop rotation planner** — track what was planted where across seasons, suggest rotations to prevent soil depletion
- [ ] **Frost date calculator** — auto-detect last/first frost dates from weather history, adjust planting windows
- [ ] **Garden journal prompts** — daily/weekly prompted questions (What did you observe? Any pests? How's the weather affecting things?)
- [ ] **Printable garden plan** — export bed layouts and planting schedules as a PDF for offline reference

### Co-op & Community
- [ ] **Co-op chat** — simple text messaging between federated peers (beyond alerts)
- [ ] **Shared task lists** — co-op members can create and assign tasks across instances
- [ ] **Community plant ratings** — rate and review plant varieties within your co-op network
- [ ] **Harvest marketplace** — list surplus with quantities and pickup details, request/claim flow

### Mobile & UX
- [ ] **Offline mode improvements** — service worker caching for core pages, queue actions for sync when back online
- [ ] **Voice journal entries** — expand voice recorder to support full journal entries with AI transcription
- [ ] **QR code plant labels** — generate printable QR labels that link to plant detail pages
- [ ] **Dark mode** — respect system preference, add manual toggle
- [ ] **Widget for iOS/Android** — show today's tasks and weather on home screen

### Infrastructure
- [ ] **Automated backups to S3/B2** — configurable remote backup destination
- [ ] **Prometheus metrics endpoint** — expose `/metrics` for monitoring with Grafana
- [ ] **Multi-garden support** — single instance managing multiple distinct gardens (e.g., front yard, community plot)
- [ ] **API rate limiting** — protect public-facing instances from abuse
- [ ] **Database migration to PostgreSQL option** — for larger deployments that outgrow SQLite

## Icebox

- [ ] **AR plant placement** — use phone camera to preview where plants would go in real space
- [ ] **Drone flyover integration** — import aerial photos for garden health overview
- [ ] **Seed inventory barcode scanner** — scan seed packets to auto-add to inventory
- [ ] **Garden game mechanics** — streaks, achievements, seasonal challenges for motivation
- [ ] **Recipe suggestions** — suggest recipes based on what's currently harvestable

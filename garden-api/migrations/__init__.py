"""Database migrations — all numbered migrations."""
from __future__ import annotations

import json
import os
import secrets
import logging

from argon2 import PasswordHasher

from db import get_db, run_migration, _migration_add_columns_if_missing, _table_exists

logger = logging.getLogger(__name__)
ph = PasswordHasher()


def startup_run_migrations():
    """Run all pending database migrations in order."""
    with get_db(attach_ref=False) as db:
        # Ensure migration tracking table exists
        db.execute("""
            CREATE TABLE IF NOT EXISTS schema_migrations (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        db.commit()

        # ── Migration 001: undo_actions table ──
        run_migration(db, 1, "create_undo_actions", [
            """CREATE TABLE IF NOT EXISTS undo_actions (
                id TEXT PRIMARY KEY,
                action_type TEXT NOT NULL,
                entity_data TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NOT NULL,
                undone INTEGER DEFAULT 0
            )""",
        ])

        # ── Migration 002: auth tables (users, sessions, invite_codes) ──
        run_migration(db, 2, "create_auth_tables", [
            """CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                display_name TEXT NOT NULL,
                email TEXT UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user', 'viewer')),
                avatar_url TEXT,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login_at TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NOT NULL,
                last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ip_address TEXT,
                user_agent TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )""",
            "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)",
            """CREATE TABLE IF NOT EXISTS invite_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT UNIQUE NOT NULL,
                created_by INTEGER NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                used_by INTEGER,
                used_at TIMESTAMP,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (created_by) REFERENCES users(id),
                FOREIGN KEY (used_by) REFERENCES users(id)
            )""",
        ])

        # ── Migration 003: seed initial admin users ──
        def _seed_users(db):
            count = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            if count == 0:
                admin_pw = secrets.token_urlsafe(16)
                user_pw = secrets.token_urlsafe(16)
                db.execute(
                    "INSERT INTO users (username, display_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)",
                    ("admin", "Admin", "admin@example.com", ph.hash(admin_pw), "admin")
                )
                db.execute(
                    "INSERT INTO users (username, display_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)",
                    ("user", "User", "user@example.com", ph.hash(user_pw), "admin")
                )
                logger.warning(f"INITIAL USER CREATED - admin password: {admin_pw}")
                logger.warning(f"INITIAL USER CREATED - user password: {user_pw}")
        run_migration(db, 3, "seed_initial_users", [], callback=_seed_users)

        # ── Migration 004: lifecycle columns on garden_tasks ──
        def _lifecycle_migration(db):
            if not _table_exists(db, "garden_tasks"):
                db.execute("""CREATE TABLE IF NOT EXISTS garden_tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_type TEXT NOT NULL CHECK(task_type IN ('purchase_seeds', 'start_seeds', 'transplant', 'direct_sow', 'water', 'fertilize', 'harvest', 'pest_check', 'prune', 'weed', 'mulch', 'custom')),
                    title TEXT NOT NULL, description TEXT,
                    priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
                    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'skipped', 'overdue')),
                    due_date TEXT, completed_date TEXT,
                    plant_id INTEGER, planting_id INTEGER, bed_id INTEGER, tray_id INTEGER,
                    auto_generated INTEGER DEFAULT 0, source TEXT, notes TEXT,
                    lifecycle_group_id TEXT, lifecycle_order INTEGER, depends_on_task_id INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (plant_id) REFERENCES plants(id),
                    FOREIGN KEY (planting_id) REFERENCES plantings(id),
                    FOREIGN KEY (bed_id) REFERENCES garden_beds(id),
                    FOREIGN KEY (tray_id) REFERENCES seed_trays(id)
                )""")
            _migration_add_columns_if_missing(db, "garden_tasks", {
                "lifecycle_group_id": "TEXT",
                "lifecycle_order": "INTEGER",
                "depends_on_task_id": "INTEGER",
            })
            db.execute("CREATE INDEX IF NOT EXISTS idx_garden_tasks_lifecycle ON garden_tasks(lifecycle_group_id)")
            db.execute("CREATE INDEX IF NOT EXISTS idx_garden_tasks_lifecycle_order ON garden_tasks(lifecycle_group_id, lifecycle_order)")
            db.execute("CREATE INDEX IF NOT EXISTS idx_garden_tasks_depends ON garden_tasks(depends_on_task_id)")
        run_migration(db, 4, "lifecycle_columns_garden_tasks", [], callback=_lifecycle_migration)

        # ── Migration 005: irrigation columns on garden_beds and seed_trays ──
        def _irrigation_migration(db):
            if not _table_exists(db, "garden_beds") or not _table_exists(db, "seed_trays"):
                logger.warning("garden_beds or seed_trays table missing — skipping irrigation migration")
                return
            _migration_add_columns_if_missing(db, "garden_beds", {
                "irrigation_type": "TEXT DEFAULT 'manual'",
                "irrigation_zone_name": "TEXT",
                "irrigation_schedule": "TEXT",
            })
            _migration_add_columns_if_missing(db, "seed_trays", {
                "irrigation_type": "TEXT DEFAULT 'manual'",
                "irrigation_zone_name": "TEXT",
            })
        run_migration(db, 5, "irrigation_columns", [], callback=_irrigation_migration)

        # ── Migration 006: areas table and area_id/sort_order on beds/trays ──
        def _areas_migration(db):
            db.execute("""
                CREATE TABLE IF NOT EXISTS areas (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    area_type TEXT NOT NULL DEFAULT 'all',
                    sort_order INTEGER DEFAULT 0,
                    color TEXT,
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            _migration_add_columns_if_missing(db, "garden_beds", {
                "area_id": "INTEGER REFERENCES areas(id)",
                "sort_order": "INTEGER DEFAULT 0",
            })
            _migration_add_columns_if_missing(db, "seed_trays", {
                "area_id": "INTEGER REFERENCES areas(id)",
                "sort_order": "INTEGER DEFAULT 0",
            })
            try:
                db.execute("UPDATE areas SET area_type = 'all' WHERE area_type IN ('beds', 'trays', 'both')")
            except Exception:
                pass
        run_migration(db, 6, "create_areas_table", [], callback=_areas_migration)

        # ── Migration 007: area_id/sort_order on ground_plants ──
        def _ground_plants_area_migration(db):
            if not _table_exists(db, "ground_plants"):
                return
            _migration_add_columns_if_missing(db, "ground_plants", {
                "area_id": "INTEGER REFERENCES areas(id)",
                "sort_order": "INTEGER DEFAULT 0",
            })
        run_migration(db, 7, "ground_plants_area_columns", [], callback=_ground_plants_area_migration)

        # ── Migration 008: bed_type/description on garden_beds, bed_sections and ground_plants tables ──
        def _bed_types_migration(db):
            _migration_add_columns_if_missing(db, "garden_beds", {
                "bed_type": "TEXT DEFAULT 'grid' CHECK(bed_type IN ('grid', 'linear', 'single', 'freeform', 'vertical'))",
                "description": "TEXT",
            })
            db.execute("""
                CREATE TABLE IF NOT EXISTS bed_sections (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    bed_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    start_cell INTEGER NOT NULL,
                    end_cell INTEGER NOT NULL,
                    irrigation_zone_name TEXT,
                    notes TEXT,
                    FOREIGN KEY (bed_id) REFERENCES garden_beds(id)
                )
            """)
            _migration_add_columns_if_missing(db, "zones", {
                "rotation_degrees": "INTEGER NOT NULL DEFAULT 0",
            })
            db.execute("""
                CREATE TABLE IF NOT EXISTS ground_plants (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT,
                    plant_id INTEGER NOT NULL,
                    variety_id INTEGER,
                    x_feet REAL,
                    y_feet REAL,
                    zone_id INTEGER,
                    planted_date TEXT,
                    status TEXT DEFAULT 'growing' CHECK(status IN ('planned', 'planted', 'growing', 'established', 'dormant', 'removed')),
                    irrigation_type TEXT DEFAULT 'manual',
                    irrigation_zone_name TEXT,
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (plant_id) REFERENCES plants(id),
                    FOREIGN KEY (zone_id) REFERENCES zones(id)
                )
            """)
        run_migration(db, 8, "bed_types_sections_ground_plants", [], callback=_bed_types_migration)

        # ── Migration 009: plant_details table ──
        run_migration(db, 9, "create_plant_details", [
            """CREATE TABLE IF NOT EXISTS plant_details (
                plant_id INTEGER PRIMARY KEY,
                scientific_name TEXT,
                family TEXT,
                genus TEXT,
                common_names TEXT,
                usda_zones TEXT,
                min_soil_temp_f INTEGER,
                max_soil_temp_f INTEGER,
                ph_min REAL,
                ph_max REAL,
                soil_type TEXT,
                mature_height_inches INTEGER,
                mature_spread_inches INTEGER,
                growth_rate TEXT,
                growth_habit TEXT,
                root_depth TEXT,
                needs_trellis INTEGER DEFAULT 0,
                needs_cage INTEGER DEFAULT 0,
                needs_staking INTEGER DEFAULT 0,
                support_notes TEXT,
                nitrogen_fixer INTEGER DEFAULT 0,
                heavy_feeder INTEGER DEFAULT 0,
                light_feeder INTEGER DEFAULT 0,
                preferred_amendments TEXT,
                soil_prep_notes TEXT,
                water_inches_per_week REAL,
                drought_tolerant INTEGER DEFAULT 0,
                mulch_recommended INTEGER DEFAULT 1,
                edible_parts TEXT,
                culinary_uses TEXT,
                flavor_profile TEXT,
                nutritional_highlights TEXT,
                common_pests TEXT,
                common_diseases TEXT,
                organic_pest_solutions TEXT,
                disease_resistance TEXT,
                pollination_type TEXT,
                attracts_pollinators INTEGER DEFAULT 0,
                attracts_beneficial_insects INTEGER DEFAULT 0,
                deer_resistant INTEGER DEFAULT 0,
                succession_planting_interval_days INTEGER,
                good_cover_crop INTEGER DEFAULT 0,
                rotation_group TEXT,
                plant_before TEXT,
                plant_after TEXT,
                seed_sources TEXT,
                openplantbook_pid TEXT,
                data_quality_score INTEGER DEFAULT 0,
                last_enriched_at TIMESTAMP,
                FOREIGN KEY (plant_id) REFERENCES plants(id)
            )""",
        ])

        # ── Migration 010: harvest flags on plant_details ──
        def _harvest_flags_migration(db):
            if not _table_exists(db, "plant_details"):
                return
            _migration_add_columns_if_missing(db, "plant_details", {
                "is_harvestable": "INTEGER DEFAULT 1",
                "success_state": "TEXT DEFAULT 'harvested'",
                "success_description": "TEXT",
            })
        run_migration(db, 10, "harvest_flags_plant_details", [], callback=_harvest_flags_migration)

        # ── Migration 011: plantings established status (table recreation) ──
        def _plantings_established_migration(db):
            if not _table_exists(db, "plantings"):
                return
            create_sql = db.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='plantings'"
            ).fetchone()
            if create_sql and "'established'" not in create_sql[0]:
                cols_info = db.execute("PRAGMA table_info(plantings)").fetchall()
                col_names = [c[1] for c in cols_info]
                db.executescript("""
                    ALTER TABLE plantings RENAME TO _plantings_old;
                    CREATE TABLE plantings (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        bed_id INTEGER,
                        plant_id INTEGER NOT NULL,
                        variety_id INTEGER,
                        cell_x INTEGER,
                        cell_y INTEGER,
                        planted_date TEXT,
                        expected_harvest_date TEXT,
                        actual_harvest_date TEXT,
                        status TEXT DEFAULT 'planned' CHECK(status IN ('planned', 'seeded', 'sprouted', 'growing', 'flowering', 'fruiting', 'harvested', 'established', 'removed', 'failed')),
                        season TEXT,
                        year INTEGER,
                        notes TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (bed_id) REFERENCES garden_beds(id),
                        FOREIGN KEY (plant_id) REFERENCES plants(id),
                        FOREIGN KEY (variety_id) REFERENCES varieties(id)
                    );
                """)
                new_cols = {c[1] for c in db.execute("PRAGMA table_info(plantings)").fetchall()}
                shared = [c for c in col_names if c in new_cols]
                cols_list = ", ".join(shared)
                db.execute(f"INSERT INTO plantings ({cols_list}) SELECT {cols_list} FROM _plantings_old")
                db.execute("DROP TABLE _plantings_old")
        run_migration(db, 11, "plantings_established_status", [], callback=_plantings_established_migration)

        # ── Migration 012: planter_types and plant_planter_compatibility tables ──
        def _planter_types_migration(db):
            db.executescript("""
                CREATE TABLE IF NOT EXISTS planter_types (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    brand TEXT,
                    form_factor TEXT NOT NULL CHECK(form_factor IN ('vertical_tower', 'vertical_wall', 'raised_bed', 'container', 'ground', 'trellis', 'hanging')),
                    tiers INTEGER,
                    pockets_per_tier INTEGER,
                    total_pockets INTEGER,
                    pocket_depth_inches REAL,
                    pocket_volume_gallons REAL,
                    footprint_diameter_inches REAL,
                    footprint_width_inches REAL,
                    footprint_depth_inches REAL,
                    height_inches REAL,
                    watering_system TEXT,
                    material TEXT,
                    indoor_outdoor TEXT DEFAULT 'outdoor',
                    url TEXT,
                    recommended_plants TEXT,
                    unsuitable_plants TEXT,
                    desert_notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS plant_planter_compatibility (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    plant_id INTEGER NOT NULL,
                    planter_type_id INTEGER,
                    form_factor TEXT,
                    compatibility TEXT NOT NULL CHECK(compatibility IN ('excellent', 'good', 'possible', 'poor', 'unsuitable')),
                    notes TEXT,
                    FOREIGN KEY (plant_id) REFERENCES plants(id),
                    FOREIGN KEY (planter_type_id) REFERENCES planter_types(id)
                );
            """)
            _migration_add_columns_if_missing(db, "garden_beds", {
                "planter_type_id": "INTEGER REFERENCES planter_types(id)",
            })
        run_migration(db, 12, "planter_types_tables", [], callback=_planter_types_migration)

        # ── Migration 013: vertical bed type CHECK constraint update ──
        def _vertical_bed_type_migration(db):
            if not _table_exists(db, "garden_beds"):
                return
            create_sql = db.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='garden_beds'"
            ).fetchone()
            if create_sql and "CHECK" in create_sql[0] and "vertical" not in create_sql[0]:
                cols_info = db.execute("PRAGMA table_info(garden_beds)").fetchall()
                col_names = [c[1] for c in cols_info]
                db.execute("DROP TABLE IF EXISTS garden_beds_new")
                db.executescript("""
                    CREATE TABLE garden_beds_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        width_cells INTEGER NOT NULL,
                        height_cells INTEGER NOT NULL,
                        cell_size_inches INTEGER DEFAULT 12,
                        location TEXT,
                        notes TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        irrigation_type TEXT DEFAULT 'manual',
                        irrigation_zone_name TEXT,
                        irrigation_schedule TEXT,
                        area_id INTEGER REFERENCES areas(id),
                        sort_order INTEGER DEFAULT 0,
                        bed_type TEXT DEFAULT 'grid' CHECK(bed_type IN ('grid', 'linear', 'single', 'freeform', 'vertical')),
                        description TEXT,
                        planter_type_id INTEGER REFERENCES planter_types(id),
                        depth_inches REAL,
                        physical_width_inches REAL,
                        physical_length_inches REAL,
                        soil_type TEXT,
                        soil_mix TEXT,
                        soil_product_id INTEGER,
                        created_by INTEGER REFERENCES users(id),
                        updated_by INTEGER REFERENCES users(id)
                    );
                """)
                new_col_names = [c[1] for c in db.execute("PRAGMA table_info(garden_beds_new)").fetchall()]
                shared = [c for c in new_col_names if c in col_names]
                cols_str = ", ".join(shared)
                db.execute(f"INSERT INTO garden_beds_new ({cols_str}) SELECT {cols_str} FROM garden_beds")
                db.execute("DROP TABLE garden_beds")
                db.execute("ALTER TABLE garden_beds_new RENAME TO garden_beds")
        run_migration(db, 13, "vertical_bed_type_constraint", [], callback=_vertical_bed_type_migration)

        # ── Migration 014: depth_inches on garden_beds ──
        def _depth_inches_migration(db):
            _migration_add_columns_if_missing(db, "garden_beds", {"depth_inches": "REAL"})
        run_migration(db, 14, "depth_inches_garden_beds", [], callback=_depth_inches_migration)

        # ── Migration 015: physical dimensions on garden_beds ──
        def _physical_dimensions_migration(db):
            _migration_add_columns_if_missing(db, "garden_beds", {
                "physical_width_inches": "REAL",
                "physical_length_inches": "REAL",
            })
        run_migration(db, 15, "physical_dimensions_garden_beds", [], callback=_physical_dimensions_migration)

        # ── Migration 016: zone types expansion (table recreation) ──
        def _zone_types_migration(db):
            if not _table_exists(db, "zones"):
                return
            create_sql_row = db.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='zones'"
            ).fetchone()
            needs_check_update = create_sql_row and "mulch" not in (create_sql_row[0] or "")
            zone_cols = {row[1] for row in db.execute("PRAGMA table_info(zones)").fetchall()}
            if needs_check_update:
                col_names = [c[1] for c in db.execute("PRAGMA table_info(zones)").fetchall()]
                db.executescript("""
                    CREATE TABLE IF NOT EXISTS zones_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        property_id INTEGER NOT NULL DEFAULT 1,
                        name TEXT NOT NULL,
                        zone_type TEXT NOT NULL CHECK(zone_type IN ('garden', 'house', 'patio', 'lawn', 'driveway', 'walkway', 'fence', 'mulch', 'turf', 'planter_area', 'other')),
                        x_feet INTEGER NOT NULL DEFAULT 0,
                        y_feet INTEGER NOT NULL DEFAULT 0,
                        width_feet INTEGER NOT NULL DEFAULT 1,
                        height_feet INTEGER NOT NULL DEFAULT 1,
                        color TEXT,
                        notes TEXT,
                        rotation_degrees INTEGER NOT NULL DEFAULT 0,
                        polygon_points TEXT,
                        is_cutout INTEGER DEFAULT 0,
                        parent_zone_id INTEGER,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (property_id) REFERENCES property(id),
                        FOREIGN KEY (parent_zone_id) REFERENCES zones(id)
                    );
                """)
                new_col_names = [c[1] for c in db.execute("PRAGMA table_info(zones_new)").fetchall()]
                shared = [c for c in new_col_names if c in col_names]
                cols_str = ", ".join(shared)
                db.execute(f"INSERT INTO zones_new ({cols_str}) SELECT {cols_str} FROM zones")
                db.execute("DROP TABLE zones")
                db.execute("ALTER TABLE zones_new RENAME TO zones")
            else:
                if "polygon_points" not in zone_cols:
                    db.execute("ALTER TABLE zones ADD COLUMN polygon_points TEXT")
                if "is_cutout" not in zone_cols:
                    db.execute("ALTER TABLE zones ADD COLUMN is_cutout INTEGER DEFAULT 0")
                if "parent_zone_id" not in zone_cols:
                    db.execute("ALTER TABLE zones ADD COLUMN parent_zone_id INTEGER")
        run_migration(db, 16, "zone_types_expansion", [], callback=_zone_types_migration)

        # ── Migration 017: area map position columns ──
        def _area_map_columns(db):
            _migration_add_columns_if_missing(db, "areas", {
                "map_x_feet": "REAL",
                "map_y_feet": "REAL",
                "map_width_feet": "REAL",
                "map_height_feet": "REAL",
                "map_polygon_points": "TEXT",
            })
        run_migration(db, 17, "area_map_columns", [], callback=_area_map_columns)

        # ── Migration 018: area irrigation columns ──
        def _area_irrigation_columns(db):
            _migration_add_columns_if_missing(db, "areas", {
                "default_irrigation_type": "TEXT DEFAULT 'manual'",
                "default_irrigation_zone_name": "TEXT",
            })
        run_migration(db, 18, "area_irrigation_columns", [], callback=_area_irrigation_columns)

        # ── Migration 019: area zone_id link ──
        def _area_zone_link(db):
            _migration_add_columns_if_missing(db, "areas", {
                "zone_id": "INTEGER REFERENCES zones(id)",
            })
        run_migration(db, 19, "area_zone_link", [], callback=_area_zone_link)

        # ── Migration 020: zone height_ft for shadow calculations ──
        def _zone_height_migration(db):
            if not _table_exists(db, "zones"):
                return
            zone_cols = {row[1] for row in db.execute("PRAGMA table_info(zones)").fetchall()}
            if "height_ft" not in zone_cols:
                db.execute("ALTER TABLE zones ADD COLUMN height_ft REAL DEFAULT 6")
                db.execute("UPDATE zones SET height_ft = 15 WHERE zone_type = 'house' AND height_ft IS NULL")
                db.execute("UPDATE zones SET height_ft = 6 WHERE zone_type = 'fence' AND height_ft IS NULL")
                db.execute("UPDATE zones SET height_ft = 10 WHERE zone_type = 'patio' AND height_ft IS NULL")
                db.execute("UPDATE zones SET height_ft = 8 WHERE zone_type NOT IN ('house', 'fence', 'patio', 'garden', 'lawn', 'driveway', 'walkway', 'mulch', 'turf', 'planter_area') AND height_ft IS NULL")
                db.execute("UPDATE zones SET height_ft = 0 WHERE zone_type IN ('garden', 'lawn', 'driveway', 'walkway', 'mulch', 'turf', 'planter_area') AND height_ft IS NULL")
        run_migration(db, 20, "zone_height_ft", [], callback=_zone_height_migration)

        # ── Migration 021: soil intelligence columns ──
        def _soil_intelligence_migration(db):
            if not _table_exists(db, "zones"):
                return
            _migration_add_columns_if_missing(db, "zones", {
                "soil_type": "TEXT",
                "soil_ph_min": "REAL",
                "soil_ph_max": "REAL",
                "soil_amendments": "TEXT",
                "soil_notes": "TEXT",
            })
            if _table_exists(db, "property"):
                _migration_add_columns_if_missing(db, "property", {
                    "default_soil_type": "TEXT DEFAULT 'native-clay'",
                    "default_soil_ph": "REAL DEFAULT 8.0",
                    "default_soil_notes": "TEXT",
                })
            _migration_add_columns_if_missing(db, "garden_beds", {
                "soil_type": "TEXT",
                "soil_mix": "TEXT",
                "soil_product_id": "INTEGER REFERENCES soil_products(id)",
            })
            db.execute("""
                CREATE TABLE IF NOT EXISTS soil_products (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    soil_type TEXT NOT NULL,
                    brand TEXT NOT NULL,
                    product_name TEXT NOT NULL,
                    description TEXT,
                    composition TEXT,
                    ph_range_min REAL,
                    ph_range_max REAL,
                    best_for TEXT,
                    url TEXT,
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
        run_migration(db, 21, "soil_intelligence_columns", [], callback=_soil_intelligence_migration)

        # ── Migration 022: seed soil_products data ──
        def _seed_soil_products(db):
            existing_soil = db.execute("SELECT COUNT(*) FROM soil_products").fetchone()[0]
            if existing_soil == 0:
                SOIL_PRODUCTS_SEED = [
                    ("raised_bed_mix", "Arizona Worm Farm", "Raised Bed Mix",
                     "Blends six-month finished compost with worm castings, coco coir, perlite, and basalt rock dust for optimal nutrients and water retention.",
                     '["finished compost (6-month)", "worm castings", "coco coir", "perlite", "basalt rock dust"]',
                     6.0, 7.0, '["raised beds", "container gardens"]',
                     "https://www.arizonawormfarm.com",
                     "Recommended for all raised beds in AZ. Uses perlite instead of vermiculite due to supply issues."),
                    ("raised_bed_mix", "Kellogg", "Raised Bed & Potting Mix",
                     "All-natural raised bed and potting mix with composted forest products, peat moss, and perlite.",
                     '["composted forest products", "peat moss", "perlite", "fertilizer"]',
                     6.0, 7.0, '["raised beds", "containers"]',
                     "https://www.kellogggarden.com",
                     "Widely available at Home Depot. Decent budget option."),
                    ("raised_bed_mix", "Dr. Earth", "Raised Bed Mix",
                     "Premium organic raised bed mix with pro-biotic seven champion strains of beneficial soil microbes.",
                     '["fir bark", "peat moss", "perlite", "earthworm castings", "bat guano", "kelp meal"]',
                     6.0, 7.0, '["raised beds", "vegetable gardens"]',
                     "https://www.drearth.com",
                     "Organic and pre-fertilized. Good for vegetable gardens."),
                    ("raised_bed_mix", "FoxFarm", "Ocean Forest",
                     "Powerfully rich ocean-based potting soil with earthworm castings, bat guano, and Pacific Northwest sea-going fish and crab meal.",
                     '["earthworm castings", "bat guano", "fish meal", "crab meal", "peat moss", "forest humus", "perlite"]',
                     6.3, 6.8, '["raised beds", "containers", "indoor plants"]',
                     "https://www.foxfarm.com",
                     "Premium and pricey but great for high-value crops. Can run hot for seedlings."),
                    ("potting_mix", "Miracle-Gro", "Potting Mix",
                     "All-purpose potting mix with continuous release plant food. Feeds up to 6 months.",
                     '["sphagnum peat moss", "perlite", "coir", "fertilizer"]',
                     5.5, 6.5, '["containers", "hanging baskets", "indoor plants"]',
                     "https://www.miraclegro.com",
                     "Most widely available. Contains slow-release synthetic fertilizer."),
                    ("potting_mix", "FoxFarm", "Happy Frog Potting Soil",
                     "pH-adjusted potting soil with mycorrhizal fungi and humic acid for strong branching roots.",
                     '["composted forest humus", "sphagnum peat moss", "perlite", "earthworm castings", "bat guano", "mycorrhizae"]',
                     6.0, 6.8, '["containers", "potted plants"]',
                     "https://www.foxfarm.com",
                     "Gentler than Ocean Forest. Good for seedlings and transplants."),
                    ("potting_mix", "Black Gold", "All Purpose Potting Mix",
                     "Rich, loamy potting mix with Canadian sphagnum peat moss, earthworm castings, and perlite.",
                     '["sphagnum peat moss", "earthworm castings", "perlite", "pumice"]',
                     5.5, 6.5, '["containers", "general purpose"]',
                     "https://www.sungro.com",
                     "Solid all-purpose choice. Widely available at nurseries."),
                    ("cactus_succulent_mix", "Bonsai Jack", "Succulent & Cactus Soil",
                     "100% mineral gritty mix specifically designed for succulents and cacti. Ultra fast draining.",
                     '["calcined clay", "pine bark fines", "monto clay"]',
                     5.5, 6.5, '["succulents", "cacti", "bonsai"]',
                     "https://www.bonsaijack.com",
                     "Premium gritty mix. Zero organic material means no fungus gnats, no root rot. Expensive but lasts forever."),
                    ("cactus_succulent_mix", "Miracle-Gro", "Cactus, Palm & Citrus Potting Mix",
                     "Fast-draining formula with sand and perlite for cacti, palms, citruses, and succulents.",
                     '["sphagnum peat moss", "sand", "perlite", "forest products"]',
                     5.5, 6.5, '["cacti", "succulents", "palms", "citrus"]',
                     "https://www.miraclegro.com",
                     "Budget-friendly cactus mix. Adequate drainage for most desert plants."),
                ]
                for soil_type, brand, product_name, desc, comp, ph_min, ph_max, best, url, notes in SOIL_PRODUCTS_SEED:
                    db.execute(
                        "INSERT INTO soil_products (soil_type, brand, product_name, description, composition, ph_range_min, ph_range_max, best_for, url, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (soil_type, brand, product_name, desc, comp, ph_min, ph_max, best, url, notes),
                    )
        run_migration(db, 22, "seed_soil_products", [], callback=_seed_soil_products)

        # ── Migration 023: frost date columns on property ──
        def _frost_dates_migration(db):
            if not _table_exists(db, "property"):
                return
            _migration_add_columns_if_missing(db, "property", {
                "last_frost_spring": "TEXT",
                "first_frost_fall": "TEXT",
                "frost_free_days": "INTEGER",
            })
        run_migration(db, 23, "frost_dates_property", [], callback=_frost_dates_migration)

        # ── Migration 024: journal_entries table ──
        run_migration(db, 24, "create_journal_entries", [
            """CREATE TABLE IF NOT EXISTS journal_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entry_type TEXT NOT NULL DEFAULT 'note' CHECK(entry_type IN ('note', 'observation', 'milestone', 'problem', 'harvest', 'weather', 'photo')),
                title TEXT,
                content TEXT NOT NULL,
                plant_id INTEGER,
                planting_id INTEGER,
                bed_id INTEGER,
                tray_id INTEGER,
                ground_plant_id INTEGER,
                photo_id INTEGER,
                mood TEXT CHECK(mood IN ('great', 'good', 'okay', 'concerned', 'bad')),
                tags TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (plant_id) REFERENCES plants(id),
                FOREIGN KEY (planting_id) REFERENCES plantings(id),
                FOREIGN KEY (bed_id) REFERENCES garden_beds(id),
                FOREIGN KEY (tray_id) REFERENCES seed_trays(id)
            )""",
        ])

        # ── Migration 025: harvest_id on journal_entries ──
        def _journal_harvest_id(db):
            _migration_add_columns_if_missing(db, "journal_entries", {
                "harvest_id": "INTEGER REFERENCES harvests(id)",
            })
        run_migration(db, 25, "journal_entries_harvest_id", [], callback=_journal_harvest_id)

        # ── Migration 026: journal_entry_photos table ──
        run_migration(db, 26, "create_journal_entry_photos", [
            """CREATE TABLE IF NOT EXISTS journal_entry_photos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                journal_entry_id INTEGER NOT NULL,
                filename TEXT NOT NULL,
                original_filename TEXT,
                caption TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id)
            )""",
        ])

        # ── Migration 027: image_url on planter_types ──
        def _planter_types_image_url(db):
            if not _table_exists(db, "planter_types"):
                return
            cols = {row[1] for row in db.execute("PRAGMA table_info(planter_types)").fetchall()}
            if "image_url" not in cols:
                db.execute("ALTER TABLE planter_types ADD COLUMN image_url TEXT")
                image_urls = {
                    "GreenStalk Original 3-Tier": "https://greenstalkgarden.com/cdn/shop/files/3TierOriginalEvergreen_720x.jpg",
                    "GreenStalk Original 5-Tier": "https://greenstalkgarden.com/cdn/shop/files/5TierOriginalEvergreen_720x.jpg",
                    "GreenStalk Original 7-Tier": "https://greenstalkgarden.com/cdn/shop/files/7TierOriginalEvergreen_720x.jpg",
                    "GreenStalk Leaf 3-Tier": "https://greenstalkgarden.com/cdn/shop/files/3TierLeafEvergreen_720x.jpg",
                    "GreenStalk Leaf 5-Tier": "https://greenstalkgarden.com/cdn/shop/files/5TierLeafEvergreen_720x.jpg",
                    "GreenStalk Leaf 7-Tier": "https://greenstalkgarden.com/cdn/shop/files/7TierLeafEvergreen_720x.jpg",
                    "GreenStalk Inventor's Bundle": "https://greenstalkgarden.com/cdn/shop/files/InventorsBundleEvergreen_720x.jpg",
                    "Vego Rolling Citrus Tree Planter 30-Gallon": "https://www.vegogarden.com/cdn/shop/files/rolling-planter-twin-pack_720x.jpg",
                    "Vego Self-Watering Rolling Garden Bed 2x4": "https://www.vegogarden.com/cdn/shop/files/rolling-self-watering-garden-bed_720x.jpg",
                    "Vego Self-Watering Rolling Garden Bed 2x6": "https://www.vegogarden.com/cdn/shop/files/self-watering-rolling-garden-bed-2x6_720x.jpg",
                    "Vego Elevated Garden Bed S-Series 2x4 with Wicking": "https://m.media-amazon.com/images/I/71QJ3J7vXhL._AC_SX679_.jpg",
                }
                for name, img_url in image_urls.items():
                    db.execute("UPDATE planter_types SET image_url = ? WHERE name = ?", (img_url, name))
        run_migration(db, 27, "planter_types_image_url", [], callback=_planter_types_image_url)

        # ── Migration 028: soil_amendments table ──
        def _soil_amendments_migration(db):
            db.execute("""
                CREATE TABLE IF NOT EXISTS soil_amendments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    bed_id INTEGER,
                    ground_plant_id INTEGER,
                    amendment_type TEXT NOT NULL,
                    product_name TEXT,
                    amount TEXT,
                    applied_date TEXT NOT NULL,
                    next_due_date TEXT,
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (bed_id) REFERENCES garden_beds(id)
                )
            """)
            db.execute("CREATE INDEX IF NOT EXISTS idx_soil_amendments_bed ON soil_amendments(bed_id)")
            db.execute("CREATE INDEX IF NOT EXISTS idx_soil_amendments_ground_plant ON soil_amendments(ground_plant_id)")
            db.execute("CREATE INDEX IF NOT EXISTS idx_soil_amendments_next_due ON soil_amendments(next_due_date)")
            _migration_add_columns_if_missing(db, "soil_amendments", {
                "tray_id": "INTEGER REFERENCES seed_trays(id)",
            })
            db.execute("CREATE INDEX IF NOT EXISTS idx_soil_amendments_tray ON soil_amendments(tray_id)")
        run_migration(db, 28, "create_soil_amendments", [], callback=_soil_amendments_migration)

        # ── Migration 029: variety_id on plantings ──
        def _plantings_variety_id(db):
            _migration_add_columns_if_missing(db, "plantings", {
                "variety_id": "INTEGER REFERENCES varieties(id)",
            })
        run_migration(db, 29, "plantings_variety_id", [], callback=_plantings_variety_id)

        # ── Migration 030: timezone on property ──
        def _timezone_migration(db):
            if _table_exists(db, "property"):
                _migration_add_columns_if_missing(db, "property", {
                    "timezone": "TEXT DEFAULT 'America/Phoenix'",
                })
        run_migration(db, 30, "timezone_property", [], callback=_timezone_migration)

        # ── Migration 031: zone height_ft (duplicate-safe) ──
        def _zone_height_ft_dup(db):
            if _table_exists(db, "zones"):
                _migration_add_columns_if_missing(db, "zones", {
                    "height_ft": "REAL DEFAULT 6",
                })
        run_migration(db, 31, "zone_height_ft_dup_safe", [], callback=_zone_height_ft_dup)

        # ── Migration 032: attribution columns (created_by/updated_by) ──
        def _attribution_migration(db):
            tables = [
                'garden_beds', 'plantings', 'ground_plants', 'journal_entries',
                'garden_tasks', 'harvests', 'expenses', 'seed_inventory',
                'soil_amendments', 'areas'
            ]
            for table in tables:
                for col in ['created_by', 'updated_by']:
                    try:
                        db.execute(f"ALTER TABLE {table} ADD COLUMN {col} INTEGER REFERENCES users(id)")
                    except Exception:
                        pass
            for table in tables:
                try:
                    db.execute(f"UPDATE {table} SET created_by = 1 WHERE created_by IS NULL")
                except Exception:
                    pass
        run_migration(db, 32, "attribution_columns", [], callback=_attribution_migration)

        # ── Migration 033: audit_log table ──
        run_migration(db, 33, "create_audit_log", [
            """CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete', 'login', 'logout', 'register', 'complete', 'generate')),
                entity_type TEXT NOT NULL,
                entity_id TEXT,
                details TEXT,
                ip_address TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )""",
            "CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, created_at)",
            "CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id)",
            "CREATE INDEX IF NOT EXISTS idx_audit_log_time ON audit_log(created_at)",
        ])

        # ── Migration 034: notification system tables ──
        run_migration(db, 34, "create_notification_tables", [
            """CREATE TABLE IF NOT EXISTS app_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )""",
            """CREATE TABLE IF NOT EXISTS notification_channels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                channel_type TEXT NOT NULL CHECK(channel_type IN ('email', 'discord', 'webpush', 'pushbullet')),
                enabled INTEGER DEFAULT 1,
                config TEXT NOT NULL DEFAULT '{}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(user_id, channel_type)
            )""",
            """CREATE TABLE IF NOT EXISTS notification_preferences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                channel_type TEXT NOT NULL,
                enabled INTEGER DEFAULT 1,
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(user_id, event_type, channel_type)
            )""",
            """CREATE TABLE IF NOT EXISTS notification_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                channel_type TEXT NOT NULL,
                event_type TEXT NOT NULL,
                title TEXT NOT NULL,
                body TEXT,
                status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent', 'failed', 'pending')),
                error TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )""",
            """CREATE TABLE IF NOT EXISTS webpush_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                subscription_json TEXT NOT NULL,
                user_agent TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )""",
        ])

        # ── Migration 035: VAPID keys for web push ──
        def _vapid_keys(db):
            existing = db.execute("SELECT value FROM app_config WHERE key = 'vapid_public_key'").fetchone()
            if not existing:
                try:
                    from cryptography.hazmat.primitives.asymmetric import ec
                    from cryptography.hazmat.backends import default_backend
                    from cryptography.hazmat.primitives import serialization
                    import base64
                    private_key = ec.generate_private_key(ec.SECP256R1(), default_backend())
                    raw_pub = private_key.public_key().public_bytes(
                        serialization.Encoding.X962,
                        serialization.PublicFormat.UncompressedPoint
                    )
                    pub_b64 = base64.urlsafe_b64encode(raw_pub).rstrip(b'=').decode('ascii')
                    priv_pem = private_key.private_bytes(
                        serialization.Encoding.PEM,
                        serialization.PrivateFormat.PKCS8,
                        serialization.NoEncryption()
                    ).decode('ascii')
                    db.execute("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)", ("vapid_public_key", pub_b64))
                    db.execute("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)", ("vapid_private_key", priv_pem))
                    db.execute("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)", ("vapid_email", "mailto:admin@example.com"))
                    logger.info(f"VAPID keys generated. Public key: {pub_b64}")
                except Exception as e:
                    logger.error(f"Failed to generate VAPID keys: {e}")
        run_migration(db, 35, "vapid_keys", [], callback=_vapid_keys)

        # ── Migration 036: irrigation type rename ──
        def _irrigation_type_rename(db):
            try:
                import re as _re
                bed_has_check = False
                for row in db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='garden_beds'").fetchall():
                    if row[0] and "CHECK(irrigation_type" in row[0]:
                        bed_has_check = True
                if bed_has_check:
                    db.execute("ALTER TABLE garden_beds RENAME TO garden_beds_old")
                    create_sql = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='garden_beds_old'").fetchone()[0]
                    create_sql = create_sql.replace("garden_beds_old", "garden_beds")
                    create_sql = _re.sub(r"\s*CHECK\s*\(\s*irrigation_type\s+IN\s*\([^)]*\)\s*\)", "", create_sql)
                    db.execute(create_sql)
                    db.execute("INSERT INTO garden_beds SELECT * FROM garden_beds_old")
                    db.execute("DROP TABLE garden_beds_old")

                tray_has_check = False
                for row in db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='seed_trays'").fetchall():
                    if row[0] and "CHECK(irrigation_type" in row[0]:
                        tray_has_check = True
                if tray_has_check:
                    db.execute("ALTER TABLE seed_trays RENAME TO seed_trays_old")
                    create_sql = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='seed_trays_old'").fetchone()[0]
                    create_sql = create_sql.replace("seed_trays_old", "seed_trays")
                    create_sql = _re.sub(r"\s*CHECK\s*\(\s*irrigation_type\s+IN\s*\([^)]*\)\s*\)", "", create_sql)
                    db.execute(create_sql)
                    db.execute("INSERT INTO seed_trays SELECT * FROM seed_trays_old")
                    db.execute("DROP TABLE seed_trays_old")

                db.execute("UPDATE ground_plants SET irrigation_type = 'rachio_controller' WHERE irrigation_type = 'rachio_zone'")
                db.execute("UPDATE ground_plants SET irrigation_type = 'rachio_hose_timer' WHERE irrigation_type = 'rachio_hose'")
                db.execute("UPDATE garden_beds SET irrigation_type = 'rachio_controller' WHERE irrigation_type = 'rachio_zone'")
                db.execute("UPDATE garden_beds SET irrigation_type = 'rachio_hose_timer' WHERE irrigation_type = 'rachio_hose'")
                db.execute("UPDATE seed_trays SET irrigation_type = 'rachio_hose_timer' WHERE irrigation_type = 'rachio_hose'")
                db.execute("UPDATE bed_sections SET irrigation_type = 'rachio_controller' WHERE irrigation_type = 'rachio_zone'")
                db.execute("UPDATE bed_sections SET irrigation_type = 'rachio_hose_timer' WHERE irrigation_type = 'rachio_hose'")
                db.execute("UPDATE areas SET default_irrigation_type = 'rachio_controller' WHERE default_irrigation_type = 'rachio_zone'")
                db.execute("UPDATE areas SET default_irrigation_type = 'rachio_hose_timer' WHERE default_irrigation_type = 'rachio_hose'")
                logger.info("Irrigation type rename migration complete")
            except Exception as e:
                logger.error(f"Irrigation type rename migration error: {e}")
        run_migration(db, 36, "irrigation_type_rename", [], callback=_irrigation_type_rename)

        # ── Migration 037: integration_settings table ──
        run_migration(db, 37, "create_integration_settings", [
            """CREATE TABLE IF NOT EXISTS integration_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                integration TEXT UNIQUE NOT NULL,
                config TEXT NOT NULL DEFAULT '{}',
                enabled INTEGER DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )""",
        ])

        # ── Migration 038: seed integration settings ──
        def _seed_integrations(db):
            count = db.execute("SELECT COUNT(*) FROM integration_settings").fetchone()[0]
            if count == 0:
                openai_key = os.environ.get("OPENAI_API_KEY")
                if openai_key:
                    db.execute("INSERT INTO integration_settings (integration, config, enabled) VALUES (?, ?, 1)",
                               ("openai", json.dumps({"api_key": openai_key})))
                ha_token = os.environ.get("HA_TOKEN")
                if ha_token:
                    db.execute("INSERT INTO integration_settings (integration, config, enabled) VALUES (?, ?, 1)",
                               ("home_assistant", json.dumps({"url": os.environ.get("HA_URL", "http://homeassistant.local:8123"), "token": ha_token})))
        run_migration(db, 38, "seed_integration_settings", [], callback=_seed_integrations)

        # ── Migration 039: journal adaptive fields (severity, milestone_type, tray_cell_id) ──
        def _journal_adaptive_fields(db):
            _migration_add_columns_if_missing(db, "journal_entries", {
                "severity": "TEXT",
                "milestone_type": "TEXT",
                "tray_cell_id": "INTEGER",
            })
        run_migration(db, 39, "journal_adaptive_fields", [], callback=_journal_adaptive_fields)

        # ── Migration 040: sensor_assignments table ──
        run_migration(db, 40, "sensor_assignments", [
            """CREATE TABLE IF NOT EXISTS sensor_assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_id TEXT NOT NULL,
                entity_friendly_name TEXT,
                target_type TEXT NOT NULL CHECK(target_type IN ('bed', 'ground_plant', 'tray', 'area')),
                target_id INTEGER NOT NULL,
                sensor_role TEXT NOT NULL DEFAULT 'soil_moisture',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(entity_id, target_type, target_id)
            )"""
        ])

        # ── Migration 041: pest_incidents table ──
        run_migration(db, 41, "pest_tracking", [
            """CREATE TABLE IF NOT EXISTS pest_incidents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plant_id INTEGER,
                bed_id INTEGER,
                ground_plant_id INTEGER,
                pest_type TEXT NOT NULL,
                pest_name TEXT NOT NULL,
                severity TEXT NOT NULL DEFAULT 'low' CHECK(severity IN ('low', 'medium', 'high', 'critical')),
                status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'monitoring', 'treated', 'resolved')),
                treatment TEXT,
                notes TEXT,
                detected_date TEXT NOT NULL,
                resolved_date TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (plant_id) REFERENCES plants(id),
                FOREIGN KEY (bed_id) REFERENCES garden_beds(id),
                FOREIGN KEY (ground_plant_id) REFERENCES ground_plants(id)
            )""",
            "CREATE INDEX IF NOT EXISTS idx_pest_incidents_date ON pest_incidents(detected_date)",
        ])

        # ── Migration 042: plant_instances and plant_instance_locations tables ──
        run_migration(db, 42, "plant_instances", [
            """CREATE TABLE IF NOT EXISTS plant_instances (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plant_id INTEGER NOT NULL,
                variety_id INTEGER,
                label TEXT,
                status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN (
                    'planned', 'seeded', 'sprouted', 'growing', 'flowering',
                    'fruiting', 'harvested', 'established', 'dormant', 'removed', 'died'
                )),
                planted_date TEXT,
                notes TEXT,
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (plant_id) REFERENCES plants(id),
                FOREIGN KEY (variety_id) REFERENCES varieties(id)
            )""",
            "CREATE INDEX IF NOT EXISTS idx_plant_instances_plant ON plant_instances(plant_id)",
            "CREATE INDEX IF NOT EXISTS idx_plant_instances_status ON plant_instances(status)",
            """CREATE TABLE IF NOT EXISTS plant_instance_locations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                instance_id INTEGER NOT NULL,
                location_type TEXT NOT NULL CHECK(location_type IN ('planter', 'ground', 'tray')),
                bed_id INTEGER,
                cell_x INTEGER,
                cell_y INTEGER,
                ground_plant_id INTEGER,
                tray_id INTEGER,
                tray_row INTEGER,
                tray_col INTEGER,
                placed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                removed_at TIMESTAMP,
                is_current INTEGER DEFAULT 1,
                FOREIGN KEY (instance_id) REFERENCES plant_instances(id),
                FOREIGN KEY (bed_id) REFERENCES garden_beds(id),
                FOREIGN KEY (ground_plant_id) REFERENCES ground_plants(id),
                FOREIGN KEY (tray_id) REFERENCES seed_trays(id)
            )""",
            "CREATE INDEX IF NOT EXISTS idx_pil_instance ON plant_instance_locations(instance_id)",
            "CREATE INDEX IF NOT EXISTS idx_pil_current ON plant_instance_locations(is_current)",
        ])

        # ── Migration 043: add instance_id columns to existing tables ──
        def _add_instance_id_columns(db):
            _migration_add_columns_if_missing(db, "plantings", {"instance_id": "INTEGER REFERENCES plant_instances(id)"})
            _migration_add_columns_if_missing(db, "ground_plants", {"instance_id": "INTEGER REFERENCES plant_instances(id)"})
        run_migration(db, 43, "add_instance_id_columns", [], callback=_add_instance_id_columns)

        # ── Migration 044: migrate existing data to plant_instances ──
        def _migrate_existing_to_instances(db):
            """Migrate existing plantings, ground_plants, and tray cells to plant_instances."""
            count = db.execute("SELECT COUNT(*) FROM plant_instances").fetchone()[0]
            if count > 0:
                return

            # Migrate bed plantings
            for p in db.execute("SELECT * FROM plantings WHERE plant_id IS NOT NULL").fetchall():
                p = dict(p)
                # Map planting statuses to instance statuses
                status = p.get("status") or "planned"
                if status not in ('planned', 'seeded', 'sprouted', 'growing', 'flowering',
                                  'fruiting', 'harvested', 'established', 'dormant', 'removed', 'died'):
                    status = 'growing'
                cursor = db.execute(
                    "INSERT INTO plant_instances (plant_id, variety_id, status, planted_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)",
                    (p["plant_id"], p.get("variety_id"), status, p.get("planted_date"), p.get("notes"), p.get("created_by"))
                )
                instance_id = cursor.lastrowid
                db.execute("UPDATE plantings SET instance_id = ? WHERE id = ?", (instance_id, p["id"]))
                if p.get("bed_id"):
                    db.execute(
                        "INSERT INTO plant_instance_locations (instance_id, location_type, bed_id, cell_x, cell_y) VALUES (?, 'planter', ?, ?, ?)",
                        (instance_id, p["bed_id"], p.get("cell_x"), p.get("cell_y"))
                    )

            # Migrate ground plants
            for gp in db.execute("SELECT * FROM ground_plants WHERE plant_id IS NOT NULL").fetchall():
                gp = dict(gp)
                status = gp.get("status") or "growing"
                if status == "dead":
                    status = "died"
                elif status not in ('planned', 'seeded', 'sprouted', 'growing', 'flowering',
                                    'fruiting', 'harvested', 'established', 'dormant', 'removed', 'died'):
                    status = 'growing'
                cursor = db.execute(
                    "INSERT INTO plant_instances (plant_id, variety_id, label, status, planted_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (gp["plant_id"], gp.get("variety_id"), gp.get("name"), status, gp.get("planted_date"), gp.get("notes"), gp.get("created_by"))
                )
                instance_id = cursor.lastrowid
                db.execute("UPDATE ground_plants SET instance_id = ? WHERE id = ?", (instance_id, gp["id"]))
                db.execute(
                    "INSERT INTO plant_instance_locations (instance_id, location_type, ground_plant_id) VALUES (?, 'ground', ?)",
                    (instance_id, gp["id"])
                )

            # Migrate tray cells
            for tc in db.execute("SELECT * FROM seed_tray_cells WHERE plant_id IS NOT NULL").fetchall():
                tc = dict(tc)
                status = tc.get("status") or "seeded"
                if status == "germinated":
                    status = "sprouted"
                elif status not in ('planned', 'seeded', 'sprouted', 'growing', 'flowering',
                                    'fruiting', 'harvested', 'established', 'dormant', 'removed', 'died'):
                    status = 'seeded'
                cursor = db.execute(
                    "INSERT INTO plant_instances (plant_id, status, planted_date) VALUES (?, ?, ?)",
                    (tc["plant_id"], status, tc.get("seed_date"))
                )
                instance_id = cursor.lastrowid
                db.execute(
                    "INSERT INTO plant_instance_locations (instance_id, location_type, tray_id, tray_row, tray_col) VALUES (?, 'tray', ?, ?, ?)",
                    (instance_id, tc.get("tray_id"), tc.get("row"), tc.get("col"))
                )

        run_migration(db, 44, "migrate_to_plant_instances", [], callback=_migrate_existing_to_instances)

        # ── Migration 045: add requested plants and Zinnia varieties ──
        def _add_requested_plants(db):
            """Add plants requested by users: Mini Carnation, Sweet Banana Pepper, Pinto Bean, Zinnia varieties."""
            new_plants = [
                # (name, category, subcategory, dtm_min, dtm_max, spacing, sun, water, heat_tol, cold_tol, desert_seasons, sow_indoor, sow_outdoor, transplant, harvest, notes)
                ("Mini Carnation", "flower", "annual flower", 60, 90, 6, "full", "moderate", "high", "moderate",
                 '["cool","warm"]', None, '["10-01","03-15"]', '["10-15","03-31"]', None,
                 "Compact dwarf carnations with frilly blooms. Heat tolerant, great for borders and containers. Attracts butterflies."),
                ("Sweet Banana Pepper", "vegetable", "pepper", 65, 75, 18, "full", "moderate", "high", "moderate",
                 '["warm"]', 6, '["02-15","04-01"]', '["03-01","04-15"]', '["05-15","10-31"]',
                 "Sweet, mild banana-shaped peppers. Excellent heat tolerance. Great for salads, frying, and pickling."),
                ("Pinto Bean", "vegetable", "legume", 80, 100, 6, "full", "moderate", "high", "moderate",
                 '["warm","monsoon"]', None, '["03-01","08-15"]', None, '["06-01","11-15"]',
                 "Classic dried bean variety. Bush type, heat tolerant, nitrogen fixer. Great for desert gardens."),
            ]
            for p in new_plants:
                existing = db.execute("SELECT id FROM plants WHERE name = ?", (p[0],)).fetchone()
                if not existing:
                    db.execute(
                        """INSERT INTO plants (name, category, subcategory, days_to_maturity_min, days_to_maturity_max,
                           spacing_inches, sun, water, heat_tolerance, cold_tolerance, desert_seasons,
                           sow_indoor_weeks_before_transplant, desert_sow_outdoor, desert_transplant,
                           desert_harvest, notes)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        p
                    )

            # Add Zinnia varieties
            zinnia = db.execute("SELECT id FROM plants WHERE name = 'Zinnia'").fetchone()
            if zinnia:
                zinnia_id = zinnia[0]
                new_varieties = [
                    # (name, description, dtm_min, dtm_max, heat_tol, disease_res, flavor, size, color, growth, desert_rating, desert_notes, source)
                    ("Profusion Orange", "Outstanding heat and disease resistance. Compact mounds of single orange blooms all season. Zinnia marylandica hybrid.",
                     45, 60, "excellent", None, "N/A (ornamental)", "Compact (12-15 in)", "Orange", "Compact mound", 5,
                     "Specific color selection from the Profusion series. Brilliant orange single blooms non-stop through AZ summer.", "Hybrid"),
                    ("Profusion Cherry", "Same tough Profusion series in cherry red. Non-stop blooms, no deadheading needed.",
                     45, 60, "excellent", None, "N/A (ornamental)", "Compact (12-15 in)", "Cherry red", "Compact mound", 5,
                     "Cherry red selection. Same bulletproof disease resistance and heat tolerance as all Profusion types.", "Hybrid"),
                    ("Profusion Double Mix", "Double-flowered Profusion in mixed colors. Same bulletproof performance.",
                     45, 60, "excellent", None, "N/A (ornamental)", "Compact (12-15 in)", "Mixed — orange, cherry, white, yellow", "Compact mound", 5,
                     "Double-flowered version of the Profusion series. Fuller blooms, same tough performance.", "Hybrid"),
                    ("Benary's Giant", "Premier cut flower zinnia. 4-5 inch fully double blooms on long stems.",
                     75, 90, "high", None, "N/A (ornamental, cut flower)", "Tall (40-50 in)", "Mixed — many colors available", "Tall upright", 3,
                     "The gold standard cut flower zinnia. Massive fully double blooms. Needs more care in extreme desert heat — afternoon shade helps.", "Open-pollinated"),
                    ("Zahara Double Fire", "Compact, disease-resistant. Bicolor red and yellow double blooms.",
                     45, 60, "excellent", None, "N/A (ornamental)", "Compact (12-18 in)", "Bicolor red and yellow", "Compact mound", 5,
                     "Stunning bicolor flowers. Disease resistant like Profusion. Great for borders and containers in AZ heat.", "Hybrid"),
                    ("Cut and Come Again", "Medium height, prolific bloomer. The more you cut, the more it blooms.",
                     60, 75, "high", None, "N/A (ornamental, cut flower)", "Medium (18-24 in)", "Mixed colors", "Bushy, branching", 4,
                     "Classic cottage garden zinnia. Branching habit means more blooms per plant. Good cut flower. Reliable in AZ.", "Open-pollinated"),
                ]
                for v in new_varieties:
                    existing = db.execute("SELECT id FROM varieties WHERE name = ? AND plant_id = ?", (v[0], zinnia_id)).fetchone()
                    if not existing:
                        db.execute(
                            """INSERT INTO varieties (plant_id, name, description, days_to_maturity_min, days_to_maturity_max,
                               heat_tolerance, disease_resistance, flavor_profile, size, color,
                               growth_habit, desert_rating, desert_notes, source)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                            (zinnia_id, *v)
                        )
            db.commit()

        run_migration(db, 45, "add_requested_plants", [], callback=_add_requested_plants)

        # ── Migration 046: add instance_id to soil_amendments ──
        def _amendment_instance_id(db):
            _migration_add_columns_if_missing(db, "soil_amendments", {
                "instance_id": "INTEGER REFERENCES plant_instances(id)"
            })
            db.execute("CREATE INDEX IF NOT EXISTS idx_soil_amendments_instance ON soil_amendments(instance_id)")
            db.commit()
        run_migration(db, 46, "amendment_instance_id", [], callback=_amendment_instance_id)

        # ── Migration 047: companion planting — multiple plants per cell ──
        def _companion_planting(db):
            _migration_add_columns_if_missing(db, "plantings", {
                "cell_role": "TEXT DEFAULT 'primary' CHECK(cell_role IN ('primary', 'companion'))",
                "companion_of": "INTEGER REFERENCES plantings(id)",
            })
            db.commit()
        run_migration(db, 47, "companion_planting", [], callback=_companion_planting)

        # ── Migration 048: voice_note_filename on journal_entries ──
        def _journal_voice_notes(db):
            _migration_add_columns_if_missing(db, "journal_entries", {
                "voice_note_filename": "TEXT",
            })
            db.commit()
        run_migration(db, 48, "journal_voice_notes", [], callback=_journal_voice_notes)

        def _fix_expense_check_constraint(db):
            """Remove restrictive CHECK constraint on expenses.category to allow new categories like 'transplants'."""
            schema = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='expenses'").fetchone()
            if not schema or "transplants" in schema[0]:
                return  # Already fixed or doesn't exist
            # Get current columns
            cols = [r[1] for r in db.execute("PRAGMA table_info(expenses)").fetchall()]
            # Recreate without CHECK constraint
            db.execute("ALTER TABLE expenses RENAME TO expenses_old")
            db.execute("""CREATE TABLE expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                description TEXT NOT NULL,
                amount_cents INTEGER NOT NULL,
                purchase_date TEXT,
                notes TEXT,
                plant_id INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by INTEGER REFERENCES users(id),
                updated_by INTEGER REFERENCES users(id)
            )""")
            shared = [c for c in cols if c in ['id','category','description','amount_cents','purchase_date','notes','plant_id','created_at','created_by','updated_by']]
            cols_str = ", ".join(shared)
            db.execute(f"INSERT INTO expenses ({cols_str}) SELECT {cols_str} FROM expenses_old")
            db.execute("DROP TABLE expenses_old")
            db.commit()

        run_migration(db, 49, "fix_expense_check_constraint", [], callback=_fix_expense_check_constraint)

        # ── Migration 050: harvest instance_id ──
        def _harvest_instance_id(db):
            _migration_add_columns_if_missing(db, "harvests", {
                "instance_id": "INTEGER REFERENCES plant_instances(id)",
            })
            # Backfill from existing planting_id → plantings.instance_id
            db.execute("""
                UPDATE harvests SET instance_id = (
                    SELECT p.instance_id FROM plantings p WHERE p.id = harvests.planting_id
                ) WHERE instance_id IS NULL AND planting_id IS NOT NULL
            """)
            db.commit()
        run_migration(db, 50, "harvest_instance_id", [], callback=_harvest_instance_id)

        # ── Migration 051: nursery transplant columns ──
        def _nursery_transplant(db):
            for col, default in [("source", "'seed'"), ("effective_planted_date", "NULL")]:
                try:
                    db.execute(f"ALTER TABLE plantings ADD COLUMN {col} TEXT DEFAULT {default}")
                except Exception:
                    pass
            db.commit()
        run_migration(db, 51, "nursery_transplant_columns", [], callback=_nursery_transplant)

        # ── Migration 052: plant task templates ──
        def _task_templates(db):
            db.execute("""CREATE TABLE IF NOT EXISTS plant_task_templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plant_id INTEGER,
                plant_name TEXT,
                task_type TEXT NOT NULL,
                title_template TEXT NOT NULL,
                description_template TEXT,
                trigger_type TEXT NOT NULL CHECK(trigger_type IN ('days_after_planting', 'growth_stage', 'recurring', 'one_time')),
                trigger_value TEXT NOT NULL,
                priority TEXT DEFAULT 'medium',
                season_filter TEXT,
                category TEXT
            )""")
            db.execute("CREATE INDEX IF NOT EXISTS idx_ptt_plant ON plant_task_templates(plant_id)")

            # Seed templates for common plants
            templates = [
                # Tomato
                ('Tomato', 'stake', 'Stake {plant_name}', 'Install cage or stakes when plant reaches 12 inches', 'days_after_planting', '21', 'high', None),
                ('Tomato', 'prune', 'Prune suckers on {plant_name}', 'Remove suckers below first flower cluster for indeterminate varieties', 'days_after_planting', '28', 'medium', None),
                ('Tomato', 'fertilize', 'Fertilize {plant_name}', 'Apply balanced fertilizer (10-10-10) or tomato-specific feed', 'recurring', '14', 'medium', None),
                ('Tomato', 'pest_check', 'Check {plant_name} for hornworms', 'Inspect leaves and stems for tomato hornworm damage', 'recurring', '7', 'medium', 'spring,summer'),
                ('Tomato', 'harvest', 'Check {plant_name} for ripe fruit', 'Harvest when fully colored and slightly soft to touch', 'growth_stage', 'fruiting', 'medium', None),

                # Pepper (all types)
                ('Pepper', 'custom', 'Pinch first flowers on {plant_name}', 'Remove first flowers to encourage stronger root development', 'days_after_planting', '14', 'high', None),
                ('Pepper', 'fertilize', 'Fertilize {plant_name}', 'Apply low-nitrogen fertilizer. Too much nitrogen = leaves, no fruit', 'recurring', '21', 'medium', None),
                ('Pepper', 'pest_check', 'Check {plant_name} for aphids', 'Inspect undersides of leaves for aphid clusters', 'recurring', '7', 'low', None),

                # Lettuce
                ('Lettuce', 'custom', 'Thin {plant_name} seedlings', 'Thin to proper spacing when seedlings have 2-3 true leaves', 'days_after_planting', '10', 'high', None),
                ('Lettuce', 'harvest', 'Harvest outer leaves of {plant_name}', 'Cut-and-come-again: harvest outer leaves, leave center growing', 'days_after_planting', '30', 'medium', None),
                ('Lettuce', 'custom', 'Watch {plant_name} for bolting', 'In hot weather, lettuce bolts quickly. Harvest before it gets bitter', 'days_after_planting', '45', 'high', 'spring,summer'),

                # Celery
                ('Celery', 'fertilize', 'Feed {plant_name} — heavy feeder', 'Celery needs frequent feeding. Apply nitrogen-rich fertilizer', 'recurring', '14', 'high', None),
                ('Celery', 'water', 'Deep water {plant_name}', 'Celery needs consistently moist soil. Never let it dry out', 'recurring', '2', 'high', None),

                # Beans
                ('Bean (Bush)', 'custom', 'Inoculate {plant_name} soil', 'Add rhizobium inoculant for better nitrogen fixation if not done at planting', 'one_time', '0', 'medium', None),
                ('Bean (Bush)', 'harvest', 'Check {plant_name} for harvest', 'Pick beans when pods are firm and snap cleanly. Pick often to encourage production', 'days_after_planting', '55', 'medium', None),

                # Cucumber
                ('Cucumber', 'stake', 'Trellis {plant_name}', 'Train vines onto trellis or cage for better airflow and easier harvesting', 'days_after_planting', '14', 'high', None),
                ('Cucumber', 'harvest', 'Check {plant_name} for harvest', 'Harvest cucumbers when 6-8 inches. Don\'t let them yellow on vine', 'days_after_planting', '50', 'medium', None),

                # Zucchini/Squash
                ('Zucchini', 'pest_check', 'Check {plant_name} for squash bugs', 'Look for bronze eggs on leaf undersides. Remove immediately', 'recurring', '7', 'medium', 'spring,summer'),
                ('Zucchini', 'harvest', 'Harvest {plant_name}', 'Pick when 6-8 inches for best flavor. Gets woody if too large', 'days_after_planting', '45', 'medium', None),
                ('Zucchini', 'custom', 'Hand pollinate {plant_name}', 'If not setting fruit, hand-pollinate morning flowers with a paintbrush', 'growth_stage', 'flowering', 'high', None),

                # Corn
                ('Corn', 'fertilize', 'Side-dress {plant_name} with nitrogen', 'Apply nitrogen fertilizer when corn is knee-high', 'days_after_planting', '30', 'high', None),
                ('Corn', 'custom', 'Hill soil around {plant_name}', 'Mound soil around base for wind stability', 'days_after_planting', '21', 'medium', None),

                # Eggplant
                ('Eggplant', 'stake', 'Stake {plant_name}', 'Support heavy fruit with stakes or cage', 'days_after_planting', '28', 'high', None),
                ('Eggplant', 'fertilize', 'Fertilize {plant_name}', 'Feed every 2 weeks with balanced fertilizer', 'recurring', '14', 'medium', None),

                # Carrot
                ('Carrot', 'custom', 'Thin {plant_name} seedlings', 'Thin to 2 inches apart when tops are 2 inches tall', 'days_after_planting', '14', 'high', None),

                # Herbs (Basil)
                ('Basil', 'prune', 'Pinch {plant_name} to encourage bushiness', 'Pinch off top sets of leaves regularly. Don\'t let it flower', 'recurring', '10', 'medium', None),

                # Swiss Chard
                ('Swiss Chard', 'harvest', 'Harvest outer leaves of {plant_name}', 'Cut outer leaves at base. Inner leaves keep growing', 'days_after_planting', '30', 'medium', None),
            ]

            for t in templates:
                plant_name, task_type, title, desc, trigger_type, trigger_val, priority, season = t
                # Look up plant_id
                plant = db.execute("SELECT id FROM plants WHERE name = ?", (plant_name,)).fetchone()
                plant_id = plant[0] if plant else None
                db.execute(
                    "INSERT INTO plant_task_templates (plant_id, plant_name, task_type, title_template, description_template, trigger_type, trigger_value, priority, season_filter) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (plant_id, plant_name, task_type, title, desc, trigger_type, trigger_val, priority, season)
                )
            db.commit()

        run_migration(db, 52, "plant_task_templates", [], callback=_task_templates)

        # ── Migration 053: task templates for ALL remaining plants ──
        def _all_plant_templates(db):
            # Get all plants
            plants = db.execute("SELECT id, name, category FROM plants").fetchall()
            # Get plant names that already have templates
            existing = set(
                row[0] for row in db.execute(
                    "SELECT DISTINCT plant_name FROM plant_task_templates"
                ).fetchall()
            )

            # ── Plant-specific templates (override category defaults) ──
            # Format: (task_type, title, description, trigger_type, trigger_value, priority, season_filter)
            specific = {
                # ── VEGETABLES ──
                'Watermelon': [
                    ('custom', 'Set up trellis or ground support for {plant_name}', 'Use straw mulch under fruit to prevent rot, or trellis with slings for vertical growing', 'days_after_planting', '14', 'high', None),
                    ('custom', 'Hand pollinate {plant_name}', 'Transfer pollen from male to female flowers (female has small fruit behind bloom) with paintbrush in morning', 'growth_stage', 'flowering', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Switch to low-nitrogen, high-potassium fertilizer once fruit sets', 'recurring', '21', 'medium', None),
                    ('custom', 'Thump test {plant_name} for ripeness', 'Ripe melons sound hollow when thumped. Also check: tendril nearest fruit turns brown, ground spot turns yellow', 'days_after_planting', '80', 'medium', None),
                    ('pest_check', 'Check {plant_name} for pests', 'Watch for aphids, cucumber beetles, and squash vine borers', 'recurring', '10', 'low', None),
                ],
                'Cantaloupe': [
                    ('custom', 'Mulch under {plant_name} fruit', 'Place straw or cardboard under developing fruit to prevent rot', 'days_after_planting', '21', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Apply balanced fertilizer, switch to low-nitrogen once flowering begins', 'recurring', '21', 'medium', None),
                    ('harvest', 'Check {plant_name} for harvest', 'Ripe when stem slips easily from fruit with gentle pressure and smells sweet at blossom end', 'days_after_planting', '75', 'medium', None),
                    ('pest_check', 'Check {plant_name} for pests', 'Watch for cucumber beetles and squash bugs', 'recurring', '10', 'low', None),
                ],
                'Pumpkin': [
                    ('custom', 'Train {plant_name} vines', 'Direct vine growth to keep plants organized. Pinch side runners if space is limited', 'days_after_planting', '21', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Heavy feeder — apply compost tea or balanced fertilizer regularly', 'recurring', '14', 'medium', None),
                    ('custom', 'Elevate {plant_name} fruit', 'Place cardboard or straw under developing pumpkins to prevent rot', 'days_after_planting', '45', 'medium', None),
                    ('harvest', 'Check {plant_name} for harvest', 'Harvest when skin is hard, deep color, and stem begins to dry. Cut with 4 inches of stem', 'days_after_planting', '100', 'medium', None),
                ],
                'Snap Pea': [
                    ('stake', 'Install trellis for {plant_name}', 'Peas need support — install trellis, netting, or stakes at planting time', 'days_after_planting', '7', 'high', None),
                    ('harvest', 'Harvest {plant_name} frequently', 'Pick pods when plump but still bright green. Harvest daily to encourage continued production', 'days_after_planting', '60', 'high', None),
                    ('pest_check', 'Check {plant_name} for pests', 'Watch for aphids and powdery mildew', 'recurring', '10', 'low', None),
                ],
                'Snow Pea': [
                    ('stake', 'Install trellis for {plant_name}', 'Snow peas need support — install trellis or netting', 'days_after_planting', '7', 'high', None),
                    ('harvest', 'Harvest {plant_name} when flat', 'Pick when pods are flat and peas are barely visible inside. Don\'t let them get fat', 'days_after_planting', '55', 'high', None),
                    ('pest_check', 'Check {plant_name} for powdery mildew', 'Ensure good airflow. Remove affected leaves immediately', 'recurring', '10', 'low', None),
                ],
                'Pea': [
                    ('stake', 'Install trellis for {plant_name}', 'Most pea varieties benefit from support — install at planting time', 'days_after_planting', '7', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick regularly to encourage continued production. Timing depends on variety', 'days_after_planting', '60', 'medium', None),
                    ('custom', 'Inoculate {plant_name} seeds', 'Use rhizobium inoculant at planting for better nitrogen fixation', 'one_time', '0', 'medium', None),
                ],
                'Artichoke': [
                    ('fertilize', 'Feed {plant_name}', 'Heavy feeder — apply balanced fertilizer or compost monthly', 'recurring', '30', 'medium', None),
                    ('harvest', 'Harvest {plant_name} buds', 'Cut buds when tight and firm, before scales open. Cut 3 inches below bud', 'growth_stage', 'flowering', 'high', None),
                    ('prune', 'Cut back {plant_name} after harvest', 'After main harvest, cut stalks to ground to encourage fall resprout', 'growth_stage', 'fruiting', 'medium', None),
                ],
                'Asparagus': [
                    ('fertilize', 'Feed {plant_name} bed', 'Apply compost and balanced fertilizer in early spring before spears emerge', 'recurring', '90', 'medium', 'spring'),
                    ('custom', 'Stop harvesting {plant_name}', 'Stop cutting spears after 8 weeks to let ferns grow and feed roots for next year', 'days_after_planting', '60', 'high', 'spring'),
                    ('prune', 'Cut back {plant_name} ferns', 'Cut brown ferns to ground in late fall or early winter', 'recurring', '365', 'medium', 'fall'),
                ],
                'Potato': [
                    ('custom', 'Hill {plant_name}', 'Mound soil around stems when plants are 6-8 inches tall. Repeat as they grow. Prevents green tubers', 'days_after_planting', '21', 'high', None),
                    ('pest_check', 'Check {plant_name} for Colorado potato beetle', 'Inspect leaves for yellow-striped beetles and orange egg clusters. Hand-pick or use BT', 'recurring', '7', 'medium', 'spring,summer'),
                    ('harvest', 'Harvest {plant_name}', 'Dig when foliage dies back. New potatoes can be harvested earlier while plants are still green', 'days_after_planting', '90', 'medium', None),
                ],
                'Sweet Potato': [
                    ('custom', 'Train {plant_name} vines', 'Redirect vines back toward the mound to prevent rooting at nodes (reduces tuber size)', 'days_after_planting', '30', 'medium', None),
                    ('harvest', 'Harvest {plant_name} before frost', 'Dig carefully before first frost. Cure in warm humid spot for 10 days before storing', 'days_after_planting', '100', 'high', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Use low-nitrogen fertilizer — too much nitrogen makes vines not tubers', 'recurring', '30', 'low', None),
                ],
                'Garlic': [
                    ('custom', 'Remove {plant_name} scapes', 'Cut curly flower stalks (scapes) when they form to direct energy to bulb. Scapes are edible!', 'growth_stage', 'flowering', 'high', None),
                    ('custom', 'Stop watering {plant_name}', 'Stop irrigation 2 weeks before harvest to let bulbs cure in ground', 'days_after_planting', '200', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Dig when lower 1/3 of leaves are brown. Cure in dry shaded area for 2-3 weeks', 'days_after_planting', '220', 'high', None),
                ],
                'Onion': [
                    ('fertilize', 'Fertilize {plant_name}', 'Apply nitrogen-rich fertilizer every 2-3 weeks during leaf growth phase', 'recurring', '21', 'medium', None),
                    ('custom', 'Stop fertilizing {plant_name}', 'When bulbs start swelling, stop nitrogen to encourage bulb formation', 'days_after_planting', '90', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Ready when tops fall over and start yellowing. Pull and cure in sun for a few days', 'days_after_planting', '110', 'medium', None),
                ],
                'Beet': [
                    ('custom', 'Thin {plant_name} seedlings', 'Thin to 3-4 inches apart when 2 inches tall. Eat the thinnings as microgreens', 'days_after_planting', '14', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Pull when 1.5-3 inches diameter. Larger beets get woody. Greens are also edible', 'days_after_planting', '55', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Side-dress with compost. Avoid high nitrogen which promotes tops over roots', 'recurring', '30', 'low', None),
                ],
                'Radish': [
                    ('custom', 'Thin {plant_name} seedlings', 'Thin to 2 inches apart soon after germination for proper root development', 'days_after_planting', '7', 'high', None),
                    ('harvest', 'Harvest {plant_name} promptly', 'Pull when roots reach marble to golf-ball size. Gets pithy and hot if left too long', 'days_after_planting', '25', 'high', None),
                ],
                'Spinach': [
                    ('harvest', 'Harvest outer {plant_name} leaves', 'Cut outer leaves when 3-4 inches long, leaving center to keep growing', 'days_after_planting', '25', 'medium', None),
                    ('custom', 'Watch {plant_name} for bolting', 'Bolts in heat — harvest entire plant if temperatures rise above 80F consistently', 'days_after_planting', '40', 'high', 'spring,summer'),
                    ('fertilize', 'Fertilize {plant_name}', 'Apply nitrogen-rich fertilizer for lush leaf growth', 'recurring', '21', 'low', None),
                ],
                'Kale': [
                    ('harvest', 'Harvest outer {plant_name} leaves', 'Pick lower/outer leaves first, leaving growing center. Gets sweeter after frost', 'days_after_planting', '30', 'medium', None),
                    ('pest_check', 'Check {plant_name} for cabbage worms', 'Inspect for green caterpillars and white butterflies. Use BT spray or row covers', 'recurring', '7', 'medium', 'spring,summer'),
                    ('fertilize', 'Fertilize {plant_name}', 'Side-dress with compost or nitrogen-rich fertilizer monthly', 'recurring', '30', 'low', None),
                ],
                'Broccoli': [
                    ('harvest', 'Check {plant_name} for harvest', 'Cut main head when florets are tight and dark green, before any yellowing. Side shoots will follow', 'days_after_planting', '60', 'high', None),
                    ('pest_check', 'Check {plant_name} for cabbage worms', 'Look for green caterpillars. Use row covers or BT spray', 'recurring', '7', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Heavy feeder — side-dress with nitrogen-rich fertilizer after transplanting', 'recurring', '21', 'medium', None),
                ],
                'Cauliflower': [
                    ('custom', 'Blanch {plant_name} heads', 'When head is 2-3 inches, tie outer leaves over curd to keep it white. Check daily', 'growth_stage', 'flowering', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Cut when head is firm, white, and 6-8 inches across. Don\'t wait for it to separate', 'days_after_planting', '70', 'high', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Very heavy feeder — apply nitrogen-rich fertilizer every 2 weeks', 'recurring', '14', 'high', None),
                ],
                'Cabbage': [
                    ('fertilize', 'Fertilize {plant_name}', 'Heavy feeder — side-dress with nitrogen fertilizer every 3 weeks', 'recurring', '21', 'medium', None),
                    ('pest_check', 'Check {plant_name} for cabbage worms', 'Look for holes in leaves, green caterpillars, and white butterflies nearby', 'recurring', '7', 'medium', None),
                    ('harvest', 'Check {plant_name} for harvest', 'Harvest when heads are firm and solid. Cut at base leaving a few outer leaves for possible second crop', 'days_after_planting', '70', 'medium', None),
                ],
                'Brussels Sprouts': [
                    ('custom', 'Top {plant_name} plant', 'Cut off growing tip 3-4 weeks before expected harvest to force sprout development', 'days_after_planting', '90', 'high', None),
                    ('harvest', 'Harvest {plant_name} from bottom up', 'Pick sprouts from bottom when firm and 1-2 inches. Taste improves after frost', 'days_after_planting', '100', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Heavy feeder — apply nitrogen fertilizer monthly', 'recurring', '30', 'medium', None),
                ],
                'Okra': [
                    ('harvest', 'Harvest {plant_name} pods', 'Pick when 2-4 inches long every 1-2 days. Gets tough and fibrous if left too long', 'days_after_planting', '55', 'high', None),
                    ('prune', 'Prune lower {plant_name} leaves', 'Remove leaves below lowest pod to improve airflow and make harvesting easier', 'recurring', '14', 'low', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Side-dress with balanced fertilizer monthly during production', 'recurring', '30', 'medium', None),
                ],
                'Corn': [],  # Already has templates
                'Tomatillo': [
                    ('stake', 'Cage or stake {plant_name}', 'Plants get bushy and heavy with fruit. Support prevents sprawling', 'days_after_planting', '21', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick when husk splits and fruit fills the papery covering. Fruit should be firm and bright green', 'days_after_planting', '70', 'medium', None),
                    ('custom', 'Plant {plant_name} in pairs', 'Needs cross-pollination — ensure at least 2 plants for fruit set', 'one_time', '0', 'high', None),
                ],
                'Ground Cherry': [
                    ('harvest', 'Harvest fallen {plant_name}', 'Pick fruit off ground when husks turn papery tan and fruit is golden. Don\'t pick green ones', 'days_after_planting', '70', 'medium', None),
                    ('custom', 'Mulch under {plant_name}', 'Lay mulch or landscape fabric under plants to keep fallen fruit clean', 'days_after_planting', '14', 'medium', None),
                ],
                'Habanero': [
                    ('custom', 'Pinch first flowers on {plant_name}', 'Remove early flowers to build stronger plant structure before fruiting', 'days_after_planting', '14', 'high', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Use low-nitrogen fertilizer once fruiting begins. Too much N = leaves, not peppers', 'recurring', '21', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick when fully colored (orange). Use gloves — oils cause burns', 'days_after_planting', '90', 'medium', None),
                ],
                'Jalapeno': [
                    ('custom', 'Pinch first flowers on {plant_name}', 'Remove early blooms for stronger plant and bigger harvest later', 'days_after_planting', '14', 'high', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Apply low-nitrogen fertilizer. Switch to potassium-rich once fruiting', 'recurring', '21', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick when firm and dark green for mild heat, or wait for red for more heat', 'days_after_planting', '70', 'medium', None),
                ],
                'Serrano': [
                    ('custom', 'Pinch first flowers on {plant_name}', 'Remove early flowers to develop stronger root system', 'days_after_planting', '14', 'high', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Low-nitrogen fertilizer once flowering starts', 'recurring', '21', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick green for milder heat or red for full heat. Harvest regularly to encourage production', 'days_after_planting', '75', 'medium', None),
                ],
                'Bell Pepper': [
                    ('custom', 'Pinch first flowers on {plant_name}', 'Remove early blooms to build plant strength', 'days_after_planting', '14', 'high', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Apply calcium-rich fertilizer to prevent blossom end rot', 'recurring', '21', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick green for mild flavor or wait for color change (red/yellow) for sweeter taste', 'days_after_planting', '65', 'medium', None),
                    ('stake', 'Stake {plant_name}', 'Support heavy plants to prevent branch breakage when loaded with fruit', 'days_after_planting', '30', 'medium', None),
                ],
                'Cherry Tomato': [
                    ('stake', 'Cage or stake {plant_name}', 'These vigorous growers need strong support — use tall cages or stakes', 'days_after_planting', '14', 'high', None),
                    ('prune', 'Prune suckers on {plant_name}', 'Remove suckers below first flower cluster to manage growth', 'days_after_planting', '21', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick when fully colored. Check daily — they ripen fast and split if left on vine', 'days_after_planting', '55', 'high', None),
                    ('pest_check', 'Check {plant_name} for hornworms', 'Inspect stems and leaves for large green caterpillars', 'recurring', '7', 'medium', 'spring,summer'),
                ],
                'Roma Tomato': [
                    ('stake', 'Cage {plant_name}', 'Determinate variety — shorter cage is fine', 'days_after_planting', '14', 'high', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Apply calcium-rich fertilizer — romas are prone to blossom end rot', 'recurring', '14', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick when deep red and firm. Perfect for sauce-making when harvested in bulk', 'days_after_planting', '70', 'medium', None),
                ],
                'Squash (Summer)': [
                    ('pest_check', 'Check {plant_name} for squash vine borers', 'Look for sawdust-like frass at stem base. Wrap stems with foil preventively', 'recurring', '7', 'medium', 'spring,summer'),
                    ('harvest', 'Harvest {plant_name}', 'Pick young and tender. Gets seedy and tough if left too long', 'days_after_planting', '45', 'medium', None),
                    ('custom', 'Hand pollinate {plant_name}', 'Transfer pollen from male to female flowers in morning if fruit isn\'t setting', 'growth_stage', 'flowering', 'medium', None),
                ],
                'Butternut Squash': [
                    ('custom', 'Train {plant_name} vines', 'Direct vine growth and pinch growing tips after 3-4 fruit set per vine', 'days_after_planting', '30', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Cut when skin is hard, tan colored, and stem is dry. Leave 2 inches of stem', 'days_after_planting', '100', 'medium', None),
                    ('pest_check', 'Check {plant_name} for squash bugs', 'Look for bronze eggs on leaf undersides and gray adults. Hand-pick', 'recurring', '10', 'medium', None),
                ],
                'Spaghetti Squash': [
                    ('harvest', 'Check {plant_name} for harvest', 'Ready when skin turns golden yellow and is hard to dent with fingernail', 'days_after_planting', '95', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Side-dress with compost when vines begin to run', 'days_after_planting', '30', 'medium', None),
                    ('pest_check', 'Check {plant_name} for squash vine borers', 'Inspect stem base for entry holes and frass', 'recurring', '10', 'medium', 'spring,summer'),
                ],
                'Winter Squash': [
                    ('harvest', 'Harvest {plant_name}', 'Cut when skin is hard and colors are deep. Cure in sun for a week before storing', 'days_after_planting', '95', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Apply compost tea when vines begin to run', 'days_after_planting', '30', 'medium', None),
                    ('pest_check', 'Check {plant_name} for squash bugs', 'Inspect leaf undersides for eggs. Hand-pick adults', 'recurring', '10', 'medium', None),
                ],
                'Acorn Squash': [
                    ('harvest', 'Harvest {plant_name}', 'Cut when dark green with orange patch on ground side. Stem should be dry', 'days_after_planting', '85', 'medium', None),
                    ('pest_check', 'Check {plant_name} for squash bugs', 'Look under leaves for bronze egg clusters', 'recurring', '10', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Side-dress with compost when vines start running', 'days_after_planting', '25', 'medium', None),
                ],
                'Delicata Squash': [
                    ('harvest', 'Harvest {plant_name}', 'Pick when cream-colored with dark green stripes and skin resists puncture', 'days_after_planting', '80', 'medium', None),
                    ('pest_check', 'Check {plant_name} for squash bugs', 'Hand-pick adults and crush egg clusters on leaf undersides', 'recurring', '10', 'medium', None),
                ],
                'Kabocha Squash': [
                    ('harvest', 'Harvest {plant_name}', 'Ready when stem is dry and corky and skin is dull not shiny', 'days_after_planting', '95', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Apply balanced fertilizer when vines begin to run', 'days_after_planting', '28', 'medium', None),
                    ('pest_check', 'Check {plant_name} for pests', 'Watch for squash bugs and vine borers', 'recurring', '10', 'medium', None),
                ],
                'Armenian Cucumber': [
                    ('stake', 'Trellis {plant_name}', 'Vigorous vine — provide strong trellis for best fruit shape and easier harvest', 'days_after_planting', '14', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick at 12-18 inches for best flavor. Gets seedy if left too long', 'days_after_planting', '55', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Feed with balanced fertilizer every 2-3 weeks', 'recurring', '21', 'medium', None),
                ],
                'Luffa': [
                    ('stake', 'Provide strong trellis for {plant_name}', 'Needs very sturdy support — fruit can be heavy. Chain link fence works well', 'days_after_planting', '14', 'high', None),
                    ('harvest', 'Harvest {plant_name} for sponges', 'Leave on vine until skin turns brown and dry, then peel and shake out seeds', 'days_after_planting', '120', 'medium', None),
                    ('custom', 'Hand pollinate {plant_name}', 'Flowers open in evening — hand-pollinate if not getting fruit set', 'growth_stage', 'flowering', 'medium', None),
                ],
                'Bitter Melon': [
                    ('stake', 'Trellis {plant_name}', 'Vigorous climber — needs sturdy trellis or fence', 'days_after_planting', '14', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick when green and firm, before turning yellow/orange. Gets more bitter as it matures', 'days_after_planting', '55', 'high', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Apply balanced fertilizer every 3 weeks', 'recurring', '21', 'medium', None),
                ],
                'Chayote': [
                    ('stake', 'Provide strong trellis for {plant_name}', 'Very vigorous vine — needs sturdy arbor, fence, or trellis', 'days_after_planting', '21', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick when 4-6 inches and still tender. Cook whole — skin is edible', 'days_after_planting', '120', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Side-dress with compost monthly. Heavy feeder once established', 'recurring', '30', 'medium', None),
                ],
                'Edamame': [
                    ('harvest', 'Harvest {plant_name}', 'Pick when pods are plump and bright green but before they start yellowing. Pull entire plant', 'days_after_planting', '80', 'high', None),
                    ('custom', 'Inoculate {plant_name} soil', 'Use soybean-specific rhizobium inoculant for better nitrogen fixation', 'one_time', '0', 'medium', None),
                ],
                'Fava Bean': [
                    ('custom', 'Pinch {plant_name} tops', 'Pinch growing tips when first pods set to redirect energy to beans and deter aphids', 'growth_stage', 'flowering', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick when pods are plump and bright green. Shell and peel inner skin for best flavor', 'days_after_planting', '80', 'medium', None),
                    ('pest_check', 'Check {plant_name} for aphids', 'Black bean aphids love fava tips. Pinching tops helps, or blast with water', 'recurring', '7', 'medium', 'spring'),
                ],
                'Lima Bean': [
                    ('harvest', 'Harvest {plant_name}', 'Pick when pods are plump and green for fresh limas, or let dry on vine for dry beans', 'days_after_planting', '70', 'medium', None),
                    ('stake', 'Support pole {plant_name} varieties', 'Pole types need trellis or teepee. Bush types are self-supporting', 'days_after_planting', '14', 'medium', None),
                ],
                'Yard-Long Bean': [
                    ('stake', 'Install tall trellis for {plant_name}', 'Vigorous climber — needs 6-8 foot support', 'days_after_planting', '10', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick at 12-18 inches before seeds bulge. Gets tough if too long. Harvest daily', 'days_after_planting', '60', 'high', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Light feeder — avoid excess nitrogen. Fixes own nitrogen', 'recurring', '30', 'low', None),
                ],
                'Yardlong Bean': [
                    ('stake', 'Install tall trellis for {plant_name}', 'Vigorous climber — needs 6-8 foot support', 'days_after_planting', '10', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick at 12-18 inches before seeds bulge. Harvest daily for best production', 'days_after_planting', '60', 'high', None),
                ],
                'Pole Bean': [
                    ('stake', 'Install trellis for {plant_name}', 'Needs 6-8 foot support — teepee, trellis, or poles', 'days_after_planting', '7', 'high', None),
                    ('harvest', 'Harvest {plant_name} regularly', 'Pick when pods snap cleanly. Harvest every 2-3 days to keep production going', 'days_after_planting', '60', 'high', None),
                ],
                'Green Bean': [
                    ('harvest', 'Harvest {plant_name}', 'Pick when firm and snap cleanly. Harvest every 2-3 days for continued production', 'days_after_planting', '55', 'high', None),
                    ('pest_check', 'Check {plant_name} for bean beetles', 'Look for copper-colored beetles and yellow egg clusters on leaf undersides', 'recurring', '10', 'medium', None),
                ],
                'Black-Eyed Pea': [
                    ('harvest', 'Harvest {plant_name}', 'Pick pods when plump for fresh peas, or let dry completely on vine for storage', 'days_after_planting', '60', 'medium', None),
                    ('custom', '{plant_name} as cover crop', 'Fixes nitrogen — great for building soil. Can turn under as green manure', 'one_time', '0', 'low', None),
                ],
                'Cowpea': [
                    ('harvest', 'Harvest {plant_name}', 'Pick when pods are plump for fresh use or let dry on vine for storage', 'days_after_planting', '60', 'medium', None),
                    ('custom', '{plant_name} nitrogen fixation', 'Fixes own nitrogen — don\'t over-fertilize. Good cover crop', 'one_time', '0', 'low', None),
                ],
                'Cowpea (Black-eyed Pea)': [
                    ('harvest', 'Harvest {plant_name}', 'Pick fresh when plump or dry on vine for storage beans', 'days_after_planting', '60', 'medium', None),
                ],
                'Tepary Bean': [
                    ('harvest', 'Harvest {plant_name}', 'Desert-adapted bean. Let pods dry completely on vine, then shell', 'days_after_planting', '75', 'medium', None),
                    ('custom', '{plant_name} is drought-tolerant', 'Needs very little water once established — overwatering reduces yield', 'one_time', '0', 'medium', None),
                ],
                'Moringa': [
                    ('prune', 'Prune {plant_name} aggressively', 'Cut back to 3-4 feet to keep bushy and harvestable. Grows very fast', 'recurring', '30', 'high', None),
                    ('harvest', 'Harvest {plant_name} leaves', 'Pick tender leaves and tips regularly. Extremely nutritious superfood', 'recurring', '14', 'medium', None),
                    ('custom', 'Protect {plant_name} from frost', 'Tropical plant — cover or bring inside when frost threatens', 'recurring', '365', 'high', 'fall,winter'),
                ],
                'Malabar Spinach': [
                    ('stake', 'Trellis {plant_name}', 'Vigorous vine — provide trellis or let scramble on fence', 'days_after_planting', '14', 'medium', None),
                    ('harvest', 'Harvest {plant_name} leaves', 'Pick young leaves and stem tips. Mucilaginous texture — great in stir-fries', 'days_after_planting', '45', 'medium', None),
                ],
                'Nopal Cactus': [
                    ('harvest', 'Harvest {plant_name} pads', 'Cut young tender pads (nopales) when 6-8 inches. Use gloves and scrape off spines', 'recurring', '30', 'medium', None),
                    ('pest_check', 'Check {plant_name} for cochineal scale', 'Look for white cottony masses on pads. Remove with strong water spray', 'recurring', '30', 'low', None),
                ],
                'Prickly Pear': [
                    ('harvest', 'Harvest {plant_name} fruit (tunas)', 'Pick ripe fruit with tongs when deeply colored. Wear gloves for tiny glochid spines', 'growth_stage', 'fruiting', 'medium', None),
                    ('harvest', 'Harvest {plant_name} pads (nopales)', 'Cut young green pads for cooking. Scrape off spines', 'recurring', '30', 'medium', None),
                ],
                'Arugula': [
                    ('harvest', 'Harvest {plant_name}', 'Cut outer leaves at 3-4 inches for mildest flavor. Gets spicier with heat and age', 'days_after_planting', '21', 'medium', None),
                    ('custom', 'Watch {plant_name} for bolting', 'Bolts quickly in heat. Succession plant every 2-3 weeks for continuous harvest', 'days_after_planting', '35', 'high', 'spring,summer'),
                ],
                'Bok Choy': [
                    ('harvest', 'Harvest {plant_name}', 'Cut at base when heads are firm, or harvest outer leaves. Baby bok choy at 6 inches', 'days_after_planting', '30', 'medium', None),
                    ('pest_check', 'Check {plant_name} for flea beetles', 'Tiny holes in leaves indicate flea beetles. Use row covers as prevention', 'recurring', '7', 'medium', None),
                ],
                'Collard Greens': [
                    ('harvest', 'Harvest lower {plant_name} leaves', 'Pick outer/lower leaves at 10-12 inches, leaving center to grow. Sweeter after frost', 'days_after_planting', '40', 'medium', None),
                    ('pest_check', 'Check {plant_name} for cabbage worms', 'Use BT spray or row covers against green caterpillars', 'recurring', '10', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Side-dress with nitrogen-rich fertilizer for lush leaves', 'recurring', '30', 'medium', None),
                ],
                'Mustard Greens': [
                    ('harvest', 'Harvest {plant_name}', 'Cut outer leaves at 4-6 inches for baby greens, larger for cooking. Gets spicier in heat', 'days_after_planting', '25', 'medium', None),
                    ('custom', 'Watch {plant_name} for bolting', 'Bolts in heat — harvest promptly or use as a cover crop', 'days_after_planting', '40', 'medium', 'spring,summer'),
                ],
                'Mizuna': [
                    ('harvest', 'Harvest {plant_name}', 'Cut outer leaves for mild mustard flavor. Great as baby green in salads', 'days_after_planting', '21', 'medium', None),
                ],
                'Tatsoi': [
                    ('harvest', 'Harvest {plant_name}', 'Cut outer rosette leaves or harvest whole plant. Very cold-tolerant', 'days_after_planting', '25', 'medium', None),
                ],
                'Endive': [
                    ('custom', 'Blanch {plant_name}', 'Cover center with plate or tie leaves for 2-3 weeks before harvest to reduce bitterness', 'days_after_planting', '60', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Cut at base when heads are full. Inner blanched leaves are mildest', 'days_after_planting', '80', 'medium', None),
                ],
                'Radicchio': [
                    ('harvest', 'Harvest {plant_name}', 'Cut when heads are firm and colored. Some varieties need cold to form heads', 'days_after_planting', '70', 'medium', None),
                ],
                'Napa Cabbage': [
                    ('harvest', 'Harvest {plant_name}', 'Cut at base when heads are firm and tall. Won\'t store long — use promptly', 'days_after_planting', '60', 'medium', None),
                    ('pest_check', 'Check {plant_name} for aphids', 'Check between tight leaf layers for hidden aphid colonies', 'recurring', '10', 'medium', None),
                ],
                'Fennel': [
                    ('custom', 'Hill soil around {plant_name} bulb', 'Mound soil around base as bulb forms to blanch and sweeten it', 'days_after_planting', '45', 'medium', None),
                    ('harvest', 'Harvest {plant_name} bulb', 'Cut at soil level when bulb is 3-4 inches across. Fronds are also edible', 'days_after_planting', '75', 'medium', None),
                ],
                'Leek': [
                    ('custom', 'Hill soil around {plant_name}', 'Mound soil around stems as they grow to blanch more white shaft', 'recurring', '21', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Dig when 1 inch or more in diameter. Can leave in ground through winter', 'days_after_planting', '90', 'medium', None),
                ],
                'Green Onion': [
                    ('harvest', 'Harvest {plant_name}', 'Pull or cut at soil level when pencil-thick. Regrows if 1 inch of base is left', 'days_after_planting', '30', 'medium', None),
                ],
                'Shallot': [
                    ('harvest', 'Harvest {plant_name}', 'Dig when tops fall over and dry. Cure in shade for 2 weeks before storing', 'days_after_planting', '90', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Light feeder — apply balanced fertilizer once a month', 'recurring', '30', 'low', None),
                ],
                'Turnip': [
                    ('custom', 'Thin {plant_name} seedlings', 'Thin to 4 inches apart for root crop, 2 inches if growing for greens only', 'days_after_planting', '10', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Pull when 2-3 inches diameter. Greens are also delicious — harvest anytime', 'days_after_planting', '40', 'medium', None),
                ],
                'Parsnip': [
                    ('custom', 'Be patient with {plant_name}', 'Very slow to germinate (2-3 weeks). Keep soil moist. Don\'t give up', 'days_after_planting', '21', 'medium', None),
                    ('harvest', 'Harvest {plant_name} after frost', 'Gets sweeter after frost converts starches to sugar. Can overwinter in ground', 'days_after_planting', '100', 'medium', None),
                ],
                'Rutabaga': [
                    ('custom', 'Thin {plant_name} seedlings', 'Thin to 6 inches apart for proper root development', 'days_after_planting', '14', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Pull when 3-5 inches across. Sweeter after light frost', 'days_after_planting', '90', 'medium', None),
                ],
                'Daikon Radish': [
                    ('custom', 'Thin {plant_name} seedlings', 'Thin to 4-6 inches apart for proper root development', 'days_after_planting', '10', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Pull when 8-14 inches long. Gets pithy if left too long in warm soil', 'days_after_planting', '50', 'medium', None),
                ],
                'Jicama': [
                    ('custom', 'Pinch {plant_name} flowers', 'Remove all flowers and runners to direct energy to tuber growth', 'growth_stage', 'flowering', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Dig tubers after 5-9 months. Needs long warm season. WARNING: all parts except tuber are toxic', 'days_after_planting', '150', 'medium', None),
                    ('stake', 'Trellis {plant_name} vines', 'Provide support for the vigorous vine growth', 'days_after_planting', '21', 'medium', None),
                ],
                'Ginger': [
                    ('custom', 'Mulch {plant_name} heavily', 'Needs consistent moisture and warmth. Heavy mulch retains both', 'days_after_planting', '7', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Dig after 8-10 months when leaves yellow and die back. Can harvest baby ginger earlier', 'days_after_planting', '240', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Apply liquid fertilizer every 2 weeks during active growth', 'recurring', '14', 'medium', None),
                ],
                'Turmeric': [
                    ('custom', 'Mulch {plant_name} heavily', 'Tropical plant — needs warmth and consistent moisture. Mulch deeply', 'days_after_planting', '7', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Dig rhizomes 8-10 months after planting when leaves yellow and die back', 'days_after_planting', '240', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Apply liquid fertilizer regularly during growing season', 'recurring', '14', 'medium', None),
                ],
                'Horseradish': [
                    ('harvest', 'Harvest {plant_name} roots', 'Dig roots in fall after frost for best flavor. Replant a piece for next year', 'days_after_planting', '150', 'medium', 'fall'),
                    ('custom', 'Contain {plant_name} spread', 'Very aggressive grower — consider container growing or root barriers', 'one_time', '0', 'high', None),
                ],
                'Rhubarb': [
                    ('harvest', 'Harvest {plant_name} stalks', 'Pull (don\'t cut) stalks when 12-18 inches. Never harvest more than 1/3 at once. LEAVES ARE TOXIC', 'days_after_planting', '365', 'medium', 'spring'),
                    ('custom', 'Remove {plant_name} flower stalks', 'Cut flower stalks immediately to keep energy going to stalk production', 'growth_stage', 'flowering', 'high', None),
                    ('fertilize', 'Feed {plant_name}', 'Top-dress with compost in early spring', 'recurring', '365', 'medium', 'spring'),
                ],
                'Celeriac': [
                    ('custom', 'Remove {plant_name} side shoots', 'Pull off small side roots as bulb develops for cleaner root', 'recurring', '21', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Dig when root is 3-4 inches across. Can tolerate light frost', 'days_after_planting', '110', 'medium', None),
                ],
                'Kohlrabi': [
                    ('harvest', 'Harvest {plant_name}', 'Pull when bulb is 2-3 inches across (tennis ball size). Gets woody if too large', 'days_after_planting', '45', 'high', None),
                ],
                'Melon': [
                    ('custom', 'Mulch under {plant_name} fruit', 'Place straw under developing fruit to prevent rot', 'days_after_planting', '30', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Apply balanced fertilizer; switch to low-nitrogen once fruiting', 'recurring', '21', 'medium', None),
                    ('harvest', 'Check {plant_name} for ripeness', 'Ripe when fragrant at blossom end and stem slips easily', 'days_after_planting', '75', 'medium', None),
                ],
                'Roselle': [
                    ('harvest', 'Harvest {plant_name} calyces', 'Pick bright red calyces when plump, 10 days after flowers bloom. Used for hibiscus tea', 'days_after_planting', '120', 'medium', None),
                    ('prune', 'Prune {plant_name}', 'Pinch tips to encourage branching for more flower/calyx production', 'days_after_planting', '45', 'medium', None),
                ],
                'Sorghum': [
                    ('harvest', 'Harvest {plant_name}', 'Cut heads when grain is hard and dry on stalk', 'days_after_planting', '100', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Side-dress with nitrogen when knee-high', 'days_after_planting', '30', 'medium', None),
                ],
                'Amaranth': [
                    ('harvest', 'Harvest {plant_name} leaves or grain', 'Pick young leaves as greens, or let seed heads mature and dry for grain harvest', 'days_after_planting', '45', 'medium', None),
                    ('custom', 'Thin {plant_name} seedlings', 'Thin to 12-18 inches apart. Eat thinnings as microgreens', 'days_after_planting', '14', 'medium', None),
                ],
                'Taro': [
                    ('custom', 'Keep {plant_name} in standing water', 'Wetland plant — needs consistently waterlogged soil or shallow standing water', 'one_time', '0', 'high', None),
                    ('harvest', 'Harvest {plant_name} corms', 'Dig corms 7-12 months after planting when leaves yellow. MUST be cooked — raw is toxic', 'days_after_planting', '210', 'medium', None),
                ],
                'Chaya': [
                    ('prune', 'Prune {plant_name}', 'Prune regularly to keep bushy and harvestable. Very vigorous grower', 'recurring', '30', 'medium', None),
                    ('harvest', 'Harvest {plant_name} leaves', 'Pick mature leaves. MUST boil at least 20 minutes — raw leaves contain cyanide', 'recurring', '14', 'medium', None),
                ],
                'Purslane': [
                    ('harvest', 'Harvest {plant_name}', 'Cut stems above lowest leaves — regrows quickly. Rich in omega-3 fatty acids', 'recurring', '10', 'medium', None),
                ],
                'New Zealand Spinach': [
                    ('harvest', 'Harvest {plant_name} tips', 'Pinch 3-4 inches of stem tips regularly. Heat-tolerant spinach alternative', 'recurring', '10', 'medium', None),
                ],
                'Watercress': [
                    ('custom', 'Keep {plant_name} wet', 'Needs constantly moist to waterlogged conditions. Grow in shallow water tray', 'one_time', '0', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Cut stems at water level. Regrows quickly from base', 'recurring', '10', 'medium', None),
                ],

                # ── PEPPERS (specific varieties) ──
                'Anaheim Pepper': [
                    ('fertilize', 'Fertilize {plant_name}', 'Apply low-nitrogen fertilizer once fruiting begins', 'recurring', '21', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick green for mild, or wait for red for richer flavor. Great for roasting', 'days_after_planting', '70', 'medium', None),
                ],
                'Poblano Pepper': [
                    ('fertilize', 'Fertilize {plant_name}', 'Low-nitrogen fertilizer during fruiting', 'recurring', '21', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick dark green for poblano, or red for ancho. Great for stuffing', 'days_after_planting', '75', 'medium', None),
                    ('stake', 'Stake {plant_name}', 'Large plants need support when heavy with fruit', 'days_after_planting', '30', 'medium', None),
                ],
                'Cayenne Pepper': [
                    ('harvest', 'Harvest {plant_name}', 'Pick when bright red for drying. String into ristras or dehydrate for flakes', 'days_after_planting', '70', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Light feeding with low-nitrogen fertilizer', 'recurring', '21', 'low', None),
                ],
                'Thai Pepper': [
                    ('harvest', 'Harvest {plant_name}', 'Pick red for full heat and flavor. Very productive — harvest frequently', 'days_after_planting', '70', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Low-nitrogen fertilizer once fruiting starts', 'recurring', '21', 'low', None),
                ],
                'Ghost Pepper': [
                    ('custom', 'Be patient with {plant_name}', 'Extremely long season — needs 120+ days of heat. Start indoors very early', 'one_time', '0', 'high', None),
                    ('harvest', 'Harvest {plant_name} carefully', 'Pick when fully colored. WEAR GLOVES — among hottest peppers in world', 'days_after_planting', '120', 'high', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Light feeding — too much nitrogen delays fruiting', 'recurring', '21', 'low', None),
                ],
                'Scotch Bonnet': [
                    ('harvest', 'Harvest {plant_name}', 'Pick when fully colored. Handle with gloves — very hot. Key ingredient in Caribbean cuisine', 'days_after_planting', '90', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Low-nitrogen fertilizer during fruiting phase', 'recurring', '21', 'low', None),
                ],
                'Shishito Pepper': [
                    ('harvest', 'Harvest {plant_name} frequently', 'Pick when 3-4 inches and still green. Mostly mild but occasional hot one! Great blistered', 'days_after_planting', '60', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Balanced fertilizer every 3 weeks', 'recurring', '21', 'low', None),
                ],
                'Padron Pepper': [
                    ('harvest', 'Harvest {plant_name} small', 'Pick at 2-3 inches for mildest flavor. Gets hotter as it grows. Blister in olive oil + salt', 'days_after_planting', '55', 'medium', None),
                ],
                'Chiltepin Pepper': [
                    ('harvest', 'Harvest {plant_name}', 'Pick tiny red berries when bright red. Native Arizona wild chile — extremely hot', 'days_after_planting', '90', 'medium', None),
                    ('custom', 'Protect {plant_name} from birds... or don\'t', 'Birds love chiltepins and spread seeds naturally. Part of their ecology', 'one_time', '0', 'low', None),
                ],
                'Sweet Banana Pepper': [
                    ('harvest', 'Harvest {plant_name}', 'Pick yellow for mild sweet flavor, or let ripen to red for sweeter taste', 'days_after_planting', '65', 'medium', None),
                ],

                # ── HERBS ──
                'Cilantro': [
                    ('harvest', 'Harvest {plant_name} leaves', 'Cut outer stems at base. Use frequently — bolts fast in heat', 'days_after_planting', '21', 'medium', None),
                    ('custom', 'Succession plant {plant_name}', 'Sow new seeds every 2-3 weeks for continuous supply. Bolts rapidly in heat', 'recurring', '21', 'high', 'spring,summer'),
                    ('custom', 'Collect {plant_name} coriander seeds', 'After bolting, let seeds dry on plant, then collect as coriander spice', 'growth_stage', 'flowering', 'low', None),
                ],
                'Mint': [
                    ('custom', 'Contain {plant_name} spread', 'VERY aggressive spreader — grow in container or use root barrier. Never plant in open bed', 'one_time', '0', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Cut stems frequently to encourage bushiness. Pinch flowers to prolong leaf production', 'recurring', '10', 'medium', None),
                    ('prune', 'Cut back {plant_name}', 'Cut to ground level in late fall. Will resprout vigorously in spring', 'recurring', '365', 'medium', 'fall'),
                ],
                'Rosemary': [
                    ('prune', 'Prune {plant_name}', 'Trim after flowering to maintain shape. Never cut into old wood — it won\'t resprout', 'recurring', '90', 'medium', None),
                    ('harvest', 'Harvest {plant_name} sprigs', 'Snip 4-6 inch tips as needed. Best harvested before flowering for strongest flavor', 'recurring', '14', 'low', None),
                ],
                'Oregano': [
                    ('prune', 'Cut back {plant_name}', 'Trim regularly to prevent woodiness and encourage fresh growth', 'recurring', '30', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Cut stems when flower buds form — this is peak flavor. Dry for storage', 'recurring', '14', 'medium', None),
                    ('custom', 'Prevent {plant_name} flowering', 'Pinch off flower buds to prolong leaf production, or let bloom for pollinators', 'growth_stage', 'flowering', 'low', None),
                ],
                'Thyme': [
                    ('prune', 'Prune {plant_name}', 'Trim by one-third after flowering. Prevent woodiness by regular light pruning', 'recurring', '60', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Snip sprigs as needed. Best flavor just before flowering', 'recurring', '14', 'low', None),
                ],
                'Sage': [
                    ('prune', 'Prune {plant_name}', 'Cut back by one-third in spring. Gets woody — replace every 4-5 years', 'recurring', '180', 'medium', 'spring'),
                    ('harvest', 'Harvest {plant_name}', 'Pick leaves as needed. Best before flowering. Don\'t harvest more than 1/3 at once', 'recurring', '14', 'low', None),
                ],
                'Dill': [
                    ('harvest', 'Harvest {plant_name} fronds', 'Cut feathery leaves as needed. Harvest seed heads when brown for dill seed', 'days_after_planting', '25', 'medium', None),
                    ('custom', 'Let {plant_name} self-seed', 'Allow some plants to go to seed — dill self-sows reliably for next season', 'growth_stage', 'flowering', 'low', None),
                    ('custom', 'Succession plant {plant_name}', 'Sow every 3 weeks for continuous harvest as it bolts quickly', 'recurring', '21', 'medium', None),
                ],
                'Chive': [
                    ('harvest', 'Harvest {plant_name}', 'Cut leaves 2 inches above soil. Regrows repeatedly. Flowers are also edible', 'recurring', '14', 'medium', None),
                    ('prune', 'Divide {plant_name} clumps', 'Divide congested clumps every 2-3 years in spring or fall', 'recurring', '730', 'medium', None),
                ],
                'Parsley': [
                    ('harvest', 'Harvest {plant_name}', 'Cut outer stems at base. Inner growth continues. Biennial — bolts in second year', 'recurring', '10', 'medium', None),
                ],
                'Lavender': [
                    ('prune', 'Prune {plant_name} after flowering', 'Cut back by one-third after bloom. Never cut into old wood — it won\'t regrow', 'recurring', '180', 'high', None),
                    ('harvest', 'Harvest {plant_name} blooms', 'Cut stems when about half the flowers have opened for best fragrance', 'growth_stage', 'flowering', 'medium', None),
                    ('custom', 'Ensure {plant_name} drainage', 'Must have excellent drainage — will die in wet soil. Add gravel to planting hole', 'one_time', '0', 'high', None),
                ],
                'Lemongrass': [
                    ('harvest', 'Harvest {plant_name} stalks', 'Twist and pull outer stalks at base when 1/2 inch thick. Use lower white portion', 'recurring', '30', 'medium', None),
                    ('custom', 'Protect {plant_name} from frost', 'Cut back and mulch heavily before frost, or bring container inside', 'recurring', '365', 'high', 'fall'),
                    ('prune', 'Cut back {plant_name}', 'Trim leaves to 6 inches in late winter to refresh growth', 'recurring', '365', 'medium', 'winter'),
                ],
                'Mexican Tarragon': [
                    ('harvest', 'Harvest {plant_name}', 'Cut stems as needed — excellent tarragon substitute that thrives in heat', 'recurring', '14', 'medium', None),
                    ('prune', 'Prune {plant_name}', 'Cut back by half after flowering to encourage fresh growth', 'growth_stage', 'flowering', 'medium', None),
                ],
                'Catnip': [
                    ('prune', 'Cut back {plant_name}', 'Trim regularly to prevent legginess and self-seeding', 'recurring', '30', 'medium', None),
                    ('custom', 'Protect {plant_name} from cats', 'Cats will roll in and destroy young plants. Cage until established', 'one_time', '0', 'medium', None),
                ],
                'Lemon Balm': [
                    ('prune', 'Cut back {plant_name}', 'Aggressive self-seeder — cut flower stalks before seeds set', 'growth_stage', 'flowering', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Cut stems as needed for tea. Best before flowering', 'recurring', '14', 'medium', None),
                    ('custom', 'Contain {plant_name} spread', 'Self-seeds aggressively — grow in container or deadhead religiously', 'one_time', '0', 'medium', None),
                ],
                'Chamomile': [
                    ('harvest', 'Harvest {plant_name} flowers', 'Pick when petals are flat or slightly reflexed. Dry for tea', 'growth_stage', 'flowering', 'medium', None),
                    ('custom', 'Let {plant_name} self-seed', 'German chamomile self-sows reliably. Leave some flowers to go to seed', 'growth_stage', 'flowering', 'low', None),
                ],
                'Aloe Vera': [
                    ('custom', 'Check {plant_name} for offsets', 'Remove pups (baby plants) when 3-4 inches and repot or share', 'recurring', '90', 'medium', None),
                    ('custom', 'Protect {plant_name} from frost', 'Bring inside or cover when temps drop below 50F', 'recurring', '365', 'high', 'fall,winter'),
                    ('pest_check', 'Check {plant_name} for mealybugs', 'Look in leaf crevices for white cottony insects. Treat with rubbing alcohol', 'recurring', '30', 'low', None),
                ],
                'Ashwagandha': [
                    ('harvest', 'Harvest {plant_name} roots', 'Dig roots after 150-180 days when berries are red and leaves start yellowing', 'days_after_planting', '150', 'medium', None),
                    ('custom', '{plant_name} is drought-tolerant', 'Don\'t overwater — prefers dry conditions. Perfect for desert gardens', 'one_time', '0', 'low', None),
                ],
                'Cuban Oregano': [
                    ('prune', 'Pinch back {plant_name}', 'Pinch growing tips frequently to keep bushy. Very vigorous grower', 'recurring', '14', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick fleshy leaves as needed. Much stronger than regular oregano', 'recurring', '14', 'low', None),
                ],
                'Chervil': [
                    ('harvest', 'Harvest {plant_name}', 'Cut outer leaves. Cool-season herb — bolts in heat. Succession plant', 'days_after_planting', '30', 'medium', None),
                ],
                'Sorrel': [
                    ('harvest', 'Harvest {plant_name} leaves', 'Pick young tender leaves for lemony flavor. Remove flower stalks to prolong leaf harvest', 'recurring', '14', 'medium', None),
                ],
                'Stevia': [
                    ('harvest', 'Harvest {plant_name} leaves', 'Pick leaves before flowering for sweetest flavor. Dry and crush for sweetener', 'growth_stage', 'flowering', 'medium', None),
                    ('prune', 'Pinch {plant_name} tips', 'Pinch growing tips to encourage branching', 'recurring', '21', 'medium', None),
                ],
                'Epazote': [
                    ('harvest', 'Harvest {plant_name}', 'Pick leaves as needed for cooking beans (traditional digestive aid). Strong flavor — use sparingly', 'recurring', '14', 'medium', None),
                    ('custom', 'Control {plant_name} self-seeding', 'Prolific self-seeder — remove flower heads if you don\'t want it everywhere', 'growth_stage', 'flowering', 'medium', None),
                ],
                'Marjoram': [
                    ('harvest', 'Harvest {plant_name}', 'Cut stems before flowers open for best flavor. Dry for storage', 'recurring', '14', 'medium', None),
                    ('prune', 'Prune {plant_name}', 'Trim regularly to prevent woodiness', 'recurring', '30', 'medium', None),
                ],
                'Tarragon': [
                    ('harvest', 'Harvest {plant_name}', 'Cut stems as needed. Best in spring when growth is fresh. Flavor fades in heat', 'recurring', '14', 'medium', None),
                    ('prune', 'Divide {plant_name}', 'Divide every 2-3 years to maintain vigor. Propagate by division, not seed', 'recurring', '730', 'medium', 'spring'),
                ],
                'Hibiscus (Tea)': [
                    ('harvest', 'Harvest {plant_name} calyces', 'Pick deep red calyces after flower fades. Dry for tea. Rich in vitamin C', 'growth_stage', 'flowering', 'medium', None),
                    ('prune', 'Prune {plant_name}', 'Cut back by one-third in late winter for bushy spring growth', 'recurring', '365', 'medium', 'winter'),
                    ('fertilize', 'Fertilize {plant_name}', 'Apply balanced fertilizer monthly during growing season', 'recurring', '30', 'medium', None),
                ],
                'Feverfew': [
                    ('harvest', 'Harvest {plant_name} flowers', 'Pick fresh flowers and leaves. Traditional migraine remedy herb', 'growth_stage', 'flowering', 'medium', None),
                    ('prune', 'Deadhead {plant_name}', 'Remove spent flowers to encourage more blooms and prevent self-seeding', 'recurring', '14', 'medium', None),
                ],
                'Tulsi (Holy Basil)': [
                    ('prune', 'Pinch {plant_name} flower buds', 'Remove flower spikes to prolong leaf production', 'growth_stage', 'flowering', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick leaves and tender stems regularly. Sacred herb in Ayurveda', 'recurring', '10', 'medium', None),
                ],
                'Curry Leaf': [
                    ('custom', 'Protect {plant_name} from cold', 'Bring inside when temps drop below 40F. Tropical plant', 'recurring', '365', 'high', 'fall,winter'),
                    ('harvest', 'Harvest {plant_name} leaves', 'Pick whole stems of leaves as needed. Fresh is far superior to dried', 'recurring', '14', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Feed with iron-rich fertilizer — prone to chlorosis', 'recurring', '30', 'medium', None),
                ],
                'Mexican Oregano': [
                    ('harvest', 'Harvest {plant_name}', 'Pick leaves before flowering for best flavor. Different genus than Mediterranean oregano', 'recurring', '14', 'medium', None),
                    ('prune', 'Prune {plant_name}', 'Cut back after flowering to maintain shape. Very drought-tolerant', 'recurring', '90', 'medium', None),
                ],
                'Comfrey': [
                    ('harvest', 'Cut {plant_name} for mulch/compost', 'Chop leaves 3-4 times per season for nutrient-rich mulch or compost activator', 'recurring', '60', 'medium', None),
                    ('custom', 'Use {plant_name} as fertilizer tea', 'Steep cut leaves in water for 4-6 weeks for potent liquid fertilizer', 'recurring', '60', 'low', None),
                ],
                'Echinacea': [
                    ('custom', 'Deadhead {plant_name} for longer bloom', 'Remove spent flowers to encourage reblooming through fall', 'recurring', '14', 'medium', None),
                    ('custom', 'Divide {plant_name} every 3-4 years', 'Divide established clumps in spring or fall to maintain vigor', 'recurring', '1095', 'medium', None),
                    ('harvest', 'Harvest {plant_name} roots or flowers', 'Roots harvested in fall of 3rd year for tea. Flowers and leaves also usable', 'days_after_planting', '730', 'low', None),
                ],
                'Yarrow': [
                    ('prune', 'Deadhead {plant_name}', 'Remove spent flowers to prevent aggressive self-seeding and encourage reblooming', 'recurring', '14', 'medium', None),
                    ('custom', 'Divide {plant_name} every 2-3 years', 'Divide clumps to prevent center from dying out', 'recurring', '730', 'medium', 'spring'),
                ],
                'Caper Bush': [
                    ('harvest', 'Harvest {plant_name} buds', 'Pick flower buds before they open. Pickle in salt or brine. Harvest daily during season', 'growth_stage', 'flowering', 'high', None),
                    ('prune', 'Prune {plant_name}', 'Cut back hard in late winter. Flowers on new wood', 'recurring', '365', 'medium', 'winter'),
                ],
                'Hoja Santa': [
                    ('harvest', 'Harvest {plant_name} leaves', 'Pick large leaves for wrapping tamales and flavoring moles. Anise-sassafras flavor', 'recurring', '14', 'medium', None),
                    ('custom', 'Contain {plant_name}', 'Spreads by underground runners — use root barrier or container', 'one_time', '0', 'medium', None),
                ],
                'Papalo': [
                    ('harvest', 'Harvest {plant_name} leaves', 'Pick tender leaves as cilantro substitute for warm weather. Strong flavor', 'recurring', '10', 'medium', None),
                ],
                'Perilla (Shiso)': [
                    ('harvest', 'Harvest {plant_name} leaves', 'Pick leaves as needed. Red or green varieties. Essential in Japanese cuisine', 'recurring', '10', 'medium', None),
                    ('custom', 'Control {plant_name} self-seeding', 'Prolific self-seeder — remove flowers if you don\'t want it spreading everywhere', 'growth_stage', 'flowering', 'medium', None),
                ],
                'Vietnamese Coriander': [
                    ('harvest', 'Harvest {plant_name}', 'Cut stems as needed. Heat-loving cilantro alternative that doesn\'t bolt', 'recurring', '10', 'medium', None),
                    ('custom', 'Keep {plant_name} moist', 'Water-loving plant — keep soil consistently moist. Great in containers', 'one_time', '0', 'medium', None),
                ],
                'Culantro': [
                    ('harvest', 'Harvest {plant_name} leaves', 'Cut outer leaves. Stronger than cilantro, used in Caribbean/Latin cooking. Heat-tolerant', 'recurring', '14', 'medium', None),
                ],
                'Garlic Chives': [
                    ('harvest', 'Harvest {plant_name}', 'Cut flat leaves at base. Garlic flavor. Flowers are also edible', 'recurring', '14', 'medium', None),
                    ('custom', 'Deadhead {plant_name}', 'Remove spent flowers to prevent aggressive self-seeding', 'growth_stage', 'flowering', 'medium', None),
                ],
                'Eucalyptus Baby Blue': [
                    ('prune', 'Prune {plant_name}', 'Cut branches for arrangements. Stump-cut to maintain shrub form vs tree', 'recurring', '90', 'medium', None),
                ],

                # ── FLOWERS ──
                'Sunflower': [
                    ('stake', 'Stake tall {plant_name} varieties', 'Tie to stake when 3+ feet tall to prevent wind damage', 'days_after_planting', '30', 'medium', None),
                    ('custom', 'Protect {plant_name} seeds from birds', 'Cover seed heads with netting or paper bag when seeds start forming if saving for harvest', 'growth_stage', 'fruiting', 'medium', None),
                    ('harvest', 'Harvest {plant_name} seeds', 'Cut head when back turns brown and seeds are plump. Dry upside down', 'days_after_planting', '80', 'medium', None),
                ],
                'Marigold': [
                    ('prune', 'Deadhead {plant_name}', 'Remove spent blooms to encourage continuous flowering all season', 'recurring', '7', 'medium', None),
                    ('custom', 'Use {plant_name} as companion plant', 'Plant near tomatoes and peppers — repels nematodes and some pests', 'one_time', '0', 'low', None),
                ],
                'Zinnia': [
                    ('prune', 'Deadhead {plant_name}', 'Cut spent blooms to encourage more flowers. Great cut flowers — cutting IS deadheading', 'recurring', '7', 'medium', None),
                    ('pest_check', 'Check {plant_name} for powdery mildew', 'Ensure good airflow between plants. Water at base, not on foliage', 'recurring', '14', 'medium', 'summer'),
                ],
                'Cosmos': [
                    ('prune', 'Deadhead {plant_name}', 'Remove faded flowers for continuous blooms. Let some go to seed at end of season', 'recurring', '10', 'medium', None),
                    ('custom', 'Pinch young {plant_name}', 'Pinch stem tips when 12 inches tall for bushier plants with more flowers', 'days_after_planting', '30', 'medium', None),
                ],
                'Nasturtium': [
                    ('harvest', 'Harvest {plant_name} flowers and leaves', 'Both edible with peppery flavor. Great in salads. Flowers are beautiful garnish', 'recurring', '10', 'medium', None),
                    ('custom', '{plant_name} as trap crop', 'Attracts aphids away from other plants. Don\'t over-fertilize or you get leaves, not flowers', 'one_time', '0', 'low', None),
                ],
                'Borage': [
                    ('harvest', 'Harvest {plant_name} flowers', 'Pick blue star-shaped flowers for salads. Also attracts pollinators', 'recurring', '7', 'medium', None),
                    ('custom', 'Let {plant_name} self-seed', 'Reliable self-seeder. Once established, you\'ll have it forever', 'one_time', '0', 'low', None),
                ],
                'Calendula': [
                    ('prune', 'Deadhead {plant_name}', 'Remove spent flowers for continuous blooms into fall', 'recurring', '7', 'medium', None),
                    ('harvest', 'Harvest {plant_name} flowers', 'Pick when fully open for medicinal salves, teas, or edible garnish', 'recurring', '7', 'low', None),
                ],
                'Sweet Alyssum': [
                    ('prune', 'Shear back {plant_name}', 'Cut back by half if it gets leggy in summer heat. Will rebloom quickly', 'recurring', '60', 'medium', 'summer'),
                ],
                'Snapdragon': [
                    ('prune', 'Deadhead {plant_name}', 'Remove spent flower stalks to encourage side shoots and more blooms', 'recurring', '14', 'medium', None),
                    ('custom', 'Pinch young {plant_name}', 'Pinch growing tip when 4 inches tall for bushier plants with more stems', 'days_after_planting', '21', 'medium', None),
                ],
                'African Marigold': [
                    ('prune', 'Deadhead {plant_name}', 'Remove spent blooms regularly for continuous large flowers', 'recurring', '7', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Monthly balanced fertilizer for best bloom production', 'recurring', '30', 'low', None),
                ],
                'Salvia Hot Lips': [
                    ('prune', 'Prune {plant_name}', 'Cut back by one-third after each flush of blooms for repeat flowering', 'recurring', '60', 'medium', None),
                    ('custom', '{plant_name} hummingbird magnet', 'Leave flowers for hummingbirds — excellent pollinator plant', 'one_time', '0', 'low', None),
                ],
                'Globe Mallow': [
                    ('custom', '{plant_name} is low-maintenance native', 'Extremely drought-tolerant desert native. Don\'t overwater', 'one_time', '0', 'low', None),
                    ('prune', 'Prune {plant_name} if desired', 'Cut back in late winter for fresh growth. Or let it naturalize', 'recurring', '365', 'low', 'winter'),
                ],
                'Blackfoot Daisy': [
                    ('custom', '{plant_name} thrives on neglect', 'Desert native — overwatering kills it. Minimal care needed', 'one_time', '0', 'low', None),
                    ('prune', 'Lightly trim {plant_name}', 'Shear lightly after peak bloom to tidy up', 'recurring', '90', 'low', None),
                ],
                'Moss Verbena': [
                    ('prune', 'Trim {plant_name}', 'Cut back by half if it gets straggly for fresh flush of blooms', 'recurring', '60', 'medium', None),
                ],
                'Purple Trailing Lantana': [
                    ('prune', 'Trim {plant_name}', 'Cut back in late winter to control spread and refresh growth', 'recurring', '365', 'medium', 'winter'),
                ],
                'Baja Fairy Duster': [
                    ('prune', 'Prune {plant_name} lightly', 'Light shaping after bloom. Avoid hard pruning', 'recurring', '365', 'low', None),
                ],
                'Parry\'s Penstemon': [
                    ('prune', 'Remove spent {plant_name} flower stalks', 'Cut stalks after bloom. May rebloom from basal growth', 'growth_stage', 'flowering', 'medium', None),
                ],
                'Sparky Tecoma': [
                    ('prune', 'Prune {plant_name}', 'Cut back hard in late winter. Blooms on new wood. Hummingbird favorite', 'recurring', '365', 'medium', 'winter'),
                    ('fertilize', 'Fertilize {plant_name}', 'Light feeding in spring for best flower production', 'recurring', '365', 'low', 'spring'),
                ],
                'Butterfly Weed': [
                    ('custom', 'Don\'t transplant {plant_name}', 'Deep taproot — doesn\'t transplant well. Start from seed in final location', 'one_time', '0', 'medium', None),
                    ('custom', 'Leave {plant_name} seed pods for monarchs', 'Critical milkweed host plant for monarch butterflies. Let pods open naturally', 'one_time', '0', 'high', None),
                ],
                'Showy Milkweed': [
                    ('custom', '{plant_name} for monarchs', 'Essential monarch butterfly host plant. Let caterpillars feed — plant recovers', 'one_time', '0', 'high', None),
                    ('custom', 'Contain {plant_name} spread', 'Spreads by rhizomes. Use root barrier if space is limited', 'one_time', '0', 'medium', None),
                ],
                'Desert Milkweed': [
                    ('custom', '{plant_name} for monarchs', 'Native milkweed — key host plant for monarch butterflies', 'one_time', '0', 'high', None),
                ],
                'Pine-leaf Milkweed': [
                    ('custom', '{plant_name} for monarchs', 'Native milkweed species. Don\'t remove caterpillars — they\'re future monarchs', 'one_time', '0', 'high', None),
                ],
                'Arizona Milkweed': [
                    ('custom', '{plant_name} for pollinators', 'Native milkweed. Monarch butterfly host plant. Minimal care needed', 'one_time', '0', 'high', None),
                ],
                'Banana Yucca': [
                    ('custom', '{plant_name} care', 'Desert native — virtually no care needed. Fruit is edible when ripe', 'one_time', '0', 'low', None),
                ],
                'Mojave Yucca': [
                    ('custom', '{plant_name} care', 'Extremely low-maintenance desert native. No supplemental water once established', 'one_time', '0', 'low', None),
                ],
                'Soaptree Yucca': [
                    ('custom', '{plant_name} care', 'Desert native. Remove dead lower leaves for tidier appearance if desired', 'one_time', '0', 'low', None),
                ],
                'Red Yucca': [
                    ('prune', 'Remove spent {plant_name} flower stalks', 'Cut flower stalks at base after bloom fades. Not actually a yucca — technically Hesperaloe', 'growth_stage', 'flowering', 'medium', None),
                ],
                'Star Jasmine': [],  # Ornamental landscape — skip
                'Indian Laurel': [],  # Ornamental landscape — skip
                'Tangerine Crossvine': [
                    ('prune', 'Prune {plant_name}', 'Trim after flowering to control size and shape', 'growth_stage', 'flowering', 'medium', None),
                ],
                'Mini Carnation': [
                    ('prune', 'Deadhead {plant_name}', 'Remove spent blooms to encourage continuous flowering', 'recurring', '7', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Light balanced fertilizer monthly during bloom season', 'recurring', '30', 'low', None),
                ],

                # ── FRUIT ──
                'Strawberry': [
                    ('custom', 'Remove {plant_name} runners', 'Cut runners unless you want new plants. Runners reduce fruit production', 'recurring', '14', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick when fully red and fragrant. Harvest every 2-3 days during season', 'recurring', '3', 'high', 'spring'),
                    ('fertilize', 'Fertilize {plant_name}', 'Feed after first harvest with balanced fertilizer', 'recurring', '30', 'medium', None),
                    ('custom', 'Renovate {plant_name} bed', 'After harvest, mow leaves 1 inch above crown. Thin plants. Renew every 3-4 years', 'recurring', '365', 'medium', None),
                ],
                'Fig': [
                    ('prune', 'Prune {plant_name}', 'Remove crossing branches and shape in late winter while dormant', 'recurring', '365', 'medium', 'winter'),
                    ('harvest', 'Harvest {plant_name}', 'Pick when soft, drooping, and slightly wrinkled at neck. Won\'t ripen off tree', 'growth_stage', 'fruiting', 'high', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Apply balanced fertilizer in spring. Don\'t over-fertilize', 'recurring', '365', 'medium', 'spring'),
                ],
                'Grape': [
                    ('prune', 'Prune {plant_name} in winter', 'Hard prune to 2-3 bud spurs in late winter. Grapes fruit on new wood from old canes', 'recurring', '365', 'high', 'winter'),
                    ('stake', 'Train {plant_name} on trellis', 'Maintain trellis system. Tie new growth to wires', 'recurring', '30', 'medium', 'spring,summer'),
                    ('pest_check', 'Check {plant_name} for disease', 'Watch for powdery mildew and black rot. Good airflow is critical', 'recurring', '14', 'medium', None),
                ],
                'Lemon': [
                    ('fertilize', 'Fertilize {plant_name}', 'Apply citrus fertilizer 3 times per year — February, May, September', 'recurring', '120', 'medium', None),
                    ('pest_check', 'Check {plant_name} for scale/citrus leafminer', 'Inspect for waxy bumps on stems and squiggly lines on leaves', 'recurring', '30', 'medium', None),
                    ('custom', 'Protect {plant_name} from frost', 'Cover with frost cloth when temps drop below 32F. Lemons are cold-sensitive', 'recurring', '365', 'high', 'winter'),
                ],
                'Orange': [
                    ('fertilize', 'Fertilize {plant_name}', 'Apply citrus fertilizer 3 times per year', 'recurring', '120', 'medium', None),
                    ('pest_check', 'Check {plant_name} for pests', 'Watch for scale, aphids, and citrus leafminer', 'recurring', '30', 'medium', None),
                    ('custom', 'Protect {plant_name} from frost', 'Cover when frost threatens. Water deeply before cold snaps', 'recurring', '365', 'high', 'winter'),
                ],
                'Lime': [
                    ('fertilize', 'Fertilize {plant_name}', 'Apply citrus fertilizer 3 times per year', 'recurring', '120', 'medium', None),
                    ('custom', 'Protect {plant_name} from frost', 'Most cold-sensitive citrus — cover when below 35F', 'recurring', '365', 'high', 'winter'),
                    ('pest_check', 'Check {plant_name} for pests', 'Watch for scale and citrus leafminer', 'recurring', '30', 'low', None),
                ],
                'Grapefruit': [
                    ('fertilize', 'Fertilize {plant_name}', 'Apply citrus fertilizer in Feb, May, and Sept', 'recurring', '120', 'medium', None),
                    ('custom', 'Protect {plant_name} from frost', 'Cover when temps drop below 28F. More cold-hardy than lemon', 'recurring', '365', 'medium', 'winter'),
                    ('harvest', 'Harvest {plant_name}', 'Ripe when heavy for size and yellow. Can stay on tree for months', 'growth_stage', 'fruiting', 'medium', None),
                ],
                'Meyer Lemon': [
                    ('fertilize', 'Fertilize {plant_name}', 'Apply citrus fertilizer 3 times per year. Great container plant', 'recurring', '120', 'medium', None),
                    ('custom', 'Protect {plant_name} from frost', 'More cold-hardy than true lemon but still protect below 32F', 'recurring', '365', 'medium', 'winter'),
                    ('harvest', 'Harvest {plant_name}', 'Pick when deep yellow-orange and slightly soft. Sweeter than regular lemon', 'growth_stage', 'fruiting', 'medium', None),
                ],
                'Blood Orange': [
                    ('fertilize', 'Fertilize {plant_name}', 'Citrus fertilizer 3 times per year', 'recurring', '120', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Color develops with cool nights. Pick when heavy and deeply colored', 'growth_stage', 'fruiting', 'medium', None),
                ],
                'Mandarin Orange': [
                    ('fertilize', 'Fertilize {plant_name}', 'Apply citrus fertilizer in Feb, May, and Sept', 'recurring', '120', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick when easily pulls from tree and tastes sweet. Don\'t leave too long — gets puffy', 'growth_stage', 'fruiting', 'medium', None),
                ],
                'Tangelo': [
                    ('fertilize', 'Fertilize {plant_name}', 'Citrus fertilizer 3 times per year', 'recurring', '120', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick when colored up and slightly soft. Taste test for sweetness', 'growth_stage', 'fruiting', 'medium', None),
                ],
                'Kumquat': [
                    ('fertilize', 'Fertilize {plant_name}', 'Citrus fertilizer 3 times per year. Most cold-hardy citrus', 'recurring', '120', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Eat whole — skin is sweet, flesh is tart. Pick when orange', 'growth_stage', 'fruiting', 'medium', None),
                ],
                'Blackberry': [
                    ('prune', 'Prune {plant_name} canes', 'Remove fruited canes (floricanes) after harvest. Tip-prune primocanes in summer', 'recurring', '365', 'high', None),
                    ('stake', 'Trellis {plant_name}', 'Train canes on wire trellis for easier picking and better sun exposure', 'days_after_planting', '30', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick when fully black and easily pulls from stem. Check every 2-3 days', 'growth_stage', 'fruiting', 'high', None),
                ],
                'Raspberry': [
                    ('prune', 'Prune spent {plant_name} canes', 'Cut fruited canes to ground after harvest. Thin remaining canes to 4-6 per foot', 'recurring', '365', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick when colored and easily slides off core. Harvest every 2-3 days', 'growth_stage', 'fruiting', 'high', None),
                ],
                'Blueberry': [
                    ('fertilize', 'Fertilize {plant_name} with acid fertilizer', 'Use azalea/blueberry fertilizer. Needs acidic soil pH 4.5-5.5', 'recurring', '90', 'medium', None),
                    ('custom', 'Acidify {plant_name} soil', 'Add sulfur or peat moss to maintain acid pH. Desert soils are naturally alkaline', 'recurring', '180', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick when fully blue and easily releases. Taste test — should be sweet', 'growth_stage', 'fruiting', 'medium', None),
                    ('pest_check', 'Net {plant_name} against birds', 'Cover with bird netting when berries start coloring', 'growth_stage', 'fruiting', 'high', None),
                ],
                'Boysenberry': [
                    ('prune', 'Prune {plant_name} canes', 'Remove fruited canes after harvest', 'recurring', '365', 'high', None),
                    ('stake', 'Trellis {plant_name}', 'Train on wire system for easier management', 'days_after_planting', '30', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick when dark maroon and soft. Very perishable — eat or freeze quickly', 'growth_stage', 'fruiting', 'medium', None),
                ],
                'Pomegranate': [
                    ('prune', 'Prune {plant_name}', 'Remove suckers and shape in late winter. Maintain 3-5 main trunks', 'recurring', '365', 'medium', 'winter'),
                    ('harvest', 'Harvest {plant_name}', 'Pick when skin is dark red and makes metallic sound when tapped. Splits if left too long', 'growth_stage', 'fruiting', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Light feeder — apply balanced fertilizer in spring', 'recurring', '365', 'low', 'spring'),
                ],
                'Date Palm': [
                    ('custom', 'Thin {plant_name} fruit clusters', 'Remove some fruit strands for larger remaining dates', 'growth_stage', 'fruiting', 'medium', None),
                    ('custom', 'Cover {plant_name} fruit clusters', 'Bag clusters with mesh to protect from birds and rain', 'growth_stage', 'fruiting', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick dates when soft and translucent (rutab stage) or let dry on tree (tamar stage)', 'growth_stage', 'fruiting', 'medium', None),
                ],
                'Jujube': [
                    ('harvest', 'Harvest {plant_name}', 'Pick when mahogany brown for dried dates, or yellow-red for fresh eating', 'growth_stage', 'fruiting', 'medium', None),
                    ('prune', 'Prune {plant_name}', 'Minimal pruning needed. Remove dead wood and crossing branches in winter', 'recurring', '365', 'low', 'winter'),
                ],
                'Dragon Fruit': [
                    ('stake', 'Support {plant_name} on sturdy post', 'Needs strong support — heavy plant. T-post or thick concrete post works best', 'days_after_planting', '14', 'high', None),
                    ('custom', 'Hand pollinate {plant_name}', 'Flowers open one night only. Pollinate between 8pm-midnight for best set', 'growth_stage', 'flowering', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick when skin color is even and fins start to wither. Twist off or cut', 'growth_stage', 'fruiting', 'medium', None),
                    ('custom', 'Protect {plant_name} from frost', 'Cover when below 32F. Tropical cactus', 'recurring', '365', 'high', 'winter'),
                ],
                'Passion Fruit': [
                    ('stake', 'Trellis {plant_name}', 'Vigorous vine — needs strong trellis or fence', 'days_after_planting', '14', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick when skin wrinkles and fruit falls or easily detaches. Wrinkly = ripe', 'growth_stage', 'fruiting', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Apply balanced fertilizer quarterly. Don\'t over-fertilize with nitrogen', 'recurring', '90', 'medium', None),
                ],
                'Guava': [
                    ('prune', 'Prune {plant_name}', 'Thin interior for airflow. Prune to maintain manageable height', 'recurring', '365', 'medium', 'winter'),
                    ('harvest', 'Harvest {plant_name}', 'Pick when fragrant and gives slightly to pressure. Color depends on variety', 'growth_stage', 'fruiting', 'medium', None),
                    ('custom', 'Protect {plant_name} from frost', 'Cover when below 30F. Young trees are especially vulnerable', 'recurring', '365', 'high', 'winter'),
                ],
                'Papaya': [
                    ('custom', 'Protect {plant_name} from frost', 'Extremely frost-sensitive — dies below 32F. In AZ, grow in protected microclimate', 'recurring', '365', 'high', 'winter'),
                    ('harvest', 'Harvest {plant_name}', 'Pick when 1/3 to full yellow. Will ripen on counter', 'growth_stage', 'fruiting', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Heavy feeder — monthly balanced fertilizer during growing season', 'recurring', '30', 'medium', None),
                ],
                'Banana': [
                    ('custom', 'Protect {plant_name} from frost', 'Mulch base heavily before winter. Can die to ground and resprout if roots survive', 'recurring', '365', 'high', 'fall,winter'),
                    ('custom', 'Remove {plant_name} suckers', 'Keep only 1-2 suckers per plant to focus energy on fruit production', 'recurring', '60', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Extremely heavy feeder — apply monthly with balanced fertilizer', 'recurring', '30', 'high', None),
                ],
                'Mango': [
                    ('custom', 'Protect {plant_name} from frost', 'Very frost-sensitive. Grow in warmest microclimate or container', 'recurring', '365', 'high', 'winter'),
                    ('prune', 'Prune {plant_name}', 'Tip-prune after fruit harvest to encourage branching', 'recurring', '365', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Apply balanced fertilizer in spring. Avoid heavy nitrogen which inhibits flowering', 'recurring', '365', 'medium', 'spring'),
                ],
                'Avocado': [
                    ('custom', 'Protect {plant_name} from frost', 'Cover or bring inside below 30F. Hass variety is most cold-sensitive', 'recurring', '365', 'high', 'winter'),
                    ('fertilize', 'Fertilize {plant_name}', 'Apply avocado/citrus fertilizer with zinc and iron', 'recurring', '90', 'medium', None),
                    ('custom', 'Plant partner for {plant_name}', 'Avocados need cross-pollination. Plant A and B type together for best fruit set', 'one_time', '0', 'medium', None),
                ],
                'Mulberry': [
                    ('prune', 'Prune {plant_name}', 'Prune in late winter while dormant. Can be pruned hard to control size', 'recurring', '365', 'medium', 'winter'),
                    ('harvest', 'Harvest {plant_name}', 'Pick when fully colored and soft. Spread sheet underneath and shake branches', 'growth_stage', 'fruiting', 'medium', None),
                ],
                'Olive': [
                    ('prune', 'Prune {plant_name}', 'Thin interior for airflow and light. Remove crossing branches in late winter', 'recurring', '365', 'medium', 'winter'),
                    ('harvest', 'Harvest {plant_name}', 'Pick green for curing or black when fully ripe. Cannot eat raw — must be cured', 'growth_stage', 'fruiting', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Light feeder — apply balanced fertilizer once in spring', 'recurring', '365', 'low', 'spring'),
                ],
                'Goji Berry': [
                    ('prune', 'Prune {plant_name}', 'Cut back laterals to 2-3 buds in winter. Remove weak growth for bigger berries', 'recurring', '365', 'medium', 'winter'),
                    ('harvest', 'Harvest {plant_name}', 'Pick when bright red-orange. Shake branches over sheet. Fresh or dried', 'growth_stage', 'fruiting', 'medium', None),
                    ('stake', 'Trellis {plant_name}', 'Train on wire or stake — drooping branches make harvesting easier', 'days_after_planting', '30', 'medium', None),
                ],
                'Barbados Cherry': [
                    ('harvest', 'Harvest {plant_name}', 'Pick when bright red and soft. Extremely high in vitamin C. Very perishable', 'growth_stage', 'fruiting', 'medium', None),
                    ('prune', 'Prune {plant_name}', 'Shape after harvest. Makes excellent hedge', 'recurring', '365', 'low', None),
                ],
                'Desert Gold Peach': [
                    ('prune', 'Prune {plant_name} in winter', 'Open-center prune while dormant for good airflow. Low chill variety for desert', 'recurring', '365', 'high', 'winter'),
                    ('custom', 'Thin {plant_name} fruit', 'Thin to 6 inches apart when marble-size for larger peaches', 'growth_stage', 'fruiting', 'high', None),
                    ('pest_check', 'Check {plant_name} for borers', 'Look for sawdust at base of trunk and gummy sap', 'recurring', '30', 'medium', None),
                ],
                'Apricot': [
                    ('prune', 'Prune {plant_name}', 'Open-center prune in late winter. Fruit on previous year\'s wood', 'recurring', '365', 'medium', 'winter'),
                    ('custom', 'Thin {plant_name} fruit', 'Thin to 3-4 inches apart for bigger, better fruit', 'growth_stage', 'fruiting', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick when fragrant and gives slightly to pressure. Tree-ripened is best', 'growth_stage', 'fruiting', 'medium', None),
                ],
                'Plum': [
                    ('prune', 'Prune {plant_name}', 'Thin center for light and airflow. Remove suckers at base', 'recurring', '365', 'medium', 'winter'),
                    ('custom', 'Thin {plant_name} fruit', 'Thin to 4-6 inches apart when marble-size', 'growth_stage', 'fruiting', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick when slightly soft and fully colored. Taste test!', 'growth_stage', 'fruiting', 'medium', None),
                ],
                'Nectarine': [
                    ('prune', 'Prune {plant_name}', 'Open-center prune while dormant. Similar to peach care', 'recurring', '365', 'high', 'winter'),
                    ('custom', 'Thin {plant_name} fruit', 'Thin to 6 inches apart for larger fruit', 'growth_stage', 'fruiting', 'high', None),
                    ('pest_check', 'Check {plant_name} for peach leaf curl', 'Apply fungicide in late fall and early spring', 'recurring', '180', 'medium', None),
                ],
                'Pecan': [
                    ('fertilize', 'Fertilize {plant_name}', 'Apply zinc-containing fertilizer in spring. Pecans need zinc in AZ alkaline soils', 'recurring', '365', 'medium', 'spring'),
                    ('custom', 'Deep water {plant_name}', 'Deep irrigation during nut development (July-Sept). Very water-hungry tree', 'recurring', '14', 'high', 'summer'),
                    ('harvest', 'Harvest {plant_name}', 'Shake tree or pick up fallen nuts when husks split open in fall', 'growth_stage', 'fruiting', 'medium', None),
                ],
                'Pineapple Guava': [
                    ('harvest', 'Harvest {plant_name}', 'Pick when fruit falls naturally or gives to gentle pull. Aromatic minty-pineapple flavor', 'growth_stage', 'fruiting', 'medium', None),
                    ('prune', 'Prune {plant_name}', 'Shape as desired. Makes excellent hedge. Minimal pruning needed', 'recurring', '365', 'low', None),
                ],
                'Loquat': [
                    ('custom', 'Thin {plant_name} fruit clusters', 'Thin to 4-6 fruit per cluster for larger fruit', 'growth_stage', 'fruiting', 'medium', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick when fully colored and slightly soft. Very perishable', 'growth_stage', 'fruiting', 'medium', None),
                    ('prune', 'Prune {plant_name}', 'Thin interior branches for light. Remove low-hanging branches', 'recurring', '365', 'low', 'winter'),
                ],
                'White Sapote': [
                    ('harvest', 'Harvest {plant_name}', 'Pick when skin color changes and fruit gives to gentle pressure. Custard-like flesh', 'growth_stage', 'fruiting', 'medium', None),
                    ('prune', 'Prune {plant_name}', 'Control size — can get very large. Prune in spring', 'recurring', '365', 'medium', 'spring'),
                ],
                'Barbados Cherry': [
                    ('harvest', 'Harvest {plant_name}', 'Pick when bright red. World\'s highest vitamin C fruit. Very perishable', 'growth_stage', 'fruiting', 'medium', None),
                ],

                # ── ORNAMENTALS (only those needing specific care) ──
                'Bougainvillea': [
                    ('prune', 'Prune {plant_name}', 'Hard prune in late winter for vigorous spring bloom. Blooms on new wood', 'recurring', '365', 'medium', 'winter'),
                    ('custom', 'Stress {plant_name} for blooms', 'Reduce watering to trigger flowering. Too much water = leaves, not bracts', 'one_time', '0', 'medium', None),
                ],
                'Lantana': [
                    ('prune', 'Cut back {plant_name}', 'Hard prune in late winter to 6-12 inches. Regrows vigorously', 'recurring', '365', 'medium', 'winter'),
                ],
                'Desert Willow': [
                    ('prune', 'Prune {plant_name}', 'Shape young trees. Remove seed pods if messy. Otherwise low-maintenance', 'recurring', '365', 'low', 'winter'),
                ],
                'Plumeria': [
                    ('custom', 'Protect {plant_name} from frost', 'Bring inside or cover below 40F. Goes dormant and drops leaves in winter', 'recurring', '365', 'high', 'fall,winter'),
                    ('fertilize', 'Fertilize {plant_name}', 'High-phosphorus fertilizer for best blooms. Stop feeding in fall', 'recurring', '30', 'medium', 'spring,summer'),
                ],
                'Jasmine': [
                    ('prune', 'Prune {plant_name} after flowering', 'Shape and control size after bloom period', 'growth_stage', 'flowering', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Balanced fertilizer monthly during growing season', 'recurring', '30', 'low', None),
                ],
                'Saguaro': [
                    ('pest_check', 'Check {plant_name} for holes/damage', 'Watch for woodpecker holes and bacterial necrosis (brown/black spots)', 'recurring', '90', 'medium', None),
                ],
                'Barrel Cactus': [
                    ('pest_check', 'Check {plant_name} for scale', 'Look for brown crusty patches — scale insects. Treat with horticultural oil', 'recurring', '90', 'low', None),
                ],
                'Ocotillo': [
                    ('custom', '{plant_name} tip', 'Leafs out and blooms after rain. Supplemental summer water encourages more leaf/bloom cycles', 'one_time', '0', 'low', None),
                ],
                'Agave americana': [
                    ('custom', 'Remove {plant_name} pups', 'Dig out offsets to prevent overcrowding. Replant or share', 'recurring', '365', 'medium', None),
                    ('pest_check', 'Check {plant_name} for agave snout weevil', 'Wilting/collapsing center = weevil. Preventive soil drench in spring', 'recurring', '365', 'medium', 'spring'),
                ],
                'Agave parryi': [
                    ('pest_check', 'Check {plant_name} for agave snout weevil', 'Sudden collapse indicates weevil. Preventive treatment in spring', 'recurring', '365', 'medium', 'spring'),
                ],
                'Agave vilmoriniana': [
                    ('custom', 'Watch for {plant_name} bloom stalk', 'Blooms once then dies (monocarpic). Produces plantlets on stalk — save them', 'recurring', '365', 'low', None),
                ],
                'Pink Muhly Grass': [
                    ('prune', 'Cut back {plant_name}', 'Cut to 4-6 inches in late winter before new growth emerges', 'recurring', '365', 'medium', 'winter'),
                ],
                'Deer Grass': [
                    ('prune', 'Cut back {plant_name}', 'Cut to 6 inches in late winter for fresh spring growth', 'recurring', '365', 'medium', 'winter'),
                ],
                'Purple Fountain Grass': [
                    ('prune', 'Cut back {plant_name}', 'Cut to 6 inches in late winter. May not survive hard freezes — treat as annual if needed', 'recurring', '365', 'medium', 'winter'),
                ],
                'Bamboo Muhly': [
                    ('prune', 'Cut back {plant_name}', 'Trim dead growth in late winter', 'recurring', '365', 'low', 'winter'),
                ],
                'Vinca (Catharanthus)': [
                    ('custom', '{plant_name} care', 'Heat-loving annual. Don\'t overwater — thrives in hot dry conditions. Self-cleans', 'one_time', '0', 'low', None),
                ],
                'Petunia': [
                    ('prune', 'Cut back leggy {plant_name}', 'Trim by half when leggy mid-season for fresh flush of blooms', 'recurring', '45', 'medium', None),
                    ('fertilize', 'Fertilize {plant_name}', 'Heavy feeder — apply liquid fertilizer weekly for best blooms', 'recurring', '7', 'medium', None),
                ],
                'Pansy': [
                    ('prune', 'Deadhead {plant_name}', 'Remove spent flowers for continuous cool-season blooms', 'recurring', '7', 'medium', 'fall,winter,spring'),
                    ('fertilize', 'Fertilize {plant_name}', 'Light balanced fertilizer monthly', 'recurring', '30', 'low', None),
                ],
                'Pentas': [
                    ('prune', 'Deadhead {plant_name}', 'Remove spent flower clusters to encourage reblooming. Butterfly magnet', 'recurring', '14', 'medium', None),
                ],
                'Gazania': [
                    ('prune', 'Deadhead {plant_name}', 'Remove faded flowers for continued blooming', 'recurring', '14', 'low', None),
                ],
                'Portulaca': [
                    ('custom', '{plant_name} care', 'Virtually maintenance-free. Don\'t overwater. Thrives on neglect in full sun', 'one_time', '0', 'low', None),
                ],
                'Globe Amaranth': [
                    ('harvest', 'Harvest {plant_name} for drying', 'Cut stems when flowers are fully colored. Excellent dried flower — lasts forever', 'growth_stage', 'flowering', 'low', None),
                ],
                'California Poppy': [
                    ('custom', 'Let {plant_name} self-seed', 'California native. Let flowers go to seed for return next year. Don\'t transplant — taproot', 'one_time', '0', 'low', None),
                ],
                'Desert Lupine': [
                    ('custom', 'Let {plant_name} naturalize', 'Desert wildflower. Scatter seeds in fall and let nature do the rest', 'one_time', '0', 'low', None),
                ],
                'Salvia Greggii': [
                    ('prune', 'Prune {plant_name}', 'Cut back by one-third in late winter. Hummingbird favorite', 'recurring', '365', 'medium', 'winter'),
                ],
                'Salvia leucantha': [
                    ('prune', 'Cut back {plant_name}', 'Hard prune to 6 inches in spring for bushy regrowth and fall blooms', 'recurring', '365', 'medium', 'spring'),
                ],
                'Salvia farinacea': [
                    ('prune', 'Deadhead {plant_name}', 'Remove spent spikes for continued blooming. Treat as annual in cold areas', 'recurring', '21', 'low', None),
                ],
                'Yellow Bells': [
                    ('prune', 'Prune {plant_name}', 'Cut back frost damage in spring. Blooms on new wood', 'recurring', '365', 'medium', 'spring'),
                ],
                'Texas Ranger': [
                    ('prune', 'Prune {plant_name} lightly', 'Never shear into ball shape — prune selectively for natural form', 'recurring', '365', 'low', None),
                    ('custom', '{plant_name} rain blooms', 'Blooms after rain — the "barometer bush." No supplemental water needed once established', 'one_time', '0', 'low', None),
                ],
                'Oleander': [
                    ('prune', 'Prune {plant_name}', 'Remove oldest 1/3 of stems at ground yearly for continuous renewal. ALL PARTS ARE TOXIC', 'recurring', '365', 'medium', 'winter'),
                    ('pest_check', 'Check {plant_name} for oleander caterpillar', 'Orange caterpillars with black tufts. Hand-pick with gloves — plant is toxic', 'recurring', '30', 'medium', None),
                ],
                'Bird of Paradise (Red)': [
                    ('prune', 'Prune {plant_name}', 'Cut back frost damage in spring. Can hard prune to rejuvenate', 'recurring', '365', 'medium', 'spring'),
                ],
                'Bird of Paradise (Yellow)': [
                    ('prune', 'Prune {plant_name}', 'Cut back frost damage in spring', 'recurring', '365', 'medium', 'spring'),
                ],
                'Mexican Bird of Paradise': [
                    ('prune', 'Prune {plant_name}', 'Remove frost damage in spring. Cut seed pods for tidier look', 'recurring', '365', 'medium', 'spring'),
                ],
                'Pride of Barbados': [
                    ('prune', 'Cut back {plant_name}', 'Dies back in frost — cut to 6 inches in spring. Regrows fast', 'recurring', '365', 'medium', 'spring'),
                ],
                'Fairy Duster (Red)': [
                    ('prune', 'Prune {plant_name} lightly', 'Light shaping only — natural form is best. Hummingbird plant', 'recurring', '365', 'low', None),
                ],
                'Trailing Rosemary': [
                    ('prune', 'Trim {plant_name}', 'Shape as needed. Great groundcover. Same uses as upright rosemary', 'recurring', '90', 'low', None),
                ],

                # Remaining specific plants
                'Sunflower (Edible)': [
                    ('stake', 'Stake tall {plant_name}', 'Support stems when over 3 feet to prevent wind damage', 'days_after_planting', '30', 'medium', None),
                    ('harvest', 'Harvest {plant_name} seeds', 'Cut head when back is brown and seeds are plump. Dry hanging upside down', 'days_after_planting', '80', 'medium', None),
                    ('custom', 'Protect {plant_name} from birds', 'Cover seed heads with netting when seeds start forming', 'growth_stage', 'fruiting', 'medium', None),
                ],
                'Pigeon Pea': [
                    ('harvest', 'Harvest {plant_name}', 'Pick green for fresh peas or let dry on plant for storage. Dual purpose', 'days_after_planting', '90', 'medium', None),
                    ('prune', 'Prune {plant_name}', 'Cut back by half after harvest for renewed production', 'recurring', '180', 'medium', None),
                ],
                'Winged Bean': [
                    ('stake', 'Trellis {plant_name}', 'Vigorous climber — all parts edible (pods, leaves, flowers, tubers)', 'days_after_planting', '14', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick pods when 6-8 inches and wings are still tender', 'days_after_planting', '60', 'medium', None),
                ],
                'Lablab Bean': [
                    ('stake', 'Trellis {plant_name}', 'Ornamental vine with purple flowers and pods. Strong support needed', 'days_after_planting', '14', 'high', None),
                    ('harvest', 'Harvest {plant_name}', 'Pick young pods for cooking or mature beans for drying', 'days_after_planting', '70', 'medium', None),
                ],
                'Guar Bean': [
                    ('harvest', 'Harvest {plant_name}', 'Pick young tender pods for cooking. Drought-tolerant legume', 'days_after_planting', '70', 'medium', None),
                ],
                'Pinto Bean': [
                    ('harvest', 'Harvest {plant_name}', 'Let pods dry completely on vine, then shell. Store dry beans', 'days_after_planting', '80', 'medium', None),
                ],
                'Chipilin': [
                    ('harvest', 'Harvest {plant_name} leaves', 'Pick tender leaves and shoots. Traditional in Central American tamales', 'recurring', '14', 'medium', None),
                    ('prune', 'Prune {plant_name}', 'Cut back regularly to encourage bushy growth', 'recurring', '30', 'medium', None),
                ],
                'Jute Mallow': [
                    ('harvest', 'Harvest {plant_name} leaves', 'Pick young leaves for mucilaginous cooking greens (molokhia)', 'recurring', '14', 'medium', None),
                ],
                'Sissoo Spinach': [
                    ('harvest', 'Harvest {plant_name}', 'Cut leaves as needed — perennial heat-loving spinach substitute', 'recurring', '14', 'medium', None),
                ],
            }

            # ── Category-based default templates ──
            def get_default_templates(name, category):
                """Generate default templates based on plant category."""
                if category == 'vegetable':
                    return [
                        ('fertilize', f'Fertilize {{plant_name}}', 'Apply balanced fertilizer for healthy growth', 'recurring', '21', 'medium', None),
                        ('pest_check', f'Check {{plant_name}} for pests', 'Inspect leaves and stems for common pests and diseases', 'recurring', '14', 'low', None),
                        ('harvest', f'Check {{plant_name}} for harvest', 'Monitor for harvest readiness based on size, color, and firmness', 'days_after_planting', '60', 'medium', None),
                    ]
                elif category == 'herb':
                    return [
                        ('prune', f'Prune/pinch {{plant_name}}', 'Trim regularly to encourage bushy growth and prevent flowering', 'recurring', '14', 'medium', None),
                        ('harvest', f'Harvest {{plant_name}}', 'Cut stems or leaves as needed for culinary use', 'recurring', '14', 'medium', None),
                    ]
                elif category == 'flower':
                    return [
                        ('prune', f'Deadhead {{plant_name}}', 'Remove spent blooms to encourage continued flowering', 'recurring', '14', 'medium', None),
                        ('fertilize', f'Fertilize {{plant_name}}', 'Apply balanced fertilizer monthly during growing season', 'recurring', '30', 'low', None),
                    ]
                elif category == 'fruit':
                    return [
                        ('fertilize', f'Fertilize {{plant_name}}', 'Apply appropriate fertilizer for fruit production', 'recurring', '90', 'medium', None),
                        ('prune', f'Prune {{plant_name}}', 'Shape and thin for airflow and fruit quality', 'recurring', '365', 'medium', 'winter'),
                        ('pest_check', f'Check {{plant_name}} for pests', 'Inspect for common fruit tree pests and diseases', 'recurring', '30', 'medium', None),
                        ('harvest', f'Harvest {{plant_name}}', 'Check for ripe fruit and harvest promptly', 'growth_stage', 'fruiting', 'medium', None),
                    ]
                elif category == 'ornamental':
                    # Most ornamentals need minimal care — just a prune template
                    return [
                        ('prune', f'Prune {{plant_name}}', 'Shape and remove dead or damaged growth', 'recurring', '365', 'low', None),
                    ]
                return []

            # Plants to skip (purely ornamental landscape plants with no specific care)
            skip_plants = {
                'Indian Laurel', 'Star Jasmine', 'Tipu Tree', 'African Sumac',
                'Sweet Acacia', 'Texas Mountain Laurel', 'Ironwood', 'Mesquite',
                'Palo Verde', 'Jacaranda',
            }

            count = 0
            for plant_id, plant_name, category in plants:
                if plant_name in existing:
                    continue
                if plant_name in skip_plants:
                    continue

                # Check for specific templates first
                if plant_name in specific:
                    templates = specific[plant_name]
                    if not templates:  # Empty list means skip (already has templates or explicitly excluded)
                        continue
                else:
                    # Use category defaults
                    templates = get_default_templates(plant_name, category)

                if not templates:
                    continue

                for t in templates:
                    task_type, title, desc, trigger_type, trigger_val, priority, season = t
                    db.execute(
                        """INSERT INTO plant_task_templates
                           (plant_id, plant_name, task_type, title_template, description_template,
                            trigger_type, trigger_value, priority, season_filter)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (plant_id, plant_name, task_type, title, desc, trigger_type, trigger_val, priority, season)
                    )
                    count += 1

            db.commit()
            logger.info(f"Migration 053: Added {count} task templates for plants missing coverage")

        run_migration(db, 53, "all_plant_task_templates", [], callback=_all_plant_templates)

        # ── Migration 054: freeform planting position columns ──
        def _freeform_planting(db):
            for col in ["position_x_inches", "position_y_inches"]:
                try:
                    db.execute(f"ALTER TABLE plantings ADD COLUMN {col} REAL")
                except Exception:
                    pass
            db.commit()

        run_migration(db, 54, "freeform_planting_positions", [], callback=_freeform_planting)

        logger.info("Migration system: all migrations checked/applied")

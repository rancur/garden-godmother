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
    with get_db() as db:
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

        logger.info("Migration system: all migrations checked/applied")

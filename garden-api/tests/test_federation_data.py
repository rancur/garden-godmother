"""Integration tests for Phase 2 federation data endpoints.

Covers harvest offers, seed swaps, federation alerts, and the co-op board.
Uses the ``auth_client`` fixture from conftest.py (authenticated as admin).
"""
from __future__ import annotations

import json

import pytest


# ── Helpers ────────────────────────────────────────────────────────────────

def _create_offer(auth_client, **kwargs):
    """POST /api/harvest-offers with sensible defaults; return response JSON."""
    payload = {
        "plant_name": "Tomato",
        "quantity_description": "About 10 lbs",
        "published": False,
    }
    payload.update(kwargs)
    resp = auth_client.post("/api/harvest-offers", json=payload)
    assert resp.status_code == 201, f"create offer failed: {resp.text}"
    return resp.json()


def _create_swap(auth_client, **kwargs):
    """POST /api/seed-swaps with sensible defaults; return response JSON."""
    payload = {
        "plant_name": "Basil",
        "quantity_description": "One packet",
        "published": False,
    }
    payload.update(kwargs)
    resp = auth_client.post("/api/seed-swaps", json=payload)
    assert resp.status_code == 201, f"create swap failed: {resp.text}"
    return resp.json()


def _create_alert(auth_client, **kwargs):
    """POST /api/federation-alerts with sensible defaults; return response JSON."""
    payload = {
        "alert_type": "pest",
        "title": "Aphid outbreak",
        "body": "Watch your brassicas.",
        "severity": "info",
    }
    payload.update(kwargs)
    resp = auth_client.post("/api/federation-alerts", json=payload)
    assert resp.status_code == 201, f"create alert failed: {resp.text}"
    return resp.json()


def _seed_peer_data(auth_client, peer_id, data_type, items):
    """Insert a row directly into federation_peer_data and federation_peers tables."""
    from db import get_db
    with get_db() as db:
        # Ensure the peer exists and is active
        db.execute(
            """INSERT OR IGNORE INTO federation_peers
               (peer_id, peer_url, display_name, public_key, status)
               VALUES (?, ?, ?, ?, 'active')""",
            (peer_id, "https://peer.example.com", "Test Peer", "fakepublickey"),
        )
        db.execute(
            """INSERT OR REPLACE INTO federation_peer_data
               (peer_id, data_type, payload)
               VALUES (?, ?, ?)""",
            (peer_id, data_type, json.dumps(items)),
        )
        db.commit()


# ═══════════════════════════════════════════════════════════════════════════
# HARVEST OFFERS
# ═══════════════════════════════════════════════════════════════════════════

class TestListHarvestOffers:
    def test_unauthenticated_returns_401(self, client):
        resp = client.get("/api/harvest-offers")
        assert resp.status_code == 401

    def test_empty_list_initially(self, auth_client):
        resp = auth_client.get("/api/harvest-offers")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_list_type(self, auth_client):
        resp = auth_client.get("/api/harvest-offers")
        assert isinstance(resp.json(), list)

    def test_created_offer_appears_in_list(self, auth_client):
        _create_offer(auth_client, plant_name="Zucchini")
        resp = auth_client.get("/api/harvest-offers")
        assert resp.status_code == 200
        names = [o["plant_name"] for o in resp.json()]
        assert "Zucchini" in names

    def test_filter_by_status_available(self, auth_client):
        _create_offer(auth_client, plant_name="Pepper")
        resp = auth_client.get("/api/harvest-offers?status=available")
        assert resp.status_code == 200
        for item in resp.json():
            assert item["status"] == "available"

    def test_filter_by_status_claimed_returns_empty(self, auth_client):
        _create_offer(auth_client, plant_name="Carrot")
        resp = auth_client.get("/api/harvest-offers?status=claimed")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_filter_by_published_true(self, auth_client):
        _create_offer(auth_client, plant_name="Kale", published=True)
        _create_offer(auth_client, plant_name="Spinach", published=False)
        resp = auth_client.get("/api/harvest-offers?published=true")
        assert resp.status_code == 200
        items = resp.json()
        assert all(item["published"] in (1, True) for item in items)
        names = [i["plant_name"] for i in items]
        assert "Kale" in names
        assert "Spinach" not in names


class TestCreateHarvestOffer:
    def test_unauthenticated_returns_401(self, client):
        resp = client.post("/api/harvest-offers", json={
            "plant_name": "Tomato",
            "quantity_description": "5 lbs",
        })
        assert resp.status_code == 401

    def test_creates_offer_successfully(self, auth_client):
        resp = auth_client.post("/api/harvest-offers", json={
            "plant_name": "Tomato",
            "quantity_description": "About 10 lbs",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["plant_name"] == "Tomato"
        assert data["quantity_description"] == "About 10 lbs"
        assert "id" in data

    def test_created_offer_has_default_status_available(self, auth_client):
        data = _create_offer(auth_client)
        assert data["status"] == "available"

    def test_created_offer_unpublished_by_default(self, auth_client):
        data = _create_offer(auth_client)
        assert data["published"] in (0, False)

    def test_create_with_published_true(self, auth_client):
        data = _create_offer(auth_client, published=True)
        assert data["published"] in (1, True)

    def test_create_with_optional_fields(self, auth_client):
        data = _create_offer(
            auth_client,
            notes="Fresh from the garden",
            available_from="2026-05-01",
            available_until="2026-05-31",
        )
        assert data["notes"] == "Fresh from the garden"
        assert data["available_from"] == "2026-05-01"
        assert data["available_until"] == "2026-05-31"

    def test_missing_plant_name_returns_422(self, auth_client):
        resp = auth_client.post("/api/harvest-offers", json={
            "quantity_description": "5 lbs",
        })
        assert resp.status_code == 422

    def test_missing_quantity_description_returns_422(self, auth_client):
        resp = auth_client.post("/api/harvest-offers", json={
            "plant_name": "Tomato",
        })
        assert resp.status_code == 422

    def test_published_offer_visible_in_coop_filter(self, auth_client):
        """Published=true offer should appear when filtering by published."""
        data = _create_offer(auth_client, plant_name="Chard", published=True)
        resp = auth_client.get("/api/harvest-offers?published=true")
        ids = [o["id"] for o in resp.json()]
        assert data["id"] in ids


class TestUpdateHarvestOffer:
    def test_unauthenticated_returns_401(self, client):
        resp = client.patch("/api/harvest-offers/1", json={"notes": "Updated"})
        assert resp.status_code == 401

    def test_update_notes(self, auth_client):
        offer = _create_offer(auth_client)
        resp = auth_client.patch(f"/api/harvest-offers/{offer['id']}", json={
            "notes": "Updated notes",
        })
        assert resp.status_code == 200
        assert resp.json()["notes"] == "Updated notes"

    def test_update_quantity_description(self, auth_client):
        offer = _create_offer(auth_client)
        resp = auth_client.patch(f"/api/harvest-offers/{offer['id']}", json={
            "quantity_description": "15 lbs now",
        })
        assert resp.status_code == 200
        assert resp.json()["quantity_description"] == "15 lbs now"

    def test_update_status(self, auth_client):
        offer = _create_offer(auth_client)
        resp = auth_client.patch(f"/api/harvest-offers/{offer['id']}", json={
            "status": "claimed",
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "claimed"

    def test_update_published(self, auth_client):
        offer = _create_offer(auth_client, published=False)
        resp = auth_client.patch(f"/api/harvest-offers/{offer['id']}", json={
            "published": True,
        })
        assert resp.status_code == 200
        assert resp.json()["published"] in (1, True)

    def test_update_unknown_id_returns_404(self, auth_client):
        resp = auth_client.patch("/api/harvest-offers/99999", json={
            "notes": "Ghost",
        })
        assert resp.status_code == 404

    def test_empty_patch_returns_400(self, auth_client):
        offer = _create_offer(auth_client)
        resp = auth_client.patch(f"/api/harvest-offers/{offer['id']}", json={})
        assert resp.status_code == 400

    def test_update_persisted_on_reread(self, auth_client):
        offer = _create_offer(auth_client)
        auth_client.patch(f"/api/harvest-offers/{offer['id']}", json={"notes": "Persisted"})
        resp = auth_client.get("/api/harvest-offers")
        updated = next(o for o in resp.json() if o["id"] == offer["id"])
        assert updated["notes"] == "Persisted"


class TestDeleteHarvestOffer:
    def test_unauthenticated_returns_401(self, client):
        resp = client.delete("/api/harvest-offers/1")
        assert resp.status_code == 401

    def test_delete_removes_offer(self, auth_client):
        offer = _create_offer(auth_client)
        resp = auth_client.delete(f"/api/harvest-offers/{offer['id']}")
        assert resp.status_code == 204

        # Confirm it's gone
        listing = auth_client.get("/api/harvest-offers").json()
        ids = [o["id"] for o in listing]
        assert offer["id"] not in ids

    def test_delete_unknown_id_returns_404(self, auth_client):
        resp = auth_client.delete("/api/harvest-offers/99999")
        assert resp.status_code == 404

    def test_double_delete_returns_404(self, auth_client):
        offer = _create_offer(auth_client)
        auth_client.delete(f"/api/harvest-offers/{offer['id']}")
        resp = auth_client.delete(f"/api/harvest-offers/{offer['id']}")
        assert resp.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════
# SEED SWAPS
# ═══════════════════════════════════════════════════════════════════════════

class TestListSeedSwaps:
    def test_unauthenticated_returns_401(self, client):
        resp = client.get("/api/seed-swaps")
        assert resp.status_code == 401

    def test_empty_list_initially(self, auth_client):
        resp = auth_client.get("/api/seed-swaps")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_created_swap_appears_in_list(self, auth_client):
        _create_swap(auth_client, plant_name="Dill")
        resp = auth_client.get("/api/seed-swaps")
        names = [s["plant_name"] for s in resp.json()]
        assert "Dill" in names

    def test_filter_by_status_available(self, auth_client):
        _create_swap(auth_client)
        resp = auth_client.get("/api/seed-swaps?status=available")
        for item in resp.json():
            assert item["status"] == "available"

    def test_filter_by_published_false(self, auth_client):
        _create_swap(auth_client, plant_name="Cilantro", published=False)
        resp = auth_client.get("/api/seed-swaps?published=false")
        names = [s["plant_name"] for s in resp.json()]
        assert "Cilantro" in names


class TestCreateSeedSwap:
    def test_unauthenticated_returns_401(self, client):
        resp = client.post("/api/seed-swaps", json={
            "plant_name": "Basil",
            "quantity_description": "A handful",
        })
        assert resp.status_code == 401

    def test_creates_swap_successfully(self, auth_client):
        resp = auth_client.post("/api/seed-swaps", json={
            "plant_name": "Oregano",
            "quantity_description": "One packet",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["plant_name"] == "Oregano"
        assert "id" in data

    def test_default_status_is_available(self, auth_client):
        data = _create_swap(auth_client)
        assert data["status"] == "available"

    def test_variety_field_stored(self, auth_client):
        data = _create_swap(auth_client, variety="Genovese")
        assert data["variety"] == "Genovese"

    def test_variety_defaults_to_null(self, auth_client):
        data = _create_swap(auth_client)
        assert data["variety"] is None

    def test_looking_for_field_stored(self, auth_client):
        data = _create_swap(auth_client, looking_for="Hot peppers")
        assert data["looking_for"] == "Hot peppers"

    def test_looking_for_defaults_to_null(self, auth_client):
        data = _create_swap(auth_client)
        assert data["looking_for"] is None

    def test_notes_field_stored(self, auth_client):
        data = _create_swap(auth_client, notes="Heirloom variety")
        assert data["notes"] == "Heirloom variety"

    def test_published_true_works(self, auth_client):
        data = _create_swap(auth_client, published=True)
        assert data["published"] in (1, True)

    def test_missing_plant_name_returns_422(self, auth_client):
        resp = auth_client.post("/api/seed-swaps", json={
            "quantity_description": "One packet",
        })
        assert resp.status_code == 422

    def test_missing_quantity_description_returns_422(self, auth_client):
        resp = auth_client.post("/api/seed-swaps", json={
            "plant_name": "Basil",
        })
        assert resp.status_code == 422


class TestUpdateSeedSwap:
    def test_unauthenticated_returns_401(self, client):
        resp = client.patch("/api/seed-swaps/1", json={"notes": "Updated"})
        assert resp.status_code == 401

    def test_update_quantity_description(self, auth_client):
        swap = _create_swap(auth_client)
        resp = auth_client.patch(f"/api/seed-swaps/{swap['id']}", json={
            "quantity_description": "Two packets",
        })
        assert resp.status_code == 200
        assert resp.json()["quantity_description"] == "Two packets"

    def test_update_looking_for(self, auth_client):
        swap = _create_swap(auth_client)
        resp = auth_client.patch(f"/api/seed-swaps/{swap['id']}", json={
            "looking_for": "Rare tomatoes",
        })
        assert resp.status_code == 200
        assert resp.json()["looking_for"] == "Rare tomatoes"

    def test_update_notes(self, auth_client):
        swap = _create_swap(auth_client)
        resp = auth_client.patch(f"/api/seed-swaps/{swap['id']}", json={
            "notes": "Updated swap notes",
        })
        assert resp.status_code == 200
        assert resp.json()["notes"] == "Updated swap notes"

    def test_update_status(self, auth_client):
        swap = _create_swap(auth_client)
        resp = auth_client.patch(f"/api/seed-swaps/{swap['id']}", json={
            "status": "swapped",
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "swapped"

    def test_update_published(self, auth_client):
        swap = _create_swap(auth_client, published=False)
        resp = auth_client.patch(f"/api/seed-swaps/{swap['id']}", json={
            "published": True,
        })
        assert resp.status_code == 200
        assert resp.json()["published"] in (1, True)

    def test_update_unknown_id_returns_404(self, auth_client):
        resp = auth_client.patch("/api/seed-swaps/99999", json={"notes": "Ghost"})
        assert resp.status_code == 404

    def test_empty_patch_returns_400(self, auth_client):
        swap = _create_swap(auth_client)
        resp = auth_client.patch(f"/api/seed-swaps/{swap['id']}", json={})
        assert resp.status_code == 400


class TestDeleteSeedSwap:
    def test_unauthenticated_returns_401(self, client):
        resp = client.delete("/api/seed-swaps/1")
        assert resp.status_code == 401

    def test_delete_removes_swap(self, auth_client):
        swap = _create_swap(auth_client)
        resp = auth_client.delete(f"/api/seed-swaps/{swap['id']}")
        assert resp.status_code == 204

        listing = auth_client.get("/api/seed-swaps").json()
        ids = [s["id"] for s in listing]
        assert swap["id"] not in ids

    def test_delete_unknown_id_returns_404(self, auth_client):
        resp = auth_client.delete("/api/seed-swaps/99999")
        assert resp.status_code == 404

    def test_double_delete_returns_404(self, auth_client):
        swap = _create_swap(auth_client)
        auth_client.delete(f"/api/seed-swaps/{swap['id']}")
        resp = auth_client.delete(f"/api/seed-swaps/{swap['id']}")
        assert resp.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════
# FEDERATION ALERTS
# ═══════════════════════════════════════════════════════════════════════════

class TestListFederationAlerts:
    def test_unauthenticated_returns_401(self, client):
        resp = client.get("/api/federation-alerts")
        assert resp.status_code == 401

    def test_empty_list_initially(self, auth_client):
        resp = auth_client.get("/api/federation-alerts")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_created_alert_appears_in_list(self, auth_client):
        _create_alert(auth_client, title="Fungal issue")
        resp = auth_client.get("/api/federation-alerts")
        titles = [a["title"] for a in resp.json()]
        assert "Fungal issue" in titles


class TestCreateFederationAlert:
    def test_unauthenticated_returns_401(self, client):
        resp = client.post("/api/federation-alerts", json={
            "alert_type": "pest",
            "title": "Aphids",
            "body": "Watch out.",
        })
        assert resp.status_code == 401

    def test_creates_local_alert(self, auth_client):
        resp = auth_client.post("/api/federation-alerts", json={
            "alert_type": "pest",
            "title": "Spider mites",
            "body": "Spotted on cucumbers.",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["title"] == "Spider mites"
        assert data["alert_type"] == "pest"
        assert "id" in data

    def test_local_alert_has_null_source_peer_id(self, auth_client):
        data = _create_alert(auth_client)
        assert data["source_peer_id"] is None

    def test_default_severity_is_info(self, auth_client):
        data = _create_alert(auth_client)
        assert data["severity"] == "info"

    def test_severity_warning(self, auth_client):
        data = _create_alert(auth_client, severity="warning")
        assert data["severity"] == "warning"

    def test_severity_urgent(self, auth_client):
        data = _create_alert(auth_client, severity="urgent")
        assert data["severity"] == "urgent"

    def test_affects_plants_list_stored_and_returned(self, auth_client):
        data = _create_alert(
            auth_client,
            affects_plants=["Tomato", "Pepper", "Eggplant"],
        )
        # The field may be stored as a JSON string; parse if needed
        raw = data["affects_plants"]
        if isinstance(raw, str):
            plants = json.loads(raw)
        else:
            plants = raw
        assert plants == ["Tomato", "Pepper", "Eggplant"]

    def test_affects_plants_none_by_default(self, auth_client):
        data = _create_alert(auth_client)
        raw = data["affects_plants"]
        # Should be null or an empty/None value
        if isinstance(raw, str):
            assert raw in ("null", "[]", "")
        else:
            assert raw is None

    def test_expires_at_field_stored(self, auth_client):
        data = _create_alert(auth_client, expires_at="2026-12-31")
        assert data["expires_at"] == "2026-12-31"

    def test_missing_required_fields_returns_422(self, auth_client):
        resp = auth_client.post("/api/federation-alerts", json={
            "title": "Missing type and body",
        })
        assert resp.status_code == 422


class TestDeleteFederationAlert:
    def test_unauthenticated_returns_401(self, client):
        resp = client.delete("/api/federation-alerts/1")
        assert resp.status_code == 401

    def test_delete_removes_alert(self, auth_client):
        alert = _create_alert(auth_client)
        resp = auth_client.delete(f"/api/federation-alerts/{alert['id']}")
        assert resp.status_code == 204

        listing = auth_client.get("/api/federation-alerts").json()
        ids = [a["id"] for a in listing]
        assert alert["id"] not in ids

    def test_delete_unknown_id_returns_404(self, auth_client):
        resp = auth_client.delete("/api/federation-alerts/99999")
        assert resp.status_code == 404

    def test_double_delete_returns_404(self, auth_client):
        alert = _create_alert(auth_client)
        auth_client.delete(f"/api/federation-alerts/{alert['id']}")
        resp = auth_client.delete(f"/api/federation-alerts/{alert['id']}")
        assert resp.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════
# CO-OP BOARD
# ═══════════════════════════════════════════════════════════════════════════

class TestCoopBoard:
    def test_unauthenticated_returns_401(self, client):
        resp = client.get("/api/coop/board")
        assert resp.status_code == 401

    def test_empty_board_structure_when_no_peer_data(self, auth_client):
        resp = auth_client.get("/api/coop/board")
        assert resp.status_code == 200
        data = resp.json()
        assert "harvest_offers" in data
        assert "seed_swaps" in data
        assert "alerts" in data
        assert data["harvest_offers"] == []
        assert data["seed_swaps"] == []
        assert data["alerts"] == []

    def test_peer_harvest_offers_appear_on_board(self, auth_client):
        _seed_peer_data(
            auth_client,
            peer_id="peer-001",
            data_type="harvest_offers",
            items=[{"plant_name": "Peer Tomato", "quantity_description": "5 lbs"}],
        )
        resp = auth_client.get("/api/coop/board")
        assert resp.status_code == 200
        offers = resp.json()["harvest_offers"]
        assert len(offers) == 1
        assert offers[0]["plant_name"] == "Peer Tomato"

    def test_peer_seed_swaps_appear_on_board(self, auth_client):
        _seed_peer_data(
            auth_client,
            peer_id="peer-002",
            data_type="seed_swaps",
            items=[{"plant_name": "Peer Basil", "quantity_description": "1 packet"}],
        )
        resp = auth_client.get("/api/coop/board")
        assert resp.status_code == 200
        swaps = resp.json()["seed_swaps"]
        assert any(s["plant_name"] == "Peer Basil" for s in swaps)

    def test_peer_alerts_appear_on_board(self, auth_client):
        _seed_peer_data(
            auth_client,
            peer_id="peer-003",
            data_type="alerts",
            items=[{"title": "Peer Alert", "alert_type": "pest", "severity": "warning"}],
        )
        resp = auth_client.get("/api/coop/board")
        assert resp.status_code == 200
        alerts = resp.json()["alerts"]
        assert any(a["title"] == "Peer Alert" for a in alerts)

    def test_inactive_peer_data_excluded(self, auth_client):
        """Data from a non-active peer should NOT appear on the board."""
        from db import get_db
        with get_db() as db:
            db.execute(
                """INSERT OR IGNORE INTO federation_peers
                   (peer_id, peer_url, display_name, public_key, status)
                   VALUES (?, ?, ?, ?, 'pending')""",
                ("inactive-peer", "https://inactive.example.com", "Inactive", "fakekey"),
            )
            db.execute(
                """INSERT OR REPLACE INTO federation_peer_data
                   (peer_id, data_type, payload)
                   VALUES (?, ?, ?)""",
                ("inactive-peer", "harvest_offers",
                 json.dumps([{"plant_name": "Hidden Tomato", "quantity_description": "1 lb"}])),
            )
            db.commit()

        resp = auth_client.get("/api/coop/board")
        offers = resp.json()["harvest_offers"]
        names = [o["plant_name"] for o in offers]
        assert "Hidden Tomato" not in names

    def test_malformed_peer_payload_skipped_gracefully(self, auth_client):
        """Invalid JSON in peer data should not crash the endpoint."""
        from db import get_db
        with get_db() as db:
            db.execute(
                """INSERT OR IGNORE INTO federation_peers
                   (peer_id, peer_url, display_name, public_key, status)
                   VALUES (?, ?, ?, ?, 'active')""",
                ("peer-bad", "https://bad.example.com", "Bad Peer", "fakekey"),
            )
            db.execute(
                """INSERT OR REPLACE INTO federation_peer_data
                   (peer_id, data_type, payload)
                   VALUES (?, ?, ?)""",
                ("peer-bad", "harvest_offers", "NOT VALID JSON {{{{"),
            )
            db.commit()

        resp = auth_client.get("/api/coop/board")
        assert resp.status_code == 200
        # Board is still returned; malformed row is silently skipped
        assert "harvest_offers" in resp.json()

    def test_multiple_peers_data_aggregated(self, auth_client):
        """Offers from multiple active peers should all appear together."""
        _seed_peer_data(
            auth_client,
            peer_id="peer-agg-1",
            data_type="harvest_offers",
            items=[{"plant_name": "Cucumber A", "quantity_description": "2 lbs"}],
        )
        _seed_peer_data(
            auth_client,
            peer_id="peer-agg-2",
            data_type="harvest_offers",
            items=[{"plant_name": "Cucumber B", "quantity_description": "3 lbs"}],
        )
        resp = auth_client.get("/api/coop/board")
        names = [o["plant_name"] for o in resp.json()["harvest_offers"]]
        assert "Cucumber A" in names
        assert "Cucumber B" in names

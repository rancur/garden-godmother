"""
Meshtastic configuration and status API.
"""
from fastapi import APIRouter, HTTPException, Request
from db import get_db
from auth import require_user, require_admin
from models import MeshtasticConfigUpdate

router = APIRouter()


@router.get("/api/meshtastic/config")
def get_config(request: Request):
    require_user(request)
    with get_db() as db:
        row = db.execute("SELECT * FROM meshtastic_config WHERE id=1").fetchone()
        if not row:
            return {
                "id": 1, "enabled": False, "connection_type": "tcp",
                "hostname": None, "port": 4403, "serial_port": None,
                "channel_index": 0, "channel_name": None, "configured": False
            }
        d = dict(row)
        d["configured"] = bool(d.get("hostname") or d.get("serial_port"))
        return d


@router.patch("/api/meshtastic/config")
def update_config(body: MeshtasticConfigUpdate, request: Request):
    require_admin(request)
    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(400, "No fields to update")

    # Convert bool to int for SQLite
    if "enabled" in data:
        data["enabled"] = 1 if data["enabled"] else 0

    with get_db() as db:
        existing = db.execute("SELECT id FROM meshtastic_config WHERE id=1").fetchone()
        if existing:
            set_parts = []
            values = []
            for k, v in data.items():
                set_parts.append(f"{k} = ?")
                values.append(v)
            set_parts.append("updated_at = datetime('now')")
            db.execute(
                f"UPDATE meshtastic_config SET {', '.join(set_parts)} WHERE id=1",
                values
            )
        else:
            cols = list(data.keys()) + ["id"]
            vals = list(data.values()) + [1]
            placeholders = ", ".join("?" for _ in vals)
            db.execute(
                f"INSERT INTO meshtastic_config ({', '.join(cols)}) VALUES ({placeholders})",
                vals
            )
        db.commit()
        row = db.execute("SELECT * FROM meshtastic_config WHERE id=1").fetchone()
        d = dict(row)
        d["configured"] = bool(d.get("hostname") or d.get("serial_port"))
        return d


@router.get("/api/meshtastic/channels")
def list_channels(request: Request):
    """List channels available on the connected Meshtastic node."""
    require_user(request)
    from meshtastic_transport import get_transport
    transport = get_transport()
    if not transport or not transport.is_connected:
        raise HTTPException(503, "Meshtastic node not connected")

    try:
        channels = []
        if hasattr(transport.interface, 'localNode') and transport.interface.localNode:
            node_channels = transport.interface.localNode.channels
            for ch in node_channels:
                if ch and hasattr(ch, 'settings') and ch.settings:
                    name = ch.settings.name or f"Channel {ch.index}"
                    channels.append({
                        "index": ch.index,
                        "name": name,
                        "role": str(ch.role) if hasattr(ch, 'role') else "SECONDARY",
                    })
        return {"channels": channels}
    except Exception as e:
        raise HTTPException(500, f"Failed to list channels: {e}")


@router.post("/api/meshtastic/connect")
def test_connection(request: Request):
    """Attempt to connect to the configured Meshtastic node."""
    require_admin(request)
    with get_db() as db:
        cfg = db.execute("SELECT * FROM meshtastic_config WHERE id=1").fetchone()
        if not cfg:
            raise HTTPException(400, "No Meshtastic configuration saved yet")
        cfg = dict(cfg)

    from meshtastic_transport import init_transport, get_transport

    # Stop existing transport if running
    existing = get_transport()
    if existing:
        existing.stop()

    try:
        hostname = cfg.get("hostname")
        serial_port = cfg.get("serial_port")
        if cfg.get("connection_type") == "tcp" and hostname:
            transport = init_transport(hostname=hostname, channel_index=cfg.get("channel_index") or 0)
        elif serial_port:
            transport = init_transport(dev_path=serial_port, channel_index=cfg.get("channel_index") or 0)
        else:
            raise HTTPException(400, "No hostname or serial port configured")

        if transport.is_connected:
            return {"status": "connected", "message": "Successfully connected to Meshtastic node"}
        else:
            raise HTTPException(503, "Transport started but device not responding")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(503, f"Connection failed: {e}")


@router.get("/api/meshtastic/status")
def get_status(request: Request):
    require_user(request)
    from meshtastic_transport import get_transport
    transport = get_transport()
    return {
        "connected": bool(transport and transport.is_connected),
        "dev_path": transport.dev_path if transport else None,
        "hostname": transport.hostname if transport else None,
    }

"""
Ed25519 cryptography for Garden Co-op federation.
"""
import base64
import hashlib
import secrets
import string
import uuid
from datetime import datetime, timezone

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import (
    Encoding, PublicFormat, PrivateFormat, NoEncryption
)


def generate_keypair() -> tuple[str, str]:
    """Generate Ed25519 keypair. Returns (public_key_b64, private_key_b64)."""
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key()
    private_bytes = private_key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
    public_bytes = public_key.public_bytes(Encoding.Raw, PublicFormat.Raw)
    return base64.b64encode(public_bytes).decode(), base64.b64encode(private_bytes).decode()


def _sign_message(private_key_b64: str, message: bytes) -> str:
    private_bytes = base64.b64decode(private_key_b64)
    private_key = Ed25519PrivateKey.from_private_bytes(private_bytes)
    sig = private_key.sign(message)
    return base64.b64encode(sig).decode()


def _verify_message(public_key_b64: str, message: bytes, signature_b64: str) -> bool:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    from cryptography.exceptions import InvalidSignature
    try:
        public_bytes = base64.b64decode(public_key_b64)
        public_key = Ed25519PublicKey.from_public_bytes(public_bytes)
        sig = base64.b64decode(signature_b64)
        public_key.verify(sig, message)
        return True
    except (InvalidSignature, Exception):
        return False


def _build_message(method: str, path: str, timestamp: str, body: bytes) -> bytes:
    body_hash = hashlib.sha256(body).hexdigest()
    return f"{method.upper()}\n{path}\n{timestamp}\n{body_hash}".encode()


def sign_request(private_key_b64: str, method: str, path: str, timestamp: str, body: bytes = b"") -> str:
    """Sign a federation request. Returns base64 signature."""
    message = _build_message(method, path, timestamp, body)
    return _sign_message(private_key_b64, message)


def verify_request(public_key_b64: str, method: str, path: str, timestamp: str, body: bytes, signature_b64: str) -> bool:
    """Verify a federation request signature."""
    message = _build_message(method, path, timestamp, body)
    return _verify_message(public_key_b64, message, signature_b64)


def verify_timestamp(timestamp: str, max_skew_seconds: int = 300) -> bool:
    """Verify timestamp is within ±max_skew_seconds of now. Timestamp is ISO8601 UTC."""
    try:
        ts = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        diff = abs((now - ts).total_seconds())
        return diff <= max_skew_seconds
    except Exception:
        return False


def generate_instance_id() -> str:
    """Generate a UUID v4 for this instance."""
    return str(uuid.uuid4())


def generate_invite_code() -> str:
    """Generate an 8-char alphanumeric invite code (e.g. 'X7K2P9MQ')."""
    alphabet = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(8))


def get_key_fingerprint(public_key_b64: str) -> str:
    """Return first 16 chars of SHA256 hex fingerprint of public key."""
    raw = base64.b64decode(public_key_b64)
    return hashlib.sha256(raw).hexdigest()[:16]

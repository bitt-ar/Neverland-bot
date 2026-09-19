import base64
import hashlib
import os
from pathlib import Path
from typing import Optional, Tuple
from cryptography.fernet import Fernet
import logging

from core import config

logger = logging.getLogger(__name__)


def _get_fernet_key() -> bytes:
    """Derive a stable 32-byte urlsafe base64-encoded key from RADIO_ENCRYPTION_KEY or legacy secrets."""
    secret = config.RADIO_ENCRYPTION_KEY
    if secret:
        raw = secret.strip()
        try:
            decoded = base64.urlsafe_b64decode(raw)
            if len(decoded) == 32:
                return raw.encode("utf-8")
        except Exception:
            pass
        digest = hashlib.sha256(raw.encode("utf-8")).digest()
        return base64.urlsafe_b64encode(digest)

    # Backward-compatibility fallback for existing deployments
    fallback = config.CONTROL_PLANE_SECRET or config.TOKEN
    if fallback:
        logger.warning(
            "RADIO_ENCRYPTION_KEY is not set. Falling back to CONTROL_PLANE_SECRET. "
            "Please configure a dedicated RADIO_ENCRYPTION_KEY in your .env file."
        )
        digest = hashlib.sha256(fallback.encode("utf-8")).digest()
        return base64.urlsafe_b64encode(digest)

    if os.getenv("ENVIRONMENT") == "production" or os.getenv("AUTH_ENABLED", "false").lower() == "true":
        raise RuntimeError("RADIO_ENCRYPTION_KEY or CONTROL_PLANE_SECRET must be configured in production.")

    # Development-only temporary key
    logger.warning("No radio encryption secret configured; using temporary dev key.")
    digest = hashlib.sha256(b"neverland-dev-insecure-key-do-not-use-in-prod").digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_token(raw_token: str) -> str:
    """Encrypt a sensitive Discord bot token for at-rest storage."""
    if not raw_token:
        return ""
    key = _get_fernet_key()
    f = Fernet(key)
    encrypted = f.encrypt(raw_token.strip().encode("utf-8"))
    return encrypted.decode("utf-8")


def decrypt_token(encrypted_token: str) -> str:
    """Decrypt an at-rest encrypted Discord bot token, supporting key migration."""
    if not encrypted_token:
        return ""
    try:
        key = _get_fernet_key()
        f = Fernet(key)
        return f.decrypt(encrypted_token.encode("utf-8")).decode("utf-8")
    except Exception:
        # If RADIO_ENCRYPTION_KEY was recently configured, attempt fallback to legacy key
        legacy_secret = config.CONTROL_PLANE_SECRET or config.TOKEN
        if legacy_secret and config.RADIO_ENCRYPTION_KEY:
            try:
                legacy_key = base64.urlsafe_b64encode(hashlib.sha256(legacy_secret.encode("utf-8")).digest())
                f_legacy = Fernet(legacy_key)
                decrypted = f_legacy.decrypt(encrypted_token.encode("utf-8")).decode("utf-8")
                logger.info("Successfully decrypted token using legacy migration key.")
                return decrypted
            except Exception:
                pass
        logger.error("Failed to decrypt bot token with configured keys.")
        return ""


def mask_token(token: str) -> str:
    """Mask a token for safe display in UI/API responses."""
    if not token:
        return ""
    cleaned = token.strip()
    if len(cleaned) <= 12:
        return "••••••••"
    return f"{cleaned[:4]}••••••••••••••••{cleaned[-4:]}"


def validate_audio_magic_bytes(file_path: Path) -> Tuple[bool, str]:
    """Inspect magic bytes of an uploaded file to ensure it is valid audio.
    
    Supports:
    - MP3 (ID3v2 tags or MPEG-1/2 frame sync 0xFF 0xFB / 0xFA / 0xF3 / 0xF2)
    - OGG (OggS)
    - WAV (RIFF....WAVE)
    - FLAC (fLaC)
    """
    if not file_path.is_file():
        return False, "File does not exist"

    file_size = file_path.stat().st_size
    if file_size < 12:
        return False, "File is too small to be a valid audio file"

    try:
        with open(file_path, "rb") as f:
            header = f.read(64)

        # 1. MP3 with ID3 header: 'ID3' (0x49 0x44 0x33)
        if header.startswith(b"ID3"):
            return True, "audio/mpeg"

        # 2. Raw MP3 sync frame: starts with 0xFF followed by 0xFB, 0xF3, 0xF2, 0xFA
        if len(header) >= 2 and header[0] == 0xFF and (header[1] & 0xE0) == 0xE0:
            return True, "audio/mpeg"

        # 3. Ogg container: 'OggS' (0x4F 0x67 0x67 0x53)
        if header.startswith(b"OggS"):
            return True, "audio/ogg"

        # 4. WAV container: 'RIFF'....'WAVE'
        if header.startswith(b"RIFF") and len(header) >= 12 and header[8:12] == b"WAVE":
            return True, "audio/wav"

        # 5. FLAC container: 'fLaC' (0x66 0x4C 0x61 0x43)
        if header.startswith(b"fLaC"):
            return True, "audio/flac"

        return False, "Unsupported audio format. Supported formats: MP3, OGG, WAV, FLAC"
    except Exception as e:
        logger.error("Error reading audio magic bytes for %s: %s", file_path, e)
        return False, f"Failed to validate file: {str(e)}"

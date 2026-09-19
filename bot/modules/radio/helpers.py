import asyncio
import json
import logging
from pathlib import Path
from typing import Optional

from core import config

logger = logging.getLogger(__name__)


import os
import re

_SAFE_ID_RE = re.compile(r"^\d+$")
_SAFE_PID_RE = re.compile(r"^pl_[0-9a-f]{8}$")


def get_radio_storage_dir(guild_id: str | int, playlist_id: Optional[str] = None) -> Path:
    """Return the filesystem directory for radio audio files in a guild/playlist with path traversal guards."""
    gid_str = str(guild_id).strip()
    if not _SAFE_ID_RE.match(gid_str):
        raise ValueError(f"Invalid guild ID: {guild_id}")

    base = (config.DATA_DIR / "guilds" / gid_str / "radio").resolve()
    if playlist_id:
        pid_str = str(playlist_id).strip()
        if not _SAFE_PID_RE.match(pid_str):
            raise ValueError(f"Invalid playlist ID format: {playlist_id}")
        target = (base / pid_str).resolve()
        if not str(target).startswith(str(base) + os.sep) and target != base:
            raise ValueError("Path traversal attempt detected in playlist storage path")
    else:
        target = base

    target.mkdir(parents=True, exist_ok=True)
    return target


async def extract_audio_metadata(file_path: Path) -> dict:
    """Extract audio duration and bitrate using ffprobe asynchronously."""
    default_meta = {"duration": 0.0, "format": "unknown", "bitrate": 0}
    if not file_path.is_file():
        return default_meta

    cmd = [
        "ffprobe",
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        str(file_path),
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        if proc.returncode != 0:
            return default_meta

        data = json.loads(stdout.decode("utf-8", errors="ignore"))
        fmt = data.get("format", {})
        duration = float(fmt.get("duration", 0.0))
        bitrate = int(fmt.get("bit_rate", 0))
        format_name = fmt.get("format_name", "unknown")

        return {
            "duration": round(duration, 2),
            "bitrate": bitrate,
            "format": format_name,
        }
    except Exception as e:
        logger.warning("Failed to extract audio metadata for %s: %s", file_path, e)
        return default_meta

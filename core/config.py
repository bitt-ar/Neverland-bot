import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
COOKIES_FILE = BASE_DIR / "cookies.txt"
ASSETS_DIR = BASE_DIR / "assets"
DATA_DIR = BASE_DIR / "data"

TOKEN = os.getenv("TOKEN")
PREFIX = os.getenv("PREFIX") or "!"
MONGODB_URI = os.getenv("MONGODB_URI")
MONGODB_DB = os.getenv("MONGODB_DB", "neverland")

ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()

CONTROL_PLANE_HOST = os.getenv("CONTROL_PLANE_HOST", "127.0.0.1")
try:
    CONTROL_PLANE_PORT = int(os.getenv("CONTROL_PLANE_PORT", "8800"))
except ValueError:
    CONTROL_PLANE_PORT = 8800
CONTROL_PLANE_SECRET = os.getenv("CONTROL_PLANE_SECRET") or None

INSECURE_SECRET_PLACEHOLDERS = {
    "change_me_to_a_long_random_string",
    "replace_with_a_secure_random_key",
    "your_control_plane_secret_here",
    "your_secret_here",
    "secret",
    "password",
    "12345678",
}

if CONTROL_PLANE_SECRET and CONTROL_PLANE_SECRET.strip().lower() in INSECURE_SECRET_PLACEHOLDERS:
    if ENVIRONMENT == "production" or os.getenv("AUTH_ENABLED", "false").lower() == "true":
        raise RuntimeError(
            "CRITICAL SECURITY CONFIGURATION ERROR: CONTROL_PLANE_SECRET cannot use an insecure default placeholder! "
            "Please generate a cryptographically secure random secret."
        )

if ENVIRONMENT == "production":
    if not CONTROL_PLANE_SECRET or len(CONTROL_PLANE_SECRET.strip()) < 32:
        raise RuntimeError(
            "CRITICAL SECURITY CONFIGURATION ERROR: In production, CONTROL_PLANE_SECRET must be at least 32 characters."
        )

RADIO_ENCRYPTION_KEY = os.getenv("RADIO_ENCRYPTION_KEY") or None

try:
    RADIO_MAX_PLAYLIST_STORAGE_MB = max(10, int(os.getenv("RADIO_MAX_PLAYLIST_STORAGE_MB", "50")))
except ValueError:
    RADIO_MAX_PLAYLIST_STORAGE_MB = 50

try:
    RADIO_MAX_PLAYLISTS_PER_GUILD = max(1, int(os.getenv("RADIO_MAX_PLAYLISTS_PER_GUILD", "6")))
except ValueError:
    RADIO_MAX_PLAYLISTS_PER_GUILD = 6

try:
    RADIO_MAX_UPLOAD_SIZE_MB = max(1, int(os.getenv("RADIO_MAX_UPLOAD_SIZE_MB", "25")))
except ValueError:
    RADIO_MAX_UPLOAD_SIZE_MB = 25

try:
    RADIO_BOTS_COUNT = min(3, max(1, int(os.getenv("RADIO_BOTS_COUNT", "3"))))
except ValueError:
    RADIO_BOTS_COUNT = 3

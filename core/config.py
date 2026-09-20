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

CONTROL_PLANE_HOST = os.getenv("CONTROL_PLANE_HOST", "0.0.0.0")
try:
    CONTROL_PLANE_PORT = int(os.getenv("CONTROL_PLANE_PORT", "8800"))
except ValueError:
    CONTROL_PLANE_PORT = 8800
CONTROL_PLANE_SECRET = os.getenv("CONTROL_PLANE_SECRET") or None

RADIO_ENCRYPTION_KEY = os.getenv("RADIO_ENCRYPTION_KEY") or None

try:
    RADIO_MAX_PLAYLIST_STORAGE_MB = max(1, int(os.getenv("RADIO_MAX_PLAYLIST_STORAGE_MB", "100")))
except ValueError:
    RADIO_MAX_PLAYLIST_STORAGE_MB = 100

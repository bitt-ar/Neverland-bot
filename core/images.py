from io import BytesIO
from pathlib import Path
import PIL
from PIL import Image, ImageChops, ImageDraw

from core import config

DEFAULT_BACKGROUND_PATH = config.BASE_DIR / "assets" / "back" / "1.png"
MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024  # 8 MB
ALLOWED_FORMATS = {"PNG", "JPEG", "JPG", "WEBP"}


def circle(pfp, size=(215, 215)):
    pfp = pfp.resize(size, PIL.Image.Resampling.LANCZOS).convert("RGBA")

    bigsize = (pfp.size[0] * 3, pfp.size[1] * 3)
    mask = Image.new('L', bigsize, 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0) + bigsize, fill=255)
    mask = mask.resize(pfp.size, PIL.Image.Resampling.LANCZOS)
    mask = ImageChops.darker(mask, pfp.split()[-1])
    pfp.putalpha(mask)
    return pfp


def validate_and_save_background(image_bytes: bytes, guild_id: int, user_id: int) -> str:
    """Validate image payload (magic bytes, size, dimensions, format) and safely save it per guild.

    Returns the relative posix path to the saved background.
    Raises ValueError on security or format validation failure.
    """
    if not image_bytes:
        raise ValueError("The provided image file is empty.")

    if len(image_bytes) > MAX_IMAGE_SIZE_BYTES:
        raise ValueError("Image file size exceeds the maximum allowed limit of 8 MB.")

    try:
        raw_image = Image.open(BytesIO(image_bytes))
        raw_image.verify()  # Verifies file integrity and header magic bytes
    except Exception:
        raise ValueError("Invalid image file format or corrupted file content.")

    # Re-open for actual processing since verify() closes/invalidates the stream
    try:
        image = Image.open(BytesIO(image_bytes))
        image_format = (image.format or "").upper()
        if image_format not in ALLOWED_FORMATS:
            raise ValueError(f"Unsupported image format '{image_format}'. Allowed formats: PNG, JPEG, WEBP.")

        width, height = image.size
        if width < 100 or height < 100:
            raise ValueError("Image dimensions are too small (minimum 100x100 pixels).")
        if width > 4096 or height > 4096:
            raise ValueError("Image dimensions are too large (maximum 4096x4096 pixels).")

        # Sanitize and convert to RGBA
        sanitized = image.convert("RGBA")

        # Save to per-guild path: data/guilds/{guild_id}/backgrounds/{user_id}.png
        guild_bg_dir = config.DATA_DIR / "guilds" / str(guild_id) / "backgrounds"
        guild_bg_dir.mkdir(parents=True, exist_ok=True)
        dest_file = guild_bg_dir / f"{user_id}.png"

        # Save to disk
        sanitized.save(dest_file, format="PNG")

        try:
            rel_path = dest_file.relative_to(config.BASE_DIR).as_posix()
        except ValueError:
            rel_path = dest_file.as_posix()
        return rel_path
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f"Failed to process and save image: {e}")


def load_background_image(background_ref: str | None) -> Image.Image:
    """Safely load background image. Prioritizes local file, falls back to bundled default."""
    if background_ref:
        # Check if local path
        local_path = config.BASE_DIR / background_ref if not Path(background_ref).is_absolute() else Path(background_ref)
        if local_path.exists() and local_path.is_file():
            try:
                img = Image.open(local_path)
                return img.convert("RGBA")
            except Exception:
                pass

        # Fallback for legacy external URLs if any
        if background_ref.startswith("http://") or background_ref.startswith("https://"):
            try:
                import requests
                resp = requests.get(background_ref, timeout=5)
                if resp.status_code == 200:
                    img = Image.open(BytesIO(resp.content))
                    return img.convert("RGBA")
            except Exception:
                pass

    # Default fallback to bundled local background
    if DEFAULT_BACKGROUND_PATH.exists():
        return Image.open(DEFAULT_BACKGROUND_PATH).convert("RGBA")

    # Ultimate fallback: solid dark background
    return Image.new("RGBA", (1000, 512), (30, 30, 35, 255))


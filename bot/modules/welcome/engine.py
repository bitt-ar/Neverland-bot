from io import BytesIO
import logging
import random

import discord
from discord.ext import commands
from PIL import Image, ImageDraw, ImageFont

from core import config, database
from core.images import circle, fetch_image_bytes

logger = logging.getLogger(__name__)

WELCOME_DIR = config.BASE_DIR / "assets" / "welcome"
FONTS_DIR = config.BASE_DIR / "assets" / "fonts"
FONT_BOLD_PATH = str(FONTS_DIR / "BOD_B.TTF")
FONT_REGULAR_PATH = str(FONTS_DIR / "BOD_R.TTF")
FONT_ARABIC_PATH = str(FONTS_DIR / "tahoma.ttf")


def _is_arabic(text: str) -> bool:
    """Check if text contains Arabic characters including presentation forms."""
    return any(
        ("\u0600" <= c <= "\u06ff")
        or ("\u0750" <= c <= "\u077f")
        or ("\u08a0" <= c <= "\u08ff")
        or ("\ufb50" <= c <= "\ufdff")
        or ("\ufe70" <= c <= "\ufeff")
        for c in text
    )


def draw_tracked_text(
    draw: ImageDraw.ImageDraw,
    pos: tuple[int, int],
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int],
    tracking: int = 0,
    align: str = "center",
) -> int:
    """Draw text with letter tracking (kerning). For Arabic, letters are cursive so tracking is disabled.
    Returns total drawn width.
    """
    if not text:
        return 0
    is_ar = _is_arabic(text)
    if is_ar:
        try:
            import arabic_reshaper
            from bidi.algorithm import get_display

            text = get_display(arabic_reshaper.reshape(text))
        except Exception:
            pass
        tracking = 0

    total_w = 0
    char_widths = []
    for char in text:
        if char == " ":
            bbox = font.getbbox("M")
            space_w = int((bbox[2] - bbox[0]) * 0.45)
            char_widths.append((char, space_w))
            total_w += space_w + tracking
        else:
            bbox = font.getbbox(char)
            w = (bbox[2] - bbox[0]) if bbox else 0
            char_widths.append((char, w))
            total_w += w + tracking
    if char_widths and tracking > 0:
        total_w -= tracking

    start_x, y = pos
    if align == "center":
        curr_x = start_x - total_w // 2
    elif align == "right":
        curr_x = start_x - total_w
    else:
        curr_x = start_x

    for char, w in char_widths:
        if char != " ":
            draw.text((curr_x, y), char, font=font, fill=fill)
        curr_x += w + tracking
    return total_w


def fit_font_tracked(
    text: str,
    max_width: int,
    initial_size: int,
    font_file: str,
    tracking: int = 0,
    is_arabic: bool = False,
):
    """Dynamically adjust font size and tracking so text fits nicely within max_width."""
    track = 0 if is_arabic else tracking
    size = initial_size
    min_size = max(int(initial_size * 0.4), 28)
    while size >= min_size:
        try:
            f = ImageFont.truetype(font_file, size)
            w = 0
            for c in text:
                if c == " ":
                    bbox = f.getbbox("M")
                    w += int((bbox[2] - bbox[0]) * 0.45) + track
                else:
                    bbox = f.getbbox(c)
                    w += ((bbox[2] - bbox[0]) if bbox else 0) + track
            if w - track <= max_width:
                return f, track
        except Exception:
            break
        size -= 4
        if track > 2:
            track = max(track - 1, 2)
    return ImageFont.truetype(font_file, min_size), track


class WelcomeEngineCog(commands.Cog):
    def __init__(self, bot, module):
        self.bot = bot
        self.module = module

    @property
    def registry(self):
        return getattr(self.bot, "modules_registry", None)

    async def _assign_join_roles(self, member):
        """Grant roles on join. Uses the configured member/bot role lists and
        falls back to the legacy name-based roles when nothing is configured."""
        try:
            cfg = {}
            if self.registry is not None:
                cfg = await self.registry.get_config(member.guild.id, "welcome")

            if not cfg.get("auto_role_enabled", True):
                return

            configured = cfg.get("bot_role_ids" if member.bot else "member_role_ids") or []
            roles = []
            for role_id in configured:
                try:
                    role = member.guild.get_role(int(role_id))
                except (TypeError, ValueError):
                    role = None
                if role is not None:
                    roles.append(role)

            if not roles:
                legacy_name = "BOT🤖" if member.bot else "Active member"
                legacy = discord.utils.get(member.guild.roles, name=legacy_name)
                roles = [legacy] if legacy else []

            for role in roles:
                try:
                    await member.add_roles(role, reason="Auto role on join")
                except discord.Forbidden:
                    logger.warning(
                        "Missing permissions to assign join role %s (role hierarchy?)", role.name
                    )
                except Exception as e:
                    logger.warning("Error assigning join role %s to %s: %s", role.name, member, e)
        except Exception as e:
            logger.warning("Error in join role assignment for %s: %s", member, e)

    @commands.Cog.listener()
    async def on_member_join(self, member):
        # Auto-role and welcome messages only run when the module is enabled for
        # this guild — previously join roles were assigned even when disabled.
        if not self.registry or not await self.registry.is_enabled(member.guild.id, "welcome"):
            return

        await self._assign_join_roles(member)

        config_data = await self.registry.get_config(member.guild.id, "welcome")
        channel_id = config_data.get("channel_id")
        if not channel_id:
            settings = await database.get_settings(member.guild.id)
            channel_id = settings.get("welcome_channel_id")

        if not channel_id:
            return

        channel = member.guild.get_channel(int(channel_id)) or self.bot.get_channel(
            int(channel_id)
        )
        if channel is None:
            return

        try:
            await channel.send(f"<@!{member.id}> Welcome")
        except Exception as e:
            logger.warning("Failed to send welcome text message: %s", e)
            return

        # Skip image if include_image is False
        if not config_data.get("include_image", True):
            return

        try:
            name_raw = str(member.display_name)
            server_raw = str(member.guild.name)
            joined_dt = getattr(member, "joined_at", None)
            join_date_raw = joined_dt.strftime("%d %B %Y") if joined_dt else "Recently"

            # Available images (1.png to 10.png)
            images = [f"{i}.png" for i in range(1, 11)]
            image = random.choice(images)

            # 1. Base canvas (soft sage linen)
            canvas = Image.new("RGBA", (2700, 1350), (242, 244, 238, 255))

            # 2. Right background illustration (908x1350)
            back_path = WELCOME_DIR / image
            if back_path.exists():
                back = Image.open(back_path).convert("RGBA")
                if back.size != (908, 1350):
                    back = back.resize((908, 1350), Image.Resampling.LANCZOS)
                canvas.paste(back, (1792, 0))

            # 3. Base template overlay (with deep calm emerald overlay and design waves)
            base = Image.open(WELCOME_DIR / "base.png").convert("RGBA")
            canvas.paste(base, (0, 0), base)

            # 4. Avatar (505x505 circular) with robust fallback cascade
            pfp_bytes = None
            # 4a. Primary: discord.py native Asset.read() (authenticated & chunk-safe)
            try:
                if hasattr(member, "display_avatar") and hasattr(member.display_avatar, "read"):
                    pfp_bytes = await member.display_avatar.read()
            except Exception as e:
                logger.debug("member.display_avatar.read() failed: %s", e)

            # 4b. Secondary: fetch_image_bytes with full aiohttp stream read
            if not pfp_bytes:
                try:
                    pfp_bytes = await fetch_image_bytes(str(member.display_avatar.url))
                except Exception as e:
                    logger.debug("fetch_image_bytes for avatar failed: %s", e)

            # 4c. Tertiary: default avatar read
            if not pfp_bytes:
                try:
                    if hasattr(member, "default_avatar") and hasattr(member.default_avatar, "read"):
                        pfp_bytes = await member.default_avatar.read()
                except Exception as e:
                    logger.debug("default_avatar.read() failed: %s", e)

            if pfp_bytes:
                try:
                    pfp = Image.open(BytesIO(pfp_bytes)).convert("RGBA")
                    pfp = circle(pfp, (505, 505))
                    canvas.paste(pfp, (2006, 402), pfp)
                except Exception as e:
                    logger.warning("Could not process avatar image: %s", e)
            else:
                # 4d. Fallback: elegant monogram initial circle (never leave an empty white disc)
                try:
                    fallback_pfp = Image.new("RGBA", (505, 505), (32, 68, 54, 255))
                    fallback_draw = ImageDraw.Draw(fallback_pfp)
                    initial = name_raw[0].upper() if name_raw and not _is_arabic(name_raw) else "★"
                    initial_font = ImageFont.truetype(FONT_BOLD_PATH, 220)
                    ibox = initial_font.getbbox(initial)
                    iw = ibox[2] - ibox[0]
                    ih = ibox[3] - ibox[1]
                    fallback_draw.text(
                        (252 - iw // 2, 235 - ih // 2),
                        initial,
                        font=initial_font,
                        fill=(242, 244, 238),
                    )
                    fallback_pfp = circle(fallback_pfp, (505, 505))
                    canvas.paste(fallback_pfp, (2006, 402), fallback_pfp)
                except Exception:
                    pass

            # 5. Draw luxury editorial typography
            draw = ImageDraw.Draw(canvas)
            cx = 950
            max_w = 1350

            # 5a. Member Name
            is_ar_name = _is_arabic(name_raw)
            font_name_file = FONT_ARABIC_PATH if is_ar_name else FONT_BOLD_PATH
            name_text = name_raw if is_ar_name else name_raw.upper()
            f_name, tr_name = fit_font_tracked(
                name_text, max_w, 150, font_name_file, tracking=10, is_arabic=is_ar_name
            )

            # 5b. Welcome text
            is_welcome_ar = is_ar_name
            font_welc_file = FONT_ARABIC_PATH if is_welcome_ar else FONT_REGULAR_PATH
            welc_text = "أهلاً وسهلاً" if is_welcome_ar else "W  E  L  C  O  M  E"
            f_welc = ImageFont.truetype(font_welc_file, 78)
            tr_welc = 0 if is_welcome_ar else 24

            # 5c. Server Name
            is_ar_serv = _is_arabic(server_raw)
            font_serv_file = FONT_ARABIC_PATH if is_ar_serv else FONT_BOLD_PATH
            if is_ar_serv:
                serv_text = f"في {server_raw}"
            else:
                serv_text = f"TO {server_raw.upper()}"
            f_serv, tr_serv = fit_font_tracked(
                serv_text, max_w, 125, font_serv_file, tracking=6, is_arabic=is_ar_serv
            )

            # 5d. Joined Date
            is_ar_date = is_ar_name
            font_date_file = FONT_ARABIC_PATH if is_ar_date else FONT_REGULAR_PATH
            if is_ar_date:
                date_text = f"انضم في · {join_date_raw}"
            else:
                date_text = f"JOINED · {join_date_raw.upper()}"
            f_date, tr_date = fit_font_tracked(
                date_text, max_w, 44, font_date_file, tracking=12, is_arabic=is_ar_date
            )

            # Draw lines
            color_dark = (20, 42, 32)
            color_emerald = (45, 88, 66)
            color_date = (235, 240, 230)

            # Name
            draw_tracked_text(draw, (cx, 360), name_text, f_name, color_dark, tracking=tr_name, align="center")
            # Subtle accent divider
            draw.line([(cx - 180, 520), (cx + 180, 520)], fill=(160, 180, 160), width=2)
            # Welcome
            draw_tracked_text(draw, (cx, 545), welc_text, f_welc, color_emerald, tracking=tr_welc, align="center")
            # Server
            draw_tracked_text(draw, (cx, 700), serv_text, f_serv, color_dark, tracking=tr_serv, align="center")
            # Joined Date (on wave)
            draw_tracked_text(draw, (cx, 1255), date_text, f_date, color_date, tracking=tr_date, align="center")

            with BytesIO() as a:
                canvas.save(a, "PNG")
                a.seek(0)
                await channel.send(file=discord.File(a, "welcome.png"))
        except Exception as e:
            logger.warning("Error generating/sending welcome image for %s: %s", member, e)

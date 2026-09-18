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
FONT_PATH = str(config.BASE_DIR / "assets" / "fonts" / "Bodo Amat.ttf")


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
            name = str(member.display_name)
            name = f"{name[:9]}.." if len(name) > 9 else name
            images = ["1.png", "2.png", "3.png", "4.png", "5.png"]
            image = random.choice(images)
            base = Image.open(WELCOME_DIR / "base.png").convert("RGBA")
            back = Image.open(WELCOME_DIR / image).convert("RGBA")
            pfp_bytes = await fetch_image_bytes(member.display_avatar.url)
            if pfp_bytes is None:
                raise ValueError("avatar download failed")
            pfp = Image.open(BytesIO(pfp_bytes)).convert("RGBA")
            pfp = pfp.resize((256, 256))
            pfp = circle(pfp, (206, 206))
            draw = ImageDraw.Draw(base)
            font = ImageFont.truetype(FONT_PATH, 50)
            draw.text((18, 120), name, font=font, fill=(255, 255, 255))
            base.paste(pfp, (321, 84), pfp)
            back.paste(base, (0, 0), base)
            with BytesIO() as a:
                back.save(a, "PNG")
                a.seek(0)
                await channel.send(file=discord.File(a, "profile.png"))
        except Exception as e:
            logger.warning("Error generating/sending welcome image for %s: %s", member, e)

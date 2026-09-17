from io import BytesIO
import logging

import discord
import requests
from discord import app_commands
from discord.ext import commands
from PIL import Image, ImageDraw, ImageFont

from core import config, database
from core.images import circle

logger = logging.getLogger(__name__)

DEFAULT_BACKGROUND = "https://n9.cl/pnc5h"
FONT_PATH = str(config.BASE_DIR / "assets" / "fonts" / "Bodo Amat.ttf")


def _new_bar(
    x,
    y,
    width,
    height,
    progress,
    fg=(211, 211, 211),
    bg=(129, 66, 97, 0),
    fg2=(15, 15, 15, 0),
):
    img = Image.new("RGBA", (x + width + height, y + height), bg)
    draw = ImageDraw.Draw(img)

    draw.rectangle(
        (x + (height / 2), y, x + width + (height / 2), y + height), fill=fg2, outline=fg2
    )
    draw.ellipse((x + width, y, x + height + width, y + height), fill=fg2, outline=fg2)
    draw.ellipse((x, y, x + height, y + height), fill=fg2, outline=fg2)

    fill_width = int(width * progress)

    draw.rectangle(
        (x + (height / 2), y, x + fill_width + (height / 2), y + height), fill=fg, outline=fg
    )
    draw.ellipse((x + fill_width, y, x + height + fill_width, y + height), fill=fg, outline=fg)
    draw.ellipse((x, y, x + height, y + height), fill=fg, outline=fg)

    return img


def render_rank_card(
    xp,
    xp_last_level,
    xp_next_level,
    background_url,
    pfp_url,
    disname,
    joined,
    rank,
    level,
    theme,
):
    xp_next_level = xp_next_level - xp_last_level
    progress = (xp - xp_last_level) / xp_next_level
    xp = int(xp - xp_last_level)

    themes_dir = config.BASE_DIR / "assets" / "themes"
    if theme == "dark":
        bar_color = (255, 255, 255)
        base = Image.open(themes_dir / "Dark.png").convert("RGBA")
    elif theme == "orange":
        bar_color = (242, 142, 38)
        base = Image.open(themes_dir / "Orange.png").convert("RGBA")
    else:
        bar_color = (153, 41, 234)
        base = Image.open(themes_dir / "purple.png").convert("RGBA")

    progress_bar = _new_bar(439, 420, 420, 31, progress, fg=bar_color)
    response = requests.get(background_url, timeout=10)
    background = Image.open(BytesIO(response.content))
    background = background.resize((1000, 512), Image.LANCZOS).convert("RGBA")
    response = requests.get(pfp_url, timeout=10)
    pfp = Image.open(BytesIO(response.content))
    pfp = circle(pfp, (213, 213))
    xp = f"{xp}/{xp_next_level}"
    disname = f"{disname[:7]}.." if len(disname) > 7 else disname
    disname = disname.upper()
    level_next = f"LEVEL {level + 1}"
    level = f"LEVEL {level}"
    joined = f"Server Join Date \n {joined}"
    rank = f"#{rank}"
    font = ImageFont.truetype(FONT_PATH, 50)
    font2 = ImageFont.truetype(FONT_PATH, 35)
    font3 = ImageFont.truetype(FONT_PATH, 20)
    font4 = ImageFont.truetype(FONT_PATH, 70)
    font5 = ImageFont.truetype(FONT_PATH, 80)
    draw = ImageDraw.Draw(base)
    draw.text((240, 109), disname, font=font, fill=(255, 255, 255))
    draw.text((36, 300), joined, font=font2, fill=(255, 255, 255))
    draw.text((36, 407), level, font=font4, fill=(255, 255, 255))
    draw.text((835, 440), level_next, font=font3, fill=(255, 255, 255))
    draw.text((504, 440), xp, font=font3, fill=(255, 255, 255))
    draw.text((807, 38), rank, font=font5, fill=(255, 255, 255))
    base.paste(pfp, (13, 37), pfp)
    base.paste(progress_bar, (50, 50), progress_bar)
    background.paste(base, (0, 0), base)
    image_io = BytesIO()
    background.save(image_io, format="PNG")
    image_io.seek(0)
    return image_io


class LevelingCommandsCog(commands.Cog):
    def __init__(self, bot, module):
        self.bot = bot
        self.module = module

    @property
    def registry(self):
        return getattr(self.bot, "modules_registry", None)

    async def _check_enabled(self, interaction: discord.Interaction) -> bool:
        if not self.registry or not await self.registry.is_enabled(
            interaction.guild_id, "leveling"
        ):
            await interaction.response.send_message("This module is disabled.", ephemeral=True)
            return False
        return True

    levelroles = app_commands.Group(
        name="levelroles",
        description="Level role rewards (admin)",
        default_permissions=discord.Permissions(administrator=True),
        guild_only=True,
    )

    @levelroles.command(name="add", description="Add a role reward for reaching a level")
    async def levelroles_add(
        self,
        interaction: discord.Interaction,
        level: app_commands.Range[int, 1, 999],
        role: discord.Role,
    ):
        if not await self._check_enabled(interaction):
            return
        if role.is_default() or role.managed:
            await interaction.response.send_message(
                "That role can't be used as a reward.", ephemeral=True
            )
            return

        config_data = await self.registry.get_config(interaction.guild_id, "leveling")
        rewards = dict(config_data.get("rewards", {}))
        rewards[str(level)] = role.id
        config_data["rewards"] = rewards
        await self.registry.set_config(interaction.guild_id, "leveling", config_data)

        # Sync legacy settings for rollback safety
        try:
            settings = await database.get_settings(interaction.guild_id)
            lr = settings.get("level_roles", {})
            lr[str(level)] = role.id
            await database.update_settings(interaction.guild_id, level_roles=lr)
        except Exception as e:
            logger.warning("Error syncing legacy level_roles: %s", e)

        await interaction.response.send_message(
            f"🏅 Level **{level}** reward set to {role.mention}", ephemeral=True
        )

    @levelroles.command(name="remove", description="Remove a level reward")
    async def levelroles_remove(
        self, interaction: discord.Interaction, level: app_commands.Range[int, 1, 999]
    ):
        if not await self._check_enabled(interaction):
            return

        config_data = await self.registry.get_config(interaction.guild_id, "leveling")
        rewards = dict(config_data.get("rewards", {}))
        if str(level) not in rewards:
            await interaction.response.send_message(
                f"No reward set for level {level}.", ephemeral=True
            )
            return
        del rewards[str(level)]
        config_data["rewards"] = rewards
        await self.registry.set_config(interaction.guild_id, "leveling", config_data)

        # Sync legacy settings for rollback safety
        try:
            settings = await database.get_settings(interaction.guild_id)
            lr = settings.get("level_roles", {})
            if str(level) in lr:
                del lr[str(level)]
                await database.update_settings(interaction.guild_id, level_roles=lr)
        except Exception as e:
            logger.warning("Error syncing legacy level_roles: %s", e)

        await interaction.response.send_message(
            f"Removed reward for level **{level}**.", ephemeral=True
        )

    @levelroles.command(name="list", description="List level rewards")
    async def levelroles_list(self, interaction: discord.Interaction):
        if not await self._check_enabled(interaction):
            return

        config_data = await self.registry.get_config(interaction.guild_id, "leveling")
        rewards = config_data.get("rewards", {})
        if not rewards:
            await interaction.response.send_message(
                "No level rewards set. Use `/levelroles add`.", ephemeral=True
            )
            return
        lines = []
        for lvl in sorted(rewards, key=int):
            role = interaction.guild.get_role(rewards[lvl])
            lines.append(f"Level **{lvl}** → {role.mention if role else '*(deleted role)*'}")
        await interaction.response.send_message("\n".join(lines), ephemeral=True)

    @app_commands.command(name="rank", description="Show your rank card in this server")
    async def rank(self, interaction: discord.Interaction, member: discord.Member = None):
        if not await self._check_enabled(interaction):
            return
        member = member or interaction.user
        if member.bot:
            await interaction.response.send_message("You can't rank bots.", ephemeral=True)
            return
        await interaction.response.defer()
        doc = await database.get_level(interaction.guild_id, member.id)
        if not doc:
            await interaction.followup.send(f"{member.mention} has no XP in this server yet.")
            return
        current_xp = doc["xp"]
        level = int(doc["level"])
        rank = await database.get_rank(interaction.guild_id, member.id)
        next_level_xp = ((level + 1) / 0.09) ** 2
        last_level_xp = (level / 0.09) ** 2
        joined = member.joined_at.strftime("%a %d %b %Y") if member.joined_at else "unknown"
        try:
            card = render_rank_card(
                xp=int(current_xp),
                xp_last_level=int(last_level_xp),
                xp_next_level=int(next_level_xp),
                background_url=doc.get("background") or DEFAULT_BACKGROUND,
                pfp_url=member.display_avatar.url,
                disname=str(member),
                joined=joined,
                rank=rank,
                level=level,
                theme=doc.get("theme"),
            )
            await interaction.followup.send(file=discord.File(card, "profile.png"))
        except Exception as e:
            logger.warning("Error generating rank card: %s", e)
            await database.set_level_field(
                interaction.guild_id, member.id, "background", DEFAULT_BACKGROUND
            )
            await interaction.followup.send(
                "Your background link is not working — reset to the default. Try again."
            )

    @app_commands.command(name="leaderboard", description="Top 10 members in this server")
    async def leaderboard(self, interaction: discord.Interaction):
        if not await self._check_enabled(interaction):
            return
        await interaction.response.defer()
        docs = await database.top_n(interaction.guild_id, 10)
        if not docs:
            await interaction.followup.send("No XP data in this server yet.")
            return
        medals = ["🥇", "🥈", "🥉"]
        lines = []
        for i, doc in enumerate(docs):
            position = medals[i] if i < 3 else f"`#{i + 1}`"
            lines.append(
                f"{position} <@{doc['user_id']}> — Level **{int(doc['level'])}** ({doc['xp']} XP)"
            )
        description = "\n".join(lines)
        my_rank = await database.get_rank(interaction.guild_id, interaction.user.id)
        if my_rank:
            description += f"\n\nYour position: **#{my_rank}**"
        embed = discord.Embed(
            title=f"🏆 Leaderboard — {interaction.guild.name}",
            description=description,
            color=discord.Color.gold(),
        )
        await interaction.followup.send(embed=embed)

    @app_commands.command(name="theme", description="Change your rank card theme")
    @app_commands.choices(
        theme=[
            app_commands.Choice(name="Dark", value="dark"),
            app_commands.Choice(name="Orange", value="orange"),
            app_commands.Choice(name="Purple", value="purple"),
        ]
    )
    async def theme(self, interaction: discord.Interaction, theme: app_commands.Choice[str]):
        if not await self._check_enabled(interaction):
            return
        await database.set_level_field(
            interaction.guild_id, interaction.user.id, "theme", theme.value
        )
        await interaction.response.send_message(
            f"{interaction.user.mention} Your theme has been changed to **{theme.name}**.",
            ephemeral=True,
        )

    @app_commands.command(name="add_background", description="Add a background by link")
    async def add_background(self, interaction: discord.Interaction, link: str):
        if not await self._check_enabled(interaction):
            return
        if not link.startswith("https"):
            await interaction.response.send_message(
                f"{interaction.user.mention} Please add an https link.", ephemeral=True
            )
            return
        await database.set_level_field(
            interaction.guild_id, interaction.user.id, "background", link
        )
        await interaction.response.send_message(
            f"{interaction.user.mention} background added to your card.", ephemeral=True
        )

    @app_commands.command(name="delete_background", description="Restore the default background")
    async def delete_background(self, interaction: discord.Interaction):
        if not await self._check_enabled(interaction):
            return
        await database.set_level_field(
            interaction.guild_id, interaction.user.id, "background", DEFAULT_BACKGROUND
        )
        await interaction.response.send_message(
            f"{interaction.user.mention} background has been deleted.", ephemeral=True
        )

    @app_commands.command(name="xp", description="Give XP to a member (admin)")
    @app_commands.default_permissions(administrator=True)
    async def give_xp(
        self,
        interaction: discord.Interaction,
        amount: app_commands.Range[int, 1, 100000],
        member: discord.Member,
    ):
        if not await self._check_enabled(interaction):
            return
        if member.bot:
            await interaction.response.send_message("You can't give XP to bots.", ephemeral=True)
            return
        level_before, level_after = await database.add_xp(interaction.guild_id, member.id, amount)
        message = f"<@!{member.id}> has gained {amount} XP"
        if level_after > level_before:
            message += f" and leveled up to level {level_after} 🆙"
            if self.module.engine:
                await self.module.engine.apply_role_rewards(
                    interaction.guild, member, level_after
                )
        await interaction.response.send_message(message)

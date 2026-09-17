import logging

import discord
from discord import app_commands
from discord.ext import commands

from core import database

logger = logging.getLogger(__name__)


class SetupCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    setup = app_commands.Group(
        name="setup",
        description="Server settings (admin)",
        default_permissions=discord.Permissions(administrator=True),
        guild_only=True,
    )

    @setup.command(name="welcome", description="Set the welcome channel")
    async def setup_welcome(
        self,
        interaction: discord.Interaction,
        channel: discord.TextChannel = None,
        off: bool = False,
    ):
        registry = getattr(self.bot, "modules_registry", None)

        if off:
            await database.update_settings(interaction.guild_id, welcome_channel_id=None)
            if registry:
                try:
                    cfg = await registry.get_config(interaction.guild_id, "welcome")
                    cfg["channel_id"] = None
                    await registry.set_config(interaction.guild_id, "welcome", cfg)
                except Exception as e:
                    logger.warning("Failed to sync welcome config on disable: %s", e)
            await interaction.response.send_message("👋 Welcome messages disabled.", ephemeral=True)
        elif channel:
            await database.update_settings(interaction.guild_id, welcome_channel_id=channel.id)
            if registry:
                try:
                    cfg = await registry.get_config(interaction.guild_id, "welcome")
                    cfg["channel_id"] = channel.id
                    await registry.set_config(interaction.guild_id, "welcome", cfg)
                except Exception as e:
                    logger.warning("Failed to sync welcome config on set: %s", e)
            await interaction.response.send_message(
                f"👋 Welcome channel set to {channel.mention}", ephemeral=True
            )
        else:
            await interaction.response.send_message(
                "Provide a channel, or use `off: True` to disable.", ephemeral=True
            )

    @setup.command(name="leave", description="Set the member-leave notification channel")
    async def setup_leave(
        self,
        interaction: discord.Interaction,
        channel: discord.TextChannel = None,
        off: bool = False,
    ):
        if off:
            await database.update_settings(interaction.guild_id, leave_channel_id=None)
            await interaction.response.send_message("🚪 Leave notifications disabled.", ephemeral=True)
        elif channel:
            await database.update_settings(interaction.guild_id, leave_channel_id=channel.id)
            await interaction.response.send_message(
                f"🚪 Leave notifications channel set to {channel.mention}", ephemeral=True
            )
        else:
            await interaction.response.send_message(
                "Provide a channel, or use `off: True` to disable.", ephemeral=True
            )

    @setup.command(name="view", description="Show the current server settings")
    async def setup_view(self, interaction: discord.Interaction):
        settings = await database.get_settings(interaction.guild_id)

        welcome = "not set"
        welcome_id = settings.get("welcome_channel_id")
        if not welcome_id:
            registry = getattr(self.bot, "modules_registry", None)
            if registry:
                cfg = await registry.get_config(interaction.guild_id, "welcome")
                welcome_id = cfg.get("channel_id")

        if welcome_id:
            ch = interaction.guild.get_channel(welcome_id)
            welcome = ch.mention if ch else f"*(deleted channel {welcome_id})*"

        leave = "not set"
        if settings.get("leave_channel_id"):
            ch = interaction.guild.get_channel(settings["leave_channel_id"])
            leave = ch.mention if ch else f"*(deleted channel {settings['leave_channel_id']})*"

        level_roles = settings.get("level_roles", {})
        if not level_roles:
            registry = getattr(self.bot, "modules_registry", None)
            if registry:
                cfg = await registry.get_config(interaction.guild_id, "leveling")
                level_roles = cfg.get("rewards", {})

        if level_roles:
            lr_lines = []
            for lvl in sorted(level_roles, key=int):
                role = interaction.guild.get_role(level_roles[lvl])
                lr_lines.append(f"Level {lvl} → {role.mention if role else '*(deleted role)*'}")
            lr = "\n".join(lr_lines)
        else:
            lr = "not set"

        rr_count = 0
        if database.db is not None:
            rr_count = await database.db.reaction_roles.count_documents(
                {"guild_id": {"$in": [interaction.guild_id, str(interaction.guild_id)]}}
            )

        embed = discord.Embed(
            title=f"⚙️ Settings — {interaction.guild.name}", color=discord.Color.blurple()
        )
        embed.add_field(name="Welcome channel", value=welcome, inline=False)
        embed.add_field(name="Leave notifications", value=leave, inline=False)
        embed.add_field(name="Level role rewards", value=lr, inline=False)
        embed.add_field(name="Reaction role pairs", value=str(rr_count), inline=False)
        await interaction.response.send_message(embed=embed, ephemeral=True)


async def setup(bot):
    await bot.add_cog(SetupCog(bot))

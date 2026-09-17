import logging

import discord
from discord import app_commands
from discord.ext import commands

from core import database

logger = logging.getLogger(__name__)


class TempVoiceCommandsCog(commands.Cog):
    def __init__(self, bot, module):
        self.bot = bot
        self.module = module

    @property
    def registry(self):
        return getattr(self.bot, "modules_registry", None)

    async def _check_enabled(self, interaction: discord.Interaction) -> bool:
        if not self.registry or not await self.registry.is_enabled(
            interaction.guild_id, "temp_voice"
        ):
            await interaction.response.send_message(
                "Temporary voice channels are currently disabled on this server.",
                ephemeral=True,
            )
            return False
        return True

    @app_commands.command(
        name="tempvoice",
        description="View Temporary Voice status, active channels, and dashboard access",
    )
    async def tempvoice(self, interaction: discord.Interaction):
        if not await self._check_enabled(interaction):
            return

        guild_id = interaction.guild_id
        if guild_id is None or interaction.guild is None:
            await interaction.response.send_message(
                "This command can only be used in a server.", ephemeral=True
            )
            return

        docs = []
        if database.db is not None:
            try:
                cursor = database.db.temp_voice_channels.find(
                    {"guild_id": {"$in": [guild_id, str(guild_id)]}}
                )
                async for doc in cursor:
                    docs.append(doc)
            except Exception as e:
                logger.warning("Error querying temp_voice_channels for /tempvoice: %s", e)

        from bot.modules.temp_voice.engine import normalize_temp_voice_config

        cfg = normalize_temp_voice_config(
            await self.registry.get_config(guild_id, "temp_voice")
        )
        areas = cfg.get("areas") or []

        embed = discord.Embed(
            title="🎙️ Temporary Voice Channels",
            description="Automatic temporary voice lounge management.",
            color=discord.Color.blurple(),
        )
        embed.add_field(name="Status", value="✅ **Enabled**", inline=True)
        embed.add_field(name="Active Channels", value=str(len(docs)), inline=True)
        embed.add_field(name="Configured Areas", value=str(len(areas)), inline=True)

        if areas:
            area_lines = []
            for area in areas[:10]:
                trigger_ch = None
                trigger_id = area.get("trigger_channel_id")
                if trigger_id:
                    trigger_ch = interaction.guild.get_channel(int(trigger_id))
                cat_ch = None
                cat_id = area.get("category_id")
                if cat_id:
                    cat_ch = interaction.guild.get_channel(int(cat_id))
                trigger_txt = trigger_ch.mention if trigger_ch else "*Not set*"
                cat_txt = cat_ch.mention if cat_ch else "*Uncategorized*"
                area_lines.append(
                    f"**{area.get('title', area.get('id', 'Area'))}** — {trigger_txt} → {cat_txt}"
                )
            embed.add_field(name="Areas", value="\n".join(area_lines), inline=False)
        else:
            embed.add_field(
                name="Areas",
                value="*No temp voice areas configured yet — add one from the dashboard.*",
                inline=False,
            )

        user_owned_doc = next(
            (d for d in docs if d.get("owner_id") == interaction.user.id), None
        )
        if user_owned_doc:
            ch_id = user_owned_doc.get("channel_id")
            ch = interaction.guild.get_channel(int(ch_id)) if ch_id else None
            ch_mention = ch.mention if ch else f"`{ch_id}`"
            locked_text = "🔒 Locked" if user_owned_doc.get("locked") else "🔓 Unlocked"
            embed.add_field(
                name="Your Channel",
                value=f"👑 {ch_mention} ({locked_text})",
                inline=False,
            )
        else:
            embed.add_field(
                name="Your Channel",
                value="You do not currently own an active temporary voice channel.",
                inline=False,
            )

        embed.add_field(
            name="Dashboard Configuration",
            value=(
                "Server admins can configure multiple temp voice areas (trigger channel, category, "
                "naming pattern, user limit, auto-deletion delay) in the Neverland web dashboard "
                "under **Community → Temp Voice**."
            ),
            inline=False,
        )

        await interaction.response.send_message(embed=embed, ephemeral=True)

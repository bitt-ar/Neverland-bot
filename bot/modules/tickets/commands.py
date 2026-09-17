import logging

import discord
from discord import app_commands
from discord.ext import commands

from core import database

logger = logging.getLogger(__name__)


class TicketsCommandsCog(commands.Cog):
    def __init__(self, bot, module):
        self.bot = bot
        self.module = module

    @property
    def registry(self):
        return getattr(self.bot, "modules_registry", None)

    async def _check_enabled(self, interaction: discord.Interaction) -> bool:
        if not self.registry or not await self.registry.is_enabled(
            interaction.guild_id, "tickets"
        ):
            await interaction.response.send_message(
                "Tickets module is currently disabled on this server.", ephemeral=True
            )
            return False
        return True

    tickets = app_commands.Group(
        name="tickets",
        description="Ticket system status and management",
        guild_only=True,
    )

    @tickets.command(
        name="status",
        description="View ticket system configuration, panel status, and open tickets",
    )
    async def tickets_status(self, interaction: discord.Interaction):
        if not await self._check_enabled(interaction):
            return

        guild_id = interaction.guild_id
        if guild_id is None or interaction.guild is None:
            await interaction.response.send_message(
                "This command can only be used in a server.", ephemeral=True
            )
            return

        cfg = await self.registry.get_config(guild_id, "tickets")
        panel_ch_id = cfg.get("panel_channel_id")
        panel_channel = (
            interaction.guild.get_channel(int(panel_ch_id)) if panel_ch_id else None
        )

        meta = None
        open_count = 0
        total_count = 0
        if database.db is not None:
            try:
                meta = await database.db.tickets_meta.find_one(
                    {"guild_id": {"$in": [guild_id, str(guild_id)]}}
                )
                open_count = await database.db.tickets.count_documents(
                    {
                        "guild_id": {"$in": [guild_id, str(guild_id)]},
                        "status": {"$in": ["open", "claimed"]},
                    }
                )
                total_count = await database.db.tickets.count_documents(
                    {"guild_id": {"$in": [guild_id, str(guild_id)]}}
                )
            except Exception as e:
                logger.warning("Error querying tickets data for /tickets status: %s", e)

        panel_published = bool(meta and meta.get("panel_message_id"))

        embed = discord.Embed(
            title="🎫 Ticket System Overview",
            description="Status, panel publishing, and active ticket metrics.",
            color=discord.Color.blurple(),
        )
        embed.add_field(name="Module Status", value="✅ **Enabled**", inline=True)
        embed.add_field(
            name="Panel Channel",
            value=panel_channel.mention if panel_channel else "*Not configured*",
            inline=True,
        )
        embed.add_field(
            name="Panel Published",
            value="✅ Yes" if panel_published else "❌ No",
            inline=True,
        )
        logs_ch_id = cfg.get("logs_channel_id")
        logs_channel = (
            interaction.guild.get_channel(int(logs_ch_id)) if logs_ch_id else None
        )
        embed.add_field(
            name="Logs Channel",
            value=logs_channel.mention if logs_channel else "*Not configured*",
            inline=True,
        )

        categories = cfg.get("categories", [])
        if categories:
            cat_lines = [
                f"{c.get('emoji', '🎫')} **{c.get('name')}** (`{c.get('id')}`)"
                for c in categories[:10]
            ]
            if len(categories) > 10:
                cat_lines.append(f"*...and {len(categories) - 10} more*")
            embed.add_field(
                name=f"Configured Categories ({len(categories)})",
                value="\n".join(cat_lines),
                inline=False,
            )
        else:
            embed.add_field(
                name="Configured Categories",
                value="*No categories configured*",
                inline=False,
            )

        embed.add_field(
            name="Active Tickets",
            value=f"🟢 **{open_count}** open / claimed",
            inline=True,
        )
        embed.add_field(
            name="Total Tickets (Lifetime)",
            value=f"📁 **{total_count}** tickets created",
            inline=True,
        )
        max_open = cfg.get("max_open_tickets", 1)
        cooldown = cfg.get("cooldown_seconds", 0)
        limits_desc = f"Max Open: **{max_open}** | Cooldown: **{cooldown}s**"
        embed.add_field(
            name="Limits & Restrictions",
            value=limits_desc,
            inline=False,
        )

        embed.add_field(
            name="Dashboard Configuration",
            value=(
                "Admins can configure panel embeds, categories, and staff roles in the Neverland web dashboard "
                "under **Community → Tickets**."
            ),
            inline=False,
        )

        await interaction.response.send_message(embed=embed, ephemeral=True)

    @tickets.command(
        name="publish-panel",
        description="Publish or replace the ticket panel in the configured channel (Admin)",
    )
    @app_commands.default_permissions(manage_guild=True)
    async def tickets_publish_panel(self, interaction: discord.Interaction):
        if not await self._check_enabled(interaction):
            return

        guild = interaction.guild
        if guild is None:
            await interaction.response.send_message(
                "This command can only be used in a server.", ephemeral=True
            )
            return

        await interaction.response.defer(ephemeral=True)

        engine = getattr(self.module, "engine", None)
        if engine is None:
            await interaction.followup.send(
                "❌ Ticket engine is not loaded.", ephemeral=True
            )
            return

        try:
            msg = await engine.publish_panel(guild)
            await interaction.followup.send(
                f"✅ Ticket panel published successfully in {msg.channel.mention}!",
                ephemeral=True,
            )
        except ValueError as ve:
            await interaction.followup.send(f"❌ Configuration error: {ve}", ephemeral=True)
        except discord.Forbidden as fe:
            await interaction.followup.send(
                f"❌ Discord permission error: {fe}", ephemeral=True
            )
        except Exception as e:
            logger.exception("Error publishing ticket panel via command: %s", e)
            await interaction.followup.send(
                f"❌ Failed to publish panel: {e}", ephemeral=True
            )

    @tickets.command(
        name="logs",
        description="Set or view the ticket audit & transcript logs channel (Admin)",
    )
    @app_commands.default_permissions(manage_guild=True)
    async def tickets_logs(
        self,
        interaction: discord.Interaction,
        channel: discord.TextChannel = None,
        off: bool = False,
    ):
        if not await self._check_enabled(interaction):
            return

        cfg = await self.registry.get_config(interaction.guild_id, "tickets")

        if off:
            cfg["logs_channel_id"] = None
            await self.registry.set_config(interaction.guild_id, "tickets", cfg)
            await interaction.response.send_message("📁 Ticket logs disabled.", ephemeral=True)
            return

        if channel:
            cfg["logs_channel_id"] = channel.id
            await self.registry.set_config(interaction.guild_id, "tickets", cfg)
            await interaction.response.send_message(
                f"📁 Ticket logs channel set to {channel.mention}.", ephemeral=True
            )
            return

        cur_id = cfg.get("logs_channel_id")
        cur_ch = interaction.guild.get_channel(int(cur_id)) if cur_id else None
        status_text = cur_ch.mention if cur_ch else "*(Not configured)*"
        await interaction.response.send_message(
            f"📁 Current ticket logs channel: {status_text}\nUse `/tickets logs channel:#channel` to configure or `off:True` to disable.",
            ephemeral=True,
        )

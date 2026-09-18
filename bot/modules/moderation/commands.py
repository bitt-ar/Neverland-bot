import datetime
import logging
from typing import Optional

import discord
from discord import app_commands
from discord.ext import commands

from bot.modules.moderation.helpers import log_moderation_action
from core import database

logger = logging.getLogger(__name__)


class ModerationCommandsCog(commands.Cog):
    def __init__(self, bot, module):
        self.bot = bot
        self.module = module

    @property
    def registry(self):
        return getattr(self.bot, "modules_registry", None)

    async def _check_permission(
        self, interaction: discord.Interaction, command_name: str, fallback_perm: str
    ) -> bool:
        """Verifies if the command is enabled and the member has configured role or default permission."""
        if not interaction.guild or not isinstance(interaction.user, discord.Member):
            await interaction.response.send_message("Moderation commands can only be used in servers.", ephemeral=True)
            return False

        if self.registry and not await self.registry.is_enabled(interaction.guild_id, "moderation"):
            await interaction.response.send_message("The moderation module is currently disabled.", ephemeral=True)
            return False

        cfg = {}
        if self.registry:
            cfg = await self.registry.get_config(interaction.guild_id, "moderation")

        # 1. Command enabled/disabled toggle check
        disabled_cmds = cfg.get("disabled_commands") or []
        if command_name in disabled_cmds:
            await interaction.response.send_message(
                f"⛔ The command `/{command_name}` has been disabled by server administrators.",
                ephemeral=True,
            )
            return False

        # 2. Administrator always has bypass
        if interaction.user.guild_permissions.administrator:
            return True

        # 3. Role-based command permissions (configured in dashboard)
        command_roles_map = cfg.get("command_roles") or {}
        allowed_roles = command_roles_map.get(command_name) or []
        if allowed_roles:
            user_roles = [r.id for r in interaction.user.roles]
            if any(int(rid) in user_roles for rid in allowed_roles):
                return True
            role_mentions = ", ".join([f"<@&{rid}>" for rid in allowed_roles])
            await interaction.response.send_message(
                f"⛔ You do not have permission to use `/{command_name}`. Required roles: {role_mentions}",
                ephemeral=True,
            )
            return False

        # 4. Fallback to Discord native permissions
        user_perms = interaction.user.guild_permissions
        has_perm = getattr(user_perms, fallback_perm, False)
        if not has_perm:
            await interaction.response.send_message(
                f"⛔ You need the `{fallback_perm.replace('_', ' ').title()}` permission to use this command.",
                ephemeral=True,
            )
            return False

        return True

    def _can_moderate(self, moderator: discord.Member, target: discord.Member) -> tuple[bool, str]:
        """Ensures hierarchy rules: moderator must have higher role than target, and target cannot be owner/bot."""
        if target.id == moderator.guild.owner_id:
            return False, "You cannot moderate the server owner."
        if target.id == moderator.id:
            return False, "You cannot moderate yourself."
        if target.id == self.bot.user.id:
            return False, "I cannot moderate myself."
        if target.top_role >= moderator.top_role and moderator.id != moderator.guild.owner_id:
            return False, "You cannot moderate a member with an equal or higher role than yours."
        if target.top_role >= moderator.guild.me.top_role:
            return False, "I cannot moderate a member with an equal or higher role than my highest role."
        return True, ""

    # =========================================================================
    # KICK
    # =========================================================================
    @app_commands.command(name="kick", description="Kick a member from the server")
    @app_commands.describe(member="The member to kick", reason="Reason for the kick")
    async def kick(
        self,
        interaction: discord.Interaction,
        member: discord.Member,
        reason: Optional[str] = "No reason provided",
    ):
        if not await self._check_permission(interaction, "kick", "kick_members"):
            return

        can_mod, err = self._can_moderate(interaction.user, member)
        if not can_mod:
            await interaction.response.send_message(f"❌ {err}", ephemeral=True)
            return

        try:
            await member.kick(reason=f"{reason} (Kicked by {interaction.user})")
            case_id = await log_moderation_action(
                bot=self.bot,
                guild=interaction.guild,
                action="kick",
                moderator=interaction.user,
                target=member,
                reason=reason,
            )
            await interaction.response.send_message(
                f"👢 **{member}** has been kicked. (Case #{case_id})"
            )
        except discord.Forbidden:
            await interaction.response.send_message("❌ I lack permissions to kick this user.", ephemeral=True)
        except Exception as e:
            logger.exception("Error kicking member: %s", e)
            await interaction.response.send_message(f"❌ An error occurred: {e}", ephemeral=True)

    # =========================================================================
    # BAN & UNBAN
    # =========================================================================
    @app_commands.command(name="ban", description="Ban a member from the server")
    @app_commands.describe(
        member="The member to ban",
        reason="Reason for the ban",
        delete_message_days="Number of days of messages to delete (0 to 7)",
    )
    async def ban(
        self,
        interaction: discord.Interaction,
        member: discord.Member,
        reason: Optional[str] = "No reason provided",
        delete_message_days: Optional[app_commands.Range[int, 0, 7]] = 0,
    ):
        if not await self._check_permission(interaction, "ban", "ban_members"):
            return

        can_mod, err = self._can_moderate(interaction.user, member)
        if not can_mod:
            await interaction.response.send_message(f"❌ {err}", ephemeral=True)
            return

        try:
            delete_seconds = (delete_message_days or 0) * 86400
            await member.ban(
                reason=f"{reason} (Banned by {interaction.user})",
                delete_message_seconds=delete_seconds,
            )
            case_id = await log_moderation_action(
                bot=self.bot,
                guild=interaction.guild,
                action="ban",
                moderator=interaction.user,
                target=member,
                reason=reason,
            )
            await interaction.response.send_message(
                f"🔨 **{member}** has been banned. (Case #{case_id})"
            )
        except discord.Forbidden:
            await interaction.response.send_message("❌ I lack permissions to ban this user.", ephemeral=True)
        except Exception as e:
            logger.exception("Error banning member: %s", e)
            await interaction.response.send_message(f"❌ An error occurred: {e}", ephemeral=True)

    @app_commands.command(name="unban", description="Unban a user by their User ID")
    @app_commands.describe(user_id="The Discord user ID to unban", reason="Reason for the unban")
    async def unban(
        self,
        interaction: discord.Interaction,
        user_id: str,
        reason: Optional[str] = "No reason provided",
    ):
        if not await self._check_permission(interaction, "unban", "ban_members"):
            return

        if not user_id.isdigit():
            await interaction.response.send_message("❌ Please provide a valid numeric User ID.", ephemeral=True)
            return

        uid = int(user_id)
        try:
            user = await self.bot.fetch_user(uid)
            await interaction.guild.unban(user, reason=f"{reason} (Unbanned by {interaction.user})")
            case_id = await log_moderation_action(
                bot=self.bot,
                guild=interaction.guild,
                action="unban",
                moderator=interaction.user,
                target=user,
                reason=reason,
            )
            await interaction.response.send_message(
                f"🔓 **{user}** has been unbanned. (Case #{case_id})"
            )
        except discord.NotFound:
            await interaction.response.send_message("❌ User was not found or is not banned.", ephemeral=True)
        except discord.Forbidden:
            await interaction.response.send_message("❌ I lack permissions to unban users.", ephemeral=True)
        except Exception as e:
            logger.exception("Error unbanning user: %s", e)
            await interaction.response.send_message(f"❌ An error occurred: {e}", ephemeral=True)

    # =========================================================================
    # TIMEOUT & UNTIMEOUT
    # =========================================================================
    @app_commands.command(name="timeout", description="Timeout (mute) a member for a duration")
    @app_commands.describe(
        member="The member to timeout",
        minutes="Duration in minutes (1 to 40320 = 28 days)",
        reason="Reason for timeout",
    )
    async def timeout(
        self,
        interaction: discord.Interaction,
        member: discord.Member,
        minutes: app_commands.Range[int, 1, 40320],
        reason: Optional[str] = "No reason provided",
    ):
        if not await self._check_permission(interaction, "timeout", "moderate_members"):
            return

        can_mod, err = self._can_moderate(interaction.user, member)
        if not can_mod:
            await interaction.response.send_message(f"❌ {err}", ephemeral=True)
            return

        duration = datetime.timedelta(minutes=minutes)
        try:
            await member.timeout(duration, reason=f"{reason} (by {interaction.user})")
            case_id = await log_moderation_action(
                bot=self.bot,
                guild=interaction.guild,
                action="timeout",
                moderator=interaction.user,
                target=member,
                reason=reason,
                duration=f"{minutes} minutes",
            )
            await interaction.response.send_message(
                f"⏳ **{member}** has been timed out for **{minutes} minutes**. (Case #{case_id})"
            )
        except discord.Forbidden:
            await interaction.response.send_message("❌ I lack permission to timeout this member.", ephemeral=True)
        except Exception as e:
            logger.exception("Error applying timeout: %s", e)
            await interaction.response.send_message(f"❌ An error occurred: {e}", ephemeral=True)

    @app_commands.command(name="untimeout", description="Remove timeout from a member")
    @app_commands.describe(member="The member to remove timeout from", reason="Reason for untimeout")
    async def untimeout(
        self,
        interaction: discord.Interaction,
        member: discord.Member,
        reason: Optional[str] = "No reason provided",
    ):
        if not await self._check_permission(interaction, "untimeout", "moderate_members"):
            return

        can_mod, err = self._can_moderate(interaction.user, member)
        if not can_mod:
            await interaction.response.send_message(f"❌ {err}", ephemeral=True)
            return

        try:
            await member.timeout(None, reason=f"{reason} (by {interaction.user})")
            case_id = await log_moderation_action(
                bot=self.bot,
                guild=interaction.guild,
                action="untimeout",
                moderator=interaction.user,
                target=member,
                reason=reason,
            )
            await interaction.response.send_message(
                f"🔊 Timeout removed for **{member}**. (Case #{case_id})"
            )
        except discord.Forbidden:
            await interaction.response.send_message("❌ I lack permission to remove timeout.", ephemeral=True)
        except Exception as e:
            logger.exception("Error removing timeout: %s", e)
            await interaction.response.send_message(f"❌ An error occurred: {e}", ephemeral=True)

    # =========================================================================
    # WARN & WARNINGS & DELWARN
    # =========================================================================
    @app_commands.command(name="warn", description="Issue a formal warning to a member")
    @app_commands.describe(member="The member to warn", reason="Reason for the warning")
    async def warn(
        self,
        interaction: discord.Interaction,
        member: discord.Member,
        reason: str,
    ):
        if not await self._check_permission(interaction, "warn", "moderate_members"):
            return

        can_mod, err = self._can_moderate(interaction.user, member)
        if not can_mod:
            await interaction.response.send_message(f"❌ {err}", ephemeral=True)
            return

        case_id = await log_moderation_action(
            bot=self.bot,
            guild=interaction.guild,
            action="warn",
            moderator=interaction.user,
            target=member,
            reason=reason,
        )

        try:
            embed = discord.Embed(
                title=f"⚠️ Warning in {interaction.guild.name}",
                description=f"You have been warned by {interaction.user.mention} for: **{reason}**",
                color=discord.Color.gold(),
            )
            await member.send(embed=embed)
        except Exception:
            pass

        await interaction.response.send_message(
            f"⚠️ **{member}** has been warned for: *{reason}* (Case #{case_id})"
        )

    @app_commands.command(name="warnings", description="View warning history of a member")
    @app_commands.describe(member="The member whose warnings to inspect")
    async def warnings(
        self,
        interaction: discord.Interaction,
        member: Optional[discord.Member] = None,
    ):
        target = member or interaction.user
        if target != interaction.user:
            if not await self._check_permission(interaction, "warnings", "moderate_members"):
                return

        if database.db is None:
            await interaction.response.send_message("Database unavailable.", ephemeral=True)
            return

        cursor = database.db.moderation_cases.find(
            {"guild_id": interaction.guild_id, "user_id": target.id, "action": "warn"}
        ).sort("case_id", -1).limit(10)
        cases = await cursor.to_list(length=10)

        if not cases:
            await interaction.response.send_message(
                f"✅ **{target}** has no recorded warnings on this server.", ephemeral=True
            )
            return

        embed = discord.Embed(
            title=f"⚠️ Warnings History — {target}",
            color=discord.Color.gold(),
        )
        for c in cases:
            created_str = c.get("created_at").strftime("%Y-%m-%d %H:%M") if c.get("created_at") else "Unknown"
            embed.add_field(
                name=f"Case #{c.get('case_id')} ({created_str})",
                value=f"**Reason:** {c.get('reason')}\n**Moderator:** <@{c.get('moderator_id')}>",
                inline=False,
            )

        embed.set_footer(text=f"Total warnings shown: {len(cases)}")
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @app_commands.command(name="delwarn", description="Delete a warning case by Case ID")
    @app_commands.describe(case_id="The numeric Case ID of the warning to remove")
    async def delwarn(self, interaction: discord.Interaction, case_id: int):
        if not await self._check_permission(interaction, "delwarn", "moderate_members"):
            return

        if database.db is None:
            await interaction.response.send_message("Database unavailable.", ephemeral=True)
            return

        res = await database.db.moderation_cases.delete_one(
            {"guild_id": interaction.guild_id, "case_id": case_id, "action": "warn"}
        )
        if res.deleted_count == 0:
            await interaction.response.send_message(
                f"❌ Warning Case #{case_id} was not found on this server.", ephemeral=True
            )
        else:
            await interaction.response.send_message(
                f"✅ Warning Case #{case_id} has been deleted.", ephemeral=True
            )

    # =========================================================================
    # MODLOGS
    # =========================================================================
    @app_commands.command(name="modlogs", description="View recent moderation cases for a member or server")
    @app_commands.describe(member="Filter cases by member (optional)")
    async def modlogs(
        self,
        interaction: discord.Interaction,
        member: Optional[discord.Member] = None,
    ):
        if not await self._check_permission(interaction, "modlogs", "moderate_members"):
            return

        if database.db is None:
            await interaction.response.send_message("Database unavailable.", ephemeral=True)
            return

        query = {"guild_id": interaction.guild_id}
        if member:
            query["user_id"] = member.id

        cursor = database.db.moderation_cases.find(query).sort("case_id", -1).limit(10)
        cases = await cursor.to_list(length=10)

        if not cases:
            await interaction.response.send_message("No moderation cases found.", ephemeral=True)
            return

        embed = discord.Embed(
            title=f"🛡️ Recent Moderation Logs" + (f" for {member}" if member else ""),
            color=discord.Color.blurple(),
        )
        for c in cases:
            action = c.get("action", "unknown").upper()
            embed.add_field(
                name=f"Case #{c.get('case_id')} | {action}",
                value=(
                    f"**User:** <@{c.get('user_id')}>\n"
                    f"**Mod:** <@{c.get('moderator_id')}>\n"
                    f"**Reason:** {c.get('reason')}"
                ),
                inline=False,
            )
        await interaction.response.send_message(embed=embed, ephemeral=True)

    # =========================================================================
    # CLEAR (ENHANCED PURGE)
    # =========================================================================
    @app_commands.command(name="clear", description="Purge messages from the current channel")
    @app_commands.describe(
        amount="Number of messages to delete (1 to 100)",
        member="Optionally delete messages only from this member",
    )
    async def clear(
        self,
        interaction: discord.Interaction,
        amount: app_commands.Range[int, 1, 100],
        member: Optional[discord.Member] = None,
    ):
        if not await self._check_permission(interaction, "clear", "manage_messages"):
            return

        await interaction.response.defer(ephemeral=True)

        def check_filter(m: discord.Message) -> bool:
            if member:
                return m.author.id == member.id
            return True

        try:
            deleted = await interaction.channel.purge(limit=amount, check=check_filter)
            filter_text = f" from {member.mention}" if member else ""
            await interaction.followup.send(
                f"🧹 Successfully purged **{len(deleted)}** messages{filter_text}.", ephemeral=True
            )
            await log_moderation_action(
                bot=self.bot,
                guild=interaction.guild,
                action="clear",
                moderator=interaction.user,
                target=member or interaction.channel.id,
                reason=f"Purged {len(deleted)} messages in #{interaction.channel.name}",
            )
        except discord.Forbidden:
            await interaction.followup.send("❌ I lack permissions to delete messages.", ephemeral=True)
        except Exception as e:
            logger.exception("Error purging messages: %s", e)
            await interaction.followup.send(f"❌ Error purging messages: {e}", ephemeral=True)

    # =========================================================================
    # MODERATION LOGS CONFIGURATION
    # =========================================================================
    @app_commands.command(
        name="moderation_logs",
        description="Configure the channel for moderation audit logs (Admin)",
    )
    @app_commands.describe(channel="Text channel for mod logs", off="Disable mod logs")
    @app_commands.default_permissions(administrator=True)
    async def moderation_logs(
        self,
        interaction: discord.Interaction,
        channel: Optional[discord.TextChannel] = None,
        off: bool = False,
    ):
        if not interaction.guild or not isinstance(interaction.user, discord.Member):
            await interaction.response.send_message("Can only be used in a server.", ephemeral=True)
            return

        is_admin = interaction.user.guild_permissions.administrator or interaction.user.id == interaction.guild.owner_id
        if not is_admin:
            await interaction.response.send_message(
                "⛔ You need Administrator permissions to configure moderation logs.", ephemeral=True
            )
            return

        cfg = await self.registry.get_config(interaction.guild_id, "moderation") if self.registry else {}

        if off:
            cfg["mod_logs_channel_id"] = None
            if self.registry:
                await self.registry.set_config(interaction.guild_id, "moderation", cfg)
            await interaction.response.send_message("📁 Moderation logs disabled.", ephemeral=True)
            return

        if channel:
            cfg["mod_logs_channel_id"] = channel.id
            if self.registry:
                await self.registry.set_config(interaction.guild_id, "moderation", cfg)
            await interaction.response.send_message(
                f"📁 Moderation logs channel set to {channel.mention}.", ephemeral=True
            )
            return

        cur_id = cfg.get("mod_logs_channel_id")
        cur_ch = interaction.guild.get_channel(int(cur_id)) if cur_id else None
        ch_text = cur_ch.mention if cur_ch else "*(Not configured)*"
        await interaction.response.send_message(
            f"📁 Current moderation logs channel: {ch_text}\nUse `/moderation_logs channel:#channel` to configure or `off:True` to disable.",
            ephemeral=True,
        )

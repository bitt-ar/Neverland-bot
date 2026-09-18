import asyncio
from datetime import datetime, timezone
import logging
import re
from typing import Optional

import discord
from discord.ext import commands, tasks
from pymongo import ReturnDocument

from core import database

logger = logging.getLogger(__name__)

MAX_TEMP_CHANNELS_PER_GUILD = 25
DEFAULT_AUTO_DELETE_SECONDS = 60


from bot.modules.temp_voice.helpers import (
    get_next_temp_voice_counter,
    render_temp_voice_name,
    sanitize_channel_name,
)
from bot.modules.temp_voice.module import TempVoiceConfig


def normalize_temp_voice_config(raw_cfg: dict) -> dict:
    """Normalize a raw stored config (which may be legacy single-area) into the
    current multi-area shape so the engine always reads from cfg["areas"]."""
    try:
        return TempVoiceConfig.model_validate(raw_cfg).model_dump()
    except Exception:
        return raw_cfg


def build_panel_embed(
    channel_name: str, owner_id: int, locked: bool, user_limit: int = 0
) -> discord.Embed:
    embed = discord.Embed(
        title=f"Owner controls — {channel_name}",
        description=(
            f"Welcome to your temporary voice channel!\n"
            f"Channel Owner: <@{owner_id}>\n\n"
            f"Use the buttons below to customize and control this channel."
        ),
        color=discord.Color.blurple(),
    )
    embed.add_field(name="🔒 Status", value="Locked" if locked else "Unlocked", inline=True)
    embed.add_field(
        name="👥 User Limit",
        value=str(user_limit) if user_limit > 0 else "Unlimited",
        inline=True,
    )
    embed.set_footer(text="Only the channel owner can use the buttons below.")
    return embed


def build_panel_view(channel_id: int) -> discord.ui.View:
    view = discord.ui.View(timeout=None)
    view.add_item(
        discord.ui.Button(
            label="Lock",
            emoji="🔒",
            style=discord.ButtonStyle.secondary,
            custom_id=f"tv:{channel_id}:lock",
        )
    )
    view.add_item(
        discord.ui.Button(
            label="Unlock",
            emoji="🔓",
            style=discord.ButtonStyle.secondary,
            custom_id=f"tv:{channel_id}:unlock",
        )
    )
    view.add_item(
        discord.ui.Button(
            label="Limit",
            emoji="👥",
            style=discord.ButtonStyle.secondary,
            custom_id=f"tv:{channel_id}:limit",
        )
    )
    view.add_item(
        discord.ui.Button(
            label="Rename",
            emoji="✏️",
            style=discord.ButtonStyle.secondary,
            custom_id=f"tv:{channel_id}:rename",
        )
    )
    view.add_item(
        discord.ui.Button(
            label="Transfer",
            emoji="👑",
            style=discord.ButtonStyle.secondary,
            custom_id=f"tv:{channel_id}:transfer",
        )
    )
    view.add_item(
        discord.ui.Button(
            label="Delete",
            emoji="🗑️",
            style=discord.ButtonStyle.danger,
            custom_id=f"tv:{channel_id}:delete",
        )
    )
    return view


class TempVoiceLimitModal(discord.ui.Modal, title="Set Channel User Limit"):
    limit_input = discord.ui.TextInput(
        label="User Limit (0 = unlimited, 1-99)",
        placeholder="0",
        min_length=1,
        max_length=2,
        required=True,
    )

    def __init__(
        self,
        channel: discord.VoiceChannel,
        engine: "TempVoiceEngineCog",
        doc: dict,
    ):
        super().__init__()
        self.channel = channel
        self.engine = engine
        self.doc = doc
        self.limit_input.default = str(channel.user_limit or 0)

    async def on_submit(self, interaction: discord.Interaction):
        raw = self.limit_input.value.strip()
        try:
            limit = int(raw)
            if limit < 0 or limit > 99:
                raise ValueError()
        except ValueError:
            await interaction.response.send_message(
                "Please enter a valid integer between 0 and 99.", ephemeral=True
            )
            return

        try:
            await self.channel.edit(
                user_limit=limit, reason="Temp voice limit updated by owner"
            )
            await self.engine.update_panel_embed(self.channel, self.doc)
            msg = (
                f"User limit set to **{limit}**."
                if limit > 0
                else "User limit set to **unlimited**."
            )
            await interaction.response.send_message(f"👥 {msg}", ephemeral=True)
        except discord.Forbidden:
            await interaction.response.send_message(
                "I do not have permission to manage this channel.", ephemeral=True
            )
        except Exception as e:
            logger.warning("Failed to update user limit: %s", e)
            await interaction.response.send_message(
                "Failed to update channel user limit.", ephemeral=True
            )


class TempVoiceRenameModal(discord.ui.Modal, title="Rename Voice Channel"):
    name_input = discord.ui.TextInput(
        label="Channel Name (max 80 characters)",
        placeholder="New channel name",
        min_length=1,
        max_length=80,
        required=True,
    )

    def __init__(
        self,
        channel: discord.VoiceChannel,
        engine: "TempVoiceEngineCog",
        doc: dict,
    ):
        super().__init__()
        self.channel = channel
        self.engine = engine
        self.doc = doc
        self.name_input.default = self.channel.name[:80]

    async def on_submit(self, interaction: discord.Interaction):
        raw = self.name_input.value
        cleaned = sanitize_channel_name(raw)
        if not cleaned:
            await interaction.response.send_message(
                "Please provide a valid channel name with alphanumeric characters.",
                ephemeral=True,
            )
            return

        try:
            await self.channel.edit(
                name=cleaned, reason="Temp voice renamed by owner"
            )
            await self.engine.update_panel_embed(self.channel, self.doc)
            await interaction.response.send_message(
                f"✏️ Channel renamed to **{cleaned}**.", ephemeral=True
            )
        except discord.RateLimited as rl:
            await interaction.response.send_message(
                f"Discord channel rename rate limit hit. Try again in a few minutes ({rl}).",
                ephemeral=True,
            )
        except discord.Forbidden:
            await interaction.response.send_message(
                "I do not have permission to rename this channel.", ephemeral=True
            )
        except Exception as e:
            logger.warning("Failed to rename channel: %s", e)
            await interaction.response.send_message(
                "Failed to rename channel.", ephemeral=True
            )


class TransferSelectView(discord.ui.View):
    def __init__(self, channel_id: int, members: list[discord.Member]):
        super().__init__(timeout=120)
        options = [
            discord.SelectOption(
                label=m.display_name[:100],
                value=str(m.id),
                description=f"@{m.name}"[:100],
            )
            for m in members[:25]
        ]
        select = discord.ui.Select(
            placeholder="Select new channel owner...",
            options=options,
            custom_id=f"tv:{channel_id}:transfer_select",
        )
        self.add_item(select)


class DeleteConfirmView(discord.ui.View):
    def __init__(self, channel_id: int):
        super().__init__(timeout=60)
        self.add_item(
            discord.ui.Button(
                label="Confirm Delete",
                style=discord.ButtonStyle.danger,
                custom_id=f"tv:{channel_id}:delete_confirm",
            )
        )
        self.add_item(
            discord.ui.Button(
                label="Cancel",
                style=discord.ButtonStyle.secondary,
                custom_id=f"tv:{channel_id}:delete_cancel",
            )
        )


class TempVoiceEngineCog(commands.Cog):
    def __init__(self, bot, module):
        self.bot = bot
        self.module = module
        self._deletion_tasks: dict[int, asyncio.Task] = {}
        self._creating_users: set[int] = set()

    @property
    def registry(self):
        return getattr(self.bot, "modules_registry", None)

    async def cog_load(self):
        self.cleanup_task.start()
        if self.bot.is_ready():
            await self.recover_channels()

    def cog_unload(self):
        self.cleanup_task.cancel()
        for task in self._deletion_tasks.values():
            task.cancel()
        self._deletion_tasks.clear()

    @commands.Cog.listener()
    async def on_ready(self):
        await self.recover_channels()

    async def recover_channels(self):
        """Startup recovery: prune vanished channels and schedule empty ones."""
        if database.db is None:
            return

        try:
            cursor = database.db.temp_voice_channels.find({})
            async for doc in cursor:
                guild_id = doc.get("guild_id")
                channel_id = doc.get("channel_id")
                try:
                    guild_id_int = int(guild_id)
                    channel_id_int = int(channel_id)
                except (TypeError, ValueError):
                    continue

                guild = self.bot.get_guild(guild_id_int)
                if guild is None:
                    continue

                channel = guild.get_channel(channel_id_int)
                if channel is None:
                    logger.info(
                        "Pruning temp channel %s doc: channel vanished from guild %s",
                        channel_id,
                        guild_id,
                    )
                    await database.db.temp_voice_channels.delete_one({"_id": doc["_id"]})
                    continue

                # Channel exists in cache
                active_members = [m for m in getattr(channel, "members", []) if not m.bot]
                if len(active_members) == 0:
                    if channel_id_int not in self._deletion_tasks:
                        self._schedule_deletion(
                            guild_id_int, channel_id_int, self._get_delete_delay(doc)
                        )
        except Exception as e:
            logger.warning("Error during temp voice recovery: %s", e)

    @tasks.loop(seconds=60)
    async def cleanup_task(self):
        """Periodic background reconciliation task running every 60 seconds."""
        # The task is started before the bot logs in; skip ticks until READY.
        # (wait_until_ready in before_loop would raise at startup.)
        if not self.bot.is_ready():
            return
        if database.db is None:
            return

        try:
            cursor = database.db.temp_voice_channels.find({})
            async for doc in cursor:
                guild_id = doc.get("guild_id")
                channel_id = doc.get("channel_id")
                try:
                    guild_id_int = int(guild_id)
                    channel_id_int = int(channel_id)
                except (TypeError, ValueError):
                    continue

                guild = self.bot.get_guild(guild_id_int)
                if guild is None:
                    continue

                channel = guild.get_channel(channel_id_int)
                if channel is None:
                    logger.info(
                        "Periodic cleanup removing vanished temp channel %s doc", channel_id
                    )
                    await database.db.temp_voice_channels.delete_one({"_id": doc["_id"]})
                    self._cancel_deletion_task(channel_id_int)
                    continue

                active_members = [m for m in getattr(channel, "members", []) if not m.bot]
                if len(active_members) == 0:
                    if channel_id_int not in self._deletion_tasks:
                        self._schedule_deletion(
                            guild_id_int, channel_id_int, self._get_delete_delay(doc)
                        )
        except Exception as e:
            logger.warning("Error in temp voice periodic cleanup: %s", e)

    # NOTE: no before_loop/wait_until_ready — the loop starts before login and
    # skips ticks via the is_ready() guard above until the gateway is READY.

    def _get_delete_delay(self, doc: dict, default: int = DEFAULT_AUTO_DELETE_SECONDS) -> int:
        """Per-channel deletion delay stored at creation time (falls back to default)."""
        try:
            delay = int(doc.get("auto_delete_seconds") or default)
        except (TypeError, ValueError):
            delay = default
        return max(15, min(3600, delay))

    def _cancel_deletion_task(self, channel_id: int):
        task = self._deletion_tasks.pop(channel_id, None)
        if task and not task.done():
            task.cancel()

    def _schedule_deletion(self, guild_id: int, channel_id: int, delay_seconds: int):
        self._cancel_deletion_task(channel_id)
        self._deletion_tasks[channel_id] = asyncio.create_task(
            self._delayed_delete(guild_id, channel_id, delay_seconds)
        )

    async def _delayed_delete(self, guild_id: int, channel_id: int, delay_seconds: int):
        try:
            await asyncio.sleep(delay_seconds)
            guild = self.bot.get_guild(guild_id)
            if guild is None:
                return

            channel = guild.get_channel(channel_id)
            if channel is None:
                if database.db is not None:
                    await database.db.temp_voice_channels.delete_one(
                        {"channel_id": {"$in": [channel_id, str(channel_id)]}}
                    )
                return

            active_members = [m for m in getattr(channel, "members", []) if not m.bot]
            if len(active_members) > 0:
                # Reoccupied before deletion
                return

            logger.info("Auto-deleting empty temp voice channel %s in guild %s", channel_id, guild_id)
            try:
                await channel.delete(reason="Temp voice auto-delete (channel empty)")
            except discord.NotFound:
                pass
            except Exception as e:
                logger.warning("Error deleting channel %s: %s", channel_id, e)

            if database.db is not None:
                await database.db.temp_voice_channels.delete_one(
                    {"channel_id": {"$in": [channel_id, str(channel_id)]}}
                )
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning("Error during delayed deletion of channel %s: %s", channel_id, e)
        finally:
            self._deletion_tasks.pop(channel_id, None)

    async def update_panel_embed(
        self,
        channel: discord.VoiceChannel,
        doc: dict,
        owner_id: Optional[int] = None,
        locked: Optional[bool] = None,
    ):
        panel_msg_id = doc.get("panel_message_id")
        if not panel_msg_id:
            return

        cur_owner = owner_id if owner_id is not None else doc.get("owner_id")
        cur_locked = locked if locked is not None else doc.get("locked", False)
        embed = build_panel_embed(
            channel.name, cur_owner, cur_locked, getattr(channel, "user_limit", 0)
        )
        try:
            msg = await channel.fetch_message(panel_msg_id)
            await msg.edit(embed=embed)
        except Exception as e:
            logger.debug("Could not edit panel message %s: %s", panel_msg_id, e)

    @commands.Cog.listener()
    async def on_voice_state_update(
        self, member: discord.Member, before: discord.VoiceState, after: discord.VoiceState
    ):
        if member.bot:
            return

        # No channel change (mute/deafen/etc.)
        if before.channel == after.channel:
            return

        # ---------------------------------------------------------------------
        # 1. DEPARTURE LOGIC: User left before.channel
        # ---------------------------------------------------------------------
        if before.channel is not None and database.db is not None:
            try:
                doc = await database.db.temp_voice_channels.find_one(
                    {"channel_id": {"$in": [before.channel.id, str(before.channel.id)]}}
                )
                if doc is not None:
                    # Remove user from participants list
                    await database.db.temp_voice_channels.update_one(
                        {"_id": doc["_id"]},
                        {"$pull": {"participants": member.id}},
                    )

                    active_members = [m for m in before.channel.members if not m.bot]
                    if len(active_members) == 0:
                        # Channel is empty -> schedule deletion
                        self._schedule_deletion(
                            before.channel.guild.id,
                            before.channel.id,
                            self._get_delete_delay(doc),
                        )
                    elif doc.get("owner_id") == member.id:
                        # Owner left while others remain -> transfer to earliest-joined remaining
                        participants = doc.get("participants", [])
                        active_ids = {m.id for m in active_members}
                        candidates = [uid for uid in participants if uid != member.id and uid in active_ids]
                        new_owner_id = candidates[0] if candidates else active_members[0].id

                        await database.db.temp_voice_channels.update_one(
                            {"_id": doc["_id"]},
                            {"$set": {"owner_id": new_owner_id}},
                        )
                        doc["owner_id"] = new_owner_id

                        new_owner = before.channel.guild.get_member(new_owner_id)
                        if new_owner:
                            try:
                                await before.channel.set_permissions(
                                    new_owner,
                                    connect=True,
                                    reason="Temp voice owner departure transfer",
                                )
                            except Exception as e:
                                logger.warning("Error granting permissions to new owner: %s", e)

                        await self.update_panel_embed(before.channel, doc, owner_id=new_owner_id)
                        try:
                            await before.channel.send(
                                f"👑 <@{member.id}> left the channel. Ownership has been transferred to <@{new_owner_id}>."
                            )
                        except Exception as e:
                            logger.debug("Failed to post transfer notification: %s", e)
            except Exception as e:
                logger.warning("Error processing departure from %s: %s", before.channel.id, e)

        # ---------------------------------------------------------------------
        # 2. JOIN LOGIC: User joined after.channel
        # ---------------------------------------------------------------------
        if after.channel is not None and database.db is not None:
            guild = member.guild

            # Check if joining an existing tracked temporary channel
            existing_doc = await database.db.temp_voice_channels.find_one(
                {"channel_id": {"$in": [after.channel.id, str(after.channel.id)]}}
            )
            if existing_doc is not None:
                # Cancel pending deletion task
                self._cancel_deletion_task(after.channel.id)
                # Track in participants
                await database.db.temp_voice_channels.update_one(
                    {"_id": existing_doc["_id"]},
                    {"$addToSet": {"participants": member.id}},
                )
                return

            # Check if joining trigger channel
            if not self.registry or not await self.registry.is_enabled(guild.id, "temp_voice"):
                return

            cfg = normalize_temp_voice_config(
                await self.registry.get_config(guild.id, "temp_voice")
            )
            areas = cfg.get("areas") or []

            # Find the area whose trigger channel was joined (string IDs from config,
            # int IDs from the gateway — compare canonically).
            matched_area = None
            for area in areas:
                trigger_id = area.get("trigger_channel_id")
                if not trigger_id:
                    continue
                try:
                    if int(trigger_id) == after.channel.id:
                        matched_area = area
                        break
                except (TypeError, ValueError):
                    continue

            if matched_area is None:
                return

            me = guild.me
            if not me or not after.channel.permissions_for(me).connect:
                logger.warning("Bot lacks connect permission to trigger channel in %s", guild.id)
                return
            if not me.guild_permissions.manage_channels or not me.guild_permissions.move_members:
                logger.warning(
                    "Bot lacks manage_channels or move_members permissions in guild %s", guild.id
                )
                return

            # Check guild temporary channel cap
            cur_count = await database.db.temp_voice_channels.count_documents(
                {"guild_id": {"$in": [guild.id, str(guild.id)]}}
            )
            if cur_count >= MAX_TEMP_CHANNELS_PER_GUILD:
                logger.warning(
                    "Guild %s reached maximum temporary channel limit (%s)",
                    guild.id,
                    MAX_TEMP_CHANNELS_PER_GUILD,
                )
                return

            # Prevent double creation from simultaneous events
            if member.id in self._creating_users:
                return
            self._creating_users.add(member.id)

            try:
                # Monotonically increasing counter for naming
                n = await get_next_temp_voice_counter(
                    database.db.temp_voice_meta, guild.id
                )

                # Channel name formatting (per-area template)
                naming_template = matched_area.get("naming") or "{username}'s lounge"
                ch_name = render_temp_voice_name(
                    naming_template, member.display_name, n, guild.name
                )

                # Category resolution (per-area destination or fallback to trigger channel category)
                category = None
                cat_id = matched_area.get("category_id")
                if cat_id:
                    candidate = guild.get_channel(int(cat_id))
                    if isinstance(candidate, discord.CategoryChannel):
                        category = candidate
                    else:
                        logger.info(
                            "Configured category %s not found in guild %s; falling back to trigger channel category",
                            cat_id,
                            guild.id,
                        )
                if category is None and isinstance(after.channel.category, discord.CategoryChannel):
                    category = after.channel.category

                # Overwrites: Preserve category locks and trigger channel's private/role permissions
                overwrites = dict(category.overwrites) if category else {}
                for target, ow in after.channel.overwrites.items():
                    overwrites[target] = ow

                # Explicitly ensure the creator (owner) can view, connect, speak, and manage their room
                member_ow = overwrites.get(member, discord.PermissionOverwrite())
                member_ow.view_channel = True
                member_ow.connect = True
                member_ow.speak = True
                member_ow.manage_channels = True
                member_ow.move_members = True
                overwrites[member] = member_ow

                # Ensure bot has necessary access to manage and move members
                if me:
                    me_ow = overwrites.get(me, discord.PermissionOverwrite())
                    me_ow.view_channel = True
                    me_ow.connect = True
                    me_ow.manage_channels = True
                    me_ow.move_members = True
                    overwrites[me] = me_ow

                # Check if channel is initially locked for @everyone (e.g. trigger channel or category was private)
                everyone_ow = overwrites.get(guild.default_role)
                is_initially_locked = bool(
                    everyone_ow and (everyone_ow.connect is False or everyone_ow.view_channel is False)
                )

                user_limit = max(0, min(99, int(matched_area.get("user_limit", 0) or 0)))

                new_ch = await guild.create_voice_channel(
                    name=ch_name,
                    category=category,
                    user_limit=user_limit,
                    overwrites=overwrites,
                    reason=f"Temp voice created for {member.display_name}",
                )

                # Move member into new channel
                try:
                    await member.move_to(new_ch, reason="Moved to new temporary voice channel")
                except discord.HTTPException as e:
                    logger.warning("Could not move member %s to temp channel %s: %s", member.id, new_ch.id, e)
                    # If member disconnected before move, schedule deletion
                    if len([m for m in new_ch.members if not m.bot]) == 0:
                        self._schedule_deletion(
                            guild.id,
                            new_ch.id,
                            max(15, min(3600, int(matched_area.get("auto_delete_seconds", DEFAULT_AUTO_DELETE_SECONDS) or DEFAULT_AUTO_DELETE_SECONDS))),
                        )

                # Send control panel message into the channel
                panel_embed = build_panel_embed(
                    new_ch.name, member.id, locked=is_initially_locked, user_limit=user_limit
                )
                panel_view = build_panel_view(new_ch.id)
                panel_msg = None
                try:
                    panel_msg = await new_ch.send(embed=panel_embed, view=panel_view)
                except Exception as e:
                    logger.warning("Failed to send control panel message to channel %s: %s", new_ch.id, e)

                # Save channel document
                doc = {
                    "guild_id": guild.id,
                    "channel_id": new_ch.id,
                    "owner_id": member.id,
                    "locked": is_initially_locked,
                    "created_at": datetime.now(timezone.utc),
                    "participants": [member.id],
                    "panel_message_id": panel_msg.id if panel_msg else None,
                    "area_id": matched_area.get("id"),
                    "auto_delete_seconds": max(
                        15,
                        min(
                            3600,
                            int(
                                matched_area.get(
                                    "auto_delete_seconds", DEFAULT_AUTO_DELETE_SECONDS
                                )
                                or DEFAULT_AUTO_DELETE_SECONDS
                            ),
                        ),
                    ),
                }
                await database.db.temp_voice_channels.insert_one(doc)

            except Exception as e:
                logger.exception("Failed to create temporary voice channel: %s", e)
            finally:
                self._creating_users.discard(member.id)

    # =========================================================================
    # PERSISTENT COMPONENT & MODAL INTERACTION HANDLER ("tv:" prefix)
    # =========================================================================
    @commands.Cog.listener()
    async def on_interaction(self, interaction: discord.Interaction):
        if interaction.type not in (
            discord.InteractionType.component,
            discord.InteractionType.modal_submit,
        ):
            return

        data = interaction.data or {}
        custom_id = data.get("custom_id", "")
        if not custom_id.startswith("tv:"):
            return

        if interaction.guild_id is None or interaction.guild is None:
            return

        if not self.registry or not await self.registry.is_enabled(
            interaction.guild_id, "temp_voice"
        ):
            await interaction.response.send_message(
                "Temporary voice channels are currently disabled on this server.",
                ephemeral=True,
            )
            return

        # Parse custom_id: "tv:{channel_id}:{action}"
        parts = custom_id.split(":")
        if len(parts) < 3:
            return

        try:
            channel_id = int(parts[1])
        except ValueError:
            return
        action = parts[2]

        if database.db is None:
            await interaction.response.send_message("Database unavailable.", ephemeral=True)
            return

        doc = await database.db.temp_voice_channels.find_one(
            {"channel_id": {"$in": [channel_id, str(channel_id)]}}
        )
        if not doc:
            await interaction.response.send_message(
                "This temporary voice channel is no longer tracked or has been closed.",
                ephemeral=True,
            )
            return

        # Owner verification
        if doc.get("owner_id") != interaction.user.id:
            await interaction.response.send_message(
                "⛔ Only the channel owner can use these controls.", ephemeral=True
            )
            return

        channel = interaction.guild.get_channel(channel_id)
        if channel is None:
            await database.db.temp_voice_channels.delete_one({"_id": doc["_id"]})
            self._cancel_deletion_task(channel_id)
            await interaction.response.send_message(
                "This channel no longer exists.", ephemeral=True
            )
            return

        # Action: LOCK
        if action == "lock":
            try:
                await channel.set_permissions(
                    interaction.guild.default_role,
                    connect=False,
                    reason="Temp voice locked by owner",
                )
                await channel.set_permissions(
                    interaction.user,
                    connect=True,
                    reason="Temp voice owner overwrite",
                )
                await database.db.temp_voice_channels.update_one(
                    {"_id": doc["_id"]}, {"$set": {"locked": True}}
                )
                doc["locked"] = True
                await self.update_panel_embed(channel, doc, locked=True)
                await interaction.response.send_message(
                    "🔒 Channel locked. Other members cannot join.", ephemeral=True
                )
            except discord.Forbidden:
                await interaction.response.send_message(
                    "I lack permissions to edit channel permissions.", ephemeral=True
                )
            except Exception as e:
                logger.warning("Error locking channel: %s", e)
                await interaction.response.send_message("Failed to lock channel.", ephemeral=True)

        # Action: UNLOCK
        elif action == "unlock":
            try:
                await channel.set_permissions(
                    interaction.guild.default_role,
                    connect=None,
                    reason="Temp voice unlocked by owner",
                )
                await database.db.temp_voice_channels.update_one(
                    {"_id": doc["_id"]}, {"$set": {"locked": False}}
                )
                doc["locked"] = False
                await self.update_panel_embed(channel, doc, locked=False)
                await interaction.response.send_message(
                    "🔓 Channel unlocked. Members can freely join.", ephemeral=True
                )
            except discord.Forbidden:
                await interaction.response.send_message(
                    "I lack permissions to edit channel permissions.", ephemeral=True
                )
            except Exception as e:
                logger.warning("Error unlocking channel: %s", e)
                await interaction.response.send_message("Failed to unlock channel.", ephemeral=True)

        # Action: LIMIT (opens Modal)
        elif action == "limit":
            modal = TempVoiceLimitModal(channel, self, doc)
            await interaction.response.send_modal(modal)

        # Action: RENAME (opens Modal)
        elif action == "rename":
            modal = TempVoiceRenameModal(channel, self, doc)
            await interaction.response.send_modal(modal)

        # Action: TRANSFER (shows Select Menu of active members)
        elif action == "transfer":
            active_members = [
                m for m in channel.members if not m.bot and m.id != interaction.user.id
            ]
            if not active_members:
                await interaction.response.send_message(
                    "There are no other members in this channel to transfer ownership to.",
                    ephemeral=True,
                )
                return
            view = TransferSelectView(channel.id, active_members)
            await interaction.response.send_message(
                "Select a member to transfer ownership to:", view=view, ephemeral=True
            )

        # Action: TRANSFER_SELECT
        elif action == "transfer_select":
            values = data.get("values", [])
            if not values:
                return
            try:
                new_owner_id = int(values[0])
            except ValueError:
                return

            new_owner = interaction.guild.get_member(new_owner_id)
            if not new_owner:
                await interaction.response.send_message("Selected member not found.", ephemeral=True)
                return

            await database.db.temp_voice_channels.update_one(
                {"_id": doc["_id"]}, {"$set": {"owner_id": new_owner_id}}
            )
            doc["owner_id"] = new_owner_id

            try:
                # Grant full owner rights to new owner
                new_ow = channel.overwrites_for(new_owner)
                new_ow.connect = True
                new_ow.view_channel = True
                new_ow.speak = True
                new_ow.manage_channels = True
                new_ow.move_members = True
                await channel.set_permissions(
                    new_owner, overwrite=new_ow, reason="Temp voice ownership transferred"
                )
                # Revoke manage permissions from previous owner
                prev_ow = channel.overwrites_for(interaction.user)
                prev_ow.manage_channels = None
                prev_ow.move_members = None
                await channel.set_permissions(
                    interaction.user,
                    overwrite=prev_ow,
                    reason="Temp voice ownership transferred (revoke previous owner manage perms)",
                )
            except Exception as e:
                logger.warning("Error setting permissions on transfer: %s", e)

            await self.update_panel_embed(channel, doc, owner_id=new_owner_id)
            await interaction.response.send_message(
                f"👑 Ownership transferred to <@{new_owner_id}>.", ephemeral=True
            )
            try:
                await channel.send(
                    f"👑 <@{interaction.user.id}> transferred channel ownership to <@{new_owner_id}>."
                )
            except Exception as e:
                logger.debug("Failed to post transfer notification in channel: %s", e)

        # Action: DELETE (prompt confirmation)
        elif action == "delete":
            view = DeleteConfirmView(channel.id)
            await interaction.response.send_message(
                "⚠️ Are you sure you want to delete this temporary voice channel? All members will be disconnected.",
                view=view,
                ephemeral=True,
            )

        # Action: DELETE_CANCEL
        elif action == "delete_cancel":
            await interaction.response.send_message("Channel deletion cancelled.", ephemeral=True)

        # Action: DELETE_CONFIRM
        elif action == "delete_confirm":
            await interaction.response.send_message(
                "🗑️ Deleting temporary voice channel...", ephemeral=True
            )
            self._cancel_deletion_task(channel.id)
            try:
                await channel.delete(
                    reason=f"Temp voice deleted by owner {interaction.user.display_name}"
                )
            except discord.NotFound:
                pass
            except Exception as e:
                logger.warning("Error deleting channel %s: %s", channel.id, e)

            await database.db.temp_voice_channels.delete_one({"_id": doc["_id"]})

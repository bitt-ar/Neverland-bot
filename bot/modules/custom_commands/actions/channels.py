from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Optional, TYPE_CHECKING

import discord

from core import database

if TYPE_CHECKING:
    from ..workflow import WorkflowRunner

logger = logging.getLogger(__name__)


class TempVoiceRegistry(dict):
    """Backwards-compatible registry mapping channel_id -> channel metadata dict."""

    def add(self, channel_id: int, **meta) -> None:
        self[channel_id] = meta or {"empty_timeout": 60, "channel_id": channel_id}

    def remove(self, channel_id: int) -> None:
        self.pop(channel_id, None)


# In-memory registry of voice channels created via custom command workflow
CUSTOM_TEMP_VOICE_CHANNELS: TempVoiceRegistry = TempVoiceRegistry()


def cancel_empty_channel_cleanup(channel_id: int) -> None:
    """Cancels any pending delayed deletion timer when a user enters the channel."""
    meta = CUSTOM_TEMP_VOICE_CHANNELS.get(channel_id)
    if meta and meta.get("cleanup_task"):
        task = meta["cleanup_task"]
        if not task.done():
            task.cancel()
        meta["cleanup_task"] = None
        logger.debug("Cancelled pending empty deletion task for channel %s (user joined)", channel_id)


def schedule_empty_channel_cleanup(channel: discord.VoiceChannel, delay_seconds: int) -> None:
    """Schedules an asynchronous task to delete an empty voice channel after delay_seconds."""
    if delay_seconds <= 0:
        # If 0, channel is permanent (0 = دائمة) and must not be deleted
        return

    # Cancel existing task if any
    cancel_empty_channel_cleanup(channel.id)

    async def _delayed_delete():
        try:
            if delay_seconds > 0:
                await asyncio.sleep(delay_seconds)

            # Re-check channel status
            if channel.id in CUSTOM_TEMP_VOICE_CHANNELS:
                fresh_channel = channel.guild.get_channel(channel.id)
                if fresh_channel and len(getattr(fresh_channel, "members", [])) == 0:
                    CUSTOM_TEMP_VOICE_CHANNELS.pop(channel.id, None)
                    if database.db is not None:
                        try:
                            await database.db.custom_temp_voice_channels.delete_one({"channel_id": channel.id})
                        except Exception:
                            pass
                    await fresh_channel.delete(
                        reason=f"Temporary custom voice channel remained empty for {delay_seconds}s"
                    )
                    logger.info(
                        "Deleted empty custom temp voice channel %s after %ds timeout",
                        channel.id,
                        delay_seconds,
                    )
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.debug("Failed deleting empty temp voice channel %s: %s", channel.id, e)

    meta = CUSTOM_TEMP_VOICE_CHANNELS.get(channel.id)
    if meta is not None:
        meta["cleanup_task"] = asyncio.create_task(_delayed_delete())


async def restore_persistent_temp_voice_channels(bot: discord.Client) -> None:
    """Restores tracked custom temp voice channels from MongoDB on bot startup."""
    if database.db is None:
        return

    try:
        count = 0
        cursor = database.db.custom_temp_voice_channels.find()
        async for doc in cursor:
            chan_id = int(doc.get("channel_id", 0))
            if not chan_id:
                continue

            channel = bot.get_channel(chan_id)
            if channel is None:
                # Channel was deleted while bot was offline
                await database.db.custom_temp_voice_channels.delete_one({"_id": doc["_id"]})
                continue

            empty_timeout = int(doc.get("empty_timeout", 60) or 0)
            CUSTOM_TEMP_VOICE_CHANNELS[chan_id] = {
                "channel_id": chan_id,
                "guild_id": doc.get("guild_id"),
                "creator_id": doc.get("creator_id"),
                "empty_timeout": empty_timeout,
                "cleanup_task": None,
            }
            count += 1

            # If not permanent and currently empty, schedule deletion
            if empty_timeout > 0 and isinstance(channel, discord.VoiceChannel) and len(channel.members) == 0:
                schedule_empty_channel_cleanup(channel, empty_timeout)

        if count > 0:
            logger.info("Restored %d active custom temp voice channels from database.", count)
    except Exception as e:
        logger.warning("Could not restore custom temp voice channels from database: %s", e)


async def execute_delete_trigger(runner: WorkflowRunner, action: dict[str, Any]) -> bool:
    """Deletes the user's command trigger message."""
    if runner.message and hasattr(runner.message, "delete"):
        try:
            await runner.message.delete()
            runner.trigger_deleted = True
            return True
        except (discord.Forbidden, discord.NotFound, discord.HTTPException) as e:
            logger.debug("Could not delete trigger message: %s", e)
            return False
    return False


async def execute_pin_message(runner: WorkflowRunner, action: dict[str, Any]) -> bool:
    """Pins either the trigger message or the bot's last sent message in the channel."""
    target_type = action.get("target", "bot_message").lower()
    msg_to_pin: Optional[discord.Message] = None

    if target_type == "trigger":
        msg_to_pin = runner.message if (runner.message and not runner.trigger_deleted) else None
    else:
        msg_to_pin = runner.last_sent_message or runner.message

    if not msg_to_pin or not hasattr(msg_to_pin, "pin"):
        logger.debug("No valid message found to pin")
        return False

    try:
        await msg_to_pin.pin(reason="Custom command workflow: pin_message")
        return True
    except (discord.Forbidden, discord.HTTPException) as e:
        logger.warning("Failed pinning message: %s", e)
        return False


async def execute_slowmode_channel(runner: WorkflowRunner, action: dict[str, Any]) -> bool:
    """Updates the channel slowmode duration in seconds (0 to 21600)."""
    if not runner.channel or not isinstance(runner.channel, discord.TextChannel):
        return False

    try:
        seconds = max(0, min(int(action.get("seconds", 0) or 0), 21600))
        await runner.channel.edit(
            slowmode_delay=seconds,
            reason=f"Custom command workflow: slowmode set to {seconds}s",
        )
        return True
    except (discord.Forbidden, discord.HTTPException) as e:
        logger.warning("Failed setting slowmode in channel %s: %s", runner.channel.id, e)
        return False


async def execute_lock_channel(runner: WorkflowRunner, action: dict[str, Any]) -> bool:
    """Locks or unlocks a text channel by toggling @everyone send_messages permission."""
    if not runner.guild or not runner.channel or not isinstance(runner.channel, discord.TextChannel):
        return False

    operation = str(action.get("action", "lock")).strip().lower()
    everyone_role = runner.guild.default_role

    try:
        current_overwrites = runner.channel.overwrites_for(everyone_role)
        if operation == "unlock":
            current_overwrites.send_messages = None  # Reset to default/allow
            await runner.channel.set_permissions(
                everyone_role,
                overwrite=current_overwrites,
                reason="Custom command workflow: channel unlocked",
            )
        else:
            current_overwrites.send_messages = False  # Deny speaking
            await runner.channel.set_permissions(
                everyone_role,
                overwrite=current_overwrites,
                reason="Custom command workflow: channel locked",
            )
        return True
    except (discord.Forbidden, discord.HTTPException) as e:
        logger.warning("Failed toggling lock on channel %s: %s", runner.channel.id, e)
        return False


async def execute_create_temp_voice(runner: WorkflowRunner, action: dict[str, Any]) -> Optional[discord.VoiceChannel]:
    """Creates a temporary voice channel that inherits category permissions and supports 0=permanent or empty timeout."""
    from ..workflow import interpolate_text

    if not runner.guild or not runner.member:
        return None

    name_tmpl = action.get("name") or "{user}'s Voice"
    chan_name = interpolate_text(name_tmpl, runner.context).strip()[:100] or f"{runner.member.name}'s Room"
    user_limit = max(0, min(int(action.get("user_limit", 0) or 0), 99))

    # Empty timeout in seconds: 0 = Permanent (دائمة - لا تُحذف أبداً عند الفراغ), > 0 = Auto-delete when empty after X seconds
    empty_timeout_raw = action.get("empty_timeout")
    if empty_timeout_raw is None:
        empty_timeout = 60  # default 60 seconds if not specified
    else:
        try:
            empty_timeout = max(0, int(empty_timeout_raw))
        except (ValueError, TypeError):
            empty_timeout = 60

    category: Optional[discord.CategoryChannel] = None
    cat_id_raw = action.get("category_id")
    if cat_id_raw:
        try:
            category = runner.guild.get_channel(int(str(cat_id_raw)))
            if not isinstance(category, discord.CategoryChannel):
                category = None
        except (ValueError, TypeError):
            pass

    # Fallback to current channel's category if available
    if not category and runner.channel and hasattr(runner.channel, "category"):
        category = runner.channel.category

    inherit_perms = action.get("inherit_category_permissions", True)
    overwrites: dict[Any, discord.PermissionOverwrite] = {}

    # Enforce maximum custom temp voice channels per guild to prevent DoS (N-M2)
    active_guild_channels = [
        c for c in CUSTOM_TEMP_VOICE_CHANNELS.values()
        if str(c.get("guild_id")) == str(runner.guild.id)
    ]
    if len(active_guild_channels) >= 25:
        logger.warning("Guild %s reached maximum custom temp voice channels limit (25)", runner.guild.id)
        if runner.channel and hasattr(runner.channel, "send"):
            try:
                await runner.channel.send("⛔ Server reached the maximum limit of 25 active temporary voice channels.", delete_after=10)
            except Exception:
                pass
        return None

    try:
        # Inherit category permissions (Private vs Public, specific role access)
        if category and inherit_perms and getattr(category, "overwrites", None):
            for target, ow in category.overwrites.items():
                overwrites[target] = discord.PermissionOverwrite.from_pair(*ow.pair())
        elif not category:
            # Default public view/connect if no category provided
            overwrites[runner.guild.default_role] = discord.PermissionOverwrite(connect=True, view_channel=True)

        # Grant room creator full permissions to see, join, and manage their room
        creator_ow = overwrites.get(runner.member, discord.PermissionOverwrite())
        creator_ow.view_channel = True
        creator_ow.connect = True
        creator_ow.manage_channels = True
        creator_ow.move_members = True
        overwrites[runner.member] = creator_ow

        voice_channel = await runner.guild.create_voice_channel(
            name=chan_name,
            category=category,
            user_limit=user_limit,
            overwrites=overwrites,
            reason=f"Custom command temp voice created for {runner.member.name}",
        )

        # Register channel in memory
        CUSTOM_TEMP_VOICE_CHANNELS[voice_channel.id] = {
            "channel_id": voice_channel.id,
            "guild_id": runner.guild.id,
            "creator_id": runner.member.id,
            "empty_timeout": empty_timeout,
            "cleanup_task": None,
        }

        # Persist to database
        if database.db is not None:
            try:
                await database.db.custom_temp_voice_channels.update_one(
                    {"channel_id": voice_channel.id},
                    {
                        "$set": {
                            "channel_id": voice_channel.id,
                            "guild_id": runner.guild.id,
                            "creator_id": runner.member.id,
                            "empty_timeout": empty_timeout,
                            "created_at": time.time(),
                        }
                    },
                    upsert=True,
                )
            except Exception as e:
                logger.debug("Failed saving temp voice channel to database: %s", e)

        # If member is currently in a voice channel, attempt moving them into their newly created room
        moved_in = False
        if isinstance(runner.member, discord.Member) and runner.member.voice and runner.member.voice.channel:
            try:
                await runner.member.move_to(voice_channel, reason="Moved to newly created temp voice channel")
                moved_in = True
            except Exception:
                pass

        # If empty_timeout > 0 and member was not moved in (channel currently empty):
        # schedule cleanup so empty ghost rooms are not left indefinitely
        if empty_timeout > 0 and not moved_in:
            schedule_empty_channel_cleanup(voice_channel, empty_timeout)

        return voice_channel
    except (discord.Forbidden, discord.HTTPException) as e:
        logger.warning("Failed creating temp voice channel in guild %s: %s", runner.guild.id, e)
        return None


async def cleanup_empty_custom_voice_channels(
    member: discord.Member, before: discord.VoiceState, after: discord.VoiceState
):
    """Voice state update listener helper:
    1. Cancels deletion timer if a user joins an active temp voice channel.
    2. Starts empty deletion timer if the last user disconnects (unless empty_timeout=0 permanent).
    """
    # Case 1: User joined a temp voice channel
    if after.channel and after.channel.id in CUSTOM_TEMP_VOICE_CHANNELS:
        cancel_empty_channel_cleanup(after.channel.id)

    # Case 2: User left a temp voice channel
    if before.channel and before.channel.id in CUSTOM_TEMP_VOICE_CHANNELS:
        meta = CUSTOM_TEMP_VOICE_CHANNELS.get(before.channel.id)
        if not meta:
            return

        empty_timeout = meta.get("empty_timeout", 60)
        if empty_timeout == 0:
            # Channel is permanent (0 = دائمة)
            return

        # Check if the channel is now empty
        if len(before.channel.members) == 0:
            schedule_empty_channel_cleanup(before.channel, empty_timeout)

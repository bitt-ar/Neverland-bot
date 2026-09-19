from __future__ import annotations

import logging
from typing import Any, Optional, Set, TYPE_CHECKING

import discord

if TYPE_CHECKING:
    from ..workflow import WorkflowRunner

logger = logging.getLogger(__name__)

# In-memory registry of voice channel IDs created via custom command workflow
CUSTOM_TEMP_VOICE_CHANNELS: Set[int] = set()


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
    """Creates a temporary voice channel for the member that auto-deletes when empty."""
    from ..workflow import interpolate_text

    if not runner.guild or not runner.member:
        return None

    name_tmpl = action.get("name") or "{user}'s Voice"
    chan_name = interpolate_text(name_tmpl, runner.context).strip()[:100] or f"{runner.member.name}'s Room"
    user_limit = max(0, min(int(action.get("user_limit", 0) or 0), 99))

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

    try:
        overwrites = {
            runner.guild.default_role: discord.PermissionOverwrite(connect=True, view_channel=True),
            runner.member: discord.PermissionOverwrite(manage_channels=True, move_members=True, connect=True),
        }
        voice_channel = await runner.guild.create_voice_channel(
            name=chan_name,
            category=category,
            user_limit=user_limit,
            overwrites=overwrites,
            reason=f"Custom command temp voice created for {runner.member.name}",
        )
        CUSTOM_TEMP_VOICE_CHANNELS.add(voice_channel.id)

        # If member is currently in another voice channel in the same guild, attempt moving them in
        if isinstance(runner.member, discord.Member) and runner.member.voice and runner.member.voice.channel:
            try:
                await runner.member.move_to(voice_channel, reason="Moved to newly created temp voice channel")
            except Exception:
                pass

        return voice_channel
    except (discord.Forbidden, discord.HTTPException) as e:
        logger.warning("Failed creating temp voice channel in guild %s: %s", runner.guild.id, e)
        return None


async def cleanup_empty_custom_voice_channels(member: discord.Member, before: discord.VoiceState, after: discord.VoiceState):
    """Voice state update listener helper that removes custom temp voice channels when empty."""
    if before.channel and before.channel.id in CUSTOM_TEMP_VOICE_CHANNELS:
        # Check if anyone is left in the channel
        if len(before.channel.members) == 0:
            try:
                CUSTOM_TEMP_VOICE_CHANNELS.remove(before.channel.id)
                await before.channel.delete(reason="Temporary custom voice channel is now empty")
                logger.info("Deleted empty custom temp voice channel %s", before.channel.id)
            except Exception as e:
                logger.debug("Failed deleting empty temp voice channel %s: %s", before.channel.id, e)

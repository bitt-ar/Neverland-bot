from __future__ import annotations

import logging
import random
from typing import Any, Optional, TYPE_CHECKING

import discord

if TYPE_CHECKING:
    from ..workflow import WorkflowRunner

logger = logging.getLogger(__name__)


async def execute_send_message(runner: WorkflowRunner, action: dict[str, Any]) -> Optional[discord.Message]:
    """Sends a regular channel message or embed."""
    from ..workflow import interpolate_text, build_embed

    content_tmpl = action.get("content") or action.get("message_content")
    content = interpolate_text(content_tmpl, runner.context) if content_tmpl else None
    embed = build_embed(action.get("embed"), runner.context)

    if not content and not embed:
        return None

    target_channel = runner.channel
    target_chan_id = action.get("channel_id")
    if target_chan_id and runner.guild:
        c = runner.guild.get_channel(int(str(target_chan_id)))
        if c:
            target_channel = c

    if target_channel and hasattr(target_channel, "send"):
        msg = await target_channel.send(content=content, embed=embed)
        runner.last_sent_message = msg
        return msg
    return None


async def execute_reply(runner: WorkflowRunner, action: dict[str, Any], ephemeral: bool = True) -> bool:
    """Replies to an interaction or a chat message."""
    from ..workflow import interpolate_text, build_embed

    content_tmpl = action.get("content") or action.get("message_content")
    content = interpolate_text(content_tmpl, runner.context) if content_tmpl else None
    embed = build_embed(action.get("embed"), runner.context)

    if not content and not embed:
        content = "Done!"

    # If active Discord interaction
    if runner.interaction:
        if getattr(runner, "modal_shown", False):
            # Modal dialog is currently presented to user; do not send premature followup
            return True
        if not runner.interaction.response.is_done():
            await runner.interaction.response.send_message(content=content, embed=embed, ephemeral=ephemeral)
            runner.responded_interaction = True
            return True
        else:
            await runner.interaction.followup.send(content=content, embed=embed, ephemeral=ephemeral)
            return True

    # Fallback to chat message reply
    if runner.message and hasattr(runner.message, "reply"):
        try:
            msg = await runner.message.reply(content=content, embed=embed)
            runner.last_sent_message = msg
            return True
        except Exception:
            pass

    # Fallback to channel send
    if runner.channel and hasattr(runner.channel, "send"):
        msg = await runner.channel.send(content=content, embed=embed)
        runner.last_sent_message = msg
        return True

    return False


async def execute_send_dm(runner: WorkflowRunner, action: dict[str, Any]) -> bool:
    """Sends a private direct message to the triggering member."""
    from ..workflow import interpolate_text, build_embed

    if not runner.member:
        return False

    content_tmpl = action.get("content") or action.get("message_content")
    content = interpolate_text(content_tmpl, runner.context) if content_tmpl else None
    embed = build_embed(action.get("embed"), runner.context)

    if not content and not embed:
        return False

    try:
        dm_channel = runner.member.dm_channel or await runner.member.create_dm()
        await dm_channel.send(content=content, embed=embed)
        return True
    except (discord.Forbidden, discord.HTTPException) as e:
        logger.warning("Could not send DM to user %s: %s", getattr(runner.member, "id", None), e)
        return False


async def execute_add_reaction(runner: WorkflowRunner, action: dict[str, Any]) -> bool:
    """Adds an emoji reaction to the invoking message or last sent message."""
    emoji_raw = str(action.get("emoji") or "").strip()
    if not emoji_raw:
        return False

    # Prefer trigger message, fallback to last sent bot message
    target_msg = runner.message if (runner.message and not runner.trigger_deleted) else runner.last_sent_message
    if not target_msg or not hasattr(target_msg, "add_reaction"):
        logger.debug("No valid message target for add_reaction")
        return False

    try:
        # Try raw emoji string first (unicode or <:name:id>)
        await target_msg.add_reaction(emoji_raw)
        return True
    except (discord.HTTPException, discord.InvalidArgument) as e:
        logger.warning("Failed adding reaction '%s': %s", emoji_raw, e)
        return False


async def execute_random_response(runner: WorkflowRunner, action: dict[str, Any]) -> Optional[Any]:
    """Randomly selects one variation from choices and dispatches it."""
    from ..workflow import interpolate_text, build_embed

    choices = action.get("choices") or []
    if not isinstance(choices, list) or not choices:
        return None

    selected = random.choice(choices)
    content_tmpl = None
    embed_dict = None

    if isinstance(selected, str):
        content_tmpl = selected
    elif isinstance(selected, dict):
        content_tmpl = selected.get("content") or selected.get("message_content")
        embed_dict = selected.get("embed")

    content = interpolate_text(content_tmpl, runner.context) if content_tmpl else None
    embed = build_embed(embed_dict, runner.context) if embed_dict else None

    if not content and not embed:
        return None

    # Determine dispatch target: reply if interaction, else channel
    if runner.interaction and not runner.interaction.response.is_done():
        ephemeral = bool(action.get("ephemeral", False))
        await runner.interaction.response.send_message(content=content, embed=embed, ephemeral=ephemeral)
        runner.responded_interaction = True
        return True
    elif runner.interaction:
        ephemeral = bool(action.get("ephemeral", False))
        await runner.interaction.followup.send(content=content, embed=embed, ephemeral=ephemeral)
        return True

    target_channel = runner.channel
    target_chan_id = action.get("channel_id")
    if target_chan_id and runner.guild:
        c = runner.guild.get_channel(int(str(target_chan_id)))
        if c:
            target_channel = c

    if target_channel and hasattr(target_channel, "send"):
        msg = await target_channel.send(content=content, embed=embed)
        runner.last_sent_message = msg
        return msg
    return None

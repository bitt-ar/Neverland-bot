from __future__ import annotations

import datetime
import logging
from typing import Any, TYPE_CHECKING

import discord

if TYPE_CHECKING:
    from ..workflow import WorkflowRunner

logger = logging.getLogger(__name__)


async def execute_send_log(runner: WorkflowRunner, action: dict[str, Any]) -> bool:
    """Sends a formatted audit log message or embed to a designated staff channel."""
    from ..workflow import interpolate_text, build_embed

    if not runner.guild:
        return False

    channel_id_raw = action.get("channel_id")
    if not channel_id_raw:
        return False

    try:
        channel = runner.guild.get_channel(int(str(channel_id_raw)))
    except (ValueError, TypeError):
        return False

    if not channel or not hasattr(channel, "send"):
        return False

    content_tmpl = action.get("content") or action.get("message_content")
    content = interpolate_text(content_tmpl, runner.context) if content_tmpl else None
    embed = build_embed(action.get("embed"), runner.context)

    if not content and not embed:
        content = f"**[Custom Command Log]** Executed by {runner.context.get('user_mention', 'User')}"

    try:
        await channel.send(content=content, embed=embed)
        return True
    except (discord.Forbidden, discord.HTTPException) as e:
        logger.warning("Failed sending workflow staff log to channel %s: %s", channel.id, e)
        return False


async def execute_timeout_member(runner: WorkflowRunner, action: dict[str, Any]) -> bool:
    """Applies a temporary timeout/mute to the member with hierarchy checks."""
    from ..workflow import interpolate_text

    if not runner.guild or not runner.member or not isinstance(runner.member, discord.Member):
        return False

    # Protection: Cannot timeout guild owner or administrators
    if runner.member.id == runner.guild.owner_id or runner.member.guild_permissions.administrator:
        logger.debug("Cannot timeout server owner or administrator")
        return False

    # Hierarchy check
    bot_member = runner.guild.me
    if bot_member and bot_member.top_role <= runner.member.top_role:
        logger.warning("Cannot timeout member %s: top role is higher than or equal to bot's", runner.member.id)
        return False

    duration_minutes = max(1, min(int(action.get("duration_minutes", 5) or 5), 40320))  # Max 28 days
    reason_tmpl = action.get("reason") or "Custom command workflow: timeout"
    reason = interpolate_text(reason_tmpl, runner.context)[:512]

    until = discord.utils.utcnow() + datetime.timedelta(minutes=duration_minutes)
    try:
        await runner.member.timeout(until, reason=reason)
        return True
    except (discord.Forbidden, discord.HTTPException) as e:
        logger.warning("Failed timing out member %s: %s", runner.member.id, e)
        return False


async def execute_kick_member(runner: WorkflowRunner, action: dict[str, Any]) -> bool:
    """Kicks the member from the server with hierarchy safety checks."""
    from ..workflow import interpolate_text

    if not runner.guild or not runner.member or not isinstance(runner.member, discord.Member):
        return False

    if runner.member.id == runner.guild.owner_id or runner.member.guild_permissions.administrator:
        logger.debug("Cannot kick server owner or administrator")
        return False

    bot_member = runner.guild.me
    if bot_member and bot_member.top_role <= runner.member.top_role:
        logger.warning("Cannot kick member %s: top role >= bot's role", runner.member.id)
        return False

    reason_tmpl = action.get("reason") or "Custom command workflow: kick"
    reason = interpolate_text(reason_tmpl, runner.context)[:512]

    try:
        await runner.member.kick(reason=reason)
        return True
    except (discord.Forbidden, discord.HTTPException) as e:
        logger.warning("Failed kicking member %s: %s", runner.member.id, e)
        return False


async def execute_ban_member(runner: WorkflowRunner, action: dict[str, Any]) -> bool:
    """Bans the member from the server with hierarchy safety checks."""
    from ..workflow import interpolate_text

    if not runner.guild or not runner.member or not isinstance(runner.member, discord.Member):
        return False

    if runner.member.id == runner.guild.owner_id or runner.member.guild_permissions.administrator:
        logger.debug("Cannot ban server owner or administrator")
        return False

    bot_member = runner.guild.me
    if bot_member and bot_member.top_role <= runner.member.top_role:
        logger.warning("Cannot ban member %s: top role >= bot's role", runner.member.id)
        return False

    reason_tmpl = action.get("reason") or "Custom command workflow: ban"
    reason = interpolate_text(reason_tmpl, runner.context)[:512]
    delete_days = max(0, min(int(action.get("delete_message_days", 0) or 0), 7))

    try:
        await runner.member.ban(reason=reason, delete_message_days=delete_days)
        return True
    except (discord.Forbidden, discord.HTTPException) as e:
        logger.warning("Failed banning member %s: %s", runner.member.id, e)
        return False

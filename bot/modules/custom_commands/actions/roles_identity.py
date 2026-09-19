from __future__ import annotations

import logging
from typing import Any, TYPE_CHECKING

import discord

if TYPE_CHECKING:
    from ..workflow import WorkflowRunner

logger = logging.getLogger(__name__)


async def execute_role(runner: WorkflowRunner, action: dict[str, Any], operation: str = "add") -> bool:
    """Manages role assignment (add, remove, toggle) with safety and hierarchy checks."""
    if not runner.guild or not runner.member:
        return False

    role_id_raw = action.get("role_id")
    if not role_id_raw:
        return False

    try:
        role_id = int(str(role_id_raw))
    except (ValueError, TypeError):
        return False

    role = runner.guild.get_role(role_id)
    if not role:
        logger.warning("Role %s not found in guild %s", role_id, runner.guild.id)
        return False

    # Check bot hierarchy: bot's top role must be higher than target role
    bot_member = runner.guild.me
    if bot_member and bot_member.top_role <= role:
        logger.warning(
            "Cannot assign role %s in guild %s: role is higher than or equal to bot's top role",
            role.name,
            runner.guild.id,
        )
        return False

    member = runner.member
    has_role = any(getattr(r, "id", None) == role.id for r in getattr(member, "roles", []))

    try:
        if operation == "add":
            if not has_role:
                await member.add_roles(role, reason="Custom command workflow: add_role")
            return True
        elif operation == "remove":
            if has_role:
                await member.remove_roles(role, reason="Custom command workflow: remove_role")
            return True
        elif operation == "toggle":
            if has_role:
                await member.remove_roles(role, reason="Custom command workflow: toggle_role (remove)")
            else:
                await member.add_roles(role, reason="Custom command workflow: toggle_role (add)")
            return True
    except (discord.Forbidden, discord.HTTPException) as e:
        logger.warning("Failed role operation %s for member %s: %s", operation, getattr(member, "id", None), e)
        return False

    return False


async def execute_change_nickname(runner: WorkflowRunner, action: dict[str, Any]) -> bool:
    """Changes member's server nickname with template variable interpolation and hierarchy safety."""
    from ..workflow import interpolate_text

    if not runner.guild or not runner.member or not isinstance(runner.member, discord.Member):
        return False

    # Guild owner nickname cannot be changed by bot
    if runner.member.id == runner.guild.owner_id:
        logger.debug("Cannot change nickname of guild owner")
        return False

    # Bot hierarchy check
    bot_member = runner.guild.me
    if bot_member and bot_member.top_role <= runner.member.top_role:
        logger.warning("Cannot change nickname: target member's top role is >= bot's top role")
        return False

    nickname_tmpl = action.get("nickname") or action.get("name") or ""
    new_nick = interpolate_text(nickname_tmpl, runner.context).strip()[:32]
    # Passing empty string or None resets the nickname
    nick_val = new_nick if new_nick else None

    try:
        await runner.member.edit(nick=nick_val, reason="Custom command workflow: change_nickname")
        display = new_nick if new_nick else runner.member.name
        runner.context["user_nick"] = display
        runner.context["user_display"] = display
        return True
    except (discord.Forbidden, discord.HTTPException) as e:
        logger.warning("Failed changing nickname for %s: %s", runner.member.id, e)
        return False

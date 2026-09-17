import re
from typing import Any, Optional

import discord


def sanitize_channel_name(name: str) -> str:
    """Sanitize channel name to Discord text channel format."""
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "", name.replace(" ", "-")).lower()
    cleaned = re.sub(r"-+", "-", cleaned).strip("-")
    return cleaned[:100] if cleaned else "ticket"


def is_ticket_staff(member: discord.Member, category: dict) -> bool:
    """Check if member has staff permissions for the ticket category."""
    perms = getattr(member, "guild_permissions", None)
    if perms and (perms.administrator or perms.manage_guild):
        return True

    # Config stores snowflakes as strings; gateway role ids are ints.
    staff_role_ids = set()
    for role_id in category.get("staff_role_ids", []):
        try:
            staff_role_ids.add(int(role_id))
        except (TypeError, ValueError):
            continue
    if not staff_role_ids:
        return bool(perms and perms.manage_channels)

    member_roles = getattr(member, "roles", [])
    return any(r.id in staff_role_ids for r in member_roles)


def render_ticket_channel_name(
    naming_template: str, username: str, number: int, category: str
) -> str:
    """Render and sanitize ticket channel name with tokens {username}, {number}, {category}."""
    clean_username = re.sub(r"[^a-zA-Z0-9]", "", username).lower() or "user"
    num_str = f"{number:04d}"
    cat_slug = category or "ticket"
    raw_name = (
        naming_template.replace("{username}", clean_username)
        .replace("{number}", num_str)
        .replace("{category}", cat_slug)
    )
    return sanitize_channel_name(raw_name)


def build_ticket_overwrites(
    default_role: discord.Role,
    user: discord.Member | discord.User,
    bot_member: discord.Member,
    staff_roles: Optional[list[discord.Role]] = None,
) -> dict[Any, discord.PermissionOverwrite]:
    """Build permission overwrites dict for a ticket channel."""
    overwrites: dict[Any, discord.PermissionOverwrite] = {
        default_role: discord.PermissionOverwrite(view_channel=False),
        user: discord.PermissionOverwrite(
            view_channel=True,
            send_messages=True,
            read_message_history=True,
            attach_files=True,
            embed_links=True,
        ),
        bot_member: discord.PermissionOverwrite(
            view_channel=True,
            send_messages=True,
            read_message_history=True,
            manage_channels=True,
            manage_permissions=True,
            attach_files=True,
            embed_links=True,
        ),
    }

    if staff_roles:
        for role in staff_roles:
            if role is not None:
                overwrites[role] = discord.PermissionOverwrite(
                    view_channel=True,
                    send_messages=True,
                    read_message_history=True,
                    attach_files=True,
                    embed_links=True,
                )

    return overwrites

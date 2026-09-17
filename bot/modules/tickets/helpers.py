import re
import unicodedata
from typing import Any, Optional

import discord

CUSTOM_EMOJI_PATTERN = re.compile(r"^<(a)?:([a-zA-Z0-9_]{2,32}):([0-9]{17,20})>$")


def sanitize_button_emoji(val: Optional[Any]) -> Optional[str]:
    """Validates and sanitizes an emoji for Discord buttons and select menus.
    Returns:
        - A valid custom emoji string '<:name:id>' or '<a:name:id>'
        - A valid Unicode emoji string
        - None if invalid, corrupted ('??'), or empty
    """
    if not val or not isinstance(val, str):
        return None

    cleaned = val.strip()
    if not cleaned or cleaned in ("??", "?", "none", "null", "undefined"):
        return None

    # Discord custom emoji: <:name:id> or <a:name:id>
    if CUSTOM_EMOJI_PATTERN.match(cleaned):
        return cleaned

    # Check Unicode emoji validity:
    # Must contain non-ASCII symbol/pictograph characters and NOT ASCII alphanumeric text
    has_symbol = False
    has_ascii_alnum = False

    for ch in cleaned:
        code = ord(ch)
        cat = unicodedata.category(ch)
        if code > 127 or cat.startswith("S") or cat.startswith("P"):
            has_symbol = True
        if ch.isascii() and ch.isalnum():
            has_ascii_alnum = True

    if has_ascii_alnum or not has_symbol:
        return None

    if len(cleaned) > 16:
        return None

    return cleaned


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


async def generate_ticket_transcript(channel: discord.TextChannel) -> tuple[int, bytes]:
    """Generate a clean text transcript of the ticket channel messages.
    Returns (message_count, transcript_bytes).
    """
    lines = [
        f"============================================================",
        f" TICKET TRANSCRIPT: #{channel.name} (ID: {channel.id})",
        f" Guild: {channel.guild.name} (ID: {channel.guild.id})",
        f" Generated At: {discord.utils.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}",
        f"============================================================\n",
    ]
    count = 0
    try:
        async for msg in channel.history(limit=1500, oldest_first=True):
            count += 1
            ts = msg.created_at.strftime("%Y-%m-%d %H:%M:%S")
            author_str = f"{msg.author.name} ({msg.author.id})"
            content = msg.clean_content or "(No text content)"
            lines.append(f"[{ts}] {author_str}: {content}")
            if msg.attachments:
                for att in msg.attachments:
                    lines.append(f"    [Attachment: {att.filename} - {att.url}]")
    except Exception as e:
        lines.append(f"\n[Notice: Error fetching full history: {e}]")

    text_content = "\n".join(lines)
    return count, text_content.encode("utf-8")

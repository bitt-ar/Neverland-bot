import re
from typing import Any
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError


def sanitize_channel_name(name: str) -> str:
    """Strip markdown formatting and normalize whitespace, max 80 chars."""
    cleaned = re.sub(r"[*_~`>#|]", "", name)
    cleaned = " ".join(cleaned.split()).strip()
    return cleaned[:80]


def render_temp_voice_name(
    template: str, username: str, counter: int, server_name: str
) -> str:
    """Render temporary voice channel name using template and tokens {username}, {n}, {server}."""
    naming_template = template or "{username}'s lounge"
    ch_name = naming_template.replace("{username}", username)
    ch_name = ch_name.replace("{n}", str(counter))
    ch_name = ch_name.replace("{server}", server_name)
    sanitized = sanitize_channel_name(ch_name)
    if not sanitized:
        sanitized = sanitize_channel_name(f"{username}'s lounge")
    return sanitized[:80]


async def get_next_temp_voice_counter(collection: Any, guild_id: int) -> int:
    """Atomically increment and return the next per-guild temporary voice channel counter.

    Uses an exact-equality filter on purpose: MongoDB cannot extract equality
    fields from an $in filter when upserting, so a $in+upsert combination would
    insert guild_id: null and the counter would reset (or collide) on every call.
    """

    async def _increment():
        return await collection.find_one_and_update(
            {"guild_id": guild_id},
            {"$inc": {"counter": 1}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )

    # Adopt the legacy null-guild counter doc created by the old $in upsert so
    # the numbering continues. If a canonical doc already exists, adoption
    # would collide — ignore that case.
    try:
        await collection.find_one_and_update(
            {"guild_id": None},
            {"$set": {"guild_id": guild_id}},
        )
    except DuplicateKeyError:
        pass

    doc = await _increment()
    return int(doc.get("counter", 1)) if doc else 1

import motor.motor_asyncio
from pymongo import ASCENDING, DESCENDING, ReturnDocument

from core import config

_client = None
db = None

# In-memory cache for reaction roles: {(message_id, emoji_str): role_id}
rr_cache = {}


async def init():
    global _client, db
    if not config.MONGODB_URI:
        raise RuntimeError("MONGODB_URI is not set. Add it to your .env file (see .env.example).")
    _client = motor.motor_asyncio.AsyncIOMotorClient(config.MONGODB_URI)
    db = _client[config.MONGODB_DB]

    await db.levels.create_index([("guild_id", ASCENDING), ("user_id", ASCENDING)], unique=True)
    await db.settings.create_index([("guild_id", ASCENDING)], unique=True)
    await db.giveaways.create_index([("message_id", ASCENDING)], unique=True)
    await db.reaction_roles.create_index([("message_id", ASCENDING), ("emoji", ASCENDING)])
    await db.activity.create_index(
        [("guild_id", ASCENDING), ("user_id", ASCENDING), ("week_start", ASCENDING)], unique=True
    )
    await db.anime_lists.create_index([("user_id", ASCENDING)], unique=True)
    await db.module_states.create_index([("guild_id", ASCENDING), ("module", ASCENDING)], unique=True)
    await db.module_configs.create_index([("guild_id", ASCENDING), ("module", ASCENDING)], unique=True)
    await db.temp_voice_meta.create_index([("guild_id", ASCENDING)], unique=True)
    await db.giveaways.create_index([("guild_id", ASCENDING)])
    await db.giveaways_config.create_index([("guild_id", ASCENDING)], unique=True)
    await db.moderation_cases.create_index([("guild_id", ASCENDING), ("case_id", ASCENDING)], unique=True)
    await db.moderation_cases.create_index([("guild_id", ASCENDING), ("user_id", ASCENDING)])
    await db.custom_commands.create_index([("guild_id", ASCENDING), ("name", ASCENDING)])
    await db.custom_dropdowns.create_index([("guild_id", ASCENDING), ("id", ASCENDING)])
    await db.custom_dropdowns.create_index([("message_id", ASCENDING)])


async def close():
    if _client:
        _client.close()


async def get_settings(guild_id: int) -> dict:
    doc = await db.settings.find_one({"guild_id": guild_id})
    return doc or {}


async def update_settings(guild_id: int, **fields):
    await db.settings.update_one({"guild_id": guild_id}, {"$set": fields}, upsert=True)


async def get_level(guild_id: int, user_id: int) -> dict | None:
    return await db.levels.find_one({"guild_id": guild_id, "user_id": user_id})


async def add_xp(guild_id: int, user_id: int, amount: int) -> tuple[int, int]:
    """Add XP for a user in a guild. Returns (level_before, level_after) as ints."""
    doc = await db.levels.find_one_and_update(
        {"guild_id": guild_id, "user_id": user_id},
        {"$inc": {"xp": amount}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    xp = doc["xp"]
    level = 0.09 * (xp ** 0.5)
    if level != doc.get("level", 0.0):
        await db.levels.update_one({"_id": doc["_id"]}, {"$set": {"level": level}})
    return int(doc.get("level", 0.0)), int(level)


async def get_rank(guild_id: int, user_id: int) -> int | None:
    me = await db.levels.find_one({"guild_id": guild_id, "user_id": user_id})
    if not me:
        return None
    higher = await db.levels.count_documents({"guild_id": guild_id, "xp": {"$gt": me["xp"]}})
    return higher + 1


async def top_n(guild_id: int, n: int = 10) -> list[dict]:
    cursor = db.levels.find({"guild_id": guild_id}).sort("xp", DESCENDING).limit(n)
    return await cursor.to_list(length=n)


async def set_level_field(guild_id: int, user_id: int, field: str, value):
    await db.levels.update_one(
        {"guild_id": guild_id, "user_id": user_id},
        {"$set": {field: value}},
        upsert=True,
    )


async def reload_reaction_roles() -> dict:
    global rr_cache
    cache = {}
    if db is not None:
        async for doc in db.reaction_roles.find({}):
            mid_raw = doc.get("message_id")
            if mid_raw is None:
                continue
            mid_str = str(mid_raw)
            mid_int = int(mid_str) if mid_str.isdigit() else None

            if "pairs" in doc and isinstance(doc["pairs"], list):
                for p in doc["pairs"]:
                    if isinstance(p, dict):
                        emoji = str(p.get("emoji", ""))
                        role_id = p.get("role_id")
                        if emoji and role_id:
                            cache[(mid_str, emoji)] = role_id
                            if mid_int is not None:
                                cache[(mid_int, emoji)] = role_id
            elif "emoji" in doc and "role_id" in doc:
                emoji = str(doc["emoji"])
                role_id = doc["role_id"]
                cache[(mid_str, emoji)] = role_id
                if mid_int is not None:
                    cache[(mid_int, emoji)] = role_id
    rr_cache = cache
    return rr_cache


def get_reaction_role(message_id: int | str, emoji: str) -> int | None:
    return (
        rr_cache.get((message_id, emoji))
        or rr_cache.get((str(message_id), str(emoji)))
        or (rr_cache.get((int(message_id), str(emoji))) if str(message_id).isdigit() else None)
    )


async def replace_message_reaction_roles(guild_id: int, message_id: int | str, pairs_or_doc):
    """Replace reaction roles doc for a message. Accepts either full doc or list of pairs."""
    msg_id_str = str(message_id)
    id_filter = [msg_id_str]
    if msg_id_str.isdigit():
        id_filter.append(int(msg_id_str))

    doc = None
    if isinstance(pairs_or_doc, dict):
        doc = dict(pairs_or_doc)
        doc["guild_id"] = int(guild_id)
        doc["message_id"] = msg_id_str
    elif isinstance(pairs_or_doc, list):
        pairs = []
        for i, item in enumerate(pairs_or_doc):
            if isinstance(item, (tuple, list)):
                emoji = item[0]
                role = item[1]
                role_id = getattr(role, "id", role)
            elif isinstance(item, dict):
                emoji = item.get("emoji")
                role_id = item.get("role_id")
            else:
                continue
            pairs.append({"emoji": str(emoji), "role_id": int(role_id), "order": i})

        doc = {
            "guild_id": int(guild_id),
            "message_id": msg_id_str,
            "channel_id": None,
            "style": "reactions",
            "content": None,
            "embed": None,
            "enabled": True,
            "pairs": pairs,
        }

    if doc is not None:
        await db.reaction_roles.replace_one(
            {"message_id": {"$in": id_filter}},
            doc,
            upsert=True,
        )

    await reload_reaction_roles()


async def delete_message_reaction_roles(message_id: int | str):
    msg_id_str = str(message_id)
    id_filter = [msg_id_str]
    if msg_id_str.isdigit():
        id_filter.append(int(msg_id_str))
    await db.reaction_roles.delete_many({"message_id": {"$in": id_filter}})
    await reload_reaction_roles()

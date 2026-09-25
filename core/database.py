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

    client_kwargs = {}
    try:
        import certifi
        client_kwargs["tlsCAFile"] = certifi.where()
    except Exception:
        pass

    _client = motor.motor_asyncio.AsyncIOMotorClient(config.MONGODB_URI, **client_kwargs)
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
    await db.radio_configs.create_index([("guild_id", ASCENDING)], unique=True)
    await db.radio_bots.create_index([("guild_id", ASCENDING), ("bot_slot", ASCENDING)], unique=True)
    await db.radio_playlists.create_index([("guild_id", ASCENDING), ("id", ASCENDING)], unique=True)
    await db.radio_playlists.create_index([("guild_id", ASCENDING)])
    await db.radio_tracks.create_index([("guild_id", ASCENDING), ("playlist_id", ASCENDING), ("id", ASCENDING)], unique=True)
    await db.radio_tracks.create_index([("guild_id", ASCENDING), ("playlist_id", ASCENDING)])
    await db.radio_active_streams.create_index([("guild_id", ASCENDING), ("bot_slot", ASCENDING)], unique=True)
    await db.custom_temp_voice_channels.create_index([("channel_id", ASCENDING)], unique=True)
    await db.custom_temp_voice_channels.create_index([("guild_id", ASCENDING)])


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


# --- Radio & Multi-Bot Broadcasting Database Operations ---

async def sync_radio_storage_quota(owner_max_mb: int):
    """Sync the Bot Owner's configured storage quota from .env to the database across all guild configs."""
    if db is None:
        return
    # 1. Update system global config document
    await db.system_config.update_one(
        {"_id": "radio_storage"},
        {"$set": {"max_playlist_storage_mb": int(owner_max_mb)}},
        upsert=True,
    )
    # 2. Update existing guild radio configs to align with bot owner's quota
    await db.radio_configs.update_many(
        {},
        {"$set": {"max_playlist_storage_mb": int(owner_max_mb)}},
    )


async def get_radio_config(guild_id: int | str) -> dict:
    gid_str = str(guild_id)
    doc = await db.radio_configs.find_one({"guild_id": gid_str})
    owner_limit = getattr(config, "RADIO_MAX_PLAYLIST_STORAGE_MB", 50)
    max_playlists = getattr(config, "RADIO_MAX_PLAYLISTS_PER_GUILD", 6)
    max_upload = getattr(config, "RADIO_MAX_UPLOAD_SIZE_MB", 25)
    bots_count = getattr(config, "RADIO_BOTS_COUNT", 3)
    res = {
        "guild_id": gid_str,
        "max_playlist_storage_mb": owner_limit,
        "max_playlists_per_guild": max_playlists,
        "max_upload_size_mb": max_upload,
        "radio_bots_count": bots_count,
        "default_volume": 100,
        "owner_enforced": True,
    }
    if doc:
        res["default_volume"] = doc.get("default_volume", 100)
    return res


async def update_radio_config(guild_id: int | str, **fields) -> dict:
    gid_str = str(guild_id)
    # Never allow server admins to overwrite bot owner's system storage quota or global limits
    fields.pop("max_playlist_storage_mb", None)
    fields.pop("max_playlists_per_guild", None)
    fields.pop("max_upload_size_mb", None)
    fields.pop("radio_bots_count", None)
    if fields:
        await db.radio_configs.update_one(
            {"guild_id": gid_str},
            {"$set": fields},
            upsert=True,
        )
    return await get_radio_config(guild_id)


async def get_radio_bots(guild_id: int | str) -> list[dict]:
    gid_str = str(guild_id)
    cursor = db.radio_bots.find({"guild_id": gid_str}).sort("bot_slot", ASCENDING)
    bots = await cursor.to_list(length=10)
    for b in bots:
        b.pop("_id", None)
    return bots


async def get_radio_bot(guild_id: int | str, bot_slot: int) -> dict | None:
    gid_str = str(guild_id)
    doc = await db.radio_bots.find_one({"guild_id": gid_str, "bot_slot": bot_slot})
    if doc:
        doc.pop("_id", None)
    return doc


async def save_radio_bot(guild_id: int | str, bot_slot: int, doc: dict):
    gid_str = str(guild_id)
    payload = dict(doc)
    payload["guild_id"] = gid_str
    payload["bot_slot"] = int(bot_slot)
    await db.radio_bots.update_one(
        {"guild_id": gid_str, "bot_slot": int(bot_slot)},
        {"$set": payload},
        upsert=True,
    )


async def delete_radio_bot(guild_id: int | str, bot_slot: int):
    gid_str = str(guild_id)
    await db.radio_bots.delete_one({"guild_id": gid_str, "bot_slot": int(bot_slot)})


async def get_radio_playlists(guild_id: int | str) -> list[dict]:
    gid_str = str(guild_id)
    cursor = db.radio_playlists.find({"guild_id": gid_str}).sort("created_at", ASCENDING)
    playlists = await cursor.to_list(length=10)
    for p in playlists:
        p.pop("_id", None)
    return playlists


async def get_radio_playlist(guild_id: int | str, playlist_id: str) -> dict | None:
    gid_str = str(guild_id)
    doc = await db.radio_playlists.find_one({"guild_id": gid_str, "id": str(playlist_id)})
    if doc:
        doc.pop("_id", None)
    return doc


async def save_radio_playlist(guild_id: int | str, doc: dict):
    gid_str = str(guild_id)
    payload = dict(doc)
    payload["guild_id"] = gid_str
    await db.radio_playlists.update_one(
        {"guild_id": gid_str, "id": str(payload["id"])},
        {"$set": payload},
        upsert=True,
    )


async def delete_radio_playlist(guild_id: int | str, playlist_id: str):
    gid_str = str(guild_id)
    pid_str = str(playlist_id)
    await db.radio_playlists.delete_one({"guild_id": gid_str, "id": pid_str})
    await db.radio_tracks.delete_many({"guild_id": gid_str, "playlist_id": pid_str})


async def get_radio_tracks(guild_id: int | str, playlist_id: str) -> list[dict]:
    gid_str = str(guild_id)
    pid_str = str(playlist_id)
    cursor = db.radio_tracks.find({"guild_id": gid_str, "playlist_id": pid_str}).sort("order", ASCENDING)
    tracks = await cursor.to_list(length=200)
    for t in tracks:
        t.pop("_id", None)
    return tracks


async def add_radio_track(guild_id: int | str, playlist_id: str, track_doc: dict):
    gid_str = str(guild_id)
    pid_str = str(playlist_id)
    payload = dict(track_doc)
    payload["guild_id"] = gid_str
    payload["playlist_id"] = pid_str
    await db.radio_tracks.update_one(
        {"guild_id": gid_str, "playlist_id": pid_str, "id": str(payload["id"])},
        {"$set": payload},
        upsert=True,
    )


async def delete_radio_track(guild_id: int | str, playlist_id: str, track_id: str) -> dict | None:
    gid_str = str(guild_id)
    pid_str = str(playlist_id)
    tid_str = str(track_id)
    track = await db.radio_tracks.find_one_and_delete(
        {"guild_id": gid_str, "playlist_id": pid_str, "id": tid_str}
    )
    if track:
        track.pop("_id", None)
    return track


async def get_active_stream(guild_id: int | str, bot_slot: int) -> dict | None:
    gid_str = str(guild_id)
    doc = await db.radio_active_streams.find_one({"guild_id": gid_str, "bot_slot": int(bot_slot)})
    if doc:
        doc.pop("_id", None)
    return doc


async def get_all_active_streams(guild_id: int | str) -> list[dict]:
    gid_str = str(guild_id)
    cursor = db.radio_active_streams.find({"guild_id": gid_str})
    streams = await cursor.to_list(length=10)
    for s in streams:
        s.pop("_id", None)
    return streams


async def update_active_stream(guild_id: int | str, bot_slot: int, doc: dict):
    gid_str = str(guild_id)
    payload = dict(doc)
    payload["guild_id"] = gid_str
    payload["bot_slot"] = int(bot_slot)
    await db.radio_active_streams.update_one(
        {"guild_id": gid_str, "bot_slot": int(bot_slot)},
        {"$set": payload},
        upsert=True,
    )


async def clear_active_stream(guild_id: int | str, bot_slot: int):
    gid_str = str(guild_id)
    await db.radio_active_streams.delete_one({"guild_id": gid_str, "bot_slot": int(bot_slot)})


DEFAULT_BOT_PRESENCE = {
    "status": "idle",
    "activity_type": "custom",
    "activity_name": "At your service",
    "streaming_url": "",
}


async def get_bot_presence() -> dict:
    if db is None:
        return dict(DEFAULT_BOT_PRESENCE)
    doc = await db.system_config.find_one({"_id": "bot_presence"})
    if not doc:
        return dict(DEFAULT_BOT_PRESENCE)
    doc.pop("_id", None)
    return {
        "status": doc.get("status", "idle"),
        "activity_type": doc.get("activity_type", "custom"),
        "activity_name": doc.get("activity_name", "At your service"),
        "streaming_url": doc.get("streaming_url", ""),
        "updated_at": doc.get("updated_at"),
    }


async def save_bot_presence(presence_data: dict) -> dict:
    if db is None:
        return presence_data
    payload = {
        "status": presence_data.get("status", "idle"),
        "activity_type": presence_data.get("activity_type", "custom"),
        "activity_name": presence_data.get("activity_name", "At your service"),
        "streaming_url": presence_data.get("streaming_url", ""),
        "updated_at": presence_data.get("updated_at"),
    }
    await db.system_config.update_one(
        {"_id": "bot_presence"},
        {"$set": payload},
        upsert=True,
    )
    return payload

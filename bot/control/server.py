import asyncio
import hmac
import json
import logging
import re
from aiohttp import web
import discord
from pydantic import ValidationError

from core import config, database

logger = logging.getLogger(__name__)


async def check_db() -> bool:
    """Ping MongoDB with a short timeout, never raising an exception."""
    try:
        if database._client is None or database.db is None:
            return False
        res = await asyncio.wait_for(database.db.command("ping"), timeout=2.0)
        return bool(res and res.get("ok"))
    except Exception:
        return False


@web.middleware
async def auth_middleware(request: web.Request, handler):
    if request.path == "/health":
        return await handler(request)

    secret = request.headers.get("X-Internal-Secret")
    if (
        not config.CONTROL_PLANE_SECRET
        or not secret
        or not hmac.compare_digest(secret, config.CONTROL_PLANE_SECRET)
    ):
        return web.json_response({"error": "unauthorized"}, status=403)

    return await handler(request)


async def health_handler(request: web.Request) -> web.Response:
    db_ok = await check_db()
    return web.json_response({"status": "ok", "db": db_ok, "version": "0.1.0"})


def _get_guild(request: web.Request):
    guild_id_raw = request.match_info.get("guild_id") or request.match_info.get("id")
    try:
        guild_id = int(guild_id_raw)
    except (TypeError, ValueError):
        return None
    bot = request.app.get("bot")
    if bot is None:
        return None
    return bot.get_guild(guild_id)


def _channel_type_name(channel) -> str:
    try:
        c_type = getattr(channel, "type", None)
        type_str = str(getattr(c_type, "name", c_type or "")).lower()
        if type_str == "text":
            return "text"
        if type_str == "voice":
            return "voice"
        if type_str == "category":
            return "category"
        if type_str in ("news", "announcement"):
            return "announcement"
        if type_str == "forum":
            return "forum"
        if type_str in ("stage_voice", "stage"):
            return "stage"
        return "other"
    except Exception:
        return "other"


async def guild_overview_handler(request: web.Request) -> web.Response:
    guild = _get_guild(request)
    if guild is None:
        return web.json_response({"error": "guild_not_found"}, status=404)

    try:
        guild_id_str = str(guild.id)
        name = getattr(guild, "name", "")
        icon = getattr(guild, "icon", None)
        icon_url = str(icon.url) if icon else None
        member_count = getattr(guild, "member_count", None)

        bot = request.app.get("bot")
        online_count = None
        try:
            intents = getattr(bot, "intents", None)
            if intents and getattr(intents, "presences", False):
                members = getattr(guild, "members", [])
                if members:
                    online_count = sum(
                        1
                        for m in members
                        if getattr(m, "status", None) is not None and str(getattr(m, "status", "")).lower() != "offline"
                    )
        except Exception as e:
            logger.warning("Error calculating online_count: %s", e)
            online_count = None

        text_count = 0
        voice_count = 0
        cat_count = 0
        total_channels = 0
        try:
            channels = getattr(guild, "channels", [])
            total_channels = len(channels)
            for c in channels:
                t = _channel_type_name(c)
                if t == "text":
                    text_count += 1
                elif t == "voice":
                    voice_count += 1
                elif t == "category":
                    cat_count += 1
        except Exception as e:
            logger.warning("Error calculating channel breakdown: %s", e)

        roles_count = 0
        try:
            roles_count = len(getattr(guild, "roles", []))
        except Exception as e:
            logger.warning("Error calculating roles count: %s", e)

        rr_pairs = 0
        level_users = 0
        tickets = 0
        if database.db is not None:
            try:
                async for doc in database.db.reaction_roles.find(
                    {"guild_id": {"$in": [guild.id, str(guild.id)]}}
                ):
                    if "pairs" in doc and isinstance(doc["pairs"], list):
                        rr_pairs += len(doc["pairs"])
                    else:
                        rr_pairs += 1
            except Exception as e:
                logger.warning("Error counting reaction_roles: %s", e)
            try:
                level_users = await database.db.levels.count_documents(
                    {"guild_id": {"$in": [guild.id, str(guild.id)]}}
                )
            except Exception as e:
                logger.warning("Error counting levels: %s", e)
            try:
                tickets = await database.db.tickets.count_documents(
                    {"guild_id": {"$in": [guild.id, str(guild.id)]}}
                )
            except Exception as e:
                logger.warning("Error counting tickets: %s", e)

        return web.json_response(
            {
                "id": guild_id_str,
                "name": name,
                "icon_url": icon_url,
                "member_count": member_count,
                "online_count": online_count,
                "channels": {
                    "text": text_count,
                    "voice": voice_count,
                    "categories": cat_count,
                    "total": total_channels,
                },
                "roles": roles_count,
                "bot_status": "connected",
                "stats": {
                    "reaction_role_pairs": rr_pairs,
                    "level_users": level_users,
                    "tickets": tickets,
                },
            }
        )
    except Exception as e:
        logger.exception("Unexpected error in guild_overview_handler: %s", e)
        return web.json_response(
            {
                "id": str(getattr(guild, "id", "")),
                "name": getattr(guild, "name", ""),
                "icon_url": None,
                "member_count": None,
                "online_count": None,
                "channels": {"text": 0, "voice": 0, "categories": 0, "total": 0},
                "roles": 0,
                "bot_status": "connected",
                "stats": {"reaction_role_pairs": 0, "level_users": 0, "tickets": 0},
            }
        )


async def guild_channels_handler(request: web.Request) -> web.Response:
    guild = _get_guild(request)
    if guild is None:
        return web.json_response({"error": "guild_not_found"}, status=404)

    try:
        channels = getattr(guild, "channels", [])
        result = []
        for c in channels:
            c_type = _channel_type_name(c)
            pos = getattr(c, "position", 0) or 0

            # Sort key: (category_position, is_not_category, channel_position)
            if c_type == "category":
                cat_pos = pos
                is_not_cat = 0
                ch_pos = -1
            elif getattr(c, "category", None) is not None:
                cat_pos = getattr(c.category, "position", 0) or 0
                is_not_cat = 1
                ch_pos = pos
            else:
                cat_pos = -1
                is_not_cat = 1
                ch_pos = pos

            result.append(
                {
                    "item": {
                        "id": str(c.id),
                        "name": getattr(c, "name", ""),
                        "type": c_type,
                        "position": pos,
                    },
                    "sort_key": (cat_pos, is_not_cat, ch_pos),
                }
            )

        result.sort(key=lambda x: x["sort_key"])
        return web.json_response([x["item"] for x in result])
    except Exception as e:
        logger.exception("Unexpected error in guild_channels_handler: %s", e)
        return web.json_response([])


async def guild_roles_handler(request: web.Request) -> web.Response:
    guild = _get_guild(request)
    if guild is None:
        return web.json_response({"error": "guild_not_found"}, status=404)

    try:
        roles = getattr(guild, "roles", [])
        roles_data = []
        for r in roles:
            color_hex = None
            color = getattr(r, "color", None)
            if color and getattr(color, "value", 0) != 0:
                color_hex = f"#{color.value:06x}"

            roles_data.append(
                {
                    "id": str(r.id),
                    "name": getattr(r, "name", ""),
                    "color": color_hex,
                    "position": getattr(r, "position", 0) or 0,
                    "managed": bool(getattr(r, "managed", False)),
                }
            )

        roles_data.sort(key=lambda r: r["position"], reverse=True)

        bot = request.app.get("bot")
        bot_top_role_pos = None
        try:
            me = getattr(guild, "me", None)
            if me is None and bot and getattr(bot, "user", None):
                me = guild.get_member(bot.user.id)
            if me is not None:
                top_role = getattr(me, "top_role", None)
                if top_role is not None:
                    bot_top_role_pos = getattr(top_role, "position", None)
        except Exception as e:
            logger.warning("Error calculating bot_top_role_position: %s", e)

        return web.json_response(
            {
                "roles": roles_data,
                "bot_top_role_position": bot_top_role_pos,
            }
        )
    except Exception as e:
        logger.exception("Unexpected error in guild_roles_handler: %s", e)
        return web.json_response({"roles": [], "bot_top_role_position": None})


async def modules_list_handler(request: web.Request) -> web.Response:
    bot = request.app.get("bot")
    registry = getattr(bot, "modules_registry", None)
    if registry is None:
        return web.json_response([])

    result = []
    for mod in registry.get_modules():
        result.append(
            {
                "name": mod.name,
                "title": mod.title,
                "icon": mod.icon,
                "description": mod.description,
                "default_config": mod.default_config,
                "json_schema": mod.config_model.model_json_schema(),
                "required_permissions": mod.required_permissions,
            }
        )
    return web.json_response(result)


async def guild_modules_overview_handler(request: web.Request) -> web.Response:
    guild = _get_guild(request)
    if guild is None:
        return web.json_response({"error": "guild_not_found"}, status=404)

    bot = request.app.get("bot")
    registry = getattr(bot, "modules_registry", None)
    if registry is None:
        return web.json_response({"error": "registry_not_found"}, status=500)

    modules_overview = []
    for mod in registry.get_modules():
        enabled = await registry.is_enabled(guild.id, mod.name)
        stats = {}
        if mod.name == "reaction_roles" and database.db is not None:
            try:
                pairs = 0
                async for doc in database.db.reaction_roles.find(
                    {"guild_id": {"$in": [guild.id, str(guild.id)]}}
                ):
                    if "pairs" in doc and isinstance(doc["pairs"], list):
                        pairs += len(doc["pairs"])
                    else:
                        pairs += 1
                stats["pairs"] = pairs
            except Exception as e:
                logger.warning("Error calculating reaction_roles stats: %s", e)
        elif mod.name == "leveling" and database.db is not None:
            try:
                stats["users"] = await database.db.levels.count_documents(
                    {"guild_id": {"$in": [guild.id, str(guild.id)]}}
                )
            except Exception as e:
                logger.warning("Error calculating leveling stats: %s", e)
        elif mod.name == "tickets" and database.db is not None:
            try:
                stats["tickets"] = await database.db.tickets.count_documents(
                    {"guild_id": {"$in": [guild.id, str(guild.id)]}}
                )
            except Exception as e:
                logger.warning("Error calculating tickets stats: %s", e)
        elif mod.name == "temp_voice" and database.db is not None:
            try:
                stats["active_channels"] = await database.db.temp_voice_channels.count_documents(
                    {"guild_id": {"$in": [guild.id, str(guild.id)]}}
                )
            except Exception as e:
                logger.warning("Error calculating temp_voice stats: %s", e)
        elif mod.name == "welcome":
            try:
                cfg = await registry.get_config(guild.id, "welcome")
                stats["channel_id"] = cfg.get("channel_id")
                stats["include_image"] = cfg.get("include_image", True)
            except Exception as e:
                logger.warning("Error calculating welcome stats: %s", e)

        modules_overview.append(
            {
                "name": mod.name,
                "title": mod.title,
                "icon": mod.icon,
                "description": mod.description,
                "enabled": enabled,
                "stats": stats,
            }
        )
    return web.json_response(modules_overview)


async def module_state_get_handler(request: web.Request) -> web.Response:
    guild = _get_guild(request)
    if guild is None:
        return web.json_response({"error": "guild_not_found"}, status=404)

    name = request.match_info.get("name")
    bot = request.app.get("bot")
    registry = getattr(bot, "modules_registry", None)
    if registry is None or registry.get_module(name) is None:
        return web.json_response({"error": "unknown_module"}, status=404)

    enabled = await registry.is_enabled(guild.id, name)
    return web.json_response({"enabled": enabled})


async def module_state_put_handler(request: web.Request) -> web.Response:
    guild = _get_guild(request)
    if guild is None:
        return web.json_response({"error": "guild_not_found"}, status=404)

    name = request.match_info.get("name")
    bot = request.app.get("bot")
    registry = getattr(bot, "modules_registry", None)
    if registry is None or registry.get_module(name) is None:
        return web.json_response({"error": "unknown_module"}, status=404)

    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)

    if not isinstance(data, dict) or "enabled" not in data or not isinstance(data["enabled"], bool):
        return web.json_response(
            {"error": "invalid_body", "details": "Field 'enabled' (bool) required"}, status=400
        )

    enabled = data["enabled"]
    await registry.set_enabled(guild.id, name, enabled)
    return web.json_response({"enabled": enabled})


async def module_config_get_handler(request: web.Request) -> web.Response:
    guild = _get_guild(request)
    if guild is None:
        return web.json_response({"error": "guild_not_found"}, status=404)

    name = request.match_info.get("name")
    bot = request.app.get("bot")
    registry = getattr(bot, "modules_registry", None)
    if registry is None or registry.get_module(name) is None:
        return web.json_response({"error": "unknown_module"}, status=404)

    enabled = await registry.is_enabled(guild.id, name)
    config_data = await registry.get_config(guild.id, name)
    return web.json_response(
        {
            "module": name,
            "enabled": enabled,
            "config": config_data,
        }
    )


async def module_config_put_handler(request: web.Request) -> web.Response:
    guild = _get_guild(request)
    if guild is None:
        return web.json_response({"error": "guild_not_found"}, status=404)

    name = request.match_info.get("name")
    bot = request.app.get("bot")
    registry = getattr(bot, "modules_registry", None)
    if registry is None or registry.get_module(name) is None:
        return web.json_response({"error": "unknown_module"}, status=404)

    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)

    if not isinstance(data, dict):
        return web.json_response(
            {"error": "invalid_body", "details": "JSON object required"}, status=400
        )

    try:
        updated = await registry.set_config(guild.id, name, data)
        return web.json_response(updated)
    except ValidationError as e:
        return web.json_response(
            {"error": "validation_failed", "details": json.loads(e.json())},
            status=422,
        )


def _format_rr_doc(doc: dict) -> dict:
    d = dict(doc)
    d.pop("_id", None)
    # Discord snowflakes exceed JS Number.MAX_SAFE_INTEGER — always emit strings.
    if "guild_id" in d:
        d["guild_id"] = str(d["guild_id"])
    if "message_id" in d:
        d["message_id"] = str(d["message_id"])
    if "channel_id" in d and d["channel_id"] is not None:
        d["channel_id"] = str(d["channel_id"])
    if "pairs" in d and isinstance(d["pairs"], list):
        formatted_pairs = []
        for i, p in enumerate(d["pairs"]):
            if isinstance(p, dict):
                formatted_pairs.append(
                    {
                        "emoji": str(p.get("emoji", "")),
                        "label": str(p.get("label", "")),
                        "role_id": str(p.get("role_id", "")),
                        "order": int(p.get("order", i)),
                    }
                )
        d["pairs"] = formatted_pairs
    else:
        d["pairs"] = []
    return d


DIGIT_KEYCAPS = {
    "0": "0️⃣", "1": "1️⃣", "2": "2️⃣", "3": "3️⃣", "4": "4️⃣",
    "5": "5️⃣", "6": "6️⃣", "7": "7️⃣", "8": "8️⃣", "9": "9️⃣", "10": "🔟"
}


def resolve_reaction_emoji(emoji_val: str | None) -> str | discord.PartialEmoji:
    """Normalize input emoji strings into valid Discord reaction emojis."""
    if not emoji_val or not isinstance(emoji_val, str):
        return ""
    s = emoji_val.strip()
    if s in DIGIT_KEYCAPS:
        return DIGIT_KEYCAPS[s]
    try:
        partial = discord.PartialEmoji.from_str(s)
        if partial.id:
            return partial
    except Exception:
        pass
    return s


def _build_embed(embed_data: dict | None) -> discord.Embed | None:
    if not embed_data or not isinstance(embed_data, dict):
        return None
    title = embed_data.get("title") or None
    description = embed_data.get("description") or None
    color_val = embed_data.get("color")

    color = discord.Color.blurple()
    if color_val:
        try:
            hex_clean = str(color_val).lstrip("#")
            color = discord.Color(int(hex_clean, 16))
        except Exception:
            color = discord.Color.blurple()

    if not title and not description:
        return None
    return discord.Embed(title=title, description=description, color=color)


def _build_reaction_role_view(style: str, msg_id: int | str, pairs: list[dict], guild: discord.Guild) -> discord.ui.View | None:
    if style == "buttons":
        view = discord.ui.View(timeout=None)
        for i, pair in enumerate(pairs):
            role_id = int(pair["role_id"])
            role = guild.get_role(role_id)
            label = role.name if role else f"Role {role_id}"
            emoji_str = pair.get("emoji", "")
            emoji = None
            if emoji_str:
                resolved = resolve_reaction_emoji(emoji_str)
                if isinstance(resolved, discord.PartialEmoji):
                    emoji = resolved
                elif resolved:
                    try:
                        emoji = discord.PartialEmoji.from_str(str(resolved))
                    except Exception:
                        emoji = None
            custom_id = f"rr:{msg_id}:{i}"
            btn = discord.ui.Button(
                style=discord.ButtonStyle.secondary,
                label=label,
                emoji=emoji,
                custom_id=custom_id,
                row=i // 5,
            )
            view.add_item(btn)
        return view
    elif style == "select":
        view = discord.ui.View(timeout=None)
        options = []
        for pair in pairs[:25]:
            role_id = int(pair["role_id"])
            role = guild.get_role(role_id)
            custom_label = str(pair.get("label") or "").strip()
            label = (custom_label or (role.name if role else f"Role {role_id}"))[:100]
            emoji_str = str(pair.get("emoji") or "").strip()
            emoji = None
            if emoji_str:
                resolved = resolve_reaction_emoji(emoji_str)
                if isinstance(resolved, discord.PartialEmoji):
                    emoji = resolved
                elif resolved:
                    try:
                        emoji = discord.PartialEmoji.from_str(str(resolved))
                    except Exception:
                        emoji = None
            options.append(
                discord.SelectOption(
                    label=label,
                    value=str(role_id),
                    emoji=emoji,
                )
            )
        select_menu = discord.ui.Select(
            placeholder="Select a role...",
            min_values=1,
            max_values=1,
            options=options,
            custom_id=f"rr-select:{msg_id}",
        )
        view.add_item(select_menu)
        return view
    return None


def _validate_reaction_role_payload(data: dict, guild: discord.Guild) -> tuple[dict | None, list[dict]]:
    details = []

    # 1. channel_id
    channel_id_raw = data.get("channel_id")
    channel = None
    if channel_id_raw is None or not str(channel_id_raw).isdigit():
        details.append({"field": "channel_id", "message": "Field 'channel_id' is required and must be an integer."})
    else:
        channel = guild.get_channel(int(channel_id_raw))
        if channel is None:
            details.append({"field": "channel_id", "message": f"Channel {channel_id_raw} was not found in this server."})
        else:
            c_type = _channel_type_name(channel)
            if c_type not in ("text", "announcement", "forum"):
                details.append(
                    {
                        "field": "channel_id",
                        "message": f"Channel #{getattr(channel, 'name', '')} is a {c_type} channel. Messages can only be posted to text, announcement, or forum channels.",
                    }
                )

    # 2. style
    style = data.get("style")
    if style not in ("reactions", "buttons", "select"):
        details.append({"field": "style", "message": "Field 'style' must be one of: 'reactions', 'buttons', 'select'."})

    # 3. content and embed
    content = data.get("content")
    if content is not None:
        if not isinstance(content, str):
            details.append({"field": "content", "message": "Field 'content' must be a string."})
        elif len(content) > 2000:
            details.append({"field": "content", "message": "Content cannot exceed 2000 characters."})

    embed = data.get("embed")
    has_embed = False
    if embed is not None:
        if not isinstance(embed, dict):
            details.append({"field": "embed", "message": "Field 'embed' must be an object or null."})
        else:
            title = embed.get("title")
            description = embed.get("description")
            color = embed.get("color")
            if title is not None:
                if not isinstance(title, str) or len(title) > 256:
                    details.append({"field": "embed.title", "message": "Embed title must be at most 256 characters."})
            if description is not None:
                if not isinstance(description, str) or len(description) > 4096:
                    details.append({"field": "embed.description", "message": "Embed description must be at most 4096 characters."})
            if color is not None and color != "":
                if not isinstance(color, str) or not re.match(r"^#?[0-9a-fA-F]{6}$", color):
                    details.append({"field": "embed.color", "message": "Embed color must be a valid 6-character hex code (e.g. #5865F2)."})
            if (title and str(title).strip()) or (description and str(description).strip()):
                has_embed = True

    has_content = bool(content and str(content).strip())
    if not has_content and not has_embed:
        details.append({"field": "content", "message": "Either message content or embed (title/description) must be provided."})

    # 4. Channel permissions
    me = getattr(guild, "me", None)
    if channel is not None and me is not None:
        perms = channel.permissions_for(me)
        if not perms.send_messages:
            details.append({"field": "channel_id", "message": f"Bot lacks 'Send Messages' permission in #{getattr(channel, 'name', '')}."})
        if has_embed and not perms.embed_links:
            details.append({"field": "embed", "message": f"Bot lacks 'Embed Links' permission in #{getattr(channel, 'name', '')}."})
        if style == "reactions" and not perms.add_reactions:
            details.append({"field": "style", "message": f"Bot lacks 'Add Reactions' permission in #{getattr(channel, 'name', '')}."})

    # 5. pairs
    pairs_raw = data.get("pairs")
    validated_pairs = []
    if not isinstance(pairs_raw, list):
        details.append({"field": "pairs", "message": "Field 'pairs' must be a list."})
    else:
        max_allowed = 25 if style == "select" else 20
        if len(pairs_raw) < 1:
            details.append({"field": "pairs", "message": "At least 1 reaction-role pair is required."})
        elif len(pairs_raw) > max_allowed:
            details.append({"field": "pairs", "message": f"Maximum {max_allowed} pairs allowed for '{style}' style."})

        seen_emojis = set()
        seen_roles = set()

        bot_top_role = getattr(me, "top_role", None) if me else None
        bot_pos = getattr(bot_top_role, "position", -1) if bot_top_role else -1

        for i, p in enumerate(pairs_raw):
            if not isinstance(p, dict):
                details.append({"field": f"pairs[{i}]", "message": f"Pair at index {i} must be an object with 'role_id'."})
                continue

            emoji_raw = p.get("emoji")
            label_raw = p.get("label")
            label_str = str(label_raw).strip() if label_raw is not None else ""

            if style == "select":
                emoji_str = str(emoji_raw).strip() if emoji_raw else ""
            else:
                if not emoji_raw or not isinstance(emoji_raw, str) or not emoji_raw.strip():
                    details.append({"field": f"pairs[{i}].emoji", "message": f"Pair at index {i}: Emoji cannot be empty."})
                    continue
                # Normalize emoji (e.g. "1" -> "1️⃣")
                resolved = resolve_reaction_emoji(emoji_raw)
                emoji_str = str(resolved) if resolved else emoji_raw.strip()

                if emoji_str in seen_emojis:
                    details.append({"field": f"pairs[{i}].emoji", "message": f"Duplicate emoji '{emoji_str}' at pair {i + 1}."})
                seen_emojis.add(emoji_str)

                # Usability check via discord.PartialEmoji.from_str
                try:
                    partial = discord.PartialEmoji.from_str(emoji_str)
                    if partial.id and not partial.is_usable():
                        details.append(
                            {
                                "field": f"pairs[{i}].emoji",
                                "message": f"Custom emoji '{emoji_str}' is not usable by the bot (source server is not shared with the bot).",
                            }
                        )
                except Exception as e:
                    details.append({"field": f"pairs[{i}].emoji", "message": f"Invalid emoji format '{emoji_str}': {e}"})

            role_id_raw = p.get("role_id")
            if role_id_raw is None or not str(role_id_raw).isdigit():
                details.append({"field": f"pairs[{i}].role_id", "message": f"Pair at index {i}: Role ID must be an integer."})
                continue
            role_id = int(role_id_raw)

            if role_id in seen_roles:
                details.append({"field": f"pairs[{i}].role_id", "message": f"Duplicate role ID '{role_id}' at pair {i + 1}."})
            seen_roles.add(role_id)

            role = guild.get_role(role_id)
            if role is None:
                details.append({"field": f"pairs[{i}].role_id", "message": f"Role {role_id} does not exist in this server."})
            elif role.is_default() or role.id == guild.id:
                details.append({"field": f"pairs[{i}].role_id", "message": "Cannot assign the @everyone role."})
            elif getattr(role, "managed", False):
                details.append({"field": f"pairs[{i}].role_id", "message": f"Role '{role.name}' is managed by an integration/bot and cannot be assigned."})
            elif role.position >= bot_pos:
                details.append(
                    {
                        "field": f"pairs[{i}].role_id",
                        "message": f"Role '{role.name}' (position {role.position}) is higher than or equal to the bot's top role '{getattr(bot_top_role, 'name', 'None')}' (position {bot_pos}).",
                    }
                )

            validated_pairs.append(
                {
                    "emoji": emoji_str,
                    "label": label_str[:100],
                    "role_id": role_id,
                    "order": i,
                }
            )

    if details:
        return None, details

    return {
        "channel_id": int(channel_id_raw),
        "style": style,
        "content": content.strip() if content and content.strip() else None,
        "embed": embed,
        "enabled": bool(data.get("enabled", True)),
        "pairs": validated_pairs,
    }, []


async def reaction_roles_list_handler(request: web.Request) -> web.Response:
    guild = _get_guild(request)
    if guild is None:
        return web.json_response({"error": "guild_not_found"}, status=404)

    if database.db is None:
        return web.json_response({"messages": []})

    docs = []
    try:
        cursor = database.db.reaction_roles.find(
            {"guild_id": {"$in": [guild.id, str(guild.id)]}}
        ).sort("_id", 1)
        async for doc in cursor:
            docs.append(_format_rr_doc(doc))
    except Exception as e:
        logger.exception("Error fetching reaction-roles: %s", e)
        return web.json_response({"messages": []})

    return web.json_response({"messages": docs})


async def reaction_role_get_handler(request: web.Request) -> web.Response:
    guild = _get_guild(request)
    if guild is None:
        return web.json_response({"error": "guild_not_found"}, status=404)

    message_id_raw = request.match_info.get("message_id")
    if not message_id_raw:
        return web.json_response({"error": "not_found"}, status=404)

    if database.db is None:
        return web.json_response({"error": "not_found"}, status=404)

    filter_ids = [str(message_id_raw)]
    if message_id_raw.isdigit():
        filter_ids.append(int(message_id_raw))

    doc = await database.db.reaction_roles.find_one(
        {
            "guild_id": {"$in": [guild.id, str(guild.id)]},
            "message_id": {"$in": filter_ids},
        }
    )
    if not doc:
        return web.json_response({"error": "not_found"}, status=404)

    return web.json_response(_format_rr_doc(doc))


async def reaction_role_post_handler(request: web.Request) -> web.Response:
    guild = _get_guild(request)
    if guild is None:
        return web.json_response({"error": "guild_not_found"}, status=404)

    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)

    if not isinstance(data, dict):
        return web.json_response({"error": "invalid_body", "details": "JSON object required"}, status=400)

    validated, errors = _validate_reaction_role_payload(data, guild)
    if errors:
        return web.json_response({"error": "validation_failed", "details": errors}, status=422)

    channel = guild.get_channel(validated["channel_id"])
    content_str = validated["content"]
    embed_obj = _build_embed(validated["embed"])
    style = validated["style"]
    pairs = validated["pairs"]

    try:
        if style == "reactions":
            msg = await channel.send(content=content_str, embed=embed_obj)
            for p in pairs:
                emoji_val = p.get("emoji")
                if emoji_val:
                    emoji_obj = resolve_reaction_emoji(emoji_val)
                    if emoji_obj:
                        try:
                            await msg.add_reaction(emoji_obj)
                        except Exception as e:
                            logger.warning("Failed adding initial reaction %s: %s", emoji_obj, e)
        else:
            # For buttons or select: send message first to acquire message_id,
            # then attach persistent view with custom_ids containing message_id.
            msg = await channel.send(content=content_str, embed=embed_obj)
            view = _build_reaction_role_view(style, msg.id, pairs, guild)
            if view:
                await msg.edit(view=view)
    except Exception as e:
        logger.exception("Discord error sending reaction-role message: %s", e)
        return web.json_response(
            {"error": "discord_error", "details": f"Failed to send message on Discord: {e}"},
            status=502,
        )

    doc = {
        "guild_id": guild.id,
        "message_id": str(msg.id),
        "channel_id": channel.id,
        "style": style,
        "content": content_str,
        "embed": validated["embed"],
        "enabled": validated["enabled"],
        "pairs": pairs,
    }

    try:
        await database.replace_message_reaction_roles(guild.id, msg.id, doc)
    except Exception as e:
        logger.exception("Error saving reaction-role doc to database: %s", e)
        return web.json_response({"error": "database_error", "details": str(e)}, status=500)

    return web.json_response(_format_rr_doc(doc), status=201)


async def reaction_role_put_handler(request: web.Request) -> web.Response:
    guild = _get_guild(request)
    if guild is None:
        return web.json_response({"error": "guild_not_found"}, status=404)

    message_id_raw = request.match_info.get("message_id")
    if not message_id_raw:
        return web.json_response({"error": "not_found"}, status=404)

    filter_ids = [str(message_id_raw)]
    if message_id_raw.isdigit():
        filter_ids.append(int(message_id_raw))

    existing_doc = await database.db.reaction_roles.find_one(
        {
            "guild_id": {"$in": [guild.id, str(guild.id)]},
            "message_id": {"$in": filter_ids},
        }
    )
    if not existing_doc:
        return web.json_response({"error": "not_found"}, status=404)

    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)

    if not isinstance(data, dict):
        return web.json_response({"error": "invalid_body", "details": "JSON object required"}, status=400)

    validated, errors = _validate_reaction_role_payload(data, guild)
    if errors:
        return web.json_response({"error": "validation_failed", "details": errors}, status=422)

    channel = guild.get_channel(validated["channel_id"])
    content_str = validated["content"]
    embed_obj = _build_embed(validated["embed"])
    style = validated["style"]
    pairs = validated["pairs"]

    # Fetch and edit Discord message
    try:
        target_msg = None
        if hasattr(channel, "fetch_message"):
            try:
                target_msg = await channel.fetch_message(int(message_id_raw))
            except Exception:
                target_msg = None

        if target_msg is not None:
            if style == "reactions":
                await target_msg.edit(content=content_str, embed=embed_obj, view=None)

                # Reconcile reactions: add missing, clear removed
                old_pairs = existing_doc.get("pairs", [])
                old_emojis = {str(resolve_reaction_emoji(p.get("emoji"))) for p in old_pairs if isinstance(p, dict) and p.get("emoji")}
                new_emojis = {str(resolve_reaction_emoji(p.get("emoji"))) for p in pairs if p.get("emoji")}

                to_remove = old_emojis - new_emojis
                to_add = new_emojis - old_emojis

                for emoji in to_remove:
                    try:
                        resolved_emoji = resolve_reaction_emoji(emoji)
                        if resolved_emoji:
                            await target_msg.clear_reaction(resolved_emoji)
                    except Exception as e:
                        logger.warning("Error clearing reaction %s: %s", emoji, e)

                for emoji in to_add:
                    try:
                        resolved_emoji = resolve_reaction_emoji(emoji)
                        if resolved_emoji:
                            await target_msg.add_reaction(resolved_emoji)
                    except Exception as e:
                        logger.warning("Error adding reaction %s: %s", emoji, e)
            else:
                # Buttons or Select
                # If old style was reactions, clear reactions
                if existing_doc.get("style") == "reactions":
                    try:
                        await target_msg.clear_reactions()
                    except Exception as e:
                        logger.warning("Error clearing reactions: %s", e)

                view = _build_reaction_role_view(style, target_msg.id, pairs, guild)
                await target_msg.edit(content=content_str, embed=embed_obj, view=view)
    except Exception as e:
        logger.exception("Discord error editing message %s: %s", message_id_raw, e)

    doc = {
        "guild_id": guild.id,
        "message_id": str(message_id_raw),
        "channel_id": channel.id,
        "style": style,
        "content": content_str,
        "embed": validated["embed"],
        "enabled": validated["enabled"],
        "pairs": pairs,
    }

    try:
        await database.replace_message_reaction_roles(guild.id, message_id_raw, doc)
    except Exception as e:
        logger.exception("Error updating reaction-role doc: %s", e)
        return web.json_response({"error": "database_error", "details": str(e)}, status=500)

    return web.json_response(_format_rr_doc(doc), status=200)


async def reaction_role_delete_handler(request: web.Request) -> web.Response:
    guild = _get_guild(request)
    if guild is None:
        return web.json_response({"error": "guild_not_found"}, status=404)

    message_id_raw = request.match_info.get("message_id")
    if not message_id_raw:
        return web.json_response({"error": "not_found"}, status=404)

    filter_ids = [str(message_id_raw)]
    if message_id_raw.isdigit():
        filter_ids.append(int(message_id_raw))

    existing_doc = await database.db.reaction_roles.find_one(
        {
            "guild_id": {"$in": [guild.id, str(guild.id)]},
            "message_id": {"$in": filter_ids},
        }
    )
    if not existing_doc:
        return web.json_response({"error": "not_found"}, status=404)

    channel_id = existing_doc.get("channel_id")
    if channel_id:
        try:
            channel = guild.get_channel(int(channel_id))
            if channel and hasattr(channel, "fetch_message"):
                msg = await channel.fetch_message(int(message_id_raw))
                await msg.delete()
        except Exception as e:
            logger.warning("Could not delete message %s from channel: %s", message_id_raw, e)

    await database.delete_message_reaction_roles(message_id_raw)
    return web.json_response({"deleted": True})


async def temp_voice_channels_list_handler(request: web.Request) -> web.Response:
    guild = _get_guild(request)
    if guild is None:
        return web.json_response({"error": "guild_not_found"}, status=404)

    channels_data = []
    if database.db is not None:
        try:
            cursor = database.db.temp_voice_channels.find(
                {"guild_id": {"$in": [guild.id, str(guild.id)]}}
            ).sort("created_at", -1)
            async for doc in cursor:
                cid = doc.get("channel_id")
                try:
                    cid_int = int(cid)
                except (TypeError, ValueError):
                    continue
                ch = guild.get_channel(cid_int)
                if ch is None:
                    continue

                created_at = doc.get("created_at")
                if hasattr(created_at, "isoformat"):
                    created_at_str = created_at.isoformat()
                else:
                    created_at_str = str(created_at) if created_at else None

                member_ids = [str(m.id) for m in getattr(ch, "members", [])]
                channels_data.append(
                    {
                        "channel_id": str(cid),
                        "name": getattr(ch, "name", "Voice Channel"),
                        "owner_id": str(doc.get("owner_id", "")),
                        "locked": bool(doc.get("locked", False)),
                        "member_ids": member_ids,
                        "member_count": len(member_ids),
                        "user_limit": getattr(ch, "user_limit", 0),
                        "created_at": created_at_str,
                    }
                )
        except Exception as e:
            logger.exception("Error listing temp voice channels: %s", e)

    return web.json_response(channels_data)


async def temp_voice_config_get_handler(request: web.Request) -> web.Response:
    request.match_info["name"] = "temp_voice"
    return await module_config_get_handler(request)


async def temp_voice_config_put_handler(request: web.Request) -> web.Response:
    request.match_info["name"] = "temp_voice"
    return await module_config_put_handler(request)


async def tickets_summary_handler(request: web.Request) -> web.Response:
    guild = _get_guild(request)
    if guild is None:
        return web.json_response({"error": "guild_not_found"}, status=404)

    open_count = 0
    total_count = 0
    if database.db is not None:
        try:
            open_count = await database.db.tickets.count_documents(
                {
                    "guild_id": {"$in": [guild.id, str(guild.id)]},
                    "status": {"$in": ["open", "claimed"]},
                }
            )
            total_count = await database.db.tickets.count_documents(
                {"guild_id": {"$in": [guild.id, str(guild.id)]}}
            )
        except Exception as e:
            logger.exception("Error calculating tickets summary: %s", e)

    return web.json_response({"open_count": open_count, "total_count": total_count})


async def tickets_publish_panel_handler(request: web.Request) -> web.Response:
    guild = _get_guild(request)
    if guild is None:
        return web.json_response({"error": "guild_not_found"}, status=404)

    bot = request.app.get("bot")
    registry = getattr(bot, "modules_registry", None)
    if not registry:
        return web.json_response({"error": "registry_not_available"}, status=500)

    module = registry.get_module("tickets")
    if not module or not getattr(module, "engine", None):
        return web.json_response({"error": "tickets_engine_not_loaded"}, status=500)

    try:
        msg = await module.engine.publish_panel(guild)
        return web.json_response(
            {
                "ok": True,
                "message_id": str(msg.id),
                "channel_id": str(msg.channel.id),
            }
        )
    except ValueError as ve:
        return web.json_response({"error": str(ve)}, status=400)
    except discord.Forbidden as fe:
        return web.json_response({"error": f"Discord permission denied: {fe}"}, status=403)
    except Exception as e:
        logger.exception("Unexpected error publishing ticket panel: %s", e)
        return web.json_response({"error": f"Failed to publish panel: {str(e)}"}, status=500)


async def tickets_list_handler(request: web.Request) -> web.Response:
    guild = _get_guild(request)
    if guild is None:
        return web.json_response({"error": "guild_not_found"}, status=404)

    tickets_data = []
    if database.db is not None:
        try:
            cursor = (
                database.db.tickets.find(
                    {"guild_id": {"$in": [guild.id, str(guild.id)]}}
                )
                .sort("created_at", -1)
                .limit(50)
            )
            async for doc in cursor:
                created_at = doc.get("created_at")
                if hasattr(created_at, "isoformat"):
                    created_at_str = created_at.isoformat()
                else:
                    created_at_str = str(created_at) if created_at else None

                closed_at = doc.get("closed_at")
                if hasattr(closed_at, "isoformat"):
                    closed_at_str = closed_at.isoformat()
                else:
                    closed_at_str = str(closed_at) if closed_at else None

                tickets_data.append(
                    {
                        "id": str(doc.get("_id", "")),
                        "channel_id": str(doc.get("channel_id", "")),
                        "user_id": str(doc.get("user_id", "")),
                        "category_id": str(doc.get("category_id", "")),
                        "status": str(doc.get("status", "open")),
                        "claimed_by": (
                            str(doc["claimed_by"])
                            if doc.get("claimed_by") is not None
                            else None
                        ),
                        "participants": [str(p) for p in doc.get("participants", [])],
                        "number": int(doc.get("number", 0)),
                        "created_at": created_at_str,
                        "closed_at": closed_at_str,
                        "closed_by": (
                            str(doc["closed_by"])
                            if doc.get("closed_by") is not None
                            else None
                        ),
                    }
                )
        except Exception as e:
            logger.exception("Error listing tickets: %s", e)

    return web.json_response(tickets_data)


async def tickets_config_get_handler(request: web.Request) -> web.Response:
    request.match_info["name"] = "tickets"
    return await module_config_get_handler(request)


async def tickets_config_put_handler(request: web.Request) -> web.Response:
    request.match_info["name"] = "tickets"
    return await module_config_put_handler(request)


async def giveaways_list_handler(request: web.Request) -> web.Response:
    guild = _get_guild(request)
    if guild is None:
        return web.json_response({"error": "guild_not_found"}, status=404)

    try:
        import math
        import time as _pyTime

        page = 1
        limit = 50
        try:
            page = max(1, int(request.query.get("page", 1)))
            limit = min(100, max(1, int(request.query.get("limit", 50))))
        except (ValueError, TypeError):
            pass

        giveaways = []
        total_count = 0

        if database.db is not None:
            base_query = {"guild_id": {"$in": [guild.id, str(guild.id)]}}
            total_count = await database.db.giveaways.count_documents(base_query)

            cursor = (
                database.db.giveaways.find(base_query)
                .sort("_id", -1)
                .skip((page - 1) * limit)
                .limit(limit)
            )
            now_ts = _pyTime.time()
            async for doc in cursor:
                doc["_id"] = str(doc.get("_id", ""))
                if "created_at" in doc and hasattr(doc["created_at"], "isoformat"):
                    doc["created_at"] = doc["created_at"].isoformat()
                if "concluded_at" in doc and hasattr(doc["concluded_at"], "isoformat"):
                    doc["concluded_at"] = doc["concluded_at"].isoformat()

                # Normalize concluded flag
                doc["concluded"] = bool(
                    doc.get("concluded")
                    or doc.get("status") == "ended"
                    or doc.get("concluded_at")
                    or doc.get("Winners")
                    or doc.get("winners")
                    or (doc.get("end_time") and doc["end_time"] <= now_ts)
                )
                giveaways.append(doc)

        config_doc = {}
        if database.db is not None:
            config_doc = await database.db.giveaways_config.find_one(
                {"guild_id": {"$in": [guild.id, str(guild.id)]}}
            ) or {}
            config_doc.pop("_id", None)

        total_pages = max(1, math.ceil(total_count / limit)) if total_count > 0 else 1

        return web.json_response(
            {
                "giveaways": giveaways,
                "config": config_doc,
                "pagination": {
                    "total": total_count,
                    "page": page,
                    "limit": limit,
                    "total_pages": total_pages,
                },
            }
        )
    except Exception as e:
        logger.exception("Error in giveaways_list_handler: %s", e)
        return web.json_response({"error": str(e)}, status=500)


async def giveaways_create_handler(request: web.Request) -> web.Response:
    guild = _get_guild(request)
    if guild is None:
        return web.json_response({"error": "guild_not_found"}, status=404)

    try:
        body = await request.json()
        channel_id = int(body.get("channel_id"))
        title = str(body.get("title", "Giveaway")).strip()
        winners_count = int(body.get("winners_count", 1))
        duration_seconds = int(body.get("duration_seconds", 3600))
        description = str(body.get("description", "")).strip()
        image_url = str(body.get("image_url", "")).strip()

        required_role_ids = [int(r) for r in body.get("required_role_ids", []) if str(r).isdigit()]
        role_multipliers = {}
        for r, m in (body.get("role_multipliers") or {}).items():
            if str(r).isdigit() and str(m).isdigit():
                role_multipliers[int(r)] = int(m)

        from cogs.giveaway_cog import launch_dashboard_giveaway

        bot = request.app.get("bot")
        result = await launch_dashboard_giveaway(
            bot=bot,
            guild_id=guild.id,
            channel_id=channel_id,
            creator_id=bot.user.id,
            title=title,
            winners_count=winners_count,
            duration_seconds=duration_seconds,
            description=description,
            image_url=image_url,
            required_role_ids=required_role_ids,
            role_multipliers=role_multipliers,
        )
        return web.json_response({"status": "ok", **result})
    except Exception as e:
        logger.exception("Error in giveaways_create_handler: %s", e)
        return web.json_response({"error": str(e)}, status=400)


async def giveaways_reroll_handler(request: web.Request) -> web.Response:
    guild = _get_guild(request)
    if guild is None:
        return web.json_response({"error": "guild_not_found"}, status=404)

    message_id = request.match_info.get("message_id")
    if not message_id:
        return web.json_response({"error": "missing_message_id"}, status=400)

    try:
        if database.db is None:
            return web.json_response({"error": "database_unavailable"}, status=503)

        doc = await database.db.giveaways.find_one({"message_id": str(message_id)})
        if not doc:
            return web.json_response({"error": "giveaway_not_found"}, status=404)

        entrants = doc.get("Entrants") or doc.get("entrants") or []
        if not entrants:
            return web.json_response({"error": "no_entrants"}, status=400)

        from cogs.giveaway_cog import weighted_sample_without_replacement

        count = min(int(doc.get("Winner") or doc.get("winners_count") or 1), len(entrants))
        user_weights = doc.get("UserWeights") or {}
        weights = [float(user_weights.get(str(u), 1.0)) for u in entrants]
        new_winners = weighted_sample_without_replacement(entrants, weights, count)

        # Notify in channel
        bot = request.app.get("bot")
        channel_id = doc.get("channel_id")
        if channel_id:
            channel = guild.get_channel(int(channel_id))
            if channel and isinstance(channel, discord.TextChannel):
                winner_mentions = [f"<@{w}>" for w in new_winners]
                title = doc.get("Title") or doc.get("title") or "Giveaway"
                await channel.send(
                    f"🎊 **Dashboard Reroll:** Congratulations {' '.join(winner_mentions)}! You won the **{title}**! 🎊"
                )

        return web.json_response({"status": "ok", "winners": [str(w) for w in new_winners]})
    except Exception as e:
        logger.exception("Error in giveaways_reroll_handler: %s", e)
        return web.json_response({"error": str(e)}, status=500)


async def giveaways_config_put_handler(request: web.Request) -> web.Response:
    guild = _get_guild(request)
    if guild is None:
        return web.json_response({"error": "guild_not_found"}, status=404)

    try:
        body = await request.json()
        logs_channel_id = body.get("logs_channel_id")
        manager_role_ids = body.get("manager_role_ids") or []

        update_doc = {
            "guild_id": guild.id,
            "logs_channel_id": int(logs_channel_id) if logs_channel_id else None,
            "manager_role_ids": [str(r) for r in manager_role_ids],
        }

        if database.db is not None:
            await database.db.giveaways_config.update_one(
                {"guild_id": guild.id},
                {"$set": update_doc},
                upsert=True,
            )

        return web.json_response({"status": "ok", "config": update_doc})
    except Exception as e:
        logger.exception("Error in giveaways_config_put_handler: %s", e)
        return web.json_response({"error": str(e)}, status=400)


async def moderation_cases_list_handler(request: web.Request) -> web.Response:
    guild = _get_guild(request)
    if guild is None:
        return web.json_response({"error": "guild_not_found"}, status=404)

    try:
        cases = []
        if database.db is not None:
            cursor = database.db.moderation_cases.find(
                {"guild_id": {"$in": [guild.id, str(guild.id)]}}
            ).sort("case_id", -1).limit(50)
            async for doc in cursor:
                doc["_id"] = str(doc.get("_id", ""))
                if "created_at" in doc and hasattr(doc["created_at"], "isoformat"):
                    doc["created_at"] = doc["created_at"].isoformat()
                cases.append(doc)

        return web.json_response(cases)
    except Exception as e:
        logger.exception("Error in moderation_cases_list_handler: %s", e)
        return web.json_response({"error": str(e)}, status=500)


async def moderation_case_delete_handler(request: web.Request) -> web.Response:
    guild = _get_guild(request)
    if guild is None:
        return web.json_response({"error": "guild_not_found"}, status=404)

    case_id_raw = request.match_info.get("case_id")
    if not case_id_raw or not case_id_raw.isdigit():
        return web.json_response({"error": "invalid_case_id"}, status=400)

    try:
        if database.db is not None:
            res = await database.db.moderation_cases.delete_one(
                {"guild_id": {"$in": [guild.id, str(guild.id)]}, "case_id": int(case_id_raw)}
            )
            if res.deleted_count == 0:
                return web.json_response({"error": "case_not_found"}, status=404)

        return web.json_response({"status": "ok"})
    except Exception as e:
        logger.exception("Error in moderation_case_delete_handler: %s", e)
        return web.json_response({"error": str(e)}, status=500)


def create_app(bot) -> web.Application:
    app = web.Application(middlewares=[auth_middleware])
    app["bot"] = bot
    app.router.add_get("/health", health_handler)

    for prefix in ("/guilds/{guild_id}", "/guilds/{id}"):
        app.router.add_get(f"{prefix}/overview", guild_overview_handler)
        app.router.add_get(f"{prefix}/modules/overview", guild_modules_overview_handler)
        app.router.add_get(f"{prefix}/channels", guild_channels_handler)
        app.router.add_get(f"{prefix}/roles", guild_roles_handler)
        app.router.add_get(f"{prefix}/modules/{{name}}/state", module_state_get_handler)
        app.router.add_put(f"{prefix}/modules/{{name}}/state", module_state_put_handler)
        app.router.add_get(f"{prefix}/modules/{{name}}/config", module_config_get_handler)
        app.router.add_put(f"{prefix}/modules/{{name}}/config", module_config_put_handler)

        # Temp Voice endpoints
        app.router.add_get(f"{prefix}/temp-voice/channels", temp_voice_channels_list_handler)
        app.router.add_get(f"{prefix}/temp-voice/config", temp_voice_config_get_handler)
        app.router.add_put(f"{prefix}/temp-voice/config", temp_voice_config_put_handler)

        # Tickets endpoints
        app.router.add_get(f"{prefix}/tickets", tickets_summary_handler)
        app.router.add_get(f"{prefix}/tickets/list", tickets_list_handler)
        app.router.add_post(f"{prefix}/tickets/publish-panel", tickets_publish_panel_handler)
        app.router.add_get(f"{prefix}/tickets/config", tickets_config_get_handler)
        app.router.add_put(f"{prefix}/tickets/config", tickets_config_put_handler)

        # Giveaways endpoints
        app.router.add_get(f"{prefix}/giveaways", giveaways_list_handler)
        app.router.add_post(f"{prefix}/giveaways", giveaways_create_handler)
        app.router.add_post(f"{prefix}/giveaways/{{message_id}}/reroll", giveaways_reroll_handler)
        app.router.add_put(f"{prefix}/giveaways/config", giveaways_config_put_handler)

        # Moderation endpoints
        app.router.add_get(f"{prefix}/moderation/cases", moderation_cases_list_handler)
        app.router.add_delete(f"{prefix}/moderation/cases/{{case_id}}", moderation_case_delete_handler)

    app.router.add_get("/modules", modules_list_handler)

    # Reaction Roles endpoints supporting both /guilds/{guild_id}/... and /guilds/{id}/...
    for prefix in ("/guilds/{guild_id}", "/guilds/{id}"):
        app.router.add_get(f"{prefix}/reaction-roles", reaction_roles_list_handler)
        app.router.add_get(f"{prefix}/reaction-roles/{{message_id}}", reaction_role_get_handler)
        app.router.add_post(f"{prefix}/reaction-roles", reaction_role_post_handler)
        app.router.add_put(f"{prefix}/reaction-roles/{{message_id}}", reaction_role_put_handler)
        app.router.add_delete(f"{prefix}/reaction-roles/{{message_id}}", reaction_role_delete_handler)

    return app


async def start_control_plane(bot) -> web.AppRunner:
    app = create_app(bot)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host=config.CONTROL_PLANE_HOST, port=config.CONTROL_PLANE_PORT)
    await site.start()
    return runner


async def stop_control_plane(runner: web.AppRunner | None) -> None:
    if runner is not None:
        await runner.cleanup()

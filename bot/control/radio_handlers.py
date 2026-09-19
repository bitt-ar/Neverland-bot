import asyncio
import io
import json
import logging
import os
import re
import shutil
import uuid
from pathlib import Path
from aiohttp import web, ClientSession
import discord

from core import config, database
from core.security import encrypt_token, decrypt_token, mask_token, validate_audio_magic_bytes
from bot.modules.radio.helpers import get_radio_storage_dir, extract_audio_metadata

logger = logging.getLogger(__name__)

_PID_RE = re.compile(r"^pl_[0-9a-f]{8}$")
_TID_RE = re.compile(r"^trk_[0-9a-f]{8}$")
_ALLOWED_AUDIO_EXTENSIONS = {".mp3", ".ogg", ".wav", ".flac"}


def _get_guild_id(request: web.Request) -> str | None:
    gid = request.match_info.get("guild_id") or request.match_info.get("id")
    if not gid or not gid.isdigit():
        return None
    return str(gid)


async def radio_config_get_handler(request: web.Request) -> web.Response:
    gid = _get_guild_id(request)
    if not gid:
        return web.json_response({"error": "Invalid guild ID"}, status=400)
    cfg = await database.get_radio_config(gid)
    return web.json_response(cfg)


async def radio_config_put_handler(request: web.Request) -> web.Response:
    gid = _get_guild_id(request)
    if not gid:
        return web.json_response({"error": "Invalid guild ID"}, status=400)
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    if "max_playlist_storage_mb" in data:
        return web.json_response(
            {
                "error": "The playlist storage quota is governed exclusively by the Bot Owner via RADIO_MAX_PLAYLIST_STORAGE_MB in .env and cannot be changed per server."
            },
            status=403,
        )

    fields = {}
    if "default_volume" in data:
        try:
            vol = int(data["default_volume"])
            if not (1 <= vol <= 100):
                return web.json_response({"error": "default_volume must be an integer between 1 and 100"}, status=400)
            fields["default_volume"] = vol
        except (ValueError, TypeError):
            return web.json_response({"error": "default_volume must be an integer between 1 and 100"}, status=400)

    updated = await database.update_radio_config(gid, **fields)
    return web.json_response(updated)


async def radio_bots_get_handler(request: web.Request) -> web.Response:
    gid = _get_guild_id(request)
    if not gid:
        return web.json_response({"error": "Invalid guild ID"}, status=400)

    bot = request.app.get("bot")
    radio_mgr = getattr(bot, "radio_manager", None)

    slots_data = []
    for slot in (0, 1, 2):
        if radio_mgr:
            status = await radio_mgr.get_bot_status(gid, slot)
        else:
            status = {
                "slot": slot,
                "name": "Main Bot" if slot == 0 else f"Radio Bot {slot}",
                "id": None,
                "avatar": None,
                "is_configured": slot == 0,
                "is_online": False,
                "in_voice": False,
                "channel_id": None,
                "channel_name": None,
                "is_playing": False,
                "current_track": None,
            }

        # If slot 1 or 2, retrieve masked token indicator (decrypted before masking for human-readable hint)
        if slot in (1, 2):
            doc = await database.get_radio_bot(gid, slot)
            if doc and doc.get("encrypted_token"):
                raw_token = decrypt_token(doc.get("encrypted_token", ""))
                status["has_token"] = bool(raw_token)
                status["masked_token"] = mask_token(raw_token) if raw_token else "••••••••"
            else:
                status["has_token"] = False
                status["masked_token"] = None

        slots_data.append(status)

    return web.json_response(slots_data)


async def radio_bot_save_handler(request: web.Request) -> web.Response:
    gid = _get_guild_id(request)
    if not gid:
        return web.json_response({"error": "Invalid guild ID"}, status=400)

    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    slot = data.get("bot_slot")
    if slot not in (1, 2):
        return web.json_response({"error": "bot_slot must be 1 or 2"}, status=400)

    raw_token = str(data.get("token", "")).strip()
    if not raw_token:
        return web.json_response({"error": "Token is required"}, status=400)

    # 1. Validate token with Discord REST API
    async with ClientSession() as session:
        headers = {"Authorization": f"Bot {raw_token}"}
        async with session.get("https://discord.com/api/v10/users/@me", headers=headers) as resp:
            if resp.status != 200:
                return web.json_response(
                    {"error": "Invalid Discord Bot Token. Discord rejected the token."},
                    status=400,
                )
            bot_user = await resp.json()

    bot_id = str(bot_user.get("id"))
    bot_name = bot_user.get("username", f"Radio Bot {slot}")
    avatar_hash = bot_user.get("avatar")
    avatar_url = (
        f"https://cdn.discordapp.com/avatars/{bot_id}/{avatar_hash}.png"
        if avatar_hash
        else "https://cdn.discordapp.com/embed/avatars/0.png"
    )

    # Check if this bot application is the same as the main bot
    bot = request.app.get("bot")
    if bot and bot.user and str(bot.user.id) == bot_id:
        return web.json_response(
            {"error": "This token belongs to the primary bot. Auxiliary bots must use different bot accounts."},
            status=400,
        )

    # 2. Encrypt token and save to database
    enc_token = encrypt_token(raw_token)
    bot_doc = {
        "bot_id": bot_id,
        "bot_username": bot_name,
        "bot_avatar": avatar_url,
        "encrypted_token": enc_token,
        "enabled": True,
        "updated_at": discord.utils.utcnow().isoformat(),
    }
    await database.save_radio_bot(gid, slot, bot_doc)

    # 3. Disconnect old client if present and initialize new client
    radio_mgr = getattr(bot, "radio_manager", None)
    if radio_mgr:
        init_task = asyncio.create_task(radio_mgr.ensure_aux_client(gid, slot))
        if hasattr(radio_mgr, "_client_tasks"):
            radio_mgr._client_tasks[(gid, slot, "init")] = init_task
            init_task.add_done_callback(lambda t: radio_mgr._client_tasks.pop((gid, slot, "init"), None))

    # Generate convenient OAuth invite link
    invite_url = f"https://discord.com/oauth2/authorize?client_id={bot_id}&permissions=3145728&scope=bot%20applications.commands"

    return web.json_response({
        "status": "ok",
        "slot": slot,
        "bot_id": bot_id,
        "bot_username": bot_name,
        "bot_avatar": avatar_url,
        "invite_url": invite_url,
        "message": "Auxiliary bot configured successfully. Ensure the bot is invited to your server.",
    })


async def radio_bot_delete_handler(request: web.Request) -> web.Response:
    gid = _get_guild_id(request)
    if not gid:
        return web.json_response({"error": "Invalid guild ID"}, status=400)

    slot_raw = request.match_info.get("bot_slot")
    try:
        slot = int(slot_raw)
    except (ValueError, TypeError):
        return web.json_response({"error": "Invalid bot slot"}, status=400)

    if slot not in (1, 2):
        return web.json_response({"error": "Cannot delete main bot slot 0"}, status=400)

    bot = request.app.get("bot")
    radio_mgr = getattr(bot, "radio_manager", None)
    if radio_mgr:
        await radio_mgr.stop_stream(gid, slot)
        await radio_mgr.disconnect_aux_client(gid, slot)

    await database.delete_radio_bot(gid, slot)
    return web.json_response({"status": "ok", "message": f"Auxiliary bot slot {slot} removed."})


async def radio_playlists_list_handler(request: web.Request) -> web.Response:
    gid = _get_guild_id(request)
    if not gid:
        return web.json_response({"error": "Invalid guild ID"}, status=400)

    playlists = await database.get_radio_playlists(gid)
    # Augment playlists with calculated track count and storage size
    cfg = await database.get_radio_config(gid)
    max_mb = cfg.get("max_playlist_storage_mb", 100)

    enriched = []
    for p in playlists:
        tracks = await database.get_radio_tracks(gid, p["id"])
        total_size = sum(t.get("file_size_bytes", 0) for t in tracks)
        total_duration = sum(t.get("duration_seconds", 0) for t in tracks)
        enriched.append({
            "id": p["id"],
            "name": p.get("name", "Untitled Playlist"),
            "loop": bool(p.get("loop", True)),
            "track_count": len(tracks),
            "total_size_bytes": total_size,
            "total_size_mb": round(total_size / (1024 * 1024), 2),
            "max_size_mb": max_mb,
            "total_duration_seconds": round(total_duration, 1),
            "created_at": p.get("created_at"),
        })

    return web.json_response(enriched)


async def radio_playlist_create_handler(request: web.Request) -> web.Response:
    gid = _get_guild_id(request)
    if not gid:
        return web.json_response({"error": "Invalid guild ID"}, status=400)

    existing = await database.get_radio_playlists(gid)
    if len(existing) >= 3:
        return web.json_response(
            {"error": "Maximum of 3 playlists allowed per server."},
            status=400,
        )

    try:
        data = await request.json()
    except Exception:
        data = {}

    name = str(data.get("name", "")).strip() or f"Playlist {len(existing) + 1}"
    loop = bool(data.get("loop", True))
    pid = f"pl_{uuid.uuid4().hex[:8]}"

    doc = {
        "id": pid,
        "guild_id": gid,
        "name": name,
        "loop": loop,
        "created_at": discord.utils.utcnow().isoformat(),
        "updated_at": discord.utils.utcnow().isoformat(),
    }
    await database.save_radio_playlist(gid, doc)
    return web.json_response(doc, status=201)


async def radio_playlist_put_handler(request: web.Request) -> web.Response:
    gid = _get_guild_id(request)
    pid = request.match_info.get("playlist_id", "")
    if not gid or not _PID_RE.match(pid):
        return web.json_response({"error": "Invalid guild or playlist ID"}, status=400)

    playlist = await database.get_radio_playlist(gid, pid)
    if not playlist:
        return web.json_response({"error": "Playlist not found"}, status=404)

    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    fields = {"updated_at": discord.utils.utcnow().isoformat()}
    if "name" in data:
        name = str(data["name"]).strip()
        if name:
            fields["name"] = name
    if "loop" in data:
        fields["loop"] = bool(data["loop"])

    playlist.update(fields)
    await database.save_radio_playlist(gid, playlist)
    return web.json_response(playlist)


async def radio_playlist_delete_handler(request: web.Request) -> web.Response:
    gid = _get_guild_id(request)
    pid = request.match_info.get("playlist_id", "")
    if not gid or not _PID_RE.match(pid):
        return web.json_response({"error": "Invalid guild or playlist ID"}, status=400)

    # Stop any running stream playing this playlist
    bot = request.app.get("bot")
    radio_mgr = getattr(bot, "radio_manager", None)
    if radio_mgr:
        for slot in (0, 1, 2):
            stream = await database.get_active_stream(gid, slot)
            if stream and stream.get("playlist_id") == pid:
                await radio_mgr.stop_stream(gid, slot)

    # Delete audio files from disk safely with containment check
    try:
        storage_dir = get_radio_storage_dir(gid, pid)
        base_dir = get_radio_storage_dir(gid)
        if str(storage_dir.resolve()).startswith(str(base_dir.resolve()) + os.sep):
            if storage_dir.exists() and storage_dir.is_dir():
                shutil.rmtree(storage_dir)
    except Exception as e:
        logger.warning("Failed deleting storage dir for playlist %s: %s", pid, e)

    await database.delete_radio_playlist(gid, pid)
    return web.json_response({"status": "ok", "message": "Playlist deleted successfully."})


async def radio_tracks_list_handler(request: web.Request) -> web.Response:
    gid = _get_guild_id(request)
    pid = request.match_info.get("playlist_id", "")
    if not gid or not _PID_RE.match(pid):
        return web.json_response({"error": "Invalid parameters"}, status=400)

    tracks = await database.get_radio_tracks(gid, pid)
    return web.json_response(tracks)


async def radio_track_upload_handler(request: web.Request) -> web.Response:
    gid = _get_guild_id(request)
    pid = request.match_info.get("playlist_id", "")
    if not gid or not _PID_RE.match(pid):
        return web.json_response({"error": "Invalid parameters"}, status=400)

    playlist = await database.get_radio_playlist(gid, pid)
    if not playlist:
        return web.json_response({"error": "Playlist does not exist"}, status=404)

    # Read storage configuration
    cfg = await database.get_radio_config(gid)
    max_storage_mb = cfg.get("max_playlist_storage_mb", 100)
    max_storage_bytes = max_storage_mb * 1024 * 1024

    # Current playlist total size
    existing_tracks = await database.get_radio_tracks(gid, pid)
    current_size = sum(t.get("file_size_bytes", 0) for t in existing_tracks)

    # Early Content-Length check to prevent denial of service (N-M5)
    if request.content_length and (current_size + request.content_length > max_storage_bytes):
        return web.json_response(
            {
                "error": f"Storage quota exceeded. Allowed limit set by Bot Owner is {max_storage_mb} MB per playlist."
            },
            status=400,
        )

    track_id = f"trk_{uuid.uuid4().hex[:8]}"
    storage_dir = get_radio_storage_dir(gid, pid)
    temp_path = storage_dir / f"temp_{track_id}.bin"
    original_filename = "track.mp3"
    uploaded_bytes = 0

    try:
        # Check if request has multipart content
        if "multipart/form-data" in (request.content_type or ""):
            reader = await request.multipart()
            found_file = False
            while True:
                try:
                    part = await reader.next()
                except Exception as e:
                    logger.debug("Multipart reader next terminated: %s", e)
                    break
                if part is None:
                    break
                if part.name == "file":
                    found_file = True
                    original_filename = part.filename or "track.mp3"
                    quota_exceeded = False
                    with open(temp_path, "wb") as out_f:
                        while True:
                            try:
                                chunk = await part.read_chunk(65536)
                            except Exception as e:
                                logger.debug("Part chunk read ended: %s", e)
                                break
                            if not chunk:
                                break
                            uploaded_bytes += len(chunk)
                            if current_size + uploaded_bytes > max_storage_bytes:
                                quota_exceeded = True
                                break
                            out_f.write(chunk)

                    if quota_exceeded:
                        temp_path.unlink(missing_ok=True)
                        return web.json_response(
                            {
                                "error": f"Storage quota exceeded. Allowed limit set by Bot Owner is {max_storage_mb} MB per playlist."
                            },
                            status=400,
                        )
                    break  # File part successfully read

            if not found_file or uploaded_bytes == 0:
                if temp_path.exists():
                    temp_path.unlink(missing_ok=True)
                return web.json_response({"error": "No file content received in upload"}, status=400)

        else:
            # Fallback for standard form post
            try:
                post_data = await request.post()
            except Exception as e:
                logger.error("Failed parsing post data: %s", e)
                return web.json_response({"error": f"Failed reading upload: {str(e)}"}, status=400)

            file_field = post_data.get("file")
            if not file_field:
                return web.json_response({"error": "No 'file' field received in upload"}, status=400)

            if hasattr(file_field, "file"):
                original_filename = getattr(file_field, "filename", "track.mp3") or "track.mp3"
                fp = file_field.file
                fp.seek(0, io.SEEK_END)
                uploaded_bytes = fp.tell()
                fp.seek(0)
            elif isinstance(file_field, bytes):
                original_filename = "track.mp3"
                uploaded_bytes = len(file_field)
                fp = io.BytesIO(file_field)
            else:
                return web.json_response({"error": "Invalid file field"}, status=400)

            if uploaded_bytes == 0:
                return web.json_response({"error": "Uploaded file is empty"}, status=400)

            if current_size + uploaded_bytes > max_storage_bytes:
                return web.json_response(
                    {
                        "error": f"Storage quota exceeded. Allowed limit set by Bot Owner is {max_storage_mb} MB per playlist."
                    },
                    status=400,
                )

            with open(temp_path, "wb") as out_f:
                shutil.copyfileobj(fp, out_f)

        # Validate magic bytes
        is_valid_audio, mime_or_err = validate_audio_magic_bytes(temp_path)
        if not is_valid_audio:
            temp_path.unlink(missing_ok=True)
            return web.json_response({"error": f"Invalid audio file: {mime_or_err}"}, status=400)

        # Deduce clean extension strictly from validated mime type
        ext_map = {
            "audio/mpeg": ".mp3",
            "audio/ogg": ".ogg",
            "audio/wav": ".wav",
            "audio/flac": ".flac",
        }
        ext = ext_map.get(mime_or_err)
        if not ext:
            temp_path.unlink(missing_ok=True)
            return web.json_response({"error": "Unsupported audio format. Supported: MP3, OGG, WAV, FLAC"}, status=400)

        final_path = storage_dir / f"{track_id}{ext}"
        temp_path.rename(final_path)

        # Extract duration & metadata using ffprobe
        meta = await extract_audio_metadata(final_path)
        duration = meta.get("duration", 0.0)

        track_doc = {
            "id": track_id,
            "guild_id": gid,
            "playlist_id": pid,
            "title": original_filename.rsplit(".", 1)[0],
            "original_filename": original_filename,
            "file_path": str(final_path),
            "file_size_bytes": uploaded_bytes,
            "duration_seconds": duration,
            "order": len(existing_tracks) + 1,
            "mime_type": mime_or_err,
            "created_at": discord.utils.utcnow().isoformat(),
        }

        await database.add_radio_track(gid, pid, track_doc)
        return web.json_response(track_doc, status=201)

    except Exception as e:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)
        logger.exception("Error uploading radio track: %s", e)
        return web.json_response({"error": "Failed processing track upload"}, status=500)


async def radio_track_delete_handler(request: web.Request) -> web.Response:
    gid = _get_guild_id(request)
    pid = request.match_info.get("playlist_id", "")
    tid = request.match_info.get("track_id", "")
    if not gid or not _PID_RE.match(pid) or not _TID_RE.match(tid):
        return web.json_response({"error": "Invalid parameters"}, status=400)

    track = await database.delete_radio_track(gid, pid, tid)
    if not track:
        return web.json_response({"error": "Track not found"}, status=404)

    file_path = Path(track.get("file_path", ""))
    try:
        storage_dir = get_radio_storage_dir(gid, pid).resolve()
        resolved_file = file_path.resolve()
        # Verify resolved track file is strictly inside playlist storage directory
        if str(resolved_file).startswith(str(storage_dir) + os.sep) and resolved_file.is_file():
            resolved_file.unlink(missing_ok=True)
    except Exception as e:
        logger.warning("Error deleting track file %s: %s", file_path, e)

    return web.json_response({"status": "ok", "message": "Track deleted successfully."})


async def radio_play_handler(request: web.Request) -> web.Response:
    gid = _get_guild_id(request)
    if not gid:
        return web.json_response({"error": "Invalid guild ID"}, status=400)

    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    slot = data.get("bot_slot", 0)
    channel_id = data.get("voice_channel_id")
    playlist_id = data.get("playlist_id")
    loop = bool(data.get("loop", True))

    if slot not in (0, 1, 2):
        return web.json_response({"error": "bot_slot must be 0, 1, or 2"}, status=400)
    if not channel_id:
        return web.json_response({"error": "voice_channel_id is required"}, status=400)
    if not playlist_id or not _PID_RE.match(str(playlist_id)):
        return web.json_response({"error": "Invalid or missing playlist_id format"}, status=400)

    bot = request.app.get("bot")
    radio_mgr = getattr(bot, "radio_manager", None)
    if not radio_mgr:
        return web.json_response({"error": "Radio voice manager not initialized"}, status=500)

    success, msg = await radio_mgr.start_stream(gid, slot, channel_id, playlist_id, loop)
    if not success:
        return web.json_response({"error": msg}, status=400)

    return web.json_response({
        "status": "ok",
        "message": msg,
        "bot_slot": slot,
        "voice_channel_id": str(channel_id),
        "playlist_id": str(playlist_id),
        "loop": loop,
    })


async def radio_stop_handler(request: web.Request) -> web.Response:
    gid = _get_guild_id(request)
    if not gid:
        return web.json_response({"error": "Invalid guild ID"}, status=400)

    try:
        data = await request.json()
    except Exception:
        data = {}

    slot = data.get("bot_slot", 0)
    if slot not in (0, 1, 2):
        return web.json_response({"error": "bot_slot must be 0, 1, or 2"}, status=400)

    bot = request.app.get("bot")
    radio_mgr = getattr(bot, "radio_manager", None)
    if not radio_mgr:
        return web.json_response({"error": "Radio manager not initialized"}, status=500)

    await radio_mgr.stop_stream(gid, slot)
    return web.json_response({"status": "ok", "message": f"Broadcast stopped for bot slot {slot}."})


async def radio_status_handler(request: web.Request) -> web.Response:
    gid = _get_guild_id(request)
    if not gid:
        return web.json_response({"error": "Invalid guild ID"}, status=400)

    bot = request.app.get("bot")
    radio_mgr = getattr(bot, "radio_manager", None)
    if not radio_mgr:
        return web.json_response({"error": "Radio manager not initialized"}, status=500)

    streams = []
    for slot in (0, 1, 2):
        slot_status = await radio_mgr.get_bot_status(gid, slot)
        active_doc = await database.get_active_stream(gid, slot)
        slot_status["active_stream"] = active_doc
        streams.append(slot_status)

    return web.json_response(streams)

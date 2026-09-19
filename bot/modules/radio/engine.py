import asyncio
import logging
from pathlib import Path
from typing import Dict, Optional, Tuple

import discord
from discord.ext import commands

from core import database
from core.security import decrypt_token
from bot.modules.radio.helpers import get_radio_storage_dir

logger = logging.getLogger(__name__)


class AuxiliaryBotClient(discord.Client):
    """A lightweight Discord client dedicated to streaming voice for an auxiliary bot slot."""

    def __init__(self, guild_id: str, bot_slot: int, *args, **kwargs):
        intents = discord.Intents.default()
        intents.guilds = True
        intents.voice_states = True
        intents.members = False
        intents.message_content = False
        super().__init__(intents=intents, *args, **kwargs)
        self.target_guild_id = int(guild_id)
        self.bot_slot = bot_slot
        self._connected_event = asyncio.Event()

    async def on_ready(self):
        logger.info(
            "Auxiliary Radio Bot Slot %d ready as %s (ID: %s) for guild %s",
            self.bot_slot,
            self.user,
            self.user.id,
            self.target_guild_id,
        )
        self._connected_event.set()
        try:
            await self.change_presence(
                status=discord.Status.online,
                activity=discord.Activity(
                    type=discord.ActivityType.listening,
                    name="24/7 Radio Stream",
                ),
            )
        except Exception as e:
            logger.warning("Failed setting presence for aux bot: %s", e)


class RadioVoiceManager:
    """Coordinates voice channels, auxiliary bot clients, and audio streaming for Neverland Radio."""

    def __init__(self, main_bot: commands.Bot):
        self.main_bot = main_bot
        # Map of (guild_id, bot_slot) -> AuxiliaryBotClient
        self.aux_clients: Dict[Tuple[str, int], AuxiliaryBotClient] = {}
        # Map of (guild_id, bot_slot) -> asyncio.Task running the stream
        self.active_tasks: Dict[Tuple[str, int], asyncio.Task] = {}
        # Map of (guild_id, bot_slot) -> current track info dict
        self.current_playing: Dict[Tuple[str, int], dict] = {}
        # Map of (guild_id, bot_slot) -> asyncio.Task running the client connection (retained against GC)
        self._client_tasks: Dict[Tuple[str, int], asyncio.Task] = {}

    def get_client(self, guild_id: str | int, bot_slot: int) -> Optional[discord.Client]:
        """Return the discord.Client for the given slot (0=Main bot, 1 or 2=Aux bot)."""
        slot = int(bot_slot)
        if slot == 0:
            return self.main_bot
        return self.aux_clients.get((str(guild_id), slot))

    async def ensure_aux_client(self, guild_id: str | int, bot_slot: int) -> Optional[AuxiliaryBotClient]:
        """Ensure the auxiliary bot for the given slot is instantiated and connected to Discord."""
        gid = str(guild_id)
        slot = int(bot_slot)
        if slot == 0:
            return None

        key = (gid, slot)
        existing = self.aux_clients.get(key)
        if existing and not existing.is_closed():
            return existing

        # Fetch bot token from database
        bot_doc = await database.get_radio_bot(gid, slot)
        if not bot_doc:
            logger.warning("No auxiliary bot configured for guild %s slot %d", gid, slot)
            return None

        enc_token = bot_doc.get("encrypted_token")
        if not enc_token:
            return None

        token = decrypt_token(enc_token)
        if not token:
            logger.error("Failed decrypting token for guild %s slot %d", gid, slot)
            return None

        client = AuxiliaryBotClient(gid, slot)
        self.aux_clients[key] = client

        # Run client connection in background task with retained reference (N-M3)
        async def run_client():
            try:
                await client.start(token)
            except Exception as e:
                logger.error("Auxiliary bot slot %d failed running: %s", slot, e)
            finally:
                if not client.is_closed():
                    await client.close()

        task = asyncio.create_task(run_client())
        self._client_tasks[key] = task
        task.add_done_callback(lambda t: self._client_tasks.pop(key, None))

        # Wait up to 10 seconds for on_ready
        try:
            await asyncio.wait_for(client._connected_event.wait(), timeout=10.0)
            return client
        except asyncio.TimeoutError:
            logger.warning("Timed out waiting for auxiliary bot slot %d to connect", slot)
            return client if client.is_ready() else None

    async def disconnect_aux_client(self, guild_id: str | int, bot_slot: int):
        """Disconnect and cleanup an auxiliary bot client."""
        key = (str(guild_id), int(bot_slot))
        old_task = self._client_tasks.pop(key, None)
        if old_task and not old_task.done():
            old_task.cancel()

        client = self.aux_clients.pop(key, None)
        if client and not client.is_closed():
            try:
                # Disconnect any active voice clients first
                for vc in list(client.voice_clients):
                    try:
                        await vc.disconnect(force=True)
                    except Exception:
                        pass
                await client.close()
            except Exception as e:
                logger.warning("Error closing auxiliary bot %s: %s", key, e)

    async def get_bot_status(self, guild_id: str | int, bot_slot: int) -> dict:
        """Get live status for a specific bot slot (0, 1, or 2)."""
        gid = str(guild_id)
        slot = int(bot_slot)
        key = (gid, slot)

        if slot == 0:
            user = self.main_bot.user
            guild = self.main_bot.get_guild(int(gid))
            vc = guild.voice_client if guild else None
            is_playing = bool(vc and vc.is_playing())
            current_track = self.current_playing.get(key)
            return {
                "slot": 0,
                "name": user.name if user else "Neverland (Main)",
                "id": str(user.id) if user else None,
                "avatar": str(user.display_avatar.url) if user else None,
                "is_configured": True,
                "is_online": self.main_bot.is_ready(),
                "in_voice": bool(vc and vc.is_connected()),
                "channel_id": str(vc.channel.id) if (vc and vc.channel) else None,
                "channel_name": vc.channel.name if (vc and vc.channel) else None,
                "is_playing": is_playing,
                "current_track": current_track,
            }

        # Aux Bot (Slot 1 or 2)
        bot_doc = await database.get_radio_bot(gid, slot)
        if not bot_doc:
            return {
                "slot": slot,
                "name": f"Radio Bot {slot}",
                "id": None,
                "avatar": None,
                "is_configured": False,
                "is_online": False,
                "in_voice": False,
                "channel_id": None,
                "channel_name": None,
                "is_playing": False,
                "current_track": None,
            }

        client = self.aux_clients.get(key)
        is_online = bool(client and client.is_ready() and not client.is_closed())
        guild = client.get_guild(int(gid)) if (client and is_online) else None
        vc = guild.voice_client if guild else None
        is_playing = bool(vc and vc.is_playing())
        current_track = self.current_playing.get(key)

        return {
            "slot": slot,
            "name": bot_doc.get("bot_username") or (client.user.name if client and client.user else f"Radio Bot {slot}"),
            "id": bot_doc.get("bot_id") or (str(client.user.id) if client and client.user else None),
            "avatar": bot_doc.get("bot_avatar") or (str(client.user.display_avatar.url) if client and client.user else None),
            "is_configured": True,
            "is_online": is_online,
            "in_voice": bool(vc and vc.is_connected()),
            "channel_id": str(vc.channel.id) if (vc and vc.channel) else None,
            "channel_name": vc.channel.name if (vc and vc.channel) else None,
            "is_playing": is_playing,
            "current_track": current_track,
        }

    async def start_stream(
        self,
        guild_id: str | int,
        bot_slot: int,
        channel_id: str | int,
        playlist_id: str,
        loop: bool = True,
    ) -> Tuple[bool, str]:
        """Connect the designated bot slot to channel_id and start playback of playlist_id."""
        gid = str(guild_id)
        slot = int(bot_slot)
        cid = int(channel_id)
        pid = str(playlist_id)
        key = (gid, slot)

        # 1. Stop any existing playback task for this slot
        await self.stop_stream(gid, slot)

        # 2. Retrieve playlist & tracks
        playlist = await database.get_radio_playlist(gid, pid)
        if not playlist:
            return False, "Playlist not found"

        tracks = await database.get_radio_tracks(gid, pid)
        if not tracks:
            return False, "Playlist contains no audio tracks. Upload tracks first."

        # 3. Retrieve or start the client
        if slot == 0:
            client = self.main_bot
        else:
            client = await self.ensure_aux_client(gid, slot)
            if not client:
                return False, f"Auxiliary Bot (Slot {slot}) is not configured or failed to connect"

        guild = client.get_guild(int(gid))
        if not guild:
            return False, f"Bot is not in target server (ID: {gid})"

        channel = guild.get_channel(cid)
        if not channel or not isinstance(channel, (discord.VoiceChannel, discord.StageChannel)):
            return False, "Target channel is not a valid voice channel"

        # Check connect & speak permissions
        my_perms = channel.permissions_for(guild.me)
        if not my_perms.connect:
            return False, "Bot lacks permission to connect to the target voice channel"
        if not my_perms.speak:
            return False, "Bot lacks permission to speak in the target voice channel"

        # 4. Connect to Voice Channel
        try:
            vc = guild.voice_client
            if vc is not None:
                if vc.channel.id != cid:
                    await vc.move_to(channel)
            else:
                vc = await channel.connect(reconnect=True, timeout=20.0)
        except Exception as e:
            logger.exception("Failed connecting voice client in guild %s slot %d: %s", gid, slot, e)
            return False, f"Failed connecting to voice channel: {str(e)}"

        # 5. Launch the async stream runner task
        task = asyncio.create_task(
            self._stream_worker(gid, slot, client, vc, pid, loop)
        )
        self.active_tasks[key] = task

        # Update database active streams
        await database.update_active_stream(
            gid,
            slot,
            {
                "voice_channel_id": str(cid),
                "playlist_id": pid,
                "current_track_id": tracks[0]["id"] if tracks else None,
                "is_playing": True,
                "loop_enabled": loop,
                "started_at": discord.utils.utcnow().isoformat(),
            },
        )

        return True, "Streaming started successfully"

    async def _stream_worker(
        self,
        guild_id: str,
        bot_slot: int,
        client: discord.Client,
        vc: discord.VoiceClient,
        playlist_id: str,
        loop: bool,
    ):
        """Asynchronous playback loop for a playlist with continuous repeat support."""
        key = (guild_id, bot_slot)
        logger.info("Started radio stream worker for guild %s slot %d", guild_id, bot_slot)

        try:
            while True:
                # Reload tracks dynamically in case playlist was modified
                tracks = await database.get_radio_tracks(guild_id, playlist_id)
                if not tracks:
                    logger.warning("No tracks in playlist %s, ending stream", playlist_id)
                    break

                for track in tracks:
                    if not vc.is_connected():
                        logger.warning("Voice client disconnected, stopping worker")
                        return

                    file_path = Path(track.get("file_path", ""))
                    if not file_path.is_file():
                        logger.warning("Track file not found on disk: %s", file_path)
                        continue

                    # Update current playing track info
                    track_info = {
                        "id": track["id"],
                        "title": track.get("title", track.get("original_filename", "Audio Track")),
                        "duration": track.get("duration_seconds", 0.0),
                        "started_at": discord.utils.utcnow().isoformat(),
                    }
                    self.current_playing[key] = track_info

                    await database.update_active_stream(
                        guild_id,
                        bot_slot,
                        {
                            "current_track_id": track["id"],
                            "is_playing": True,
                        },
                    )

                    # Build audio source with optimized FFmpeg options (audio only, bitrate cap and buffer constraint)
                    ffmpeg_options = {
                        "options": "-vn -b:a 128k -bufsize 256k",
                    }

                    finish_event = asyncio.Event()

                    def after_callback(error):
                        if error:
                            logger.error("FFmpeg playback error: %s", error)
                        client.loop.call_soon_threadsafe(finish_event.set)

                    # Retrieve guild default volume setting (N-M6)
                    guild_cfg = await database.get_radio_config(guild_id)
                    volume_pct = int(guild_cfg.get("default_volume", 100))
                    volume_factor = max(0.01, min(volume_pct / 100.0, 2.0))

                    try:
                        pcm_source = discord.FFmpegPCMAudio(str(file_path), **ffmpeg_options)
                        audio_source = discord.PCMVolumeTransformer(pcm_source, volume=volume_factor)
                        vc.play(audio_source, after=after_callback)
                    except Exception as play_err:
                        logger.error("Failed to play track %s: %s", track["id"], play_err)
                        continue

                    # Wait for track completion or task cancellation
                    await finish_event.wait()

                # End of playlist: if loop is not enabled, break and stop
                if not loop:
                    logger.info("Playlist completed with loop=False. Finishing stream.")
                    break

        except asyncio.CancelledError:
            logger.info("Stream worker cancelled for guild %s slot %d", guild_id, bot_slot)
        except Exception as e:
            logger.exception("Unexpected error in stream worker: %s", e)
        finally:
            self.current_playing.pop(key, None)
            self.active_tasks.pop(key, None)
            await database.clear_active_stream(guild_id, bot_slot)
            if vc and vc.is_connected():
                try:
                    vc.stop()
                    await vc.disconnect(force=True)
                except Exception:
                    pass

    async def stop_stream(self, guild_id: str | int, bot_slot: int):
        """Stop current stream and disconnect voice client for a specific bot slot."""
        gid = str(guild_id)
        slot = int(bot_slot)
        key = (gid, slot)

        # Cancel stream task
        task = self.active_tasks.pop(key, None)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        self.current_playing.pop(key, None)
        await database.clear_active_stream(gid, slot)

        # Disconnect voice client
        client = self.get_client(gid, slot)
        if client:
            guild = client.get_guild(int(gid))
            if guild and guild.voice_client:
                try:
                    guild.voice_client.stop()
                    await guild.voice_client.disconnect(force=True)
                except Exception as e:
                    logger.warning("Error disconnecting voice client on stop: %s", e)

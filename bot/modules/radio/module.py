from typing import Optional

import discord
from pydantic import BaseModel, Field

from bot.modules.base import Module
from bot.modules.radio.engine import RadioVoiceManager


class RadioConfigModel(BaseModel):
    max_playlist_storage_mb: int = Field(default=100, ge=10, le=1000)
    default_volume: int = Field(default=100, ge=1, le=100)


class RadioModule(Module):
    name = "radio"
    title = "Radio & 24/7 Broadcast"
    icon = "radio"
    description = (
        "Multi-bot 24/7 radio and audio streaming engine with playlist management, "
        "storage quotas, continuous loop playback, and auxiliary bot support."
    )
    default_config = {
        "max_playlist_storage_mb": 100,
        "default_volume": 100,
    }
    config_model = RadioConfigModel
    required_permissions = ["connect", "speak"]

    def __init__(self, bot):
        super().__init__(bot)
        self.voice_manager = RadioVoiceManager(bot)
        bot.radio_manager = self.voice_manager

    async def setup(self) -> None:
        """Initialize radio module and sync owner's storage quota from .env to database."""
        from core import config, database
        try:
            owner_quota = getattr(config, "RADIO_MAX_PLAYLIST_STORAGE_MB", 100)
            await database.sync_radio_storage_quota(owner_quota)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning("Failed syncing radio storage quota on startup: %s", e)

    async def on_enable(self, guild: Optional[discord.Guild]) -> None:
        pass

    async def on_disable(self, guild: Optional[discord.Guild]) -> None:
        if guild and hasattr(self, "voice_manager"):
            # Stop any running streams in this guild across all 3 bot slots
            for slot in (0, 1, 2):
                try:
                    await self.voice_manager.stop_stream(guild.id, slot)
                except Exception:
                    pass

    async def apply_config(self, guild: Optional[discord.Guild], config: dict) -> None:
        pass

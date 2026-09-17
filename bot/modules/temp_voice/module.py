from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from bot.modules.base import Module, SnowflakeId


class TempVoiceAreaModel(BaseModel):
    """A single temp voice area: one trigger channel + destination category."""

    id: str = Field(..., min_length=1, max_length=32)
    title: str = Field(default="Lounge Area", min_length=1, max_length=64)
    trigger_channel_id: SnowflakeId = None
    category_id: SnowflakeId = None
    naming: str = Field(default="{username}'s lounge", max_length=80)
    user_limit: int = Field(default=0, ge=0, le=99)
    auto_delete_seconds: int = Field(default=60, ge=15, le=3600)

    @field_validator("id")
    @classmethod
    def validate_id_slug(cls, v: str) -> str:
        cleaned = v.strip().lower()
        if not cleaned:
            raise ValueError("Area id cannot be empty")
        if not all(c.isalnum() or c in "-_" for c in cleaned):
            raise ValueError(
                "Area id must be a short slug containing only letters, numbers, hyphens, and underscores"
            )
        return cleaned

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Area title cannot be empty")
        return cleaned


class TempVoiceConfig(BaseModel):
    areas: list[TempVoiceAreaModel] = Field(default_factory=list, max_length=10)

    @model_validator(mode="before")
    @classmethod
    def migrate_legacy_single_area(cls, data):
        """Older configs stored a single flat {trigger_channel_id, category_id, ...}
        object. Wrap it into one area so existing saved settings keep working."""
        if not isinstance(data, dict) or "areas" in data:
            return data
        legacy_keys = (
            "trigger_channel_id",
            "category_id",
            "naming",
            "user_limit",
            "auto_delete_seconds",
        )
        has_legacy = any(data.get(k) not in (None, "", []) for k in legacy_keys)
        if has_legacy:
            area = {k: data.get(k) for k in legacy_keys if data.get(k) is not None}
            area.setdefault("id", "lounge")
            area.setdefault("title", "Lounge Area")
            data = {"areas": [area]}
        return data

    @model_validator(mode="after")
    def validate_unique_areas(self) -> "TempVoiceConfig":
        seen_ids = set()
        seen_triggers = set()
        for area in self.areas:
            if area.id in seen_ids:
                raise ValueError(f"Duplicate area id: '{area.id}'")
            seen_ids.add(area.id)
            if area.trigger_channel_id:
                if area.trigger_channel_id in seen_triggers:
                    raise ValueError(
                        f"Channel is already used as a trigger by another area (ID {area.trigger_channel_id})"
                    )
                seen_triggers.add(area.trigger_channel_id)
        return self


class TempVoiceModule(Module):
    name = "temp_voice"
    title = "Temp Voice"
    icon = "mic"
    description = "Automatically create temporary voice channels when members join a trigger channel."
    default_config = TempVoiceConfig().model_dump()
    config_model = TempVoiceConfig
    required_permissions = ["manage_channels", "move_members"]

    def __init__(self, bot):
        super().__init__(bot)
        self.engine = None
        self.commands_cog = None

    async def setup(self) -> None:
        from bot.modules.temp_voice.commands import TempVoiceCommandsCog
        from bot.modules.temp_voice.engine import TempVoiceEngineCog

        self.engine = TempVoiceEngineCog(self.bot, self)
        self.commands_cog = TempVoiceCommandsCog(self.bot, self)
        await self.bot.add_cog(self.engine)
        await self.bot.add_cog(self.commands_cog)

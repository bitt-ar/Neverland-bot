from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from bot.modules.base import Module, SnowflakeId


class LevelingConfig(BaseModel):
    xp_min: int = Field(default=1, ge=1, le=100)
    xp_max: int = Field(default=30, ge=1, le=100)
    cooldown_seconds: int = Field(default=60, ge=0, le=600)
    voice_xp_enabled: bool = True
    voice_xp_per_minute: int = Field(default=30, ge=0, le=1000)
    announce_channel_id: SnowflakeId = None
    announce_message: str = Field(default="{user} has leveled up to level {level}!", max_length=500)
    rewards: dict[str, SnowflakeId] = Field(default_factory=dict)

    @field_validator("rewards")
    @classmethod
    def validate_rewards_keys(cls, v: dict[str, int]) -> dict[str, int]:
        for k in v.keys():
            if not (isinstance(k, str) and k.isdigit()):
                raise ValueError(f"Reward level key '{k}' must be a numeric string")
        return v

    @model_validator(mode="after")
    def validate_xp_range(self) -> "LevelingConfig":
        if self.xp_max < self.xp_min:
            raise ValueError("xp_max must be greater than or equal to xp_min")
        return self


class LevelingModule(Module):
    name = "leveling"
    title = "Leveling"
    icon = "trophy"
    description = "Gain XP through text and voice activity, earn role rewards, and compete on the leaderboard."
    default_config = LevelingConfig().model_dump()
    config_model = LevelingConfig
    required_permissions = ["manage_roles"]

    def __init__(self, bot):
        super().__init__(bot)
        self.engine = None
        self.commands_cog = None

    async def setup(self) -> None:
        from bot.modules.leveling.commands import LevelingCommandsCog
        from bot.modules.leveling.engine import LevelingEngineCog

        self.engine = LevelingEngineCog(self.bot, self)
        self.commands_cog = LevelingCommandsCog(self.bot, self)
        await self.bot.add_cog(self.engine)
        await self.bot.add_cog(self.commands_cog)

from typing import Optional
from pydantic import BaseModel, Field

from bot.modules.base import Module, SnowflakeId


class AntiSpamConfig(BaseModel):
    enabled: bool = False
    max_messages: int = Field(default=5, ge=2, le=30)
    seconds: int = Field(default=5, ge=1, le=60)
    action: str = Field(default="timeout")  # "timeout" | "delete" | "warn"
    timeout_minutes: int = Field(default=5, ge=1, le=1440)


class AntiInviteConfig(BaseModel):
    enabled: bool = False
    action: str = Field(default="delete")  # "delete" | "warn" | "timeout"
    whitelisted_channels: list[SnowflakeId] = Field(default_factory=list)
    whitelisted_roles: list[SnowflakeId] = Field(default_factory=list)


class AntiMentionConfig(BaseModel):
    enabled: bool = False
    max_mentions: int = Field(default=5, ge=2, le=50)
    action: str = Field(default="warn")  # "delete" | "warn" | "timeout"


class BadWordsConfig(BaseModel):
    enabled: bool = False
    action: str = Field(default="delete")  # "delete" | "warn" | "timeout"
    words: list[str] = Field(default_factory=list)


class ModerationConfig(BaseModel):
    mod_logs_channel_id: Optional[SnowflakeId] = None
    disabled_commands: list[str] = Field(default_factory=list)
    command_roles: dict[str, list[SnowflakeId]] = Field(default_factory=dict)
    anti_spam: AntiSpamConfig = Field(default_factory=AntiSpamConfig)
    anti_invite: AntiInviteConfig = Field(default_factory=AntiInviteConfig)
    anti_mention: AntiMentionConfig = Field(default_factory=AntiMentionConfig)
    bad_words: BadWordsConfig = Field(default_factory=BadWordsConfig)


class ModerationModule(Module):
    name = "moderation"
    title = "Moderation & AutoMod"
    icon = "shield-alert"
    description = (
        "Server moderation tools, command permission controls, and automated filters "
        "for spam, invites, mass mentions, and bad words."
    )
    default_config = ModerationConfig().model_dump()
    config_model = ModerationConfig
    required_permissions = [
        "kick_members",
        "ban_members",
        "moderate_members",
        "manage_messages",
        "embed_links",
    ]

    def __init__(self, bot):
        super().__init__(bot)
        self.commands_cog = None
        self.engine = None

    async def setup(self) -> None:
        from bot.modules.moderation.commands import ModerationCommandsCog
        from bot.modules.moderation.engine import AutoModEngineCog

        self.commands_cog = ModerationCommandsCog(self.bot, self)
        self.engine = AutoModEngineCog(self.bot, self)

        await self.bot.add_cog(self.commands_cog)
        await self.bot.add_cog(self.engine)

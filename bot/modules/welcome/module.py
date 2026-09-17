from typing import Optional

from pydantic import BaseModel, Field

from bot.modules.base import Module, SnowflakeId


class WelcomeConfig(BaseModel):
    channel_id: SnowflakeId = None
    include_image: bool = True
    # Auto role on join: toggle + explicit role choices for members and bots.
    # Empty lists fall back to the legacy name-based roles (Active member / BOT🤖).
    auto_role_enabled: bool = True
    member_role_ids: list[SnowflakeId] = Field(default_factory=list)
    bot_role_ids: list[SnowflakeId] = Field(default_factory=list)


class WelcomeModule(Module):
    name = "welcome"
    title = "Welcome"
    icon = "door-open"
    description = "Send welcome messages and images when new members join, and automatically assign roles."
    default_config = WelcomeConfig().model_dump()
    config_model = WelcomeConfig
    required_permissions = ["send_messages", "embed_links", "attach_files", "manage_roles"]

    def __init__(self, bot):
        super().__init__(bot)
        self.engine = None

    async def setup(self) -> None:
        from bot.modules.welcome.engine import WelcomeEngineCog

        self.engine = WelcomeEngineCog(self.bot, self)
        await self.bot.add_cog(self.engine)

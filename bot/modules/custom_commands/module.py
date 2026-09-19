from typing import Any, Optional
from pydantic import BaseModel, Field

from bot.modules.base import Module, SnowflakeId


class WorkflowActionModel(BaseModel):
    type: str  # send_message, reply_ephemeral, send_dm, add_role, remove_role, toggle_role, delete_trigger, send_log
    channel_id: SnowflakeId = None
    role_id: SnowflakeId = None
    content: Optional[str] = None
    embed: Optional[dict[str, Any]] = None
    ephemeral: bool = False


class CommandDefinitionModel(BaseModel):
    id: str
    name: str
    aliases: list[str] = Field(default_factory=list)
    description: str = ""
    trigger_type: str = "prefix"  # "prefix", "exact", "contains"
    cooldown_seconds: int = 0
    allowed_roles: list[str] = Field(default_factory=list)
    allowed_channels: list[str] = Field(default_factory=list)
    enabled: bool = True
    actions: list[WorkflowActionModel] = Field(default_factory=list)


class DropdownOptionModel(BaseModel):
    id: str
    label: str
    value: str
    description: Optional[str] = None
    emoji: Optional[str] = None
    actions: list[WorkflowActionModel] = Field(default_factory=list)


class DropdownDefinitionModel(BaseModel):
    id: str
    title: str
    placeholder: str = "Choose an option..."
    min_values: int = 1
    max_values: int = 1
    message_id: SnowflakeId = None
    channel_id: SnowflakeId = None
    panel_content: Optional[str] = None
    panel_embed: Optional[dict[str, Any]] = None
    options: list[DropdownOptionModel] = Field(default_factory=list)
    enabled: bool = True


class CustomCommandsConfig(BaseModel):
    prefix: str = "!"
    delete_trigger_default: bool = False


class CustomCommandsModule(Module):
    name = "custom_commands"
    title = "Custom Commands & Menus"
    icon = "terminal"
    description = "Create custom commands and interactive workflow dropdown select menus."
    default_config = {
        "prefix": "!",
        "delete_trigger_default": False,
    }
    config_model = CustomCommandsConfig
    required_permissions = ["manage_roles", "manage_messages", "send_messages", "embed_links"]

    def __init__(self, bot):
        super().__init__(bot)
        self.engine = None

    async def setup(self) -> None:
        from bot.modules.custom_commands.engine import CustomCommandsEngineCog

        self.engine = CustomCommandsEngineCog(self.bot, self)
        await self.bot.add_cog(self.engine)

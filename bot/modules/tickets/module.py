import re
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from bot.modules.base import Module, SnowflakeId

HEX_COLOR_REGEX = re.compile(r"^#?([0-9a-fA-F]{6})$")


class PanelEmbedModel(BaseModel):
    title: Optional[str] = Field(default=None, max_length=256)
    description: Optional[str] = Field(default=None, max_length=4000)
    color: Optional[str] = Field(default=None)

    @field_validator("color")
    @classmethod
    def validate_color(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return None
        v = v.strip()
        if not v:
            return None
        if not HEX_COLOR_REGEX.match(v):
            raise ValueError("Color must be a valid 6-digit hex code, e.g. '#5865F2' or '5865F2'")
        if not v.startswith("#"):
            v = f"#{v}"
        return v


class TicketCategoryModel(BaseModel):
    id: str = Field(..., min_length=1, max_length=32)
    name: str = Field(..., min_length=1, max_length=100)
    emoji: str = Field(default="🎫", max_length=32)
    category_channel_id: SnowflakeId = None
    staff_role_ids: list[SnowflakeId] = Field(default_factory=list)
    naming: str = Field(default="ticket-{username}-{number}", min_length=1, max_length=80)

    @field_validator("id")
    @classmethod
    def validate_id_slug(cls, v: str) -> str:
        cleaned = v.strip().lower()
        if not re.match(r"^[a-z0-9_-]+$", cleaned):
            raise ValueError("Category id must be a short slug containing only letters, numbers, hyphens, and underscores")
        return cleaned


class TicketsConfig(BaseModel):
    panel_channel_id: SnowflakeId = None
    panel_content: str = Field(default="", max_length=2000)
    panel_embed: Optional[PanelEmbedModel] = None
    button_label: str = Field(default="Open a ticket", min_length=1, max_length=80)
    button_emoji: str = Field(default="🎫", max_length=32)
    categories: list[TicketCategoryModel] = Field(default_factory=list, max_length=25)

    @model_validator(mode="after")
    def validate_unique_categories(self) -> "TicketsConfig":
        seen_ids = set()
        seen_names = set()
        for cat in self.categories:
            cat_id = cat.id.strip().lower()
            cat_name = cat.name.strip().lower()
            if cat_id in seen_ids:
                raise ValueError(f"Duplicate category ID: '{cat.id}'")
            if cat_name in seen_names:
                raise ValueError(f"Duplicate category name: '{cat.name}'")
            seen_ids.add(cat_id)
            seen_names.add(cat_name)
        return self


def get_default_tickets_config() -> dict:
    default_obj = TicketsConfig(
        panel_channel_id=None,
        panel_content="Need help? Open a support ticket below.",
        panel_embed=PanelEmbedModel(
            title="Support Tickets",
            description="Select a category from the dropdown to open a private support ticket with our team.",
            color="#5865F2",
        ),
        button_label="Open a ticket",
        button_emoji="🎫",
        categories=[
            TicketCategoryModel(
                id="general",
                name="General Support",
                emoji="🎫",
                category_channel_id=None,
                staff_role_ids=[],
                naming="ticket-{username}-{number}",
            )
        ],
    )
    return default_obj.model_dump()


class TicketsModule(Module):
    name = "tickets"
    title = "Tickets"
    icon = "ticket"
    description = "Complete support ticket system with customizable panel, categories, and staff controls."
    default_config = get_default_tickets_config()
    config_model = TicketsConfig
    required_permissions = ["manage_channels", "manage_roles"]

    def __init__(self, bot):
        super().__init__(bot)
        self.engine = None
        self.commands_cog = None

    async def setup(self) -> None:
        from bot.modules.tickets.commands import TicketsCommandsCog
        from bot.modules.tickets.engine import TicketsEngineCog

        self.engine = TicketsEngineCog(self.bot, self)
        self.commands_cog = TicketsCommandsCog(self.bot, self)
        await self.bot.add_cog(self.engine)
        await self.bot.add_cog(self.commands_cog)

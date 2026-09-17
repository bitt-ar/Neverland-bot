from abc import ABC
from typing import Annotated, Optional

import discord
from pydantic import BaseModel, BeforeValidator


def _coerce_snowflake(value):
    """Normalize a Discord snowflake (int / digit-string / whole float) to canonical string form.

    Discord IDs exceed JavaScript's Number.MAX_SAFE_INTEGER, so they must never be
    handled as JSON numbers. Accepts int, str, and whole floats (e.g. 123.0 from
    loose serialization — precision beyond 2^53 is already lost at that point, so
    this is best-effort recovery of what the float holds) and raises ValueError
    for anything else so Pydantic reports a clean validation error.
    """
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError(f"Invalid Discord ID: {value!r}")
    if isinstance(value, float):
        if not value.is_integer():
            raise ValueError(f"Invalid Discord ID: {value!r}")
        value = int(value)
    s = str(value).strip()
    if not s.isdigit():
        raise ValueError(f"Invalid Discord ID: {value!r}")
    return s


SnowflakeId = Annotated[Optional[str], BeforeValidator(_coerce_snowflake)]


class Module(ABC):
    name: str  # stable id, e.g. "leveling"
    title: str  # human title
    icon: str  # lucide icon name for the dashboard, e.g. "trophy"
    description: str
    default_config: dict
    config_model: type[BaseModel]  # pydantic v2 model validating the config
    required_permissions: list[str]  # discord permission names, e.g. ["manage_roles"]

    def __init__(self, bot):
        self.bot = bot

    async def setup(self) -> None:
        """Register cogs or setup background tasks for this module."""
        pass

    async def on_enable(self, guild: Optional[discord.Guild]) -> None:
        """Hook called when the module is enabled for a guild."""
        pass

    async def on_disable(self, guild: Optional[discord.Guild]) -> None:
        """Hook called when the module is disabled for a guild."""
        pass

    async def apply_config(self, guild: Optional[discord.Guild], config: dict) -> None:
        """Hook called when a validated config is applied for a guild."""
        pass

from pydantic import BaseModel

from bot.modules.base import Module


class ReactionRolesConfig(BaseModel):
    pass


class ReactionRolesModule(Module):
    name = "reaction_roles"
    title = "Reaction Roles"
    icon = "smile"
    description = "Allow members to obtain roles by reacting to messages."
    default_config = {}
    config_model = ReactionRolesConfig
    required_permissions = ["manage_roles", "add_reactions"]

    def __init__(self, bot):
        super().__init__(bot)
        self.engine = None
        self.commands_cog = None

    async def setup(self) -> None:
        from bot.modules.reaction_roles.commands import ReactionRolesCommandsCog
        from bot.modules.reaction_roles.engine import ReactionRolesEngineCog

        self.engine = ReactionRolesEngineCog(self.bot, self)
        self.commands_cog = ReactionRolesCommandsCog(self.bot, self)
        await self.bot.add_cog(self.engine)
        await self.bot.add_cog(self.commands_cog)

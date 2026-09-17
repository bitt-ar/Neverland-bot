import logging

from discord.ext import commands

from core import database

logger = logging.getLogger(__name__)


class ReactionRolesEngineCog(commands.Cog):
    def __init__(self, bot, module):
        self.bot = bot
        self.module = module

    @property
    def registry(self):
        return getattr(self.bot, "modules_registry", None)

    async def cog_load(self):
        if database.db is not None:
            try:
                await database.reload_reaction_roles()
            except Exception as e:
                logger.warning("Error loading reaction roles cache: %s", e)

    @commands.Cog.listener()
    async def on_raw_reaction_add(self, payload):
        if payload.guild_id is None:
            return
        if not self.registry or not await self.registry.is_enabled(payload.guild_id, "reaction_roles"):
            return
        if database.db is not None:
            doc = await database.db.reaction_roles.find_one(
                {"message_id": {"$in": [str(payload.message_id), payload.message_id]}}
            )
            if doc and not doc.get("enabled", True):
                return
        role_id = database.get_reaction_role(payload.message_id, str(payload.emoji))
        if not role_id:
            return
        guild = self.bot.get_guild(payload.guild_id)
        if not guild:
            return
        member = guild.get_member(payload.user_id)
        role = guild.get_role(role_id)
        if role and member and not member.bot:
            try:
                await member.add_roles(role, reason="Reaction role")
            except Exception as e:
                logger.warning("Error adding reaction role: %s", e)

    @commands.Cog.listener()
    async def on_raw_reaction_remove(self, payload):
        if payload.guild_id is None:
            return
        if not self.registry or not await self.registry.is_enabled(payload.guild_id, "reaction_roles"):
            return
        if database.db is not None:
            doc = await database.db.reaction_roles.find_one(
                {"message_id": {"$in": [str(payload.message_id), payload.message_id]}}
            )
            if doc and not doc.get("enabled", True):
                return
        role_id = database.get_reaction_role(payload.message_id, str(payload.emoji))
        if not role_id:
            return
        guild = self.bot.get_guild(payload.guild_id)
        if not guild:
            return
        member = guild.get_member(payload.user_id)
        role = guild.get_role(role_id)
        if role and member and not member.bot:
            try:
                await member.remove_roles(role, reason="Reaction role removed")
            except Exception as e:
                logger.warning("Error removing reaction role: %s", e)

    # =========================================================================
    # PERSISTENT COMPONENT INTERACTION HANDLER
    # Buttons and Select menus attached to Discord messages use custom_id prefixes:
    #   - "rr:{message_id}:{index}" for button toggles
    #   - "rr-select:{message_id}" for select menu choices
    # By listening to on_interaction at the Cog level, all incoming component
    # clicks survive bot restarts automatically without requiring persistent
    # View objects to be re-instantiated in memory on startup.
    # =========================================================================
    @commands.Cog.listener()
    async def on_interaction(self, interaction):
        import discord

        if interaction.type != discord.InteractionType.component:
            return

        data = interaction.data or {}
        custom_id = data.get("custom_id", "")

        if not custom_id.startswith("rr:") and not custom_id.startswith("rr-select:"):
            return

        if interaction.guild_id is None or interaction.guild is None:
            return

        if not self.registry or not await self.registry.is_enabled(interaction.guild_id, "reaction_roles"):
            await interaction.response.send_message(
                "Reaction roles are currently disabled on this server.", ephemeral=True
            )
            return

        # ---------------------------------------------------------------------
        # Style 1: BUTTONS ("rr:{message_id}:{index_or_role}")
        # ---------------------------------------------------------------------
        if custom_id.startswith("rr:"):
            parts = custom_id.split(":")
            if len(parts) < 3:
                return

            msg_id_str = parts[1]
            param = parts[2]

            doc = None
            if database.db is not None:
                doc = await database.db.reaction_roles.find_one(
                    {
                        "guild_id": {"$in": [interaction.guild_id, str(interaction.guild_id)]},
                        "message_id": {"$in": [msg_id_str, int(msg_id_str) if msg_id_str.isdigit() else msg_id_str]},
                    }
                )

            if not doc or not doc.get("enabled", True):
                await interaction.response.send_message(
                    "This reaction role message is inactive or no longer configured.", ephemeral=True
                )
                return

            role_id = None
            pairs = doc.get("pairs", [])
            if param.isdigit():
                idx = int(param)
                if idx < len(pairs):
                    role_id = pairs[idx].get("role_id")
                else:
                    role_id = idx

            if not role_id:
                await interaction.response.send_message("Could not resolve role for this button.", ephemeral=True)
                return

            role = interaction.guild.get_role(role_id)
            if not role:
                await interaction.response.send_message("The configured role no longer exists.", ephemeral=True)
                return

            member = interaction.user
            if not isinstance(member, discord.Member):
                member = interaction.guild.get_member(interaction.user.id)
            if not member:
                return

            try:
                if role in member.roles:
                    await member.remove_roles(role, reason="Reaction role button toggle")
                    await interaction.response.send_message(f"Removed role **{role.name}**.", ephemeral=True)
                else:
                    await member.add_roles(role, reason="Reaction role button toggle")
                    await interaction.response.send_message(f"Added role **{role.name}**.", ephemeral=True)
            except discord.Forbidden:
                await interaction.response.send_message(
                    "I lack permissions to manage this role (it may be higher than my highest role).",
                    ephemeral=True,
                )
            except Exception as e:
                logger.warning("Error toggling reaction role button: %s", e)
                await interaction.response.send_message("Failed to update role.", ephemeral=True)

        # ---------------------------------------------------------------------
        # Style 2: SELECT MENU ("rr-select:{message_id}")
        # ---------------------------------------------------------------------
        elif custom_id.startswith("rr-select:"):
            msg_id_str = custom_id.split(":", 1)[1]

            doc = None
            if database.db is not None:
                doc = await database.db.reaction_roles.find_one(
                    {
                        "guild_id": {"$in": [interaction.guild_id, str(interaction.guild_id)]},
                        "message_id": {"$in": [msg_id_str, int(msg_id_str) if msg_id_str.isdigit() else msg_id_str]},
                    }
                )

            if not doc or not doc.get("enabled", True):
                await interaction.response.send_message(
                    "This reaction role message is inactive or no longer configured.", ephemeral=True
                )
                return

            values = data.get("values", [])
            if not values:
                return

            try:
                selected_role_id = int(values[0])
            except (ValueError, TypeError):
                return

            all_pairs = doc.get("pairs", [])
            all_role_ids = {p.get("role_id") for p in all_pairs if isinstance(p, dict) and p.get("role_id")}

            member = interaction.user
            if not isinstance(member, discord.Member):
                member = interaction.guild.get_member(interaction.user.id)
            if not member:
                return

            role_to_add = interaction.guild.get_role(selected_role_id)
            if not role_to_add:
                await interaction.response.send_message("The selected role no longer exists.", ephemeral=True)
                return

            roles_to_remove = [
                r
                for rid in all_role_ids
                if rid != selected_role_id
                and (r := interaction.guild.get_role(rid)) is not None
                and r in member.roles
            ]

            try:
                if roles_to_remove:
                    await member.remove_roles(*roles_to_remove, reason="Reaction role select switch")
                if role_to_add not in member.roles:
                    await member.add_roles(role_to_add, reason="Reaction role select assignment")
                    await interaction.response.send_message(f"Selected role **{role_to_add.name}**.", ephemeral=True)
                else:
                    await interaction.response.send_message(
                        f"You already have the **{role_to_add.name}** role.", ephemeral=True
                    )
            except discord.Forbidden:
                await interaction.response.send_message(
                    "I lack permissions to manage these roles (one or more may be higher than my highest role).",
                    ephemeral=True,
                )
            except Exception as e:
                logger.warning("Error assigning reaction role select: %s", e)
                await interaction.response.send_message("Failed to update roles.", ephemeral=True)


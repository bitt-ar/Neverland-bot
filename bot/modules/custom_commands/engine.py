import asyncio
import datetime
import logging
import re
import time
from typing import Any, Optional

import discord
from discord.ext import commands

from bot.modules.custom_commands.workflow import WorkflowRunner
from bot.modules.tickets.helpers import sanitize_button_emoji
from core import database

logger = logging.getLogger(__name__)


class PersistentDropdownView(discord.ui.View):
    """Persistent View containing a dynamic select menu with timeout=None."""

    def __init__(self, dropdown_id: str, placeholder: str = "Select an option...", min_values: int = 1, max_values: int = 1, options: Optional[list[discord.SelectOption]] = None):
        super().__init__(timeout=None)
        self.dropdown_id = dropdown_id
        
        # Build select
        select_options = options or [
            discord.SelectOption(label="Default Option", value="default", description="Please configure options in dashboard")
        ]
        
        # Max 25 options per Discord API
        self.select_component = discord.ui.Select(
            custom_id=f"cc_select:{dropdown_id}",
            placeholder=placeholder[:100] if placeholder else "Select an option...",
            min_values=max(1, min(min_values, len(select_options))),
            max_values=max(1, min(max_values, len(select_options))),
            options=select_options[:25],
        )
        self.add_item(self.select_component)


def build_dropdown_view_from_data(data: dict[str, Any]) -> PersistentDropdownView:
    dropdown_id = str(data.get("id") or data.get("dropdown_id") or "")
    placeholder = str(data.get("placeholder") or "Choose an option...")
    min_vals = int(data.get("min_values", 1) or 1)
    max_vals = int(data.get("max_values", 1) or 1)
    
    raw_options = data.get("options", [])
    select_options: list[discord.SelectOption] = []
    
    for opt in raw_options:
        if not isinstance(opt, dict):
            continue
        label = str(opt.get("label", "Option"))[:100]
        val = str(opt.get("value", opt.get("id", label)))[:100]
        desc = str(opt.get("description", ""))[:100] if opt.get("description") else None
        emoji_raw = sanitize_button_emoji(opt.get("emoji"))
        select_options.append(
            discord.SelectOption(
                label=label,
                value=val,
                description=desc,
                emoji=emoji_raw,
            )
        )
    
    return PersistentDropdownView(
        dropdown_id=dropdown_id,
        placeholder=placeholder,
        min_values=min_vals,
        max_values=max_vals,
        options=select_options if select_options else None,
    )


class CustomCommandsEngineCog(commands.Cog):
    """Engine cog that handles custom commands execution and persistent dropdown select menus."""

    def __init__(self, bot: commands.Bot, module):
        self.bot = bot
        self.module = module
        # Cooldown map: (guild_id, user_id, command_id) -> expiration_timestamp
        self._cooldowns: dict[tuple[int, int, str], float] = {}

    @property
    def registry(self):
        return getattr(self.bot, "modules_registry", None)

    async def cog_load(self):
        """Restore all published dropdown menus from the database on bot startup."""
        await self._restore_persistent_dropdowns()

    async def _restore_persistent_dropdowns(self):
        if database.db is None:
            return

        try:
            count = 0
            cursor = database.db.custom_dropdowns.find({"enabled": {"$ne": False}})
            async for doc in cursor:
                dd_id = str(doc.get("id") or doc.get("dropdown_id") or "")
                if not dd_id:
                    continue
                try:
                    view = build_dropdown_view_from_data(doc)
                    self.bot.add_view(view)
                    count += 1
                except Exception as e:
                    logger.warning("Error registering persistent dropdown view %s: %s", dd_id, e)
            logger.info("Restored %d persistent custom dropdown views.", count)
        except Exception as e:
            logger.warning("Could not restore custom dropdowns from database: %s", e)

    @commands.Cog.listener()
    async def on_interaction(self, interaction: discord.Interaction):
        """Global interaction listener for custom dropdown components (cc_select:...)."""
        if interaction.type != discord.InteractionType.component:
            return

        data = interaction.data or {}
        custom_id = str(data.get("custom_id", ""))
        if not custom_id.startswith("cc_select:"):
            return

        dropdown_id = custom_id.split("cc_select:", 1)[1]
        guild = interaction.guild
        member = interaction.user

        if not guild or not isinstance(member, discord.Member):
            await interaction.response.send_message("This menu can only be used in a server.", ephemeral=True)
            return

        if self.registry and not await self.registry.is_enabled(guild.id, "custom_commands"):
            await interaction.response.send_message("Custom Commands & Menus module is disabled in this server.", ephemeral=True)
            return

        # Fetch dropdown configuration
        if database.db is None:
            await interaction.response.send_message("Database unavailable. Please try again later.", ephemeral=True)
            return

        doc = await database.db.custom_dropdowns.find_one({
            "guild_id": {"$in": [guild.id, str(guild.id)]},
            "$or": [{"id": dropdown_id}, {"dropdown_id": dropdown_id}],
        })

        if not doc or not doc.get("enabled", True):
            await interaction.response.send_message("This menu is no longer active.", ephemeral=True)
            return

        # Selected values
        selected_values = data.get("values", [])
        if not selected_values:
            await interaction.response.send_message("No option selected.", ephemeral=True)
            return

        # Find matching options
        options_map = {str(opt.get("value", opt.get("id", ""))): opt for opt in doc.get("options", []) if isinstance(opt, dict)}

        # Run actions for each selected option
        all_actions = []
        matched_option_dict = None
        for val in selected_values:
            opt = options_map.get(str(val))
            if opt:
                if matched_option_dict is None:
                    matched_option_dict = opt
                opt_actions = opt.get("actions", [])
                if isinstance(opt_actions, list):
                    all_actions.extend(opt_actions)

        if not all_actions:
            # Fallback ack if no actions defined
            await interaction.response.send_message(f"Selected: {', '.join(selected_values)}", ephemeral=True)
            return

        runner = WorkflowRunner(
            bot=self.bot,
            guild=guild,
            member=member,
            channel=interaction.channel,
            interaction=interaction,
            context_vars={"option": matched_option_dict, "values": selected_values},
        )
        await runner.execute_all(all_actions)

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        """Listen for custom prefix/exact/contains command triggers."""
        if message.author.bot or not message.guild:
            return

        guild_id = message.guild.id
        if self.registry and not await self.registry.is_enabled(guild_id, "custom_commands"):
            return

        if database.db is None:
            return

        content = message.content.strip()
        if not content:
            return

        # Load guild module config for prefix
        config = await self.registry.get_config(guild_id, "custom_commands") if self.registry else {}
        prefix = config.get("prefix", "!")
        delete_default = bool(config.get("delete_trigger_default", False))

        # Query all enabled custom commands for this guild
        cursor = database.db.custom_commands.find({
            "guild_id": {"$in": [guild_id, str(guild_id)]},
            "enabled": True,
        })
        commands_list = await cursor.to_list(length=100)
        if not commands_list:
            return

        now = time.time()
        for cmd in commands_list:
            name = str(cmd.get("name", "")).strip()
            aliases = [str(a).strip() for a in cmd.get("aliases", []) if a]
            all_triggers = [name] + aliases
            trigger_type = cmd.get("trigger_type", "prefix").lower()

            matched_trigger = None
            args = ""

            if trigger_type == "prefix":
                # Must start with prefix followed by trigger name
                for trig in all_triggers:
                    pattern = rf"^{re.escape(prefix)}{re.escape(trig)}(?:\s+([\s\S]*))?$"
                    match = re.match(pattern, content, re.IGNORECASE)
                    if match:
                        matched_trigger = trig
                        args = (match.group(1) or "").strip()
                        break

            elif trigger_type == "exact":
                # Content must equal trigger exactly (case-insensitive)
                for trig in all_triggers:
                    if content.lower() == trig.lower():
                        matched_trigger = trig
                        break

            elif trigger_type == "contains":
                # Content must contain trigger as word
                for trig in all_triggers:
                    pattern = rf"\b{re.escape(trig)}\b"
                    if re.search(pattern, content, re.IGNORECASE):
                        matched_trigger = trig
                        break

            if not matched_trigger:
                continue

            # ---------------- Check Permissions & Restrictions ----------------
            cmd_id = str(cmd.get("id") or cmd.get("_id"))
            member = message.author
            channel = message.channel

            # Channel restrictions
            allowed_channels = [str(c) for c in cmd.get("allowed_channels", []) if c]
            if allowed_channels and str(channel.id) not in allowed_channels:
                continue

            # Role restrictions
            allowed_roles = [str(r) for r in cmd.get("allowed_roles", []) if r]
            if allowed_roles:
                member_role_ids = {str(r.id) for r in getattr(member, "roles", [])}
                is_admin = getattr(getattr(member, "guild_permissions", None), "administrator", False)
                if not is_admin and not (member_role_ids & set(allowed_roles)):
                    continue

            # Cooldown check
            cooldown = int(cmd.get("cooldown_seconds", 0) or 0)
            if cooldown > 0:
                cd_key = (guild_id, member.id, cmd_id)
                last_used = self._cooldowns.get(cd_key, 0.0)
                if now < last_used + cooldown:
                    remaining = int((last_used + cooldown) - now) + 1
                    try:
                        await channel.send(
                            f"{member.mention} You are on cooldown for this command. Please wait {remaining}s.",
                            delete_after=5,
                        )
                    except Exception:
                        pass
                    return
                self._cooldowns[cd_key] = now

            # Delete trigger message if configured
            if delete_default:
                try:
                    await message.delete()
                except Exception:
                    pass

            # Execute workflow actions
            actions = cmd.get("actions", [])
            runner = WorkflowRunner(
                bot=self.bot,
                guild=message.guild,
                member=member,
                channel=channel,
                message=message,
                context_vars={"args": args, "trigger": matched_trigger},
            )
            await runner.execute_all(actions)
            # Only trigger first matching command
            break

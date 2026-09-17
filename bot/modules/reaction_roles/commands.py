import logging

import discord
from discord import app_commands
from discord.ext import commands

from core import database

logger = logging.getLogger(__name__)


class EmojiModal(discord.ui.Modal, title="Add emoji for the selected role"):
    emoji_input = discord.ui.TextInput(
        label="Emoji",
        placeholder="Paste an emoji like 😀 or :custom_emoji:",
        max_length=100,
    )

    def __init__(self, panel: "ReactionRolePanel", role: discord.Role):
        self.panel = panel
        self.role = role
        super().__init__()

    async def on_submit(self, interaction: discord.Interaction):
        raw = self.emoji_input.value.strip()
        if not raw:
            await interaction.response.send_message("Emoji cannot be empty.", ephemeral=True)
            return

        emoji = discord.PartialEmoji.from_str(raw)
        if emoji.id:  # custom emoji
            if not emoji.is_usable():
                await interaction.response.send_message(
                    "This custom emoji is not available to the bot (its source server is not shared with the bot).",
                    ephemeral=True,
                )
                return
            emoji_str = str(emoji)
        else:  # unicode emoji
            emoji_str = raw

        if any(p[0] == emoji_str for p in self.panel.pairs):
            await interaction.response.send_message(
                "This emoji is already used in this setup.", ephemeral=True
            )
            return
        if len(self.panel.pairs) >= ReactionRolePanel.MAX_PAIRS:
            await interaction.response.send_message("Maximum 20 pairs per message.", ephemeral=True)
            return

        try:
            await self.panel.message.add_reaction(emoji_str)
        except discord.HTTPException:
            await interaction.response.send_message(
                "Failed to react with this emoji (invalid emoji or missing permissions).",
                ephemeral=True,
            )
            return

        self.panel.pairs.append((emoji_str, self.role))
        self.panel.refresh_components()
        await interaction.response.edit_message(embed=self.panel.embed(), view=self.panel)

    async def on_error(self, interaction: discord.Interaction, error):
        logger.warning("EmojiModal error: %s", error)


class ReactionRolePanel(discord.ui.View):
    MAX_PAIRS = 20

    def __init__(self, bot, guild: discord.Guild, message: discord.Message):
        super().__init__(timeout=600)
        self.bot = bot
        self.guild = guild
        self.message = message
        self.pairs = []  # [(emoji_str, role)] in order
        self.pending_role = None
        self.refresh_components()

    def embed(self):
        target = f"[Jump to message]({self.message.jump_url})"
        if self.pairs:
            lines = [
                f"`{i + 1}.` {emoji} → {role.mention}"
                for i, (emoji, role) in enumerate(self.pairs)
            ]
            desc = "**Pairs (in order):**\n" + "\n".join(lines)
        else:
            desc = "*No pairs yet.*\n\nPick a role below, then enter the emoji for it."
        embed = discord.Embed(
            title="🎛️ Reaction Role Setup",
            description=f"{target}\n\n{desc}",
            color=discord.Color.blurple(),
        )
        embed.set_footer(text=f"{len(self.pairs)}/{self.MAX_PAIRS} pairs")
        return embed

    def refresh_components(self):
        self.remove_select.options.clear()
        for i, (emoji, role) in enumerate(self.pairs):
            self.remove_select.add_option(label=f"{i + 1}. {emoji} → {role.name}", value=str(i))
        self.remove_select.disabled = not self.pairs
        self.save_button.disabled = not self.pairs

    @discord.ui.select(cls=discord.ui.RoleSelect, placeholder="1) Select a role...")
    async def pick_role(self, interaction: discord.Interaction, select: discord.ui.RoleSelect):
        if len(self.pairs) >= self.MAX_PAIRS:
            await interaction.response.send_message("Maximum 20 pairs per message.", ephemeral=True)
            return
        self.pending_role = select.values[0]
        await interaction.response.send_modal(EmojiModal(self, self.pending_role))

    @discord.ui.select(placeholder="2) Remove a pair...", disabled=True)
    async def remove_select(self, interaction: discord.Interaction, select: discord.ui.Select):
        idx = int(select.values[0])
        emoji_str, _role = self.pairs.pop(idx)
        try:
            await self.message.clear_reaction(emoji_str)
        except discord.HTTPException:
            pass
        self.refresh_components()
        await interaction.response.edit_message(embed=self.embed(), view=self)

    @discord.ui.button(label="✅ Save & Publish", style=discord.ButtonStyle.success, disabled=True)
    async def save_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        pairs_data = [
            {
                "emoji": emoji_str,
                "role_id": getattr(role, "id", role),
                "order": i,
            }
            for i, (emoji_str, role) in enumerate(self.pairs)
        ]
        doc = {
            "guild_id": self.guild.id,
            "message_id": str(self.message.id),
            "channel_id": getattr(self.message.channel, "id", None),
            "style": "reactions",
            "content": getattr(self.message, "content", None),
            "embed": None,
            "enabled": True,
            "pairs": pairs_data,
        }
        await database.replace_message_reaction_roles(self.guild.id, self.message.id, doc)
        lines = [
            f"`{i + 1}.` {emoji} → {role.mention}"
            for i, (emoji, role) in enumerate(self.pairs)
        ]
        embed = discord.Embed(
            title="✅ Reaction roles saved!",
            description=f"[Jump to message]({self.message.jump_url})\n\n" + "\n".join(lines),
            color=discord.Color.green(),
        )
        await interaction.response.edit_message(content=None, embed=embed, view=None)
        self.stop()

    @discord.ui.button(label="Cancel", style=discord.ButtonStyle.danger)
    async def cancel_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.edit_message(
            content="❌ Reaction role setup cancelled (nothing was saved).",
            embed=None,
            view=None,
        )
        self.stop()

    async def on_error(self, interaction: discord.Interaction, error):
        logger.warning("ReactionRolePanel error: %s", error)


class MessageTransformer(app_commands.Transformer):
    async def transform(self, interaction: discord.Interaction, value: str) -> discord.Message:
        value = value.strip()
        msg_id = None
        channel_id = None
        if "/" in value:
            parts = value.rstrip("/").split("/")
            if parts[-1].isdigit():
                msg_id = int(parts[-1])
            if len(parts) >= 2 and parts[-2].isdigit():
                channel_id = int(parts[-2])
        elif value.isdigit():
            msg_id = int(value)

        if not msg_id:
            raise app_commands.TransformerError(value, discord.AppCommandOptionType.string, self)

        if channel_id and interaction.guild:
            ch = interaction.guild.get_channel(channel_id)
            if ch and hasattr(ch, "fetch_message"):
                try:
                    return await ch.fetch_message(msg_id)
                except Exception:
                    pass

        if interaction.channel and hasattr(interaction.channel, "fetch_message"):
            try:
                return await interaction.channel.fetch_message(msg_id)
            except Exception:
                pass

        if interaction.guild:
            for ch in getattr(interaction.guild, "text_channels", []):
                if ch.id == interaction.channel_id:
                    continue
                try:
                    return await ch.fetch_message(msg_id)
                except Exception:
                    continue

        # Fallback stub for deleted or remote messages so removal still functions
        class _StubMessage:
            def __init__(self, mid, guild, channel):
                self.id = mid
                self.guild = guild
                self.channel = channel
                self.jump_url = f"https://discord.com/channels/{getattr(guild, 'id', 0)}/{getattr(channel, 'id', 0)}/{mid}"

            async def add_reaction(self, emoji):
                raise discord.HTTPException(None, "Message could not be found on Discord.")

            async def clear_reaction(self, emoji):
                pass

        return _StubMessage(msg_id, interaction.guild, interaction.channel)  # type: ignore


class ReactionRolesCommandsCog(commands.Cog):
    def __init__(self, bot, module):
        self.bot = bot
        self.module = module

    @property
    def registry(self):
        return getattr(self.bot, "modules_registry", None)

    async def _check_enabled(self, interaction: discord.Interaction) -> bool:
        if not self.registry or not await self.registry.is_enabled(
            interaction.guild_id, "reaction_roles"
        ):
            await interaction.response.send_message("This module is disabled.", ephemeral=True)
            return False
        return True

    reactionrole = app_commands.Group(
        name="reactionrole",
        description="Reaction roles (admin)",
        default_permissions=discord.Permissions(administrator=True),
        guild_only=True,
    )

    @reactionrole.command(name="setup", description="Interactive reaction-roles wizard for a message")
    async def reactionrole_setup(
        self,
        interaction: discord.Interaction,
        message: app_commands.Transform[discord.Message, MessageTransformer],
    ):
        if not await self._check_enabled(interaction):
            return
        if message.guild is None or message.guild.id != interaction.guild_id:
            await interaction.response.send_message(
                "That message is not in this server.", ephemeral=True
            )
            return
        me = interaction.guild.me
        if not message.channel.permissions_for(me).add_reactions:
            await interaction.response.send_message(
                "I need the **Add Reactions** permission in that channel.", ephemeral=True
            )
            return
        panel = ReactionRolePanel(self.bot, interaction.guild, message)
        await interaction.response.send_message(embed=panel.embed(), view=panel, ephemeral=True)

    @reactionrole.command(name="remove", description="Remove all reaction roles from a message")
    async def reactionrole_remove(
        self,
        interaction: discord.Interaction,
        message: app_commands.Transform[discord.Message, MessageTransformer],
    ):
        if not await self._check_enabled(interaction):
            return
        result = await database.db.reaction_roles.delete_many(
            {"message_id": {"$in": [message.id, str(message.id)]}}
        )
        await database.reload_reaction_roles()
        if result.deleted_count == 0:
            await interaction.response.send_message(
                "No reaction roles found on that message.", ephemeral=True
            )
        else:
            await interaction.response.send_message(
                f"Removed reaction roles from message {message.id}.", ephemeral=True
            )

    @reactionrole.command(name="list", description="List reaction roles in this server")
    async def reactionrole_list(self, interaction: discord.Interaction):
        if not await self._check_enabled(interaction):
            return
        docs = []
        async for doc in database.db.reaction_roles.find(
            {"guild_id": {"$in": [interaction.guild_id, str(interaction.guild_id)]}}
        ):
            docs.append(doc)
        if not docs:
            await interaction.response.send_message(
                "No reaction roles set. Use `/reactionrole setup`.", ephemeral=True
            )
            return
        by_message = {}
        for doc in docs:
            mid = str(doc.get("message_id", ""))
            if "pairs" in doc and isinstance(doc["pairs"], list):
                by_message[mid] = [f"{p.get('emoji')} → <@&{p.get('role_id')}>" for p in doc["pairs"]]
            elif "emoji" in doc and "role_id" in doc:
                by_message.setdefault(mid, []).append(f"{doc['emoji']} → <@&{doc['role_id']}>")

        embed = discord.Embed(
            title="📜 Reaction roles in this server", color=discord.Color.blurple()
        )
        for message_id, lines in by_message.items():
            embed.add_field(name=f"Message {message_id}", value="\n".join(lines) or "No pairs", inline=False)
        await interaction.response.send_message(embed=embed, ephemeral=True)

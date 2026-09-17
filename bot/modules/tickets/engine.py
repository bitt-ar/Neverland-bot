import asyncio
from datetime import datetime, timezone
import logging
import re
from typing import Optional

import discord
from discord.ext import commands
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from core import database

logger = logging.getLogger(__name__)


from bot.modules.tickets.helpers import (
    build_ticket_overwrites,
    is_ticket_staff,
    render_ticket_channel_name,
    sanitize_channel_name,
)


def build_panel_message_view(button_label: str = "Open a ticket", button_emoji: str = "🎫") -> discord.ui.View:
    view = discord.ui.View(timeout=None)
    view.add_item(
        discord.ui.Button(
            label=button_label[:80],
            emoji=button_emoji if button_emoji else None,
            style=discord.ButtonStyle.primary,
            custom_id="tk:open",
        )
    )
    return view


def build_category_select_view(categories: list[dict]) -> discord.ui.View:
    view = discord.ui.View(timeout=180)
    options = []
    for cat in categories[:25]:
        emoji = cat.get("emoji") or "🎫"
        options.append(
            discord.SelectOption(
                label=cat.get("name", "Support")[:100],
                value=str(cat.get("id")),
                emoji=emoji,
                description=f"Open a {cat.get('name')} ticket"[:100],
            )
        )
    select = discord.ui.Select(
        placeholder="Choose a ticket category...",
        options=options,
        custom_id="tk:category_select",
    )
    view.add_item(select)
    return view


def build_ticket_control_view(channel_id: int, status: str = "open", is_claimed: bool = False) -> discord.ui.View:
    view = discord.ui.View(timeout=None)
    if status == "closed":
        view.add_item(
            discord.ui.Button(
                label="Reopen",
                emoji="🔓",
                style=discord.ButtonStyle.secondary,
                custom_id=f"tk:{channel_id}:reopen",
            )
        )
        view.add_item(
            discord.ui.Button(
                label="Delete",
                emoji="🗑️",
                style=discord.ButtonStyle.danger,
                custom_id=f"tk:{channel_id}:delete",
            )
        )
    else:
        claim_label = "Unclaim" if is_claimed else "Claim"
        view.add_item(
            discord.ui.Button(
                label=claim_label,
                emoji="👑",
                style=discord.ButtonStyle.secondary,
                custom_id=f"tk:{channel_id}:claim",
            )
        )
        view.add_item(
            discord.ui.Button(
                label="Close",
                emoji="🔒",
                style=discord.ButtonStyle.secondary,
                custom_id=f"tk:{channel_id}:close",
            )
        )
        view.add_item(
            discord.ui.Button(
                label="Options",
                emoji="⚙️",
                style=discord.ButtonStyle.secondary,
                custom_id=f"tk:{channel_id}:options",
            )
        )
    return view


class TicketRenameModal(discord.ui.Modal, title="Rename Ticket Channel"):
    name_input = discord.ui.TextInput(
        label="New Channel Name",
        placeholder="e.g. ticket-john-0001",
        min_length=1,
        max_length=100,
        required=True,
    )

    def __init__(self, channel: discord.TextChannel):
        super().__init__()
        self.channel = channel
        self.name_input.default = channel.name

    async def on_submit(self, interaction: discord.Interaction):
        raw = self.name_input.value.strip()
        cleaned = sanitize_channel_name(raw)
        if not cleaned:
            await interaction.response.send_message(
                "Please provide a valid channel name.", ephemeral=True
            )
            return

        try:
            await self.channel.edit(
                name=cleaned, reason=f"Ticket channel renamed by {interaction.user}"
            )
            await interaction.response.send_message(
                f"✏️ Channel renamed to **#{cleaned}**.", ephemeral=True
            )
        except discord.Forbidden:
            await interaction.response.send_message(
                "I lack permission to rename this channel.", ephemeral=True
            )
        except Exception as e:
            logger.warning("Failed to rename ticket channel %s: %s", self.channel.id, e)
            await interaction.response.send_message(
                "Failed to rename ticket channel.", ephemeral=True
            )


class TicketOptionsView(discord.ui.View):
    def __init__(self, channel_id: int, is_locked: bool = False):
        super().__init__(timeout=120)
        self.add_item(
            discord.ui.Button(
                label="Rename",
                emoji="✏️",
                style=discord.ButtonStyle.secondary,
                custom_id=f"tk:{channel_id}:rename",
            )
        )
        self.add_item(
            discord.ui.Button(
                label="Add User",
                emoji="👤",
                style=discord.ButtonStyle.secondary,
                custom_id=f"tk:{channel_id}:add_user",
            )
        )
        self.add_item(
            discord.ui.Button(
                label="Remove User",
                emoji="🚫",
                style=discord.ButtonStyle.secondary,
                custom_id=f"tk:{channel_id}:remove_user",
            )
        )
        lock_label = "Unlock" if is_locked else "Lock"
        lock_emoji = "🔓" if is_locked else "🔒"
        self.add_item(
            discord.ui.Button(
                label=lock_label,
                emoji=lock_emoji,
                style=discord.ButtonStyle.secondary,
                custom_id=f"tk:{channel_id}:toggle_lock",
            )
        )
        self.add_item(
            discord.ui.Button(
                label="Delete",
                emoji="🗑️",
                style=discord.ButtonStyle.danger,
                custom_id=f"tk:{channel_id}:delete",
            )
        )


class TicketAddUserView(discord.ui.View):
    def __init__(self, channel_id: int):
        super().__init__(timeout=60)
        self.add_item(
            discord.ui.UserSelect(
                placeholder="Select a member to add to this ticket...",
                custom_id=f"tk:{channel_id}:add_user_select",
            )
        )


class TicketRemoveUserView(discord.ui.View):
    def __init__(self, channel_id: int):
        super().__init__(timeout=60)
        self.add_item(
            discord.ui.UserSelect(
                placeholder="Select a member to remove from this ticket...",
                custom_id=f"tk:{channel_id}:remove_user_select",
            )
        )


class TicketDeleteConfirmView(discord.ui.View):
    def __init__(self, channel_id: int):
        super().__init__(timeout=60)
        self.add_item(
            discord.ui.Button(
                label="Confirm Delete",
                style=discord.ButtonStyle.danger,
                custom_id=f"tk:{channel_id}:delete_confirm",
            )
        )
        self.add_item(
            discord.ui.Button(
                label="Cancel",
                style=discord.ButtonStyle.secondary,
                custom_id=f"tk:{channel_id}:delete_cancel",
            )
        )


class TicketsEngineCog(commands.Cog):
    def __init__(self, bot, module):
        self.bot = bot
        self.module = module
        self._creating_users: set[int] = set()

    @property
    def registry(self):
        return getattr(self.bot, "modules_registry", None)

    async def get_next_ticket_number(self, guild_id: int, category_id: str) -> int:
        """Atomically increment and return the next ticket counter for (guild_id, category_id)."""
        if database.db is None:
            return 1

        # Exact-equality filter is required here: MongoDB cannot extract the
        # equality fields from an $in filter when upserting, so it would insert
        # guild_id: null and collide with the unique (guild_id, category_id)
        # index on every subsequent ticket.
        async def _increment():
            return await database.db.ticket_counters.find_one_and_update(
                {"guild_id": guild_id, "category_id": category_id},
                {"$inc": {"counter": 1}},
                upsert=True,
                return_document=ReturnDocument.AFTER,
            )

        # Adopt the legacy null-guild counter doc created by the old $in upsert
        # so numbering continues instead of restarting at 1. If the canonical
        # counter already exists, adoption would collide — ignore that case.
        try:
            await database.db.ticket_counters.find_one_and_update(
                {"guild_id": None, "category_id": category_id},
                {"$set": {"guild_id": guild_id}},
            )
        except DuplicateKeyError:
            pass

        doc = await _increment()
        return int(doc.get("counter", 1))

    async def publish_panel(self, guild: discord.Guild) -> discord.Message:
        """Publishes or replaces the ticket panel message in the configured channel."""
        cfg = await self.registry.get_config(guild.id, "tickets")
        channel_id = cfg.get("panel_channel_id")
        if not channel_id:
            raise ValueError("Ticket panel channel is not configured.")

        channel = guild.get_channel(int(channel_id))
        if channel is None or not isinstance(channel, discord.TextChannel):
            raise ValueError(f"Channel with ID {channel_id} was not found or is not a text channel.")

        # Check bot permissions in target channel
        perms = channel.permissions_for(guild.me)
        if not perms.view_channel or not perms.send_messages or not perms.embed_links:
            raise discord.Forbidden(
                discord.HTTPResponse(None, status=403),
                "Bot lacks View Channel, Send Messages, or Embed Links permissions in the panel channel.",
            )

        content = cfg.get("panel_content") or None
        embed_data = cfg.get("panel_embed") or {}
        embed = None
        if embed_data and (embed_data.get("title") or embed_data.get("description")):
            color_val = discord.Color.blurple()
            color_hex = embed_data.get("color")
            if color_hex:
                try:
                    color_val = discord.Color(int(color_hex.lstrip("#"), 16))
                except (ValueError, TypeError):
                    pass
            embed = discord.Embed(
                title=embed_data.get("title") or "Support Tickets",
                description=embed_data.get("description") or "Click below to open a ticket.",
                color=color_val,
            )

        button_label = cfg.get("button_label") or "Open a ticket"
        button_emoji = cfg.get("button_emoji") or "🎫"
        view = build_panel_message_view(button_label, button_emoji)

        meta = None
        if database.db is not None:
            try:
                meta = await database.db.tickets_meta.find_one(
                    {"guild_id": {"$in": [guild.id, str(guild.id)]}}
                )
            except Exception as e:
                logger.warning("Error fetching tickets_meta: %s", e)

        old_msg_id = meta.get("panel_message_id") if meta else None
        old_ch_id = meta.get("panel_channel_id") if meta else None

        msg: Optional[discord.Message] = None

        if old_msg_id:
            try:
                old_msg_id_int = int(old_msg_id)
                if old_ch_id and int(old_ch_id) == channel.id:
                    # Same channel: try editing existing message
                    try:
                        existing_msg = await channel.fetch_message(old_msg_id_int)
                        await existing_msg.edit(content=content, embed=embed, view=view)
                        msg = existing_msg
                    except (discord.NotFound, discord.HTTPException):
                        pass
                else:
                    # Different channel: clean up old message if possible
                    if old_ch_id:
                        old_channel = guild.get_channel(int(old_ch_id))
                        if old_channel and isinstance(old_channel, discord.TextChannel):
                            try:
                                old_msg = await old_channel.fetch_message(old_msg_id_int)
                                await old_msg.delete()
                            except Exception:
                                pass
            except Exception as e:
                logger.debug("Could not edit/cleanup previous panel message: %s", e)

        if msg is None:
            msg = await channel.send(content=content, embed=embed, view=view)

        if database.db is not None:
            await database.db.tickets_meta.update_one(
                {"guild_id": guild.id},
                {
                    "$set": {
                        "guild_id": guild.id,
                        "panel_message_id": msg.id,
                        "panel_channel_id": channel.id,
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
                upsert=True,
            )

        return msg

    async def create_ticket(self, interaction: discord.Interaction, category_id: str) -> None:
        """Handles ticket channel creation and initialization."""
        guild = interaction.guild
        user = interaction.user
        if guild is None or not isinstance(user, discord.Member):
            if not interaction.response.is_done():
                await interaction.response.send_message("Tickets can only be created in a server.", ephemeral=True)
            return

        if user.id in self._creating_users:
            if not interaction.response.is_done():
                await interaction.response.send_message("You already have a ticket creation in progress.", ephemeral=True)
            return

        self._creating_users.add(user.id)
        try:
            cfg = await self.registry.get_config(guild.id, "tickets")
            categories = cfg.get("categories", [])
            category = next((c for c in categories if c.get("id") == category_id), None)
            if not category:
                if not interaction.response.is_done():
                    await interaction.response.send_message("The selected ticket category is no longer available.", ephemeral=True)
                return

            if not interaction.response.is_done():
                await interaction.response.defer(ephemeral=True)

            ticket_number = await self.get_next_ticket_number(guild.id, category_id)

            # Build channel name from category naming template
            naming_template = category.get("naming") or "ticket-{username}-{number}"
            channel_name = render_ticket_channel_name(
                naming_template, user.name, ticket_number, category.get("id", "ticket")
            )

            # Parent category
            parent_category: Optional[discord.CategoryChannel] = None
            cat_ch_id = category.get("category_channel_id")
            if cat_ch_id:
                ch = guild.get_channel(int(cat_ch_id))
                if isinstance(ch, discord.CategoryChannel):
                    parent_category = ch

            # Permissions
            staff_roles = []
            for role_id in category.get("staff_role_ids", []):
                role = guild.get_role(int(role_id))
                if role:
                    staff_roles.append(role)

            overwrites = build_ticket_overwrites(
                guild.default_role, user, guild.me, staff_roles
            )

            try:
                ticket_channel = await guild.create_text_channel(
                    name=channel_name,
                    category=parent_category,
                    overwrites=overwrites,
                    topic=f"Ticket #{ticket_number} | Creator: {user} ({user.id}) | Category: {category.get('name')}",
                    reason=f"Ticket #{ticket_number} created by {user}",
                )
            except discord.Forbidden:
                await interaction.followup.send(
                    "❌ I lack permissions to create the ticket channel.", ephemeral=True
                )
                return
            except Exception as e:
                logger.exception("Failed to create text channel for ticket: %s", e)
                await interaction.followup.send(
                    "❌ Failed to create ticket channel. Please contact an administrator.", ephemeral=True
                )
                return

            now = datetime.now(timezone.utc)
            ticket_doc = {
                "guild_id": guild.id,
                "channel_id": ticket_channel.id,
                "user_id": user.id,
                "category_id": category_id,
                "status": "open",
                "claimed_by": None,
                "participants": [user.id],
                "number": ticket_number,
                "created_at": now,
                "closed_at": None,
                "closed_by": None,
                "locked": False,
            }

            if database.db is not None:
                try:
                    await database.db.tickets.insert_one(ticket_doc)
                except Exception as e:
                    logger.exception("Failed to insert ticket document: %s", e)

            # Ticket opening message
            embed_color = discord.Color.blurple()
            panel_color_hex = (cfg.get("panel_embed") or {}).get("color")
            if panel_color_hex:
                try:
                    embed_color = discord.Color(int(panel_color_hex.lstrip("#"), 16))
                except Exception:
                    pass

            open_embed = discord.Embed(
                title=f"{category.get('emoji', '🎫')} {category.get('name', 'Support Ticket')}",
                description=(
                    f"Welcome <@{user.id}>!\n\n"
                    f"Thank you for opening a ticket. Staff have been notified and will assist you shortly.\n"
                    f"Please describe your question or issue in detail below."
                ),
                color=embed_color,
            )
            open_embed.add_field(name="Ticket", value=f"#{ticket_number:04d}", inline=True)
            open_embed.add_field(name="Created by", value=f"<@{user.id}>", inline=True)
            open_embed.add_field(name="Status", value="🟢 Open", inline=True)
            open_embed.set_footer(text=f"Ticket #{ticket_number:04d} • Use controls below to manage")

            control_view = build_ticket_control_view(ticket_channel.id, status="open", is_claimed=False)
            try:
                control_msg = await ticket_channel.send(
                    content=f"👋 <@{user.id}> Your ticket has been opened!",
                    embed=open_embed,
                    view=control_view,
                )
                if database.db is not None:
                    await database.db.tickets.update_one(
                        {"channel_id": ticket_channel.id},
                        {"$set": {"control_message_id": control_msg.id}},
                    )
            except Exception as e:
                logger.warning("Error posting initial ticket message in %s: %s", ticket_channel.id, e)

            await interaction.followup.send(
                f"✅ Your ticket has been created: {ticket_channel.mention}", ephemeral=True
            )

        finally:
            self._creating_users.discard(user.id)

    async def _update_ticket_control_message(
        self,
        channel: discord.TextChannel,
        doc: dict,
        category: dict,
        status: str,
        claimed_by: Optional[int] = None,
    ) -> None:
        """Helper to edit the ticket channel's control message embed and view."""
        control_msg_id = doc.get("control_message_id")
        if not control_msg_id:
            return

        try:
            msg = await channel.fetch_message(int(control_msg_id))
            is_claimed = claimed_by is not None
            new_view = build_ticket_control_view(channel.id, status=status, is_claimed=is_claimed)

            if msg.embeds:
                old_embed = msg.embeds[0]
                embed = discord.Embed(
                    title=old_embed.title,
                    description=old_embed.description,
                    color=old_embed.color,
                )
                number = doc.get("number", 0)
                creator_id = doc.get("user_id")

                embed.add_field(name="Ticket", value=f"#{number:04d}", inline=True)
                embed.add_field(name="Created by", value=f"<@{creator_id}>", inline=True)

                if status == "closed":
                    embed.add_field(name="Status", value="🔒 Closed", inline=True)
                elif is_claimed:
                    embed.add_field(name="Status", value=f"👑 Claimed by <@{claimed_by}>", inline=True)
                else:
                    embed.add_field(name="Status", value="🟢 Open", inline=True)

                embed.set_footer(text=f"Ticket #{number:04d} • Use controls below to manage")
                await msg.edit(embed=embed, view=new_view)
            else:
                await msg.edit(view=new_view)
        except Exception as e:
            logger.debug("Could not edit control message in channel %s: %s", channel.id, e)

    @commands.Cog.listener()
    async def on_interaction(self, interaction: discord.Interaction):
        """Global interaction listener for all ticket persistent components."""
        if interaction.type not in (
            discord.InteractionType.component,
            discord.InteractionType.modal_submit,
        ):
            return

        data = interaction.data or {}
        custom_id = data.get("custom_id", "")
        if not custom_id.startswith("tk:") and not custom_id.startswith("tk-"):
            return

        if interaction.guild_id is None or interaction.guild is None:
            await interaction.response.send_message("Tickets are only available in servers.", ephemeral=True)
            return

        if not self.registry or not await self.registry.is_enabled(interaction.guild_id, "tickets"):
            await interaction.response.send_message(
                "Tickets module is currently disabled on this server.", ephemeral=True
            )
            return

        guild = interaction.guild
        member = interaction.user
        if not isinstance(member, discord.Member):
            return

        # ---------------------------------------------------------------------
        # 1. PANEL BUTTON CLICK: "tk:open"
        # ---------------------------------------------------------------------
        if custom_id in ("tk:open", "tk-open"):
            cfg = await self.registry.get_config(guild.id, "tickets")
            categories = cfg.get("categories", [])
            if not categories:
                await interaction.response.send_message(
                    "No ticket categories are configured on this server.", ephemeral=True
                )
                return

            view = build_category_select_view(categories)
            await interaction.response.send_message(
                "Please select a category to open your support ticket:",
                view=view,
                ephemeral=True,
            )
            return

        # ---------------------------------------------------------------------
        # 2. CATEGORY SELECT MENU: "tk:category_select"
        # ---------------------------------------------------------------------
        if custom_id in ("tk:category_select", "tk-select"):
            values = data.get("values", [])
            if not values:
                return
            category_id = values[0]
            await self.create_ticket(interaction, category_id)
            return

        # ---------------------------------------------------------------------
        # 3. CHANNEL ACTIONS: "tk:{channel_id}:{action}"
        # ---------------------------------------------------------------------
        parts = custom_id.split(":")
        if len(parts) < 3:
            return

        try:
            channel_id = int(parts[1])
        except ValueError:
            return
        action = parts[2]

        if database.db is None:
            await interaction.response.send_message("Database is unavailable.", ephemeral=True)
            return

        doc = await database.db.tickets.find_one(
            {"channel_id": {"$in": [channel_id, str(channel_id)]}}
        )
        if not doc:
            await interaction.response.send_message(
                "This ticket is no longer tracked or does not exist.", ephemeral=True
            )
            return

        cfg = await self.registry.get_config(guild.id, "tickets")
        categories = cfg.get("categories", [])
        category = next((c for c in categories if c.get("id") == doc.get("category_id")), {})

        channel = guild.get_channel(channel_id)
        if channel is None or not isinstance(channel, discord.TextChannel):
            await interaction.response.send_message("Ticket channel was not found.", ephemeral=True)
            return

        # ---------------------------------------------------------------------
        # ACTION: CLAIM
        # ---------------------------------------------------------------------
        if action == "claim":
            if not is_ticket_staff(member, category):
                await interaction.response.send_message(
                    "⛔ Only staff members can claim tickets.", ephemeral=True
                )
                return

            current_claimed_by = doc.get("claimed_by")
            if current_claimed_by == member.id:
                # Unclaim
                await database.db.tickets.update_one(
                    {"_id": doc["_id"]},
                    {"$set": {"status": "open", "claimed_by": None}},
                )
                doc["status"] = "open"
                doc["claimed_by"] = None
                await self._update_ticket_control_message(channel, doc, category, status="open", claimed_by=None)
                await channel.send(f"Ticket unclaimed by {member.mention}.")
                await interaction.response.send_message("You have unclaimed this ticket.", ephemeral=True)
            else:
                # Claim
                await database.db.tickets.update_one(
                    {"_id": doc["_id"]},
                    {"$set": {"status": "claimed", "claimed_by": member.id}},
                )
                doc["status"] = "claimed"
                doc["claimed_by"] = member.id
                await self._update_ticket_control_message(channel, doc, category, status="claimed", claimed_by=member.id)
                await channel.send(f"👑 Ticket claimed by {member.mention}.")
                await interaction.response.send_message("You have claimed this ticket.", ephemeral=True)

        # ---------------------------------------------------------------------
        # ACTION: CLOSE
        # ---------------------------------------------------------------------
        elif action == "close":
            creator_id = doc.get("user_id")
            if member.id != creator_id and not is_ticket_staff(member, category):
                await interaction.response.send_message(
                    "⛔ Only the ticket creator or staff members can close this ticket.", ephemeral=True
                )
                return

            if doc.get("status") == "closed":
                await interaction.response.send_message("This ticket is already closed.", ephemeral=True)
                return

            now = datetime.now(timezone.utc)
            await database.db.tickets.update_one(
                {"_id": doc["_id"]},
                {"$set": {"status": "closed", "closed_at": now, "closed_by": member.id}},
            )
            doc["status"] = "closed"
            doc["closed_at"] = now
            doc["closed_by"] = member.id

            # Revoke ViewChannel for creator and non-staff participants
            participants = set(doc.get("participants", []))
            if creator_id:
                participants.add(creator_id)

            for uid in participants:
                p_member = guild.get_member(uid)
                if p_member and not is_ticket_staff(p_member, category):
                    try:
                        await channel.set_permissions(
                            p_member,
                            view_channel=False,
                            reason=f"Ticket closed by {member}",
                        )
                    except discord.Forbidden:
                        pass
                    except Exception as e:
                        logger.warning("Error revoking ticket overwrite for %s: %s", uid, e)

            await self._update_ticket_control_message(channel, doc, category, status="closed", claimed_by=doc.get("claimed_by"))
            await channel.send(
                f"🔒 Ticket closed by {member.mention}. Creator permissions revoked.",
                view=build_ticket_control_view(channel.id, status="closed"),
            )
            await interaction.response.send_message("Ticket closed successfully.", ephemeral=True)

        # ---------------------------------------------------------------------
        # ACTION: REOPEN
        # ---------------------------------------------------------------------
        elif action == "reopen":
            if not is_ticket_staff(member, category):
                await interaction.response.send_message(
                    "⛔ Only staff members can reopen tickets.", ephemeral=True
                )
                return

            await database.db.tickets.update_one(
                {"_id": doc["_id"]},
                {"$set": {"status": "open", "closed_at": None, "closed_by": None}},
            )
            doc["status"] = "open"
            doc["closed_at"] = None
            doc["closed_by"] = None

            # Restore ViewChannel for creator
            creator_id = doc.get("user_id")
            if creator_id:
                creator_member = guild.get_member(creator_id)
                if creator_member:
                    try:
                        await channel.set_permissions(
                            creator_member,
                            view_channel=True,
                            send_messages=True,
                            read_message_history=True,
                            attach_files=True,
                            embed_links=True,
                            reason=f"Ticket reopened by {member}",
                        )
                    except Exception as e:
                        logger.warning("Error restoring creator overwrite: %s", e)

            await self._update_ticket_control_message(channel, doc, category, status="open", claimed_by=None)
            await channel.send(
                f"🔓 Ticket reopened by {member.mention}.",
                view=build_ticket_control_view(channel.id, status="open", is_claimed=False),
            )
            await interaction.response.send_message("Ticket reopened.", ephemeral=True)

        # ---------------------------------------------------------------------
        # ACTION: OPTIONS (ephemeral menu)
        # ---------------------------------------------------------------------
        elif action == "options":
            if not is_ticket_staff(member, category):
                await interaction.response.send_message(
                    "⛔ Only staff members can access ticket options.", ephemeral=True
                )
                return

            view = TicketOptionsView(channel.id, is_locked=bool(doc.get("locked", False)))
            await interaction.response.send_message(
                "⚙️ **Ticket Staff Controls**\nChoose an action below to manage this ticket:",
                view=view,
                ephemeral=True,
            )

        # ---------------------------------------------------------------------
        # ACTION: RENAME (Modal prompt)
        # ---------------------------------------------------------------------
        elif action == "rename":
            if not is_ticket_staff(member, category):
                await interaction.response.send_message("⛔ Staff only.", ephemeral=True)
                return
            modal = TicketRenameModal(channel)
            await interaction.response.send_modal(modal)

        # ---------------------------------------------------------------------
        # ACTION: ADD USER (shows UserSelect)
        # ---------------------------------------------------------------------
        elif action == "add_user":
            if not is_ticket_staff(member, category):
                await interaction.response.send_message("⛔ Staff only.", ephemeral=True)
                return
            view = TicketAddUserView(channel.id)
            await interaction.response.send_message(
                "Select a user to grant access to this ticket:", view=view, ephemeral=True
            )

        # ---------------------------------------------------------------------
        # ACTION: ADD USER SELECT
        # ---------------------------------------------------------------------
        elif action == "add_user_select":
            if not is_ticket_staff(member, category):
                await interaction.response.send_message("⛔ Staff only.", ephemeral=True)
                return
            values = data.get("values", [])
            if not values:
                return
            try:
                target_id = int(values[0])
            except ValueError:
                return

            target = guild.get_member(target_id)
            if not target:
                await interaction.response.send_message("User not found in this server.", ephemeral=True)
                return

            try:
                await channel.set_permissions(
                    target,
                    view_channel=True,
                    send_messages=True,
                    read_message_history=True,
                    attach_files=True,
                    embed_links=True,
                    reason=f"Added to ticket by {member}",
                )
                await database.db.tickets.update_one(
                    {"_id": doc["_id"]},
                    {"$addToSet": {"participants": target_id}},
                )
                await channel.send(f"👤 {target.mention} was added to this ticket by {member.mention}.")
                await interaction.response.send_message(f"Added {target.mention} to the ticket.", ephemeral=True)
            except discord.Forbidden:
                await interaction.response.send_message("I lack permissions to edit channel permissions.", ephemeral=True)
            except Exception as e:
                logger.warning("Error adding user to ticket: %s", e)
                await interaction.response.send_message("Failed to add user to ticket.", ephemeral=True)

        # ---------------------------------------------------------------------
        # ACTION: REMOVE USER (shows UserSelect)
        # ---------------------------------------------------------------------
        elif action == "remove_user":
            if not is_ticket_staff(member, category):
                await interaction.response.send_message("⛔ Staff only.", ephemeral=True)
                return
            view = TicketRemoveUserView(channel.id)
            await interaction.response.send_message(
                "Select a user to remove from this ticket:", view=view, ephemeral=True
            )

        # ---------------------------------------------------------------------
        # ACTION: REMOVE USER SELECT
        # ---------------------------------------------------------------------
        elif action == "remove_user_select":
            if not is_ticket_staff(member, category):
                await interaction.response.send_message("⛔ Staff only.", ephemeral=True)
                return
            values = data.get("values", [])
            if not values:
                return
            try:
                target_id = int(values[0])
            except ValueError:
                return

            target = guild.get_member(target_id)
            if target:
                try:
                    await channel.set_permissions(
                        target,
                        overwrite=None,
                        reason=f"Removed from ticket by {member}",
                    )
                except Exception as e:
                    logger.warning("Error removing overwrite for user %s: %s", target_id, e)

            await database.db.tickets.update_one(
                {"_id": doc["_id"]},
                {"$pull": {"participants": target_id}},
            )
            await channel.send(f"👤 <@{target_id}> was removed from this ticket by {member.mention}.")
            await interaction.response.send_message(f"Removed <@{target_id}> from the ticket.", ephemeral=True)

        # ---------------------------------------------------------------------
        # ACTION: TOGGLE LOCK (Toggle SendMessages for non-staff participants)
        # ---------------------------------------------------------------------
        elif action == "toggle_lock":
            if not is_ticket_staff(member, category):
                await interaction.response.send_message("⛔ Staff only.", ephemeral=True)
                return

            cur_locked = bool(doc.get("locked", False))
            new_locked = not cur_locked

            participants = set(doc.get("participants", []))
            creator_id = doc.get("user_id")
            if creator_id:
                participants.add(creator_id)

            for uid in participants:
                p_member = guild.get_member(uid)
                if p_member and not is_ticket_staff(p_member, category):
                    try:
                        await channel.set_permissions(
                            p_member,
                            send_messages=not new_locked,
                            reason=f"Ticket {'locked' if new_locked else 'unlocked'} by {member}",
                        )
                    except Exception as e:
                        logger.warning("Error updating lock permissions for %s: %s", uid, e)

            await database.db.tickets.update_one(
                {"_id": doc["_id"]},
                {"$set": {"locked": new_locked}},
            )

            lock_msg = (
                f"🔒 Ticket locked by {member.mention}. Non-staff participants cannot send messages."
                if new_locked
                else f"🔓 Ticket unlocked by {member.mention}. Participants can now send messages."
            )
            await channel.send(lock_msg)
            await interaction.response.send_message(
                f"Ticket {'locked' if new_locked else 'unlocked'}.", ephemeral=True
            )

        # ---------------------------------------------------------------------
        # ACTION: DELETE (Prompt confirmation)
        # ---------------------------------------------------------------------
        elif action == "delete":
            if not is_ticket_staff(member, category):
                await interaction.response.send_message("⛔ Staff only.", ephemeral=True)
                return
            view = TicketDeleteConfirmView(channel.id)
            await interaction.response.send_message(
                "⚠️ Are you sure you want to permanently delete this ticket channel?\n"
                "The channel will be deleted immediately. The database record is preserved for history.",
                view=view,
                ephemeral=True,
            )

        # ---------------------------------------------------------------------
        # ACTION: DELETE CANCEL
        # ---------------------------------------------------------------------
        elif action == "delete_cancel":
            await interaction.response.send_message("Ticket deletion cancelled.", ephemeral=True)

        # ---------------------------------------------------------------------
        # ACTION: DELETE CONFIRM
        # ---------------------------------------------------------------------
        elif action == "delete_confirm":
            if not is_ticket_staff(member, category):
                await interaction.response.send_message("⛔ Staff only.", ephemeral=True)
                return

            await interaction.response.send_message("🗑️ Deleting ticket channel...", ephemeral=True)
            # Mark closed in DB if not already closed
            if doc.get("status") != "closed":
                await database.db.tickets.update_one(
                    {"_id": doc["_id"]},
                    {
                        "$set": {
                            "status": "closed",
                            "closed_at": datetime.now(timezone.utc),
                            "closed_by": member.id,
                        }
                    },
                )

            try:
                await channel.delete(reason=f"Ticket deleted by {member}")
            except discord.NotFound:
                pass
            except discord.Forbidden:
                logger.warning("Bot lacked permission to delete ticket channel %s", channel.id)
            except Exception as e:
                logger.warning("Error deleting ticket channel %s: %s", channel.id, e)

import datetime
import logging
import re
from typing import Any, Optional

import discord

logger = logging.getLogger(__name__)


def interpolate_text(template: Optional[str], context: dict[str, Any]) -> str:
    """Safely replace `{var}` placeholders in template string with values from context."""
    if not template or not isinstance(template, str):
        return ""

    result = template
    for key, val in context.items():
        pattern = re.compile(rf"\{{{re.escape(key)}\}}", re.IGNORECASE)
        val_str = str(val if val is not None else "")
        result = pattern.sub(val_str, result)

    return result


def parse_hex_color(color_val: Any) -> Optional[discord.Color]:
    """Parse hex string (#5865F2) or integer into discord.Color."""
    if color_val is None:
        return None
    if isinstance(color_val, discord.Color):
        return color_val
    if isinstance(color_val, int):
        return discord.Color(color_val)
    if isinstance(color_val, str):
        cleaned = color_val.strip().lstrip("#")
        try:
            return discord.Color(int(cleaned, 16))
        except (ValueError, TypeError):
            pass
    return None


def build_embed(embed_dict: Optional[dict], context: dict[str, Any]) -> Optional[discord.Embed]:
    """Build a discord.Embed from dictionary data with variable interpolation."""
    if not embed_dict or not isinstance(embed_dict, dict):
        return None

    title = interpolate_text(embed_dict.get("title"), context)[:256] if embed_dict.get("title") else None
    desc = interpolate_text(embed_dict.get("description"), context)[:4096] if embed_dict.get("description") else None

    color = parse_hex_color(embed_dict.get("color")) or discord.Color.blurple()

    if not title and not desc and not embed_dict.get("fields") and not embed_dict.get("image"):
        return None

    embed = discord.Embed(
        title=title,
        description=desc,
        color=color,
    )

    footer = embed_dict.get("footer")
    if footer:
        footer_text = interpolate_text(str(footer), context)[:2048]
        embed.set_footer(text=footer_text)

    thumbnail = embed_dict.get("thumbnail")
    if thumbnail:
        thumb_url = interpolate_text(str(thumbnail), context).strip()
        if thumb_url.startswith("http://") or thumb_url.startswith("https://"):
            embed.set_thumbnail(url=thumb_url)

    image = embed_dict.get("image")
    if image:
        img_url = interpolate_text(str(image), context).strip()
        if img_url.startswith("http://") or img_url.startswith("https://"):
            embed.set_image(url=img_url)

    fields = embed_dict.get("fields", [])
    if isinstance(fields, list):
        for f in fields[:25]:
            if isinstance(f, dict):
                f_name = interpolate_text(f.get("name", ""), context)[:256] or "\u200b"
                f_val = interpolate_text(f.get("value", ""), context)[:1024] or "\u200b"
                embed.add_field(name=f_name, value=f_val, inline=bool(f.get("inline", False)))

    return embed


def build_context(
    guild: Optional[discord.Guild],
    member: Optional[discord.Member | discord.User],
    channel: Optional[discord.abc.GuildChannel | discord.Thread | discord.abc.Messageable],
    option: Optional[dict] = None,
    args: Optional[str] = None,
) -> dict[str, Any]:
    """Construct variable substitution context."""
    now = datetime.datetime.now(datetime.timezone.utc)
    ctx: dict[str, Any] = {
        "date": now.strftime("%Y-%m-%d"),
        "time": now.strftime("%H:%M:%S"),
        "args": args or "",
    }

    if member:
        ctx["user"] = getattr(member, "name", "User")
        ctx["user_name"] = ctx["user"]
        ctx["user_mention"] = getattr(member, "mention", f"@{ctx['user']}")
        ctx["user_id"] = str(getattr(member, "id", ""))
        display_name = getattr(member, "display_name", ctx["user"])
        ctx["user_nick"] = display_name
        ctx["user_display"] = display_name
        avatar = getattr(member, "display_avatar", None)
        ctx["user_avatar"] = str(avatar.url) if avatar else ""

    if guild:
        ctx["server"] = guild.name
        ctx["server_name"] = guild.name
        ctx["server_id"] = str(guild.id)
        ctx["member_count"] = str(guild.member_count or "")
        ctx["server_icon"] = str(guild.icon.url) if guild.icon else ""

    if channel:
        ctx["channel"] = getattr(channel, "name", "channel")
        ctx["channel_name"] = ctx["channel"]
        ctx["channel_id"] = str(getattr(channel, "id", ""))
        ctx["channel_mention"] = getattr(channel, "mention", f"#{ctx['channel']}")

    if option and isinstance(option, dict):
        ctx["option_label"] = option.get("label", "")
        ctx["option_value"] = option.get("value", "")
        ctx["option_description"] = option.get("description", "")

    return ctx


class WorkflowRunner:
    """Executes a list of workflow actions sequentially for a given context."""

    def __init__(
        self,
        bot: discord.Client,
        guild: Optional[discord.Guild],
        member: Optional[discord.Member | discord.User],
        channel: Optional[discord.abc.GuildChannel | discord.Thread | discord.abc.Messageable],
        interaction: Optional[discord.Interaction] = None,
        message: Optional[discord.Message] = None,
        context_vars: Optional[dict[str, Any]] = None,
    ):
        self.bot = bot
        self.guild = guild
        self.member = member
        self.channel = channel
        self.interaction = interaction
        self.message = message
        self.context = build_context(
            guild=guild,
            member=member,
            channel=channel,
            args=context_vars.get("args") if context_vars else None,
            option=context_vars.get("option") if context_vars else None,
        )
        if context_vars:
            self.context.update(context_vars)

        self.responded_interaction = False
        self.modal_shown = False
        self.last_sent_message = None
        self.trigger_deleted = False

    async def execute_all(self, actions: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Run all actions in order. Returns execution results summary."""
        results = []
        if not actions or not isinstance(actions, list):
            return results

        # In Discord, show_modal MUST be the very first response to an interaction before any other response/ack
        modal_actions = [a for a in actions if isinstance(a, dict) and a.get("type", "").strip().lower() == "show_modal"]
        other_actions = [a for a in actions if isinstance(a, dict) and a.get("type", "").strip().lower() != "show_modal"]
        ordered_actions = modal_actions + other_actions

        for idx, action in enumerate(ordered_actions):
            act_type = action.get("type", "").strip().lower()
            try:
                res = await self._run_action(act_type, action)
                results.append({"step": idx, "type": act_type, "success": True, "result": res})
            except Exception as e:
                logger.warning("Workflow step %d (%s) failed: %s", idx, act_type, e)
                results.append({"step": idx, "type": act_type, "success": False, "error": str(e)})

        # If interaction wasn't replied to yet and is still active, send a quick ack so it doesn't fail with 'Interaction failed'
        if self.interaction and not self.interaction.response.is_done() and not self.responded_interaction:
            try:
                await self.interaction.response.send_message("Done!", ephemeral=True)
                self.responded_interaction = True
            except Exception:
                pass

        return results

    async def _run_action(self, act_type: str, action: dict[str, Any]) -> Any:
        from .actions import communication, roles_identity, channels, moderation, timing, modals

        # Communication
        if act_type == "send_message":
            return await communication.execute_send_message(self, action)
        elif act_type in ("reply_ephemeral", "reply"):
            return await communication.execute_reply(self, action, ephemeral=(act_type == "reply_ephemeral"))
        elif act_type == "send_dm":
            return await communication.execute_send_dm(self, action)
        elif act_type == "add_reaction":
            return await communication.execute_add_reaction(self, action)
        elif act_type == "random_response":
            return await communication.execute_random_response(self, action)

        # Roles & Identity
        elif act_type == "add_role":
            return await roles_identity.execute_role(self, action, operation="add")
        elif act_type == "remove_role":
            return await roles_identity.execute_role(self, action, operation="remove")
        elif act_type == "toggle_role":
            return await roles_identity.execute_role(self, action, operation="toggle")
        elif act_type == "change_nickname":
            return await roles_identity.execute_change_nickname(self, action)

        # Channels & Environment
        elif act_type == "delete_trigger":
            return await channels.execute_delete_trigger(self, action)
        elif act_type == "pin_message":
            return await channels.execute_pin_message(self, action)
        elif act_type == "slowmode_channel":
            return await channels.execute_slowmode_channel(self, action)
        elif act_type == "lock_channel":
            return await channels.execute_lock_channel(self, action)
        elif act_type == "create_temp_voice":
            return await channels.execute_create_temp_voice(self, action)

        # Moderation
        elif act_type == "send_log":
            return await moderation.execute_send_log(self, action)
        elif act_type == "timeout_member":
            return await moderation.execute_timeout_member(self, action)
        elif act_type == "kick_member":
            return await moderation.execute_kick_member(self, action)
        elif act_type == "ban_member":
            return await moderation.execute_ban_member(self, action)

        # Timing
        elif act_type == "wait_delay":
            return await timing.execute_wait_delay(self, action)

        # Modals (Dropdown Interactions)
        elif act_type == "show_modal":
            return await modals.execute_show_modal(self, action)

        else:
            logger.debug("Unknown workflow action type: %s", act_type)
            return None

    async def _action_send_message(self, action: dict[str, Any]):
        content_tmpl = action.get("content")
        content = interpolate_text(content_tmpl, self.context) if content_tmpl else None
        embed = build_embed(action.get("embed"), self.context)

        if not content and not embed:
            return None

        target_channel = self.channel
        target_chan_id = action.get("channel_id")
        if target_chan_id and self.guild:
            c = self.guild.get_channel(int(str(target_chan_id)))
            if c:
                target_channel = c

        if target_channel and hasattr(target_channel, "send"):
            return await target_channel.send(content=content, embed=embed)
        return None

    async def _action_reply(self, action: dict[str, Any], ephemeral: bool = True):
        content_tmpl = action.get("content")
        content = interpolate_text(content_tmpl, self.context) if content_tmpl else None
        embed = build_embed(action.get("embed"), self.context)

        if not content and not embed:
            content = "Action performed."

        # If we have an active Discord interaction
        if self.interaction:
            if not self.interaction.response.is_done():
                await self.interaction.response.send_message(content=content, embed=embed, ephemeral=ephemeral)
                self.responded_interaction = True
                return True
            else:
                await self.interaction.followup.send(content=content, embed=embed, ephemeral=ephemeral)
                return True

        # Fallback when invoked via message command (no interaction)
        if self.message and hasattr(self.message, "reply"):
            try:
                await self.message.reply(content=content, embed=embed)
                return True
            except discord.HTTPException:
                if self.channel and hasattr(self.channel, "send"):
                    await self.channel.send(content=content, embed=embed)
                    return True
        elif self.channel and hasattr(self.channel, "send"):
            await self.channel.send(content=content, embed=embed)
            return True
        return False

    async def _action_send_dm(self, action: dict[str, Any]):
        if not self.member:
            return False
        content_tmpl = action.get("content")
        content = interpolate_text(content_tmpl, self.context) if content_tmpl else None
        embed = build_embed(action.get("embed"), self.context)

        if not content and not embed:
            return False

        try:
            await self.member.send(content=content, embed=embed)
            return True
        except (discord.Forbidden, discord.HTTPException) as e:
            logger.info("Could not send DM to user %s: %s", getattr(self.member, "id", None), e)
            return False

    async def _action_role(self, action: dict[str, Any], operation: str):
        role_id_raw = action.get("role_id")
        if not role_id_raw or not self.guild or not self.member:
            return False
        if not hasattr(self.member, "roles") or not hasattr(self.member, "add_roles"):
            return False

        try:
            role_id = int(str(role_id_raw).strip())
        except (ValueError, TypeError):
            return False

        role = self.guild.get_role(role_id)
        if not role:
            logger.warning("Role %s not found in guild %s", role_id, self.guild.id)
            return False

        # Role hierarchy check against bot's top role
        me = self.guild.me
        if me and me.top_role <= role:
            logger.warning("Cannot manage role %s (%s): bot role hierarchy too low", role.name, role.id)
            return False

        has_role = role in self.member.roles
        if operation == "add":
            if not has_role:
                await self.member.add_roles(role, reason="Custom Workflow: add_role")
            return "added"
        elif operation == "remove":
            if has_role:
                await self.member.remove_roles(role, reason="Custom Workflow: remove_role")
            return "removed"
        elif operation == "toggle":
            if has_role:
                await self.member.remove_roles(role, reason="Custom Workflow: toggle_role (remove)")
                return "removed"
            else:
                await self.member.add_roles(role, reason="Custom Workflow: toggle_role (add)")
                return "added"
        return False

    async def _action_delete_trigger(self, action: dict[str, Any]):
        if self.message and hasattr(self.message, "delete"):
            try:
                await self.message.delete()
                return True
            except (discord.Forbidden, discord.NotFound, discord.HTTPException):
                return False
        return False

    async def _action_send_log(self, action: dict[str, Any]):
        if not self.guild:
            return False

        channel_id_raw = action.get("channel_id")
        target_channel = None
        if channel_id_raw:
            try:
                target_channel = self.guild.get_channel(int(str(channel_id_raw)))
            except (ValueError, TypeError):
                pass

        if not target_channel:
            # Fallback to current channel or do nothing
            target_channel = self.channel

        if not target_channel or not hasattr(target_channel, "send"):
            return False

        content_tmpl = action.get("content")
        content = interpolate_text(content_tmpl, self.context) if content_tmpl else None
        embed = build_embed(action.get("embed"), self.context)

        if not content and not embed:
            # Generate a standard audit embed if none specified
            embed = discord.Embed(
                title="Custom Workflow Triggered",
                description=f"Triggered by {self.member.mention if self.member else 'Unknown'}",
                color=discord.Color.blue(),
                timestamp=datetime.datetime.now(datetime.timezone.utc),
            )

        try:
            await target_channel.send(content=content, embed=embed)
            return True
        except discord.HTTPException as e:
            logger.warning("Failed to send workflow log: %s", e)
            return False

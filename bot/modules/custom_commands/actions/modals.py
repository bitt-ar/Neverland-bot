from __future__ import annotations

import datetime
import logging
from typing import Any, Optional, TYPE_CHECKING

import discord

if TYPE_CHECKING:
    from ..workflow import WorkflowRunner

logger = logging.getLogger(__name__)


class CustomWorkflowModal(discord.ui.Modal):
    """Dynamic Discord Modal created from custom dropdown configuration."""

    def __init__(
        self,
        title: str,
        fields: list[dict[str, Any]],
        submission_channel_id: Optional[str | int],
        response_message: Optional[str],
        context: dict[str, Any],
    ):
        super().__init__(title=(title or "Form")[:45])
        self.fields_config = fields
        self.submission_channel_id = submission_channel_id
        self.response_message = response_message or "Thank you! Your submission has been received."
        self.context = context
        self.field_inputs: list[tuple[dict[str, Any], discord.ui.TextInput]] = []

        # Discord allows a maximum of 5 TextInput components per Modal
        for idx, f in enumerate(fields[:5]):
            label = str(f.get("label") or f"Question {idx + 1}")[:45]
            style_str = str(f.get("style", "short")).strip().lower()
            style = discord.TextStyle.paragraph if style_str == "paragraph" else discord.TextStyle.short

            min_len = int(f.get("min_length", 0) or 0) if f.get("min_length") else None
            max_len = int(f.get("max_length", 1000) or 1000) if f.get("max_length") else 1000
            placeholder = str(f.get("placeholder"))[:100] if f.get("placeholder") else None

            text_input = discord.ui.TextInput(
                label=label,
                style=style,
                placeholder=placeholder,
                required=bool(f.get("required", True)),
                min_length=min_len,
                max_length=max_len,
            )
            self.add_item(text_input)
            self.field_inputs.append((f, text_input))

    async def on_submit(self, interaction: discord.Interaction):
        """Processes modal answers, sends formatted submission embed, and acks user."""
        from ..workflow import interpolate_text

        # 1. Build submission embed
        user_name = interaction.user.display_name if hasattr(interaction.user, "display_name") else interaction.user.name
        embed = discord.Embed(
            title=f"📋 New Submission: {self.title}",
            color=discord.Color.brand_green(),
            timestamp=datetime.datetime.now(datetime.timezone.utc),
        )
        embed.set_author(
            name=f"{user_name} ({interaction.user.id})",
            icon_url=interaction.user.display_avatar.url if hasattr(interaction.user, "display_avatar") else None,
        )

        for f_config, text_input in self.field_inputs:
            field_label = text_input.label or "Question"
            field_value = text_input.value or "*No response*"
            embed.add_field(name=field_label[:256], value=field_value[:1024], inline=False)

        if interaction.guild:
            embed.set_footer(text=f"Server: {interaction.guild.name} • User ID: {interaction.user.id}")

        # 2. Dispatch to designated staff submissions channel
        sent_to_staff = False
        if self.submission_channel_id and interaction.guild:
            try:
                sub_channel = interaction.guild.get_channel(int(str(self.submission_channel_id)))
                if sub_channel and hasattr(sub_channel, "send"):
                    await sub_channel.send(embed=embed)
                    sent_to_staff = True
            except Exception as e:
                logger.warning("Failed sending modal submission to channel %s: %s", self.submission_channel_id, e)

        # If no specific submission channel was found, try the channel the interaction was triggered in
        if not sent_to_staff and interaction.channel and hasattr(interaction.channel, "send"):
            try:
                await interaction.channel.send(embed=embed)
            except Exception:
                pass

        # 3. Respond with ephemeral confirmation to user
        final_reply = interpolate_text(self.response_message, self.context) or "Thank you! Your submission has been received."
        if not interaction.response.is_done():
            await interaction.response.send_message(content=final_reply, ephemeral=True)
        else:
            await interaction.followup.send(content=final_reply, ephemeral=True)


async def execute_show_modal(runner: WorkflowRunner, action: dict[str, Any]) -> bool:
    """Triggers a Discord Modal popup for an interaction (used exclusively in dropdowns)."""
    if not runner.interaction:
        logger.warning("show_modal can only be triggered by an active Discord Interaction")
        return False

    if runner.interaction.response.is_done():
        logger.warning("Cannot send_modal: interaction has already been acknowledged or responded to")
        return False

    title = str(action.get("title") or "Application Form")
    fields = action.get("fields") or action.get("questions") or []
    if not isinstance(fields, list) or not fields:
        # Default single input if none provided
        fields = [{"label": "Your Response", "style": "paragraph", "required": True}]

    sub_channel = action.get("submission_channel_id") or action.get("channel_id")
    response_msg = action.get("response_message")

    modal = CustomWorkflowModal(
        title=title,
        fields=fields,
        submission_channel_id=sub_channel,
        response_message=response_msg,
        context=runner.context,
    )

    try:
        await runner.interaction.response.send_modal(modal)
        runner.responded_interaction = True
        runner.modal_shown = True
        return True
    except (discord.Forbidden, discord.HTTPException) as e:
        logger.warning("Failed sending modal interaction: %s", e)
        return False

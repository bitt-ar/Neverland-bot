import logging
from typing import Optional
import discord

logger = logging.getLogger(__name__)


async def check_command_permission(
    bot,
    interaction: discord.Interaction,
    command_name: str,
    default_admin_only: bool = True,
    fallback_perm: str = "administrator",
) -> bool:
    """Verifies command permissions dynamically.
    
    Hierarchy:
    1. Only executable in guilds by guild members.
    2. Guild Owner and Administrators always bypass restrictions.
    3. If command is disabled in moderation config, reject execution.
    4. If server admins assigned specific roles in moderation config (command_roles),
       verify if the user possesses at least one authorized role.
    5. If no specific roles are configured (default mode):
       - If default_admin_only is True, verify user possesses fallback_perm (default: administrator).
       - If default_admin_only is False, allow execution (public command).
    """
    if not interaction.guild or not isinstance(interaction.user, discord.Member):
        if not interaction.response.is_done():
            await interaction.response.send_message("Commands can only be used in servers.", ephemeral=True)
        return False

    # 1. Guild Owner and Administrators always have full bypass
    is_admin = (
        interaction.user.guild_permissions.administrator
        or interaction.user.id == interaction.guild.owner_id
    )
    if is_admin:
        return True

    # Retrieve moderation config for command permissions and disabled commands
    cfg = {}
    registry = getattr(bot, "modules_registry", None)
    if registry:
        try:
            cfg = await registry.get_config(interaction.guild_id, "moderation")
        except Exception as e:
            logger.warning("Failed to fetch moderation config for permission check: %s", e)

    # 2. Check disabled commands toggle
    disabled_cmds = cfg.get("disabled_commands") or []
    if command_name in disabled_cmds:
        if not interaction.response.is_done():
            await interaction.response.send_message(
                f"⛔ The command `/{command_name}` has been disabled by server administrators.",
                ephemeral=True,
            )
        return False

    # 3. Check role-based command overrides configured by server admin
    command_roles_map = cfg.get("command_roles") or {}
    allowed_roles = command_roles_map.get(command_name) or []
    if allowed_roles:
        user_role_ids = {r.id for r in interaction.user.roles}
        if any(int(rid) in user_role_ids for rid in allowed_roles):
            return True

        role_mentions = ", ".join([f"<@&{rid}>" for rid in allowed_roles])
        if not interaction.response.is_done():
            await interaction.response.send_message(
                f"⛔ You do not have permission to use `/{command_name}`. Required roles: {role_mentions}",
                ephemeral=True,
            )
        return False

    # 4. Default behavior when no custom roles are assigned
    if default_admin_only:
        has_perm = getattr(interaction.user.guild_permissions, fallback_perm, False)
        if not has_perm:
            perm_display = fallback_perm.replace("_", " ").title()
            if not interaction.response.is_done():
                await interaction.response.send_message(
                    f"⛔ You need `{perm_display}` permissions to use `/{command_name}`.",
                    ephemeral=True,
                )
            return False
        return True

    # Public command by default
    return True

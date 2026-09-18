import asyncio
import logging
import os

import discord
from discord import app_commands
from discord.ext import commands

from bot.control.server import start_control_plane, stop_control_plane, memory_log_handler
from core import config, database

logging.basicConfig(level=logging.INFO)
logging.getLogger().addHandler(memory_log_handler)

intents = discord.Intents.all()
bot = commands.Bot(command_prefix=config.PREFIX, intents=intents)


async def load_extensions():
    for filename in os.listdir(config.BASE_DIR / "cogs"):
        if filename.endswith(".py"):
            await bot.load_extension(f"cogs.{filename[:-3]}")


async def main():
    await database.init()
    from bot.modules.registry import build_registry

    bot.modules_registry = build_registry(bot)
    try:
        await bot.modules_registry.load_startup_migrations()
    except Exception as e:
        logging.exception("Startup migration error: %s", e)

    control_runner = None
    if config.CONTROL_PLANE_SECRET:
        control_runner = await start_control_plane(bot)
        logging.info(
            "Control plane listening on http://%s:%s",
            config.CONTROL_PLANE_HOST,
            config.CONTROL_PLANE_PORT,
        )
    else:
        logging.info("CONTROL_PLANE_SECRET not set — control plane disabled")

    try:
        async with bot:
            await load_extensions()
            await bot.modules_registry.register_cogs()
            await bot.start(config.TOKEN, reconnect=True)
    finally:
        if control_runner:
            await stop_control_plane(control_runner)
        await database.close()


@bot.event
async def on_ready():
    logging.info("Discord Gateway Connected: Logged in as %s (ID: %s)", bot.user, bot.user.id)
    logging.info("Bot is active across %d servers on Discord", len(bot.guilds))
    await bot.change_presence(status=discord.Status.idle, activity=discord.Game("At your service"))

    # Automatic Slash Command Sync (Eliminates duplicates by clearing guild-level copies)
    try:
        guild_id_raw = os.getenv("GUILD_ID")
        if guild_id_raw:
            try:
                target_guild = discord.Object(id=int(guild_id_raw))
                bot.tree.clear_commands(guild=target_guild)
                await bot.tree.sync(guild=target_guild)
                logging.info("Purged duplicate guild commands for Guild %s", guild_id_raw)
            except Exception as ge:
                logging.warning("Failed purging guild commands: %s", ge)

        # Global sync across all Discord servers
        synced_global = await bot.tree.sync()
        logging.info("Globally synced %d slash commands (single source, no duplicates)", len(synced_global))
    except Exception as e:
        logging.error("Error syncing slash commands on startup: %s", e)


@bot.event
async def on_member_remove(member):
    settings = await database.get_settings(member.guild.id)
    channel_id = settings.get("leave_channel_id")
    if not channel_id:
        return
    channel = member.guild.get_channel(channel_id) or bot.get_channel(channel_id)
    if channel:
        await channel.send(f"<@{member.id}> has left the server")


@bot.event
async def on_command_error(ctx, error):
    logging.error("Command error in %s: %s", ctx.command, error)


@bot.tree.error
async def on_app_command_error(interaction: discord.Interaction, error: app_commands.AppCommandError):
    command_name = getattr(interaction.command, "qualified_name", "unknown")
    logging.error("App command error in /%s: %s", command_name, error)
    if isinstance(error, app_commands.CheckFailure):
        message = "You don't have permission to use this command here."
    else:
        message = "Something went wrong while running that command."
    try:
        if interaction.response.is_done():
            await interaction.followup.send(message, ephemeral=True)
        else:
            await interaction.response.send_message(message, ephemeral=True)
    except Exception as report_error:
        logging.warning("Failed to report app command error to user: %s", report_error)


@bot.tree.command(name="avatar", description="Fetch avatar of a user")
async def avatar(interaction: discord.Interaction, member: discord.Member = None):
    member = member or interaction.user
    await interaction.response.send_message(member.display_avatar.url)


@bot.tree.command(name="help")
async def help_command(interaction: discord.Interaction):
    sections = [
        ("Chat & Utilities", [
            "/avatar — Fetch avatar of a user",
            "/clear — Clean up messages (admin/moderator)",
        ]),
        ("Leveling & Rank", [
            "/rank — Display your rank card & server position",
            "/leaderboard — Top 10 members in this server",
            "/theme — Change your rank card theme (Dark, Orange, Purple)",
            "/add_background — Upload a custom rank card background image",
        ]),
        ("Giveaways", [
            "/giveaway — Create an interactive giveaway",
            "/giveaway_logs — Configure the giveaway logs channel",
            "/reroll — Reroll a completed giveaway",
        ]),
        ("Support Tickets & Voice", [
            "/tickets status — View ticket system configuration & stats",
            "/tickets publish-panel — Publish or refresh the ticket panel",
            "/tickets logs — Set the ticket audit & transcript logs channel",
            "/tempvoice — View active temporary voice lounges",
        ]),
        ("Moderation & Security", [
            "/warn, /warnings — Issue and review member warnings",
            "/timeout, /untimeout — Mute/unmute members dynamically",
            "/kick, /ban, /unban — Enforce server moderation actions",
            "/modlogs — View moderation action history",
        ]),
        ("Activity & Admin", [
            "/activity — Weekly voice & message statistics",
            "/setup — Server settings (welcome, leave)",
            "/levelroles — Configure level role rewards",
            "/reactionrole — Reaction roles wizard",
            "/xp — Grant XP to a member (admin)",
        ]),
    ]

    embed = discord.Embed(
        title="📖 Neverland — Command Guide",
        color=discord.Color.blurple(),
    )
    for title, lines in sections:
        embed.add_field(name=title, value="\n".join(lines), inline=False)

    await interaction.response.send_message(embed=embed)


asyncio.run(main())

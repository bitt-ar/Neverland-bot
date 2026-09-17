import asyncio
import logging
import os

import discord
from discord import app_commands
from discord.ext import commands

from bot.control.server import start_control_plane, stop_control_plane
from core import config, database

logging.basicConfig(level=logging.INFO)

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
    print(f"We have logged in as {bot.user} (ID: {bot.user.id})")
    print(f"Connected servers: {len(bot.guilds)}")
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


@bot.tree.command(name="avatar", description="Fetch avatar of a user")
async def avatar(interaction: discord.Interaction, member: discord.Member = None):
    member = member or interaction.user
    await interaction.response.send_message(member.display_avatar.url)


@bot.tree.command(name="help")
async def help_command(interaction: discord.Interaction):
    embed = ("# **Chat & Utilities** \n"
             " * **/avatar              Fetch avatar of a user** \n"
             " * **/clear               Clean up messages (admin/moderator)** \n"
             "# **Leveling & Rank**\n"
             " * **/rank                Display your rank card & server position**\n"
             " * **/leaderboard         Top 10 members in this server**\n"
             " * **/theme               Change your rank card theme (Dark, Orange, Purple)**\n"
             " * **/add_background      Upload a custom rank card background image**\n"
             "# **Giveaways**\n"
             " * **/giveaway            Create an interactive giveaway**\n"
             " * **/giveaway_logs       Configure the giveaway logs channel**\n"
             " * **/reroll              Reroll a completed giveaway**\n"
             "# **Support Tickets & Voice**\n"
             " * **/tickets status      View ticket system configuration & stats**\n"
             " * **/tickets publish-panel Publish or refresh the ticket panel**\n"
             " * **/tickets logs        Set the ticket audit & transcript logs channel**\n"
             " * **/tempvoice           View active temporary voice lounges**\n"
             "# **Moderation & Security**\n"
             " * **/warn, /warnings     Issue and review member warnings**\n"
             " * **/timeout, /untimeout Mute/unmute members dynamically**\n"
             " * **/kick, /ban, /unban  Enforce server moderation actions**\n"
             " * **/modlogs             View moderation action history**\n"
             "# **Activity & Admin**\n"
             " * **/activity            Weekly voice & message statistics**\n"
             " * **/setup               Server settings (welcome, leave)**\n"
             " * **/levelroles          Configure level role rewards**\n"
             " * **/reactionrole        Reaction roles wizard**\n"
             " * **/xp                  Grant XP to a member (admin)**\n"
             )

    await interaction.response.send_message(embed)


asyncio.run(main())

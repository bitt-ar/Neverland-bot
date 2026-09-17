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


@bot.command(name="sync")
@commands.has_permissions(administrator=True)
async def prefix_sync(ctx: commands.Context):
    """Fallback prefix command (!sync) to purge duplicate commands and sync globally."""
    try:
        msg = await ctx.send("⏳ Purging duplicate commands and syncing globally...")
        bot.tree.clear_commands(guild=ctx.guild)
        await bot.tree.sync(guild=ctx.guild)
        global_cmds = await bot.tree.sync()
        await msg.edit(content=f"✅ Removed duplicate commands! Successfully synced {len(global_cmds)} global commands cleanly.")
    except Exception as e:
        await ctx.send(f"❌ Error syncing commands: {e}")


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


@bot.tree.command(name="sync", description="Purge duplicate commands and sync globally (admin)")
@app_commands.default_permissions(administrator=True)
async def sync(interaction: discord.Interaction):
    try:
        if interaction.guild:
            bot.tree.clear_commands(guild=interaction.guild)
            await bot.tree.sync(guild=interaction.guild)
        fmt = await bot.tree.sync()
        await interaction.response.send_message(
            f"Purged duplicate commands and synced {len(fmt)} command(s) globally.",
            ephemeral=True
        )
    except Exception as e:
        await interaction.response.send_message(f"Error while syncing commands: {e}", ephemeral=True)


@bot.tree.command(name="setavatar", description="Change the bot's avatar (admin)")
@app_commands.default_permissions(administrator=True)
async def setavatar(interaction: discord.Interaction, image: discord.Attachment):
    if not image.content_type.startswith("image"):
        await interaction.response.send_message("Please provide an image attachment.", ephemeral=True)
        return
    await interaction.response.defer(ephemeral=True)
    data = await image.read()
    try:
        await bot.user.edit(avatar=data)
        await interaction.followup.send("Avatar updated successfully.", ephemeral=True)
    except Exception as e:
        await interaction.followup.send(f"Error: {e}", ephemeral=True)


@bot.tree.command(name="clear", description="Clean up conversations (admin)")
@app_commands.default_permissions(administrator=True)
async def clear(interaction: discord.Interaction, amount: app_commands.Range[int, 1, 100]):
    await interaction.response.defer(ephemeral=True)
    deleted = await interaction.channel.purge(limit=amount)
    await interaction.followup.send(f"Deleted {len(deleted)} messages", ephemeral=True)


@bot.tree.command(name="avatar", description="Fetch avatar of a user")
async def avatar(interaction: discord.Interaction, member: discord.Member = None):
    member = member or interaction.user
    await interaction.response.send_message(member.display_avatar.url)


@bot.tree.command(name="help")
async def help_command(interaction: discord.Interaction):
    embed = ("# **Chatbot Commands** \n"
             " * **/avatar   fetch avatar of a user** \n"
             " * **/clear    Clean up conversations (admin)** \n"
             "# **Leveling Commands**\n"
             " * **/rank               Rank card + your position in this server**\n"
             " * **/leaderboard        Top 10 members in this server**\n"
             " * **/theme              Change your rank card theme (Dark, Orange, Purple)**\n"
             " * **/add_background     Add a background by link**\n"
             " * **/delete_background   Recovery of the default background**\n"
             "# **Giveaway Commands**\n"
             " * **/giveaway       creat a give away**\n"
             " * **/reroll         reroll a giveaway**\n"
             "# **Tickets & Voice**\n"
             " * **/tickets status         View tickets configuration & open tickets**\n"
             " * **/tickets publish-panel  Publish or replace ticket panel**\n"
             " * **/tempvoice              View active voice lounges & dashboard**\n"
             "# **Activity**\n"
             " * **/activity       Weekly voice & message stats**\n"
             "# **Admin**\n"
             " * **/sync            Sync slash commands and purge duplicates**\n"
             " * **/setavatar       Change the bot avatar**\n"
             " * **/setup           Server settings (welcome, leave)**\n"
             " * **/levelroles      Level role rewards**\n"
             " * **/reactionrole    Reaction roles wizard**\n"
             " * **/xp              Give XP to a member**\n"
             )

    await interaction.response.send_message(embed)


asyncio.run(main())

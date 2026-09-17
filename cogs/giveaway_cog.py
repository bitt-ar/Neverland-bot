import asyncio
import datetime
import random
import time as pyTime

import discord
from discord import app_commands
from discord.ext import commands

from core import database


class Exit(discord.ui.View):
    def __init__(self):
        super().__init__()
        self.value = None

    @discord.ui.button(label="Cancel", style=discord.ButtonStyle.red)
    async def Exit(self, interaction: discord.Interaction, button: discord.Button):
        await interaction.response.edit_message(content="You have successfully canceled the giveaway ✅ ", view=None)
        self.value = True
        self.stop()


class Leave(discord.ui.View):
    def __init__(self, timeout=False):
        super().__init__(timeout=timeout)
        self.id = {}
        self.timedout = {}

    @discord.ui.button(label="Leave Giveaway", style=discord.ButtonStyle.red)
    async def Leavee(self, interaction: discord.Interaction, button: discord.Button):
        if interaction.user.id in self.timedout:
            self.id[str(interaction.user.id)] = 1
            await interaction.response.edit_message(content="You have successfully left the giveaway! ✅ ", view=None)
        else:
            await interaction.response.edit_message(content="Timed out. Please try again ❌ ", view=None)

    async def waiting(self, user_id):
        if user_id in self.timedout:
            self.timedout[user_id] = 299
            return
        else:
            self.timedout[user_id] = 299

        while True:
            if self.id[str(user_id)] == 1:
                del self.timedout[user_id]
                return self.id[str(user_id)] == 1
            if self.timedout[user_id] == 0:
                del self.timedout[user_id]
                return 0
            self.timedout[user_id] -= 1
            await asyncio.sleep(1)

    async def on_error(self, interaction: discord.Interaction, error: Exception, item, /) -> None:
        print(error)


class MyView(discord.ui.View):
    def __init__(self, ctx, timeout=False):
        super().__init__(timeout=timeout)
        self.ctx = ctx
        self.time = None
        self.value = None
        self.clicked_users = []
        self.Entries = 0
        self.timer = None
        self.winners = []
        self.pyTime = None
        self.message = None
        self.Titel = None
        self.Winner = None
        self.Time = None
        self.Description = None
        self.member = None
        self.Link = None
        self.Leave = Leave()

    def data(self, member, Titel, Winner, Time, Description, Link):
        self.member = member
        self.Titel = Titel
        self.Winner = Winner
        self.Time = Time
        self.Description = Description
        self.Link = Link
        t = datetime.datetime.now()
        self.time_now = t.strftime('%A %d %b %Y %I:%M %p')

    def Timer(self):
        time_str = self.Time.lower()
        time_parts = time_str.split()
        if time_str.endswith(("sec", "second", "seconds")):
            self.time = int(time_parts[0])
            self.pyTime = pyTime.time() + self.time
            return 1
        elif time_str.endswith(("mn", "min", "minute", "minutes")):
            self.time = int(time_parts[0]) * 60
            self.pyTime = pyTime.time() + self.time
            return 1
        elif time_str.endswith(("h", "hour", "hours")):
            self.time = int(time_parts[0]) * 3600
            self.pyTime = pyTime.time() + self.time
            return 1
        elif time_str.endswith(("d", "day", "days")):
            self.time = int(time_parts[0]) * 86400
            self.pyTime = pyTime.time() + self.time
            return 1
        else:
            return

    def embed(self):
        try:
            avatar = self.ctx.author.avatar.url
        except Exception:
            avatar = "https://cdn.discordapp.com/embed/avatars/0.png"
        embed = discord.Embed(title=self.Titel, description=self.Description, color=discord.Color.random())
        embed.add_field(name="Ends", value=f"<t:{int(self.pyTime)}:R> at <t:{int(self.pyTime)}:f>  ", inline=False)
        embed.add_field(name="Hosted by", value=self.member, inline=False)
        embed.add_field(name="Entries", value=self.Entries, inline=False)
        embed.add_field(name="Winners", value=self.Winner, inline=False)
        embed.set_footer(text=f"{self.time_now}", icon_url=avatar)
        embed.set_image(url=self.Link)
        return embed

    @discord.ui.button(label="", style=discord.ButtonStyle.blurple, emoji="🎉")
    async def menu(self, interaction: discord.Interaction, button: discord.Button):
        user_id = interaction.user.id
        if user_id in self.clicked_users:
            self.Leave.id[str(user_id)] = 0
            await interaction.response.send_message(content="You have already entered this giveaway!",
                                                    ephemeral=True, view=self.Leave)
            await self.Leave.waiting(user_id)
            if user_id in self.clicked_users and self.Leave.id[str(user_id)] == 1:
                self.Entries -= 1
                self.clicked_users.remove(user_id)
                embed = self.embed()
                channel = interaction.channel
                msg = await channel.fetch_message(self.message.id)
                await msg.edit(embed=embed)
                return
            else:
                return

        self.clicked_users.append(user_id)
        self.Entries += 1
        embed = self.embed()
        await interaction.response.edit_message(embed=embed)

    async def winner(self):
        self.timer = asyncio.create_task(asyncio.sleep(self.time))
        await self.timer
        channel = self.ctx.bot.get_channel(self.message.channel.id)
        try:
            await channel.fetch_message(self.message.id)
        except Exception as e:
            print(e)
            self.value = False
            self.stop()
            self.Leave.stop()
            return
        if self.Entries == 0:
            await self.message.channel.send(f"{self.member} No one cares about your giveaway")
            await self.clean_up_giveaway()
            return
        winners_count = min(int(self.Winner), self.Entries)
        winners = random.sample(self.clicked_users, winners_count)
        self.winners = [f"<@{winner}>" for winner in winners]
        await self.save_giveaway()
        await self.send_congratulations_message(winners)
        await self.edit_giveaway_message()
        await self.send_summary_message()
        self.value = False
        self.stop()
        self.Leave.stop()

    async def clean_up_giveaway(self):
        channel = self.ctx.bot.get_channel(self.message.channel.id)
        msg = await channel.fetch_message(self.message.id)
        self.clear_items()
        embed = self.embed()
        await msg.edit(embed=embed, view=self)
        self.value = False
        self.stop()
        self.Leave.stop()

    async def save_giveaway(self):
        doc = {
            "message_id": str(self.message.id),
            "guild_id": self.message.guild.id,
            "member": self.member,
            "Title": self.Titel,
            "Winner": self.Winner,
            "Time": self.time,
            "Description": self.Description,
            "Entries": self.Entries,
            "Entrants": self.clicked_users,
            "Winners": self.winners,
        }
        await database.db.giveaways.update_one({"message_id": doc["message_id"]}, {"$set": doc}, upsert=True)

    async def send_congratulations_message(self, winners):
        await self.message.channel.send(f"🎊🎊 Congratulations {' '.join(self.winners)} "
                                        f"**You won the {self.Titel}** 🎊🎊")
        for winner in winners:
            user = await self.ctx.bot.fetch_user(winner)
            embed = discord.Embed(title=" 🎊🎊 ** Congratulations ** 🎊🎊 ", color=user.color)
            embed.add_field(name=f"", value=f"  <@{winner}> **You won the {self.Titel}**", inline=False)
            embed.add_field(name="", value=f"You can check it here : {self.message.jump_url}", inline=False)
            await user.send(embed=embed)

    async def edit_giveaway_message(self):
        self.Winner = " ".join(self.winners)
        self.clear_items()
        channel = self.ctx.bot.get_channel(self.message.channel.id)
        msg = await channel.fetch_message(self.message.id)
        embed = self.embed()
        await msg.edit(embed=embed, view=self)

    async def send_summary_message(self):
        channel = await self.ctx.author.create_dm()
        users = [f"<@{user}>" for user in self.clicked_users]
        Entrants = ' '.join(users)
        self.Description = self.Titel
        self.Titel = " Giveaway Summary "
        embed = self.embed().remove_field(index=2)
        embed = embed.insert_field_at(index=2, name="Entrants", value=Entrants, inline=False)
        embed = embed.add_field(name="Giveaway id", value=self.message.id, inline=False)
        await channel.send(embed=embed)

    async def leave(self):
        self.value = False
        self.Leave.stop()
        self.stop()

    async def on_error(self, interaction: discord.Interaction, error):
        print(error)


class Input(discord.ui.Modal, title="Creat a GiveAway"):
    Title = discord.ui.TextInput(
        style=discord.TextStyle.short,
        label="Prize",
        placeholder=" EX: 1000 dollar "
    )
    Winner = discord.ui.TextInput(
        style=discord.TextStyle.short,
        label="The number of winners",
        default="1",
    )
    Time = discord.ui.TextInput(
        style=discord.TextStyle.short,
        label="Time",
        placeholder=" EX: 10 minutes,  10 hours,  10 days. "
    )
    Link = discord.ui.TextInput(
        style=discord.TextStyle.short,
        label="Photo Links",
        placeholder=" The source URL for the image. Only HTTP(S) is supported. Inline attachment URLs are also supported ",
        required=False
    )
    description = discord.ui.TextInput(
        style=discord.TextStyle.long,
        required=False,
        label="Description",
        max_length=300,
    )

    def __init__(self, ctx, member, image, timeout=None):
        self.image = image
        self.member = member
        self.ctx = ctx
        self.MyView = MyView(self.ctx)
        self.Exit = Exit()
        super().__init__(timeout=timeout)

    async def on_submit(self, interaction: discord.Interaction):
        if self.image is not None:
            self.Link = self.image.url
        elif str(self.Link) != "":
            if str(self.Link).startswith("https") == False:
                await interaction.response.send_message("The source URL for the image. Only HTTP(S)", ephemeral=True)
                return
        if self.Winner.value.isnumeric() == False:
            await interaction.response.send_message("Please enter a number", ephemeral=True)
            return

        view = self.MyView
        view.data(str(self.member), str(self.Title), str(self.Winner), str(self.Time), str(self.description),
                  str(self.Link))
        time = str(self.Time.value).split()
        if time[0].isnumeric() == False or view.Timer() is None:
            await interaction.response.send_message("Please enter minutes, hours or days", ephemeral=True)
            return
        view.Timer()
        embed = view.embed()
        await interaction.response.send_message(embed=embed, view=view)
        message = await interaction.original_response()
        Exit = self.Exit
        Exit.timeout = view.time
        await interaction.followup.send(f"The giveaway was successfully created! ID:{message.id}", ephemeral=True,
                                        view=Exit)
        view.message = message
        winner_task = asyncio.create_task(view.winner())

        await Exit.wait()
        if Exit.value == True:
            if interaction.user.id != self.ctx.author.id:
                return
            else:
                channel = self.ctx.bot.get_channel(message.channel.id)
                msg = await channel.fetch_message(message.id)
                await msg.delete()
                view.value = False
                view.timer.cancel()
                await view.leave()
                Exit.stop()
        elif Exit.value == None:
            print("its done")
        await winner_task

    async def on_error(self, interaction: discord.Interaction, error):
        print(error)


class Giveaway(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="giveaway", description="Creat a giveaway")
    async def giveaway(self, interaction: discord.Interaction, image: discord.Attachment = None):
        if image is not None and not image.content_type.startswith('image'):
            await interaction.response.send_message("Please provide an image attachment.", ephemeral=True)
            return
        ctx = await self.bot.get_context(interaction)
        member = str(ctx.author.mention)
        await interaction.response.send_modal(Input(ctx, member, image))

    @app_commands.command(name="reroll", description="for reroll a giveaway")
    async def reroll(self, interaction: discord.Interaction, giveaway_id: str, number_of_winners: int = None):
        doc = await database.db.giveaways.find_one({"message_id": giveaway_id})
        if not doc:
            await interaction.response.send_message("This message is not a completed giveaway message!", ephemeral=True)
            return
        if number_of_winners == None:
            number_of_winners = 1
        Entrants = doc["Entrants"]
        number_of_winners = min(int(number_of_winners), len(Entrants))
        win = random.sample(Entrants, number_of_winners)
        wiin = [f"<@{winner}>" for winner in win]
        await interaction.response.send_message(
            f"🎊🎊 Congratulations  {' '.join(wiin)} **You won the {doc['Title']}** 🎊🎊")

        channel = self.bot.get_channel(interaction.channel.id)
        message = await channel.fetch_message(int(giveaway_id))
        for winner in win:
            user = await self.bot.fetch_user(winner)
            embed = discord.Embed(title=" 🎊🎊 ** Congratulations ** 🎊🎊 ", color=user.color)
            embed.add_field(name=f"", value=f"  <@{winner}> **You won the {doc['Title']}**", inline=False)
            embed.add_field(name="", value=f"You can check it here : {message.jump_url}", inline=False)
            await user.send(embed=embed)

    # The "reroll" context menu is registered in setup() via
    # app_commands.ContextMenu — context menus cannot be defined inside a class.


async def reroll_context_callback(interaction: discord.Interaction, message: discord.Message):
    """Context-menu callback. Defined at module level because discord.py does not
    allow app_commands.ContextMenu decorators inside a Cog class; registered in setup()."""
    doc = await database.db.giveaways.find_one({"message_id": str(message.id)})
    if not doc:
        await interaction.response.send_message("This message is not a completed giveaway message!", ephemeral=True)
        return
    number_of_winners = doc["Winner"]
    Entrants = doc["Entrants"]
    number_of_winners = min(int(number_of_winners), len(Entrants))
    win = random.sample(Entrants, number_of_winners)
    wiin = [f"<@{winner}>" for winner in win]
    await interaction.response.send_message(
        f"🎊🎊 Congratulations  {' '.join(wiin)} **You won the {doc['Title']}** 🎊🎊")
    for winner in win:
        user = await interaction.client.fetch_user(winner)
        embed = discord.Embed(title=" 🎊🎊 ** Congratulations ** 🎊🎊 ", color=user.color)
        embed.add_field(name=f"", value=f"  <@{winner}> **You won the {doc['Title']}**", inline=False)
        embed.add_field(name="", value=f"You can check it here : {message.jump_url}", inline=False)
        await user.send(embed=embed)


async def setup(bot):
    await bot.add_cog(Giveaway(bot))
    bot.tree.add_command(
        app_commands.ContextMenu(name="reroll", callback=reroll_context_callback)
    )

import asyncio
import datetime
import io
import logging
import random
import time as pyTime
from typing import Optional

import discord
from discord import app_commands
from discord.ext import commands, tasks

from pymongo import ReturnDocument

from core import database

logger = logging.getLogger(__name__)


async def select_giveaway_winners(
    guild: Optional[discord.Guild],
    entrants: list[int],
    role_multipliers: dict,
    count: int,
) -> tuple[list[int], dict[str, int]]:
    """Selects `count` unique winners using the list-expansion lottery pool:
    Each entrant is added `mult` times into the pool list based on their highest role multiplier (default 1).
    """
    if not entrants or count <= 0:
        return [], {}

    mult_map = {str(k): int(v) for k, v in (role_multipliers or {}).items()}
    pool = []
    user_mults = {}
    for uid in entrants:
        uid_int = int(uid)
        mult = 1
        if mult_map and guild:
            member = guild.get_member(uid_int)
            if not member:
                try:
                    member = await guild.fetch_member(uid_int)
                except Exception:
                    member = None
            if member and hasattr(member, "roles"):
                m_list = [1]
                for r in member.roles:
                    if str(r.id) in mult_map:
                        m_list.append(mult_map[str(r.id)])
                mult = max(m_list)
        user_mults[str(uid_int)] = mult
        pool.extend([uid_int] * mult)

    actual_count = min(count, len(entrants))
    winners = []
    pool_copy = list(pool)
    for _ in range(actual_count):
        if not pool_copy:
            break
        chosen = random.choice(pool_copy)
        winners.append(chosen)
        pool_copy = [u for u in pool_copy if u != chosen]

    return winners, user_mults


async def send_giveaway_logs(
    bot: discord.Client,
    guild: discord.Guild,
    doc: dict,
    winners: list[int],
    entrants: list[int],
    entrant_weights: dict,
):
    """Sends giveaway results to the configured logs channel and the creator.
    Safely exports large entrant rosters to a text file to prevent Discord 2000-character payload crashes.
    """
    if database.db is None:
        return

    try:
        config_doc = await database.db.giveaways_config.find_one({"guild_id": guild.id}) or {}
        logs_ch_id = config_doc.get("logs_channel_id")

        title = doc.get("Title") or doc.get("title") or "Giveaway"
        msg_id = str(doc.get("message_id", ""))
        channel_id = doc.get("channel_id")
        jump_url = doc.get("jump_url") or (
            f"https://discord.com/channels/{guild.id}/{channel_id}/{msg_id}"
            if channel_id and msg_id
            else ""
        )
        creator_id = doc.get("creator_id") or doc.get("member_id")

        embed = discord.Embed(
            title=f"🎉 Giveaway Concluded: {title}",
            color=discord.Color.gold(),
            timestamp=datetime.datetime.now(datetime.timezone.utc),
        )
        embed.add_field(name="Prize", value=title, inline=True)
        embed.add_field(name="Winners Count", value=str(len(winners)), inline=True)
        embed.add_field(name="Total Entrants", value=str(len(entrants)), inline=True)

        winners_mentions = " ".join([f"<@{w}>" for w in winners]) if winners else "None"
        embed.add_field(name="Winners", value=winners_mentions, inline=False)
        if jump_url:
            embed.add_field(name="Giveaway Message", value=f"[Jump to Message]({jump_url})", inline=False)

        # Build entrants roster content safely
        file_bytes = None
        if len(entrants) <= 20 and entrants:
            entrant_lines = []
            for u in entrants:
                w = entrant_weights.get(str(u), entrant_weights.get(u, 1))
                entrant_lines.append(f"<@{u}> ({w}x chance)")
            embed.add_field(name="Entrants", value="\n".join(entrant_lines)[:1000], inline=False)
        elif entrants:
            txt_lines = [
                f"Giveaway ID: {msg_id}",
                f"Prize: {title}",
                f"Guild ID: {guild.id}",
                f"Concluded At: {datetime.datetime.now(datetime.timezone.utc).isoformat()}",
                f"Total Entrants: {len(entrants)}",
                f"Winners: {', '.join([str(w) for w in winners])}",
                "============================================================",
                "User ID | Win Multiplier",
                "============================================================",
            ]
            for u in entrants:
                w = entrant_weights.get(str(u), entrant_weights.get(u, 1))
                txt_lines.append(f"{u} | {w}x chance")
            file_bytes = "\n".join(txt_lines).encode("utf-8")
            embed.add_field(
                name="Entrants Roster",
                value=f"📄 Full entrant roster attached (`giveaway_{msg_id}_entrants.txt`) with {len(entrants)} participants.",
                inline=False,
            )

        # 1. Send to server logs channel if configured
        if logs_ch_id:
            logs_channel = guild.get_channel(int(logs_ch_id))
            if logs_channel and isinstance(logs_channel, discord.TextChannel):
                try:
                    f1 = (
                        discord.File(io.BytesIO(file_bytes), filename=f"giveaway_{msg_id}_entrants.txt")
                        if file_bytes
                        else None
                    )
                    await logs_channel.send(embed=embed, file=f1)
                except Exception as e:
                    logger.warning("Error posting to giveaway logs channel %s: %s", logs_ch_id, e)

        # 2. Send DM to creator
        if creator_id:
            try:
                creator = guild.get_member(int(creator_id)) or await bot.fetch_user(int(creator_id))
                if creator:
                    f2 = (
                        discord.File(io.BytesIO(file_bytes), filename=f"giveaway_{msg_id}_entrants.txt")
                        if file_bytes
                        else None
                    )
                    await creator.send(embed=embed, file=f2)
            except Exception as e:
                logger.debug("Could not DM giveaway creator %s: %s", creator_id, e)
    except Exception as e:
        logger.warning("Error in send_giveaway_logs: %s", e)


async def conclude_giveaway_doc(bot: discord.Client, doc: dict):
    """Safely and idempotently concludes a giveaway document from database."""
    if not doc:
        return
    message_id = str(doc.get("message_id", ""))
    if not message_id:
        return

    # Atomic lock: ONLY ONE task can ever transition status from 'active' to 'ended'
    fresh = None
    if database.db is not None:
        fresh = await database.db.giveaways.find_one_and_update(
            {"message_id": message_id, "status": "active"},
            {
                "$set": {
                    "status": "ended",
                    "concluded": True,
                    "concluded_at": datetime.datetime.now(datetime.timezone.utc),
                }
            },
            return_document=ReturnDocument.AFTER,
        )
        if not fresh:
            # Already concluded by another task (or not active) - avoid duplicate conclusion!
            return

    working_doc = fresh if fresh is not None else doc
    guild_id = working_doc.get("guild_id")
    channel_id = working_doc.get("channel_id")
    title = working_doc.get("Title") or working_doc.get("title") or "Giveaway"
    creator_id = working_doc.get("creator_id") or working_doc.get("member_id")
    winners_count = int(working_doc.get("winners_count") or working_doc.get("Winner") or 1)
    entrants = working_doc.get("Entrants") or working_doc.get("entrants") or []
    role_multipliers = working_doc.get("role_multipliers") or {}

    guild = bot.get_guild(int(guild_id)) if guild_id else None
    if not guild:
        return

    channel = guild.get_channel(int(channel_id)) if channel_id else None
    message = None
    if channel and hasattr(channel, "fetch_message"):
        try:
            message = await channel.fetch_message(int(message_id))
        except Exception:
            message = None

    if not entrants:
        if channel:
            creator_mention = f"<@{creator_id}>" if creator_id else "Giveaway host"
            try:
                await channel.send(f"{creator_mention} No entries recorded for **{title}**. No winners selected.")
            except Exception:
                pass
        if message:
            try:
                embed = message.embeds[0] if message.embeds else discord.Embed(title=f"🎉 {title}")
                embed.description = "**Giveaway Ended**\nNo entries were recorded."
                embed.color = discord.Color.dark_gray()
                await message.edit(embed=embed, view=None)
            except Exception:
                pass
        return

    raw_winners, user_multipliers = await select_giveaway_winners(
        guild, entrants, role_multipliers, winners_count
    )
    winner_mentions = [f"<@{w}>" for w in raw_winners]

    if database.db is not None:
        await database.db.giveaways.update_one(
            {"message_id": message_id},
            {"$set": {"Winners": [str(w) for w in raw_winners]}}
        )

    if channel:
        try:
            await channel.send(
                f"🎊 Congratulations {' '.join(winner_mentions)}! You won the **{title}**! 🎊"
            )
        except Exception as e:
            logger.warning("Error sending winner announcement: %s", e)

    for winner in raw_winners:
        try:
            user = await bot.fetch_user(winner)
            embed = discord.Embed(
                title="🎉 Congratulations! 🎉",
                description=f"You won the giveaway for **{title}** in **{guild.name}**!",
                color=discord.Color.gold(),
            )
            if message:
                embed.add_field(name="Giveaway Link", value=f"[View Giveaway]({message.jump_url})", inline=False)
            await user.send(embed=embed)
        except Exception:
            pass

    if message:
        try:
            embed = message.embeds[0] if message.embeds else discord.Embed(title=f"🎉 {title}")
            embed.description = f"**Giveaway Ended**\nWinners: {' '.join(winner_mentions)}"
            embed.color = discord.Color.dark_gray()
            new_fields = []
            for f in embed.fields:
                if f.name == "Winners":
                    new_fields.append({"name": "Winners", "value": " ".join(winner_mentions), "inline": f.inline})
                elif f.name == "Ends":
                    new_fields.append({"name": "Ended", "value": f"<t:{int(pyTime.time())}:R>", "inline": f.inline})
                else:
                    new_fields.append({"name": f.name, "value": f.value, "inline": f.inline})
            embed.clear_fields()
            for f in new_fields:
                embed.add_field(name=f["name"], value=f["value"], inline=f["inline"])
            await message.edit(embed=embed, view=None)
        except Exception as e:
            logger.warning("Error updating giveaway embed: %s", e)

    doc_for_logs = dict(working_doc)
    doc_for_logs["jump_url"] = message.jump_url if message else ""
    await send_giveaway_logs(
        bot=bot,
        guild=guild,
        doc=doc_for_logs,
        winners=raw_winners,
        entrants=entrants,
        entrant_weights=user_multipliers,
    )


class Exit(discord.ui.View):
    def __init__(self):
        super().__init__()
        self.value = None

    @discord.ui.button(label="Cancel", style=discord.ButtonStyle.red)
    async def Exit(self, interaction: discord.Interaction, button: discord.Button):
        await interaction.response.edit_message(
            content="You have successfully canceled the giveaway ✅", view=None
        )
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
            await interaction.response.edit_message(
                content="You have successfully left the giveaway! ✅", view=None
            )
        else:
            await interaction.response.edit_message(
                content="Timed out. Please try again ❌", view=None
            )

    async def waiting(self, user_id):
        if user_id in self.timedout:
            self.timedout[user_id] = 299
            return
        else:
            self.timedout[user_id] = 299

        while True:
            if self.id.get(str(user_id)) == 1:
                self.timedout.pop(user_id, None)
                return True
            if self.timedout.get(user_id, 0) <= 0:
                self.timedout.pop(user_id, None)
                return False
            self.timedout[user_id] -= 1
            await asyncio.sleep(1)


class MyView(discord.ui.View):
    def __init__(
        self,
        bot: discord.Client,
        guild: discord.Guild,
        author: discord.Member | discord.User,
        required_role_ids: list[int] = None,
        role_multipliers: dict[int, int] = None,
        timeout: Optional[float] = None,
    ):
        super().__init__(timeout=timeout)
        self.bot = bot
        self.guild = guild
        self.author = author
        self.required_role_ids = required_role_ids or []
        self.role_multipliers = role_multipliers or {}

        self.time = 0
        self.value = None
        self.clicked_users: list[int] = []
        self.timer = None
        self.winners: list[str] = []
        self.pyTime = 0.0
        self.message: Optional[discord.Message] = None
        self.Titel = ""
        self.Winner = "1"
        self.Time = ""
        self.Description = ""
        self.member = str(author.mention)
        self.Link: Optional[str] = None
        self.Leave = Leave()
        self.time_now = datetime.datetime.now().strftime("%A %d %b %Y %I:%M %p")

    def data(self, member, Titel, Winner, Time, Description, Link):
        self.member = member
        self.Titel = Titel
        self.Winner = Winner
        self.Time = Time
        self.Description = Description
        self.Link = Link
        t = datetime.datetime.now()
        self.time_now = t.strftime("%A %d %b %Y %I:%M %p")

    def Timer(self):
        if isinstance(self.Time, (int, float)):
            self.time = int(self.Time)
            self.pyTime = pyTime.time() + self.time
            return 1

        time_str = str(self.Time).lower().strip()
        time_parts = time_str.split()
        if not time_parts or not time_parts[0].isdigit():
            return None

        amount = int(time_parts[0])
        if time_str.endswith(("sec", "second", "seconds", "s")):
            self.time = amount
        elif time_str.endswith(("mn", "min", "minute", "minutes", "m")):
            self.time = amount * 60
        elif time_str.endswith(("h", "hour", "hours")):
            self.time = amount * 3600
        elif time_str.endswith(("d", "day", "days")):
            self.time = amount * 86400
        else:
            return None

        self.pyTime = pyTime.time() + self.time
        return 1

    def embed(self):
        avatar = getattr(self.author.display_avatar, "url", "https://cdn.discordapp.com/embed/avatars/0.png")
        embed = discord.Embed(
            title=f"🎉 {self.Titel}",
            description=self.Description or "",
            color=discord.Color.gold(),
        )
        embed.add_field(
            name="Ends",
            value=f"<t:{int(self.pyTime)}:R> (<t:{int(self.pyTime)}:f>)",
            inline=False,
        )
        embed.add_field(name="Hosted by", value=self.member, inline=True)
        embed.add_field(name="Winners", value=str(self.Winner), inline=True)

        # Requirements
        if self.required_role_ids:
            req_roles = [f"<@&{rid}>" for rid in self.required_role_ids]
            embed.add_field(
                name="🎟️ Requirements",
                value="Must have: " + ", ".join(req_roles),
                inline=False,
            )

        # Bonus multipliers
        if self.role_multipliers:
            mult_parts = [
                f"<@&{rid}> ({mult}x chance)" for rid, mult in self.role_multipliers.items()
            ]
            embed.add_field(
                name="⭐ Bonus Chances",
                value=", ".join(mult_parts),
                inline=False,
            )

        participants_count = len(self.clicked_users)
        embed.add_field(
            name="Entries",
            value=str(participants_count),
            inline=False,
        )

        embed.set_footer(text=f"Started {self.time_now}", icon_url=avatar)
        if self.Link:
            embed.set_image(url=self.Link)
        return embed

    @discord.ui.button(label="Enter", style=discord.ButtonStyle.blurple, emoji="🎉", custom_id="giveaway_enter")
    async def menu(self, interaction: discord.Interaction, button: discord.Button):
        user = interaction.user
        user_id = user.id

        # 1. Role requirements check
        member = interaction.user if isinstance(interaction.user, discord.Member) else None
        if not member and interaction.guild:
            member = interaction.guild.get_member(user_id)
            if not member:
                try:
                    member = await interaction.guild.fetch_member(user_id)
                except Exception:
                    member = None

        req_role_ids = [str(r) for r in (self.required_role_ids or [])]
        if not req_role_ids and database.db is not None and self.message:
            doc = await database.db.giveaways.find_one({"message_id": str(self.message.id)})
            if doc:
                req_role_ids = [str(r) for r in (doc.get("required_role_ids") or [])]

        if req_role_ids and member:
            is_admin = getattr(getattr(member, "guild_permissions", None), "administrator", False)
            if not is_admin:
                member_role_ids = {str(r.id) for r in getattr(member, "roles", [])}
                has_req = any(str(rid) in member_role_ids for rid in req_role_ids)
                if not has_req:
                    req_mentions = ", ".join([f"<@&{rid}>" for rid in req_role_ids])
                    await interaction.response.send_message(
                        f"⛔ You do not have the required role(s) to enter this giveaway: {req_mentions}",
                        ephemeral=True,
                    )
                    return

        # 2. Already entered handling
        if user_id in self.clicked_users:
            self.Leave.id[str(user_id)] = 0
            await interaction.response.send_message(
                content="You have already entered this giveaway!",
                ephemeral=True,
                view=self.Leave,
            )
            await self.Leave.waiting(user_id)
            if user_id in self.clicked_users and self.Leave.id.get(str(user_id)) == 1:
                self.clicked_users.remove(user_id)
                if database.db is not None and self.message:
                    try:
                        await database.db.giveaways.update_one(
                            {"message_id": str(self.message.id)},
                            {
                                "$pull": {"entrants": user_id},
                                "$set": {"Entries": len(self.clicked_users)},
                            },
                        )
                    except Exception:
                        pass
                embed = self.embed()
                if self.message:
                    try:
                        await self.message.edit(embed=embed)
                    except Exception:
                        pass
            return

        # 3. Add user to entrants
        self.clicked_users.append(user_id)

        if database.db is not None and self.message:
            try:
                await database.db.giveaways.update_one(
                    {"message_id": str(self.message.id)},
                    {
                        "$addToSet": {"entrants": user_id},
                        "$set": {"Entries": len(self.clicked_users)},
                    },
                )
            except Exception as e:
                logger.debug("Failed updating giveaway entrant in DB: %s", e)

        embed = self.embed()
        if self.message:
            try:
                await self.message.edit(embed=embed)
            except Exception:
                pass

        await interaction.response.send_message(
            "🎉 You have entered the giveaway!",
            ephemeral=True,
        )

    async def winner(self):
        self.timer = asyncio.create_task(asyncio.sleep(self.time))
        try:
            await self.timer
        except asyncio.CancelledError:
            return

        if not self.message:
            return

        doc = None
        if database.db is not None:
            doc = await database.db.giveaways.find_one({"message_id": str(self.message.id)})

        if not doc:
            doc = {
                "message_id": str(self.message.id),
                "guild_id": self.guild.id,
                "channel_id": self.message.channel.id,
                "creator_id": self.author.id,
                "title": self.Titel,
                "winners_count": int(self.Winner),
                "entrants": self.clicked_users,
                "role_multipliers": self.role_multipliers,
            }

        await conclude_giveaway_doc(self.bot, doc)
        self.value = False
        self.stop()
        self.Leave.stop()

    async def leave(self):
        self.value = False
        self.Leave.stop()
        self.stop()

    async def on_error(self, interaction: discord.Interaction, error: Exception, item=None):
        logger.warning("Giveaway view error: %s", error)


class Input(discord.ui.Modal, title="Create a Giveaway"):
    Title = discord.ui.TextInput(
        style=discord.TextStyle.short,
        label="Prize",
        placeholder="e.g. 1000 Credits or Discord Nitro",
    )
    Winner = discord.ui.TextInput(
        style=discord.TextStyle.short,
        label="Number of Winners",
        default="1",
    )
    Time = discord.ui.TextInput(
        style=discord.TextStyle.short,
        label="Duration",
        placeholder="e.g. 10 minutes, 2 hours, 3 days",
    )
    Link = discord.ui.TextInput(
        style=discord.TextStyle.short,
        label="Photo Link (Optional)",
        placeholder="Direct image URL (https://...)",
        required=False,
    )
    description = discord.ui.TextInput(
        style=discord.TextStyle.long,
        required=False,
        label="Description (Optional)",
        max_length=300,
    )

    def __init__(
        self,
        ctx,
        member: str,
        image: Optional[discord.Attachment] = None,
        required_role: Optional[discord.Role] = None,
        bonus_role: Optional[discord.Role] = None,
        multiplier: Optional[int] = None,
        timeout=None,
    ):
        self.image = image
        self.member = member
        self.ctx = ctx
        self.required_role_ids = [required_role.id] if required_role else []
        self.role_multipliers = {bonus_role.id: multiplier} if bonus_role and multiplier else {}
        self.MyView = MyView(
            bot=self.ctx.bot,
            guild=self.ctx.guild,
            author=self.ctx.author,
            required_role_ids=self.required_role_ids,
            role_multipliers=self.role_multipliers,
        )
        self.Exit = Exit()
        super().__init__(timeout=timeout)

    async def on_submit(self, interaction: discord.Interaction):
        image_url = None
        if self.image is not None:
            image_url = self.image.url
        elif str(self.Link).strip():
            if not str(self.Link).startswith("http"):
                await interaction.response.send_message(
                    "Image link must start with http/https.", ephemeral=True
                )
                return
            image_url = str(self.Link).strip()

        if not str(self.Winner.value).isdigit() or int(self.Winner.value) <= 0:
            await interaction.response.send_message(
                "Please enter a valid positive number for winners.", ephemeral=True
            )
            return

        view = self.MyView
        view.data(
            str(self.member),
            str(self.Title.value),
            str(self.Winner.value),
            str(self.Time.value),
            str(self.description.value or ""),
            image_url,
        )

        if view.Timer() is None:
            await interaction.response.send_message(
                "Invalid duration. Please enter time like '10 minutes', '2 hours', or '1 day'.",
                ephemeral=True,
            )
            return

        embed = view.embed()
        await interaction.response.send_message(embed=embed, view=view)
        message = await interaction.original_response()
        view.message = message

        # Save initial active state in database
        if database.db is not None:
            await database.db.giveaways.insert_one(
                {
                    "message_id": str(message.id),
                    "guild_id": interaction.guild_id,
                    "channel_id": interaction.channel_id,
                    "creator_id": interaction.user.id,
                    "title": str(self.Title.value),
                    "description": str(self.description.value or ""),
                    "winners_count": int(self.Winner.value),
                    "end_time": view.pyTime,
                    "required_role_ids": [str(r) for r in self.required_role_ids],
                    "role_multipliers": {str(k): int(v) for k, v in (self.role_multipliers or {}).items()},
                    "entrants": [],
                    "Entries": 0,
                    "status": "active",
                    "created_at": datetime.datetime.now(datetime.timezone.utc),
                }
            )

        Exit = self.Exit
        Exit.timeout = view.time
        await interaction.followup.send(
            f"✅ Giveaway created! ID: `{message.id}`", ephemeral=True, view=Exit
        )

        winner_task = asyncio.create_task(view.winner())

        await Exit.wait()
        if Exit.value is True:
            if interaction.user.id == self.ctx.author.id:
                channel = self.ctx.bot.get_channel(message.channel.id)
                if channel:
                    try:
                        msg = await channel.fetch_message(message.id)
                        await msg.delete()
                    except Exception:
                        pass
                view.value = False
                view.timer.cancel()
                await view.leave()
                Exit.stop()
                if database.db is not None:
                    await database.db.giveaways.update_one(
                        {"message_id": str(message.id)},
                        {"$set": {"status": "canceled"}},
                    )
        await winner_task


async def is_giveaway_manager(interaction: discord.Interaction) -> bool:
    """Checks if the user has permission to manage/create giveaways."""
    if not interaction.guild or not isinstance(interaction.user, discord.Member):
        return False
    if interaction.user.guild_permissions.administrator or interaction.user.guild_permissions.manage_guild:
        return True

    if database.db is not None:
        cfg = await database.db.giveaways_config.find_one({"guild_id": interaction.guild_id}) or {}
        manager_role_ids = cfg.get("manager_role_ids", [])
        user_role_ids = {r.id for r in interaction.user.roles}
        for rid in manager_role_ids:
            try:
                if int(rid) in user_role_ids:
                    return True
            except (ValueError, TypeError):
                continue

    return False


class Giveaway(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.giveaway_checker.start()

    def cog_unload(self):
        self.giveaway_checker.cancel()

    @tasks.loop(seconds=15)
    async def giveaway_checker(self):
        if database.db is None:
            return
        now_ts = pyTime.time()
        try:
            cursor = database.db.giveaways.find({
                "status": "active",
                "end_time": {"$lte": now_ts},
            })
            async for doc in cursor:
                try:
                    await conclude_giveaway_doc(self.bot, doc)
                except Exception as e:
                    logger.warning("Error in giveaway_checker concluding %s: %s", doc.get("message_id"), e)
        except Exception as e:
            logger.warning("Error in giveaway_checker loop: %s", e)

    @giveaway_checker.before_loop
    async def before_checker(self):
        await self.bot.wait_until_ready()

    @commands.Cog.listener()
    async def on_interaction(self, interaction: discord.Interaction):
        if interaction.type != discord.InteractionType.component:
            return
        data = interaction.data or {}
        if data.get("custom_id") != "giveaway_enter":
            return
        if interaction.response.is_done():
            return
        if not interaction.guild or not interaction.message:
            return

        msg_id = str(interaction.message.id)
        if database.db is None:
            return

        doc = await database.db.giveaways.find_one({"message_id": msg_id})
        if not doc:
            return

        # 1. Active check
        if doc.get("status") != "active" or pyTime.time() >= doc.get("end_time", 0):
            await interaction.response.send_message(
                "⛔ This giveaway has already ended.", ephemeral=True
            )
            return

        user_id = interaction.user.id
        member = interaction.user if isinstance(interaction.user, discord.Member) else None
        if not member and interaction.guild:
            try:
                member = await interaction.guild.fetch_member(user_id)
            except Exception:
                member = None

        # 2. Required role check
        req_role_ids = [str(r) for r in (doc.get("required_role_ids") or [])]
        if req_role_ids and member:
            is_admin = getattr(getattr(member, "guild_permissions", None), "administrator", False)
            if not is_admin:
                member_role_ids = {str(r.id) for r in getattr(member, "roles", [])}
                has_req = any(str(rid) in member_role_ids for rid in req_role_ids)
                if not has_req:
                    req_mentions = ", ".join([f"<@&{rid}>" for rid in req_role_ids])
                    await interaction.response.send_message(
                        f"⛔ You do not have the required role(s) to enter this giveaway: {req_mentions}",
                        ephemeral=True,
                    )
                    return

        # 3. Already entered check
        entrants = [int(u) for u in (doc.get("entrants") or doc.get("Entrants") or [])]
        if user_id in entrants:
            await interaction.response.send_message(
                "You have already entered this giveaway!", ephemeral=True
            )
            return

        entrants.append(user_id)

        await database.db.giveaways.update_one(
            {"message_id": msg_id},
            {
                "$set": {
                    "entrants": entrants,
                    "Entries": len(entrants),
                }
            },
        )

        # Update message embed
        try:
            embed = interaction.message.embeds[0] if interaction.message.embeds else None
            if embed:
                new_fields = []
                for f in embed.fields:
                    if f.name in ("Entries", "👥 Entries"):
                        new_fields.append({
                            "name": "Entries",
                            "value": str(len(entrants)),
                            "inline": False,
                        })
                    else:
                        new_fields.append({"name": f.name, "value": f.value, "inline": f.inline})
                embed.clear_fields()
                for f in new_fields:
                    embed.add_field(name=f["name"], value=f["value"], inline=f["inline"])
                await interaction.message.edit(embed=embed)
        except Exception:
            pass

        await interaction.response.send_message(
            "🎉 You have entered the giveaway!",
            ephemeral=True,
        )

    @app_commands.command(
        name="giveaway",
        description="Create an interactive giveaway with optional role requirements and bonus entries",
    )
    @app_commands.describe(
        image="Optional image attachment for the giveaway embed",
        required_role="Only members with this role can enter",
        bonus_role="Members with this role get extra entries",
        multiplier="Entry multiplier for the bonus role (e.g. 2 for 2x, 10 for 10x)",
    )
    async def giveaway(
        self,
        interaction: discord.Interaction,
        image: Optional[discord.Attachment] = None,
        required_role: Optional[discord.Role] = None,
        bonus_role: Optional[discord.Role] = None,
        multiplier: Optional[app_commands.Range[int, 2, 100]] = None,
    ):
        if not await is_giveaway_manager(interaction):
            await interaction.response.send_message(
                "⛔ You do not have permission to create giveaways on this server.",
                ephemeral=True,
            )
            return

        if image is not None and not image.content_type.startswith("image"):
            await interaction.response.send_message(
                "Please provide a valid image attachment.", ephemeral=True
            )
            return

        ctx = await self.bot.get_context(interaction)
        member = str(ctx.author.mention)
        modal = Input(
            ctx=ctx,
            member=member,
            image=image,
            required_role=required_role,
            bonus_role=bonus_role,
            multiplier=multiplier,
        )
        await interaction.response.send_modal(modal)

    @app_commands.command(
        name="giveaway_logs",
        description="Set or view the channel for giveaway results and entrants logs",
    )
    @app_commands.describe(
        channel="The channel where giveaway audit logs and rosters will be sent",
        off="Disable giveaway logs",
    )
    async def giveaway_logs(
        self,
        interaction: discord.Interaction,
        channel: Optional[discord.TextChannel] = None,
        off: bool = False,
    ):
        if not await is_giveaway_manager(interaction):
            await interaction.response.send_message(
                "⛔ You do not have permission to manage giveaways on this server.",
                ephemeral=True,
            )
            return

        if not interaction.guild:
            await interaction.response.send_message(
                "This command can only be used in a server.", ephemeral=True
            )
            return

        if off:
            if database.db is not None:
                await database.db.giveaways_config.update_one(
                    {"guild_id": interaction.guild_id},
                    {"$set": {"logs_channel_id": None}},
                    upsert=True,
                )
            await interaction.response.send_message("📁 Giveaway logs disabled.", ephemeral=True)
            return

        if channel:
            if database.db is not None:
                await database.db.giveaways_config.update_one(
                    {"guild_id": interaction.guild_id},
                    {"$set": {"logs_channel_id": channel.id}},
                    upsert=True,
                )
            await interaction.response.send_message(
                f"📁 Giveaway logs channel set to {channel.mention}.", ephemeral=True
            )
            return

        # View current
        cfg = {}
        if database.db is not None:
            cfg = await database.db.giveaways_config.find_one({"guild_id": interaction.guild_id}) or {}
        cur_id = cfg.get("logs_channel_id")
        cur_ch = interaction.guild.get_channel(int(cur_id)) if cur_id else None
        ch_text = cur_ch.mention if cur_ch else "*(Not configured)*"
        await interaction.response.send_message(
            f"📁 Current giveaway logs channel: {ch_text}\nUse `/giveaway_logs channel:#channel` to configure or `off:True` to disable.",
            ephemeral=True,
        )

    @app_commands.command(name="reroll", description="Reroll a completed giveaway to select new winners")
    @app_commands.describe(
        giveaway_id="The message ID of the completed giveaway",
        number_of_winners="Number of new winners to select",
    )
    async def reroll(
        self,
        interaction: discord.Interaction,
        giveaway_id: str,
        number_of_winners: Optional[int] = None,
    ):
        if not await is_giveaway_manager(interaction):
            await interaction.response.send_message(
                "⛔ You do not have permission to manage giveaways on this server.",
                ephemeral=True,
            )
            return

        if database.db is None:
            await interaction.response.send_message("Database unavailable.", ephemeral=True)
            return

        doc = await database.db.giveaways.find_one({"message_id": giveaway_id})
        if not doc:
            await interaction.response.send_message(
                "Could not find a giveaway message with that ID.", ephemeral=True
            )
            return

        entrants = doc.get("Entrants") or doc.get("entrants") or []
        if not entrants:
            await interaction.response.send_message("No entrants found for this giveaway.", ephemeral=True)
            return

        count = number_of_winners or int(doc.get("Winner", 1))
        count = number_of_winners or int(doc.get("Winner") or doc.get("winners_count") or 1)
        role_multipliers = doc.get("role_multipliers") or {}
        new_winners, _ = await select_giveaway_winners(interaction.guild, entrants, role_multipliers, count)
        if not new_winners:
            await interaction.response.send_message("Could not select any reroll winners.", ephemeral=True)
            return

        winner_mentions = [f"<@{w}>" for w in new_winners]

        title = doc.get("Title") or doc.get("title") or "Giveaway"
        await interaction.response.send_message(
            f"🎊 **Reroll Complete!** Congratulations {' '.join(winner_mentions)}! You won the **{title}**! 🎊"
        )

        await database.db.giveaways.update_one(
            {"message_id": giveaway_id},
            {"$set": {"Winners": [str(w) for w in new_winners]}}
        )

        channel_id = doc.get("channel_id") or interaction.channel.id
        channel = self.bot.get_channel(channel_id)
        if channel:
            try:
                message = await channel.fetch_message(int(giveaway_id))
                for winner in new_winners:
                    try:
                        user = await self.bot.fetch_user(winner)
                        embed = discord.Embed(
                            title="🎊 Congratulations on Reroll! 🎊",
                            description=f"You won the reroll for **{title}**!",
                            color=discord.Color.gold(),
                        )
                        embed.add_field(
                            name="Giveaway Link",
                            value=f"[View Giveaway]({message.jump_url})",
                            inline=False,
                        )
                        await user.send(embed=embed)
                    except Exception:
                        pass
            except Exception:
                pass


async def reroll_context_callback(interaction: discord.Interaction, message: discord.Message):
    if not await is_giveaway_manager(interaction):
        await interaction.response.send_message(
            "⛔ You do not have permission to manage giveaways on this server.",
            ephemeral=True,
        )
        return

    if database.db is None:
        await interaction.response.send_message("Database is unavailable.", ephemeral=True)
        return

    doc = await database.db.giveaways.find_one({"message_id": str(message.id)})
    if not doc:
        await interaction.response.send_message(
            "This message is not a completed giveaway message.", ephemeral=True
        )
        return

    entrants = doc.get("Entrants") or doc.get("entrants") or []
    if not entrants:
        await interaction.response.send_message("No entrants found for this giveaway.", ephemeral=True)
        return

    count = int(doc.get("Winner") or doc.get("winners_count") or 1)
    role_multipliers = doc.get("role_multipliers") or {}
    new_winners, _ = await select_giveaway_winners(interaction.guild, entrants, role_multipliers, count)
    if not new_winners:
        await interaction.response.send_message("Could not select any reroll winners.", ephemeral=True)
        return

    winner_mentions = [f"<@{w}>" for w in new_winners]

    title = doc.get("Title") or doc.get("title") or "Giveaway"
    await interaction.response.send_message(
        f"🎊 **Reroll Complete!** Congratulations {' '.join(winner_mentions)}! You won the **{title}**! 🎊"
    )

    await database.db.giveaways.update_one(
        {"message_id": str(message.id)},
        {"$set": {"Winners": [str(w) for w in new_winners]}}
    )

    for winner in new_winners:
        try:
            user = await interaction.client.fetch_user(winner)
            embed = discord.Embed(
                title="🎊 Congratulations on Reroll! 🎊",
                description=f"You won the reroll for **{title}**!",
                color=discord.Color.gold(),
            )
            embed.add_field(
                name="Giveaway Link",
                value=f"[View Giveaway]({message.jump_url})",
                inline=False,
            )
            await user.send(embed=embed)
        except Exception:
            pass


async def launch_dashboard_giveaway(
    bot: discord.Client,
    guild_id: int,
    channel_id: int,
    creator_id: int,
    title: str,
    winners_count: int,
    duration_seconds: int,
    description: str = "",
    image_url: str = "",
    required_role_ids: list[int] = None,
    role_multipliers: dict[int, int] = None,
) -> dict:
    """Helper to launch giveaways programmatically from the dashboard control plane."""
    guild = bot.get_guild(guild_id)
    if not guild:
        raise ValueError("Guild not found or bot not in guild")
    channel = guild.get_channel(channel_id)
    if not channel or not isinstance(channel, discord.TextChannel):
        raise ValueError("Target channel not found or is not a text channel")

    creator = guild.get_member(creator_id)
    if not creator:
        try:
            creator = await bot.fetch_user(creator_id)
        except Exception:
            creator = None
    creator_mention = creator.mention if creator else f"<@{creator_id}>"

    view = MyView(
        bot=bot,
        guild=guild,
        author=creator or guild.me,
        required_role_ids=required_role_ids or [],
        role_multipliers=role_multipliers or {},
    )
    view.data(
        member=creator_mention,
        Titel=title,
        Winner=str(winners_count),
        Time=duration_seconds,
        Description=description,
        Link=image_url if image_url and image_url.startswith("http") else None,
    )
    view.Timer()
    embed = view.embed()
    msg = await channel.send(embed=embed, view=view)
    view.message = msg

    doc = {
        "message_id": str(msg.id),
        "guild_id": guild_id,
        "channel_id": channel_id,
        "creator_id": creator_id,
        "title": title,
        "description": description,
        "winners_count": winners_count,
        "end_time": view.pyTime,
        "required_role_ids": [str(r) for r in (required_role_ids or [])],
        "role_multipliers": {str(k): int(v) for k, v in (role_multipliers or {}).items()},
        "entrants": [],
        "Entries": 0,
        "status": "active",
        "created_at": datetime.datetime.now(datetime.timezone.utc),
    }
    if database.db is not None:
        await database.db.giveaways.insert_one(doc)

    asyncio.create_task(view.winner())
    return {"message_id": str(msg.id), "jump_url": msg.jump_url}


async def setup(bot):
    await bot.add_cog(Giveaway(bot))
    bot.tree.add_command(
        app_commands.ContextMenu(name="reroll", callback=reroll_context_callback)
    )

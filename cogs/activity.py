from datetime import datetime, timedelta
import datetime as weekly

import discord
from discord import app_commands
from discord.ext import commands, tasks

from core import database


class Activity(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.voice_start_times = {}
        self.weekly_reset.start()

    def cog_unload(self):
        self.weekly_reset.cancel()

    # ---------- Weekly activity stats ----------

    def _get_week_start(self):
        """Calculate week start date (Monday-based)"""
        today = datetime.now()
        return (today - timedelta(days=today.weekday())).strftime("%Y-%m-%d")

    @tasks.loop(time=weekly.time(hour=0, minute=0))
    async def weekly_reset(self):
        """Delete previous weeks' stats every Monday 00:00"""
        today = datetime.now()
        if today.weekday() == 0:  # Monday
            try:
                current_week = self._get_week_start()
                result = await database.db.activity.delete_many({"week_start": {"$ne": current_week}})
                print(f"Weekly reset completed. Deleted {result.deleted_count} old entries.")
            except Exception as e:
                print(f"Error during weekly reset: {e}")

    @commands.Cog.listener()
    async def on_voice_state_update(self, member, before, after):
        """Track voice time for weekly stats"""
        if member.bot or member.guild is None:
            return
        current_week = self._get_week_start()
        if before.channel is None and after.channel is not None:
            self.voice_start_times[member.id] = datetime.now()
        elif before.channel and after.channel is None:
            if member.id in self.voice_start_times:
                try:
                    duration = datetime.now() - self.voice_start_times[member.id]
                    await self._upsert_voice(member.id, member.guild.id, duration.total_seconds(), current_week)
                finally:
                    del self.voice_start_times[member.id]

    @commands.Cog.listener()
    async def on_message(self, message):
        """Count messages for weekly stats"""
        if message.author.bot or message.guild is None:
            return
        try:
            await database.db.activity.update_one(
                {"guild_id": message.guild.id, "user_id": message.author.id, "week_start": self._get_week_start()},
                {"$inc": {"messages": 1}},
                upsert=True,
            )
        except Exception as e:
            print(f"Activity message error: {e}")

    async def _upsert_voice(self, user_id, guild_id, seconds, week_start):
        try:
            await database.db.activity.update_one(
                {"guild_id": guild_id, "user_id": user_id, "week_start": week_start},
                {"$inc": {"voice_time": seconds}},
                upsert=True,
            )
        except Exception as e:
            print(f"Activity voice error: {e}")

    def _calculate_percentage(self, voice_seconds, messages):
        """Calculate activity percentage"""
        max_voice = 604800  # 7 days in seconds
        max_messages = 3000
        voice_percent = (voice_seconds / max_voice) * 70
        message_percent = (messages / max_messages) * 30
        return min(voice_percent + message_percent, 100)

    @app_commands.command(name="activity", description="Check weekly voice & message stats")
    async def activity(self, interaction: discord.Interaction, member: discord.Member = None):
        member = member or interaction.user
        doc = await database.db.activity.find_one(
            {"guild_id": interaction.guild_id, "user_id": member.id, "week_start": self._get_week_start()}
        )
        if not doc:
            await interaction.response.send_message(f"{member.mention} has no activity data this week!",
                                                    ephemeral=True)
            return
        voice_seconds = int(doc.get("voice_time", 0))
        messages = int(doc.get("messages", 0))
        total_percent = self._calculate_percentage(voice_seconds, messages)
        await interaction.response.send_message(
            f"**Weekly Activity** — {member.mention}\n"
            f"Voice: {voice_seconds // 3600}h {voice_seconds % 3600 // 60}m\n"
            f"Messages: {messages}\n"
            f"Total: {total_percent:.1f}%"
        )


async def setup(bot):
    await bot.add_cog(Activity(bot))

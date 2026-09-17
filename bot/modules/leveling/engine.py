import logging
import random
import time

import discord
from discord.ext import commands, tasks

from bot.modules.leveling.rewards import select_reward_role_ids
from core import database

logger = logging.getLogger(__name__)


class LevelingEngineCog(commands.Cog):
    def __init__(self, bot, module):
        self.bot = bot
        self.module = module
        self.xp_cooldowns = {}  # {(guild_id, user_id): last_timestamp}
        self.voice_xp.start()

    @property
    def registry(self):
        return getattr(self.bot, "modules_registry", None)

    def cog_unload(self):
        self.voice_xp.cancel()

    async def apply_role_rewards(
        self, guild: discord.Guild, member: discord.Member, level: int, config: dict | None = None
    ):
        try:
            if config is None and self.registry:
                config = await self.registry.get_config(guild.id, "leveling")

            rewards = config.get("rewards", {}) if config else {}
            if not rewards:
                settings = await database.get_settings(guild.id)
                rewards = settings.get("level_roles", {})

            role_ids = select_reward_role_ids(rewards, level)
            to_add = []
            for role_id in role_ids:
                role = guild.get_role(role_id)
                if role is None:
                    logger.warning(
                        "Level reward role %s not found in guild %s", role_id, guild.id
                    )
                    continue
                if role not in member.roles:
                    to_add.append(role)

            if to_add:
                try:
                    await member.add_roles(*to_add, reason="Level reward")
                except discord.Forbidden:
                    logger.warning(
                        "Permission or hierarchy error adding roles to %s in guild %s",
                        member,
                        guild.id,
                    )
                except discord.HTTPException as e:
                    logger.warning("Discord HTTPException adding roles to %s: %s", member, e)
                except Exception as e:
                    logger.warning("Unexpected error adding roles to %s: %s", member, e)
        except Exception as e:
            logger.exception("Error in apply_role_rewards: %s", e)

    @tasks.loop(minutes=1)
    async def voice_xp(self):
        if not self.registry:
            return

        for guild in self.bot.guilds:
            try:
                if not await self.registry.is_enabled(guild.id, "leveling"):
                    continue

                config = await self.registry.get_config(guild.id, "leveling")
                if not config.get("voice_xp_enabled", True):
                    continue

                voice_rate = config.get("voice_xp_per_minute", 30)
                if voice_rate <= 0:
                    continue

                afk_channel_id = guild.afk_channel.id if guild.afk_channel else None
                for channel in guild.voice_channels:
                    if channel.id == afk_channel_id:
                        continue
                    for member in channel.members:
                        if member.bot:
                            continue
                        try:
                            level_before, level_after = await database.add_xp(
                                guild.id, member.id, voice_rate
                            )
                            if level_after > level_before:
                                await self.apply_role_rewards(guild, member, level_after, config)
                                announce_channel_id = config.get("announce_channel_id")
                                if announce_channel_id:
                                    target_ch = guild.get_channel(
                                        int(announce_channel_id)
                                    ) or self.bot.get_channel(int(announce_channel_id))
                                    if target_ch:
                                        msg_tmpl = (
                                            config.get("announce_message")
                                            or "{user} has leveled up to level {level}!"
                                        )
                                        msg = (
                                            msg_tmpl.replace("{user}", member.mention)
                                            .replace("{level}", str(level_after))
                                            .replace("{server}", guild.name)
                                        )
                                        await target_ch.send(msg)
                        except Exception as e:
                            logger.warning("Voice XP error for %s: %s", member, e)
            except Exception as e:
                logger.warning("Error processing voice XP for guild %s: %s", guild.id, e)

        cutoff = time.time() - 3600
        for key in [k for k, ts in self.xp_cooldowns.items() if ts < cutoff]:
            del self.xp_cooldowns[key]

    @commands.Cog.listener()
    async def on_message(self, message):
        if message.author.bot or message.guild is None:
            return
        if not self.registry:
            return

        if not await self.registry.is_enabled(message.guild.id, "leveling"):
            return

        config = await self.registry.get_config(message.guild.id, "leveling")
        cooldown_seconds = config.get("cooldown_seconds", 60)
        key = (message.guild.id, message.author.id)
        now = time.time()

        if now - self.xp_cooldowns.get(key, 0) < cooldown_seconds:
            return
        self.xp_cooldowns[key] = now

        xp_min = config.get("xp_min", 1)
        xp_max = config.get("xp_max", 30)
        if xp_max < xp_min:
            xp_max = xp_min
        amount = random.randint(xp_min, xp_max)

        try:
            level_before, level_after = await database.add_xp(
                message.guild.id, message.author.id, amount
            )
        except Exception as e:
            logger.warning("XP error in guild %s: %s", message.guild.id, e)
            return

        if level_after > level_before:
            announce_channel_id = config.get("announce_channel_id")
            target_ch = None
            if announce_channel_id:
                target_ch = message.guild.get_channel(
                    int(announce_channel_id)
                ) or self.bot.get_channel(int(announce_channel_id))

            if target_ch is not None:
                msg_tmpl = (
                    config.get("announce_message") or "{user} has leveled up to level {level}!"
                )
                msg = (
                    msg_tmpl.replace("{user}", message.author.mention)
                    .replace("{level}", str(level_after))
                    .replace("{server}", message.guild.name)
                )
                try:
                    await target_ch.send(msg)
                except Exception as e:
                    logger.warning("Failed sending level-up to announce channel: %s", e)
                    try:
                        await message.channel.send(
                            f"{message.author.mention} has leveled up to level {level_after}"
                        )
                    except Exception:
                        pass
            else:
                try:
                    await message.channel.send(
                        f"{message.author.mention} has leveled up to level {level_after}"
                    )
                except Exception as e:
                    logger.warning("Failed sending level-up to channel: %s", e)

            await self.apply_role_rewards(message.guild, message.author, level_after, config)

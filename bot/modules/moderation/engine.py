import datetime
import logging
import discord
from discord.ext import commands

from bot.modules.moderation.helpers import (
    DISCORD_INVITE_REGEX,
    SlidingWindowRateLimiter,
    contains_bad_word,
    log_moderation_action,
)

logger = logging.getLogger(__name__)


class AutoModEngineCog(commands.Cog):
    def __init__(self, bot, module):
        self.bot = bot
        self.module = module
        self.limiter = SlidingWindowRateLimiter()

    @property
    def registry(self):
        return getattr(self.bot, "modules_registry", None)

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if message.author.bot or not message.guild or not isinstance(message.author, discord.Member):
            return

        # Bypass server administrators
        if message.author.guild_permissions.administrator:
            return

        if not self.registry or not await self.registry.is_enabled(message.guild.id, "moderation"):
            return

        cfg = await self.registry.get_config(message.guild.id, "moderation")
        guild = message.guild
        member = message.author
        content = message.content or ""

        # =====================================================================
        # 1. ANTI-SPAM (Sliding window rate limit)
        # =====================================================================
        anti_spam = cfg.get("anti_spam") or {}
        if anti_spam.get("enabled"):
            max_msgs = int(anti_spam.get("max_messages", 5))
            window_sec = int(anti_spam.get("seconds", 5))
            is_spam, violation_count = self.limiter.is_spamming(
                guild.id, member.id, max_msgs, window_sec
            )

            if is_spam:
                action = anti_spam.get("action", "timeout")
                t_mins = int(anti_spam.get("timeout_minutes", 5)) * min(violation_count, 4)

                try:
                    await message.delete()
                except Exception:
                    pass

                if action in ("timeout", "warn"):
                    try:
                        duration = datetime.timedelta(minutes=t_mins)
                        await member.timeout(duration, reason="AutoMod: Message spam detected")
                        await message.channel.send(
                            f"🛡️ {member.mention} has been timed out for **{t_mins} minutes** for rapid message spam.",
                            delete_after=10,
                        )
                        await log_moderation_action(
                            bot=self.bot,
                            guild=guild,
                            action="automod",
                            moderator="AutoMod",
                            target=member,
                            reason=f"Chat spam detected ({max_msgs} msgs in {window_sec}s)",
                            duration=f"{t_mins} minutes",
                            extra_details=f"Violation #{violation_count}. Action: {action}",
                        )
                    except Exception as e:
                        logger.warning("Error applying AutoMod spam timeout: %s", e)
                return

        # =====================================================================
        # 2. ANTI-INVITE
        # =====================================================================
        anti_invite = cfg.get("anti_invite") or {}
        if anti_invite.get("enabled"):
            whitelist_ch = [int(cid) for cid in anti_invite.get("whitelisted_channels", [])]
            whitelist_roles = [int(rid) for rid in anti_invite.get("whitelisted_roles", [])]
            user_roles = [r.id for r in member.roles]

            is_whitelisted = (
                message.channel.id in whitelist_ch
                or any(rid in user_roles for rid in whitelist_roles)
            )

            if not is_whitelisted and DISCORD_INVITE_REGEX.search(content):
                try:
                    await message.delete()
                except Exception:
                    pass

                action = anti_invite.get("action", "delete")
                if action == "timeout":
                    try:
                        await member.timeout(datetime.timedelta(minutes=10), reason="AutoMod: Discord invite link")
                    except Exception:
                        pass

                await message.channel.send(
                    f"🛡️ {member.mention} Discord invite links are not permitted here.",
                    delete_after=8,
                )
                await log_moderation_action(
                    bot=self.bot,
                    guild=guild,
                    action="automod",
                    moderator="AutoMod",
                    target=member,
                    reason="Posted unauthorized Discord invite link",
                    extra_details=f"In #{message.channel.name}. Action: {action}",
                )
                return

        # =====================================================================
        # 3. ANTI-MENTION (Mass mentions)
        # =====================================================================
        anti_mention = cfg.get("anti_mention") or {}
        if anti_mention.get("enabled"):
            max_mentions = int(anti_mention.get("max_mentions", 5))
            if len(message.mentions) >= max_mentions:
                try:
                    await message.delete()
                except Exception:
                    pass

                action = anti_mention.get("action", "warn")
                if action == "timeout":
                    try:
                        await member.timeout(datetime.timedelta(minutes=10), reason="AutoMod: Mass mentions")
                    except Exception:
                        pass

                await message.channel.send(
                    f"🛡️ {member.mention} Mass mentions are prohibited.",
                    delete_after=8,
                )
                await log_moderation_action(
                    bot=self.bot,
                    guild=guild,
                    action="automod",
                    moderator="AutoMod",
                    target=member,
                    reason=f"Mass mentions detected ({len(message.mentions)} mentions)",
                    extra_details=f"Action: {action}",
                )
                return

        # =====================================================================
        # 4. BAD WORDS FILTER
        # =====================================================================
        bad_words_cfg = cfg.get("bad_words") or {}
        if bad_words_cfg.get("enabled"):
            words = bad_words_cfg.get("words", [])
            has_bad_word, matched = contains_bad_word(content, words)
            if has_bad_word:
                try:
                    await message.delete()
                except Exception:
                    pass

                action = bad_words_cfg.get("action", "delete")
                if action == "timeout":
                    try:
                        await member.timeout(datetime.timedelta(minutes=5), reason=f"AutoMod: Inappropriate language")
                    except Exception:
                        pass

                await message.channel.send(
                    f"🛡️ {member.mention} Your message was removed for containing prohibited language.",
                    delete_after=8,
                )
                await log_moderation_action(
                    bot=self.bot,
                    guild=guild,
                    action="automod",
                    moderator="AutoMod",
                    target=member,
                    reason=f"Prohibited word detected: ||{matched}||",
                    extra_details=f"Action: {action}",
                )
                return

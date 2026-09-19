import datetime
import logging
import re
import time
from typing import Optional

import discord

from core import database

logger = logging.getLogger(__name__)

DISCORD_INVITE_REGEX = re.compile(
    r"(?:https?://)?(?:www\.)?(?:discord\.(?:gg|io|me|li)|discord(?:app)?\.com/invite)/[a-zA-Z0-9-]+",
    re.IGNORECASE,
)

LEET_REPLACEMENTS = {
    "@": "a",
    "4": "a",
    "8": "b",
    "(": "c",
    "3": "e",
    "1": "i",
    "!": "i",
    "|": "i",
    "0": "o",
    "$": "s",
    "5": "s",
    "7": "t",
    "+": "t",
    "v": "u",
}


def normalize_text(text: str) -> str:
    """Normalizes text by converting leetspeak characters and removing separating punctuation."""
    lowered = text.lower()
    for char, rep in LEET_REPLACEMENTS.items():
        lowered = lowered.replace(char, rep)
    # Strip spaces and symbols for contiguous matching
    alphanumeric = re.sub(r"[^a-z0-9]", "", lowered)
    return alphanumeric


def contains_bad_word(content: str, bad_words: list[str]) -> tuple[bool, Optional[str]]:
    """Checks if message contains any blacklisted words via word boundaries or normalized forms."""
    if not content or not bad_words:
        return False, None

    cleaned_words = [w.strip().lower() for w in bad_words if w.strip()]
    if not cleaned_words:
        return False, None

    # 1. Exact boundary matching on raw content
    for word in cleaned_words:
        pattern = r"\b" + re.escape(word) + r"\b"
        if re.search(pattern, content, re.IGNORECASE):
            return True, word

    # 2. Normalized matching (catches f.u.c.k, f u c k, etc.)
    #    Words of 4+ normalized characters match as substrings; shorter words
    #    require word boundaries so entries like "ass" do not fire inside
    #    innocent words such as "class", "bass" or "passport".
    norm_content = normalize_text(content)
    for word in cleaned_words:
        norm_word = normalize_text(word)
        if not norm_word:
            continue
        if len(norm_word) >= 4:
            if norm_word in norm_content:
                return True, word
        elif re.search(r"\b" + re.escape(norm_word) + r"\b", norm_content):
            return True, word

    return False, None


def validate_regex_pattern(pattern: str) -> tuple[bool, str]:
    """Validates regex pattern syntax and checks safety against catastrophic backtracking."""
    if not pattern or not isinstance(pattern, str):
        return False, "Pattern cannot be empty."

    cleaned = pattern.strip()
    if len(cleaned) > 250:
        return False, "Pattern exceeds maximum allowed length (250 characters)."

    try:
        compiled = re.compile(cleaned, re.IGNORECASE)
    except re.error as e:
        return False, f"Invalid regex syntax: {e}"

    # Basic ReDoS safety check: test against a moderate test string
    test_str = "a" * 50 + " " + "b" * 50
    try:
        compiled.search(test_str)
    except Exception as e:
        return False, f"Pattern execution error: {e}"

    return True, ""


def check_regex_violations(content: str, rules: list[dict]) -> tuple[bool, Optional[dict], Optional[str]]:
    """Evaluates message content against a list of custom regex rules.
    Returns (has_violation, matched_rule, matched_snippet).
    """
    if not content or not rules:
        return False, None, None

    for rule in rules:
        if not isinstance(rule, dict):
            continue
        if not rule.get("enabled", True):
            continue

        pattern_str = rule.get("pattern")
        if not pattern_str or not isinstance(pattern_str, str):
            continue

        valid, _ = validate_regex_pattern(pattern_str)
        if not valid:
            continue

        try:
            match = re.search(pattern_str, content, re.IGNORECASE)
            if match:
                matched_snippet = match.group(0)
                return True, rule, matched_snippet
        except Exception as e:
            logger.warning("Error evaluating regex rule '%s': %s", rule.get("name"), e)

    return False, None, None


class SlidingWindowRateLimiter:
    """Sliding-window in-memory message rate limiter for anti-spam."""

    VIOLATION_DECAY_SECONDS = 600  # escalation counter resets after 10 quiet minutes
    MAX_TRACKED_KEYS = 4096

    def __init__(self):
        self._history: dict[tuple[int, int], list[float]] = {}
        self._violations: dict[tuple[int, int], int] = {}
        self._last_violation: dict[tuple[int, int], float] = {}

    def is_spamming(
        self, guild_id: int, user_id: int, max_messages: int, window_seconds: int
    ) -> tuple[bool, int]:
        """Returns (is_spamming: bool, violation_count: int)."""
        now = time.time()
        key = (guild_id, user_id)
        timestamps = self._history.get(key, [])

        # Prune old timestamps outside the window
        cutoff = now - window_seconds
        timestamps = [t for t in timestamps if t > cutoff]
        timestamps.append(now)
        self._history[key] = timestamps

        if len(timestamps) > max_messages:
            # Violations decay after a quiet period so a single bad minute does
            # not permanently inflate future timeout durations.
            if now - self._last_violation.get(key, 0.0) > self.VIOLATION_DECAY_SECONDS:
                self._violations[key] = 0
            violations = self._violations.get(key, 0) + 1
            self._violations[key] = violations
            self._last_violation[key] = now
            self._prune(now)
            return True, violations

        return False, self._violations.get(key, 0)

    def _prune(self, now: float):
        """Drop state for users with no recent activity to keep memory bounded."""
        if len(self._history) <= self.MAX_TRACKED_KEYS:
            return
        stale = [k for k, ts in self._history.items() if not ts or ts[-1] < now - 3600]
        for k in stale:
            self._history.pop(k, None)
            self._violations.pop(k, None)
            self._last_violation.pop(k, None)

    def reset(self, guild_id: int, user_id: int):
        key = (guild_id, user_id)
        self._history.pop(key, None)
        self._violations.pop(key, None)
        self._last_violation.pop(key, None)


async def get_next_case_id(guild_id: int) -> int:
    """Generates an atomic, incremental moderation case ID per guild."""
    if database.db is None:
        return 1
    doc = await database.db.moderation_cases_counter.find_one_and_update(
        {"guild_id": guild_id},
        {"$inc": {"counter": 1}},
        upsert=True,
        return_document=True,
    )
    return doc.get("counter", 1)


async def log_moderation_action(
    bot: discord.Client,
    guild: discord.Guild,
    action: str,
    moderator: discord.Member | discord.User | str,
    target: discord.Member | discord.User | int,
    reason: str = "No reason provided",
    duration: Optional[str] = None,
    extra_details: Optional[str] = None,
) -> int:
    """Logs a moderation action to MongoDB and dispatches a rich embed to the configured mod logs channel."""
    case_id = await get_next_case_id(guild.id)
    now = datetime.datetime.now(datetime.timezone.utc)

    target_id = target.id if hasattr(target, "id") else int(target)
    moderator_id = (
        moderator.id if hasattr(moderator, "id") else (bot.user.id if moderator == "AutoMod" else 0)
    )
    moderator_name = (
        moderator.name if hasattr(moderator, "name") else str(moderator)
    )

    doc = {
        "guild_id": guild.id,
        "case_id": case_id,
        "user_id": target_id,
        "moderator_id": moderator_id,
        "moderator_name": moderator_name,
        "action": action.lower(),
        "reason": reason,
        "duration": duration,
        "extra_details": extra_details,
        "created_at": now,
    }

    if database.db is not None:
        try:
            await database.db.moderation_cases.insert_one(doc)
        except Exception as e:
            logger.warning("Error saving moderation case: %s", e)

    # Post to mod logs channel if configured (stored in module_configs via the registry)
    try:
        config_doc = {}
        registry = getattr(bot, "modules_registry", None)
        if registry is not None:
            try:
                config_doc = await registry.get_config(guild.id, "moderation") or {}
            except Exception as e:
                logger.warning("Error reading moderation config via registry: %s", e)
        if not config_doc and database.db is not None:
            raw_doc = await database.db.module_configs.find_one(
                {"guild_id": {"$in": [guild.id, str(guild.id)]}, "module": "moderation"}
            )
            config_doc = (raw_doc or {}).get("config") or {}
        logs_ch_id = config_doc.get("mod_logs_channel_id")
        if logs_ch_id:
            ch = guild.get_channel(int(logs_ch_id))
            if ch and isinstance(ch, discord.TextChannel):
                action_colors = {
                    "ban": discord.Color.red(),
                    "unban": discord.Color.green(),
                    "kick": discord.Color.orange(),
                    "timeout": discord.Color.yellow(),
                    "untimeout": discord.Color.teal(),
                    "warn": discord.Color.gold(),
                    "clear": discord.Color.blue(),
                    "automod": discord.Color.dark_red(),
                }
                color = action_colors.get(action.lower(), discord.Color.dark_grey())
                embed = discord.Embed(
                    title=f"🛡️ Case #{case_id} | {action.upper()}",
                    color=color,
                    timestamp=now,
                )
                embed.add_field(name="User", value=f"<@{target_id}> (`{target_id}`)", inline=True)
                mod_display = f"<@{moderator_id}>" if moderator_id else moderator_name
                embed.add_field(name="Moderator", value=mod_display, inline=True)
                if duration:
                    embed.add_field(name="Duration", value=duration, inline=True)
                embed.add_field(name="Reason", value=reason, inline=False)
                if extra_details:
                    embed.add_field(name="Details", value=extra_details[:1000], inline=False)

                embed.set_footer(text=f"Neverland Moderation • Case #{case_id}")
                await ch.send(embed=embed)
    except Exception as e:
        logger.warning("Error dispatching mod log embed: %s", e)

    return case_id

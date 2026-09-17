import copy
from datetime import datetime, timezone
import logging
from typing import Optional

from bot.modules.base import Module
from bot.modules.leveling.module import LevelingModule
from bot.modules.reaction_roles.module import ReactionRolesModule
from bot.modules.temp_voice.module import TempVoiceModule
from bot.modules.tickets.module import TicketsModule
from bot.modules.welcome.module import WelcomeModule
from core import database

logger = logging.getLogger(__name__)


class Registry:
    def __init__(self, bot, modules: list[Module]):
        self.bot = bot
        self.modules: dict[str, Module] = {mod.name: mod for mod in modules}
        self._enabled_cache: dict[tuple[int, str], bool] = {}
        self._config_cache: dict[tuple[int, str], dict] = {}
        self._cogs_registered = False

    def get_module(self, name: str) -> Optional[Module]:
        return self.modules.get(name)

    def get_modules(self) -> list[Module]:
        return list(self.modules.values())

    async def register_cogs(self) -> None:
        """Register cogs for all modules. Idempotent."""
        if self._cogs_registered:
            return
        for mod in self.modules.values():
            try:
                await mod.setup()
            except Exception as e:
                logger.exception("Error during setup for module %s: %s", mod.name, e)
        self._cogs_registered = True

    def invalidate_cache(
        self, guild_id: Optional[int] = None, name: Optional[str] = None
    ) -> None:
        if guild_id is None and name is None:
            self._enabled_cache.clear()
            self._config_cache.clear()
        else:
            for k in list(self._enabled_cache.keys()):
                if (guild_id is None or k[0] == guild_id) and (name is None or k[1] == name):
                    self._enabled_cache.pop(k, None)
            for k in list(self._config_cache.keys()):
                if (guild_id is None or k[0] == guild_id) and (name is None or k[1] == name):
                    self._config_cache.pop(k, None)

    async def _check_legacy_enabled(self, guild_id: int, name: str) -> bool:
        if database.db is None:
            return False
        try:
            if name == "welcome":
                settings = await database.get_settings(guild_id)
                return bool(settings.get("welcome_channel_id"))
            elif name == "leveling":
                count = await database.db.levels.count_documents(
                    {"guild_id": {"$in": [guild_id, str(guild_id)]}}, limit=1
                )
                if count > 0:
                    return True
                settings = await database.get_settings(guild_id)
                return bool(settings.get("level_roles"))
            elif name == "reaction_roles":
                count = await database.db.reaction_roles.count_documents(
                    {"guild_id": {"$in": [guild_id, str(guild_id)]}}, limit=1
                )
                return count > 0
            elif name == "tickets":
                count = await database.db.tickets.count_documents(
                    {"guild_id": {"$in": [guild_id, str(guild_id)]}}, limit=1
                )
                return count > 0
        except Exception as e:
            logger.warning(
                "Error checking legacy enabled state for (%s, %s): %s", guild_id, name, e
            )
        return False

    async def is_enabled(self, guild_id: int, name: str) -> bool:
        try:
            guild_id = int(guild_id)
        except (ValueError, TypeError):
            return False

        key = (guild_id, name)
        if key in self._enabled_cache:
            return self._enabled_cache[key]

        if name not in self.modules:
            return False

        enabled = False
        if database.db is not None:
            try:
                doc = await database.db.module_states.find_one(
                    {"guild_id": {"$in": [guild_id, str(guild_id)]}, "module": name}
                )
                if doc is not None:
                    enabled = bool(doc.get("enabled", False))
                else:
                    enabled = await self._check_legacy_enabled(guild_id, name)
            except Exception as e:
                logger.warning(
                    "Error querying module_states for (%s, %s): %s", guild_id, name, e
                )
                enabled = await self._check_legacy_enabled(guild_id, name)
        else:
            logger.warning(
                "Database not available; fallback enabled state used for (%s, %s)",
                guild_id,
                name,
            )

        self._enabled_cache[key] = enabled
        return enabled

    async def _get_legacy_config(self, guild_id: int, name: str) -> dict:
        if database.db is None:
            return {}
        try:
            settings = await database.get_settings(guild_id)
            if name == "leveling":
                level_roles = settings.get("level_roles", {})
                if level_roles:
                    return {"rewards": {str(k): int(v) for k, v in level_roles.items()}}
            elif name == "welcome":
                welcome_id = settings.get("welcome_channel_id")
                if welcome_id is not None:
                    return {"channel_id": int(welcome_id)}
        except Exception as e:
            logger.warning(
                "Error fetching legacy config for (%s, %s): %s", guild_id, name, e
            )
        return {}

    async def get_config(self, guild_id: int, name: str) -> dict:
        try:
            guild_id = int(guild_id)
        except (ValueError, TypeError):
            return {}

        key = (guild_id, name)
        if key in self._config_cache:
            return copy.deepcopy(self._config_cache[key])

        module = self.get_module(name)
        if not module:
            return {}

        config = copy.deepcopy(module.default_config)
        if database.db is not None:
            try:
                doc = await database.db.module_configs.find_one(
                    {"guild_id": {"$in": [guild_id, str(guild_id)]}, "module": name}
                )
                if doc and "config" in doc and isinstance(doc["config"], dict):
                    config.update(doc["config"])
                else:
                    legacy_cfg = await self._get_legacy_config(guild_id, name)
                    if legacy_cfg:
                        config.update(legacy_cfg)
            except Exception as e:
                logger.warning(
                    "Error reading module_configs for (%s, %s): %s", guild_id, name, e
                )
                legacy_cfg = await self._get_legacy_config(guild_id, name)
                if legacy_cfg:
                    config.update(legacy_cfg)
        else:
            logger.warning(
                "Database not available; returning default config for (%s, %s)",
                guild_id,
                name,
            )

        self._config_cache[key] = config
        return copy.deepcopy(config)

    async def set_enabled(self, guild_id: int, name: str, enabled: bool) -> None:
        try:
            guild_id = int(guild_id)
        except (ValueError, TypeError):
            raise ValueError(f"Invalid guild_id: {guild_id}")

        module = self.get_module(name)
        if not module:
            raise ValueError(f"Unknown module: {name}")

        if database.db is not None:
            await database.db.module_states.update_one(
                {"guild_id": guild_id, "module": name},
                {"$set": {"guild_id": guild_id, "module": name, "enabled": enabled}},
                upsert=True,
            )

        self._enabled_cache[(guild_id, name)] = enabled

        guild = self.bot.get_guild(guild_id)
        try:
            if enabled:
                await module.on_enable(guild)
            else:
                await module.on_disable(guild)
        except Exception as e:
            logger.warning("Error running on_enable/disable for %s: %s", name, e)

    async def set_config(self, guild_id: int, name: str, config: dict) -> dict:
        try:
            guild_id = int(guild_id)
        except (ValueError, TypeError):
            raise ValueError(f"Invalid guild_id: {guild_id}")

        module = self.get_module(name)
        if not module:
            raise ValueError(f"Unknown module: {name}")

        # Validate with module.config_model (raises ValidationError on failure)
        validated_model = module.config_model.model_validate(config)
        validated_dict = validated_model.model_dump()

        merged = copy.deepcopy(module.default_config)
        merged.update(validated_dict)

        now = datetime.now(timezone.utc)
        if database.db is not None:
            await database.db.module_configs.update_one(
                {"guild_id": guild_id, "module": name},
                {
                    "$set": {
                        "guild_id": guild_id,
                        "module": name,
                        "config": merged,
                        "updated_at": now,
                    }
                },
                upsert=True,
            )

        self._config_cache[(guild_id, name)] = merged

        guild = self.bot.get_guild(guild_id)
        try:
            await module.apply_config(guild, merged)
        except Exception as e:
            logger.warning("Error running apply_config for %s: %s", name, e)

        return copy.deepcopy(merged)

    async def load_startup_migrations(self) -> None:
        """Idempotent startup migrations. Runs once before bot connects."""
        # Ensure module cogs are registered
        await self.register_cogs()

        if database.db is None:
            logger.warning("Database not connected. Skipping startup migrations.")
            return

        try:
            await database.db.module_states.create_index(
                [("guild_id", 1), ("module", 1)], unique=True
            )
            await database.db.module_configs.create_index(
                [("guild_id", 1), ("module", 1)], unique=True
            )
            await database.db.tickets.create_index([("guild_id", 1), ("channel_id", 1)])
            await database.db.tickets.create_index([("guild_id", 1), ("status", 1)])
            await database.db.ticket_counters.create_index(
                [("guild_id", 1), ("category_id", 1)], unique=True
            )
            await database.db.tickets_meta.create_index([("guild_id", 1)], unique=True)
        except Exception as e:
            logger.warning("Error creating module indexes: %s", e)

        # 1. settings containing level_roles (non-empty) -> module_configs (guild_id, "leveling")
        try:
            cursor = database.db.settings.find({"level_roles": {"$exists": True, "$ne": {}}})
            async for doc in cursor:
                try:
                    gid = doc.get("guild_id")
                    if not gid:
                        continue
                    try:
                        gid = int(gid)
                    except (ValueError, TypeError):
                        pass
                    level_roles = doc.get("level_roles", {})
                    if not level_roles:
                        continue
                    existing = await database.db.module_configs.find_one(
                        {"guild_id": {"$in": [gid, str(gid)]}, "module": "leveling"}
                    )
                    if not existing:
                        cfg = copy.deepcopy(self.modules["leveling"].default_config)
                        cfg["rewards"] = {str(k): int(v) for k, v in level_roles.items()}
                        await database.db.module_configs.insert_one(
                            {
                                "guild_id": gid,
                                "module": "leveling",
                                "config": cfg,
                                "updated_at": datetime.now(timezone.utc),
                            }
                        )
                        logger.info("Migrated level_roles to module_configs for guild %s", gid)
                except Exception as e:
                    logger.warning("Error migrating leveling config for doc %s: %s", doc.get("_id"), e)
        except Exception as e:
            logger.warning("Error in leveling config migration step: %s", e)

        # 2. settings containing welcome_channel_id -> module_configs (guild_id, "welcome")
        try:
            cursor = database.db.settings.find({"welcome_channel_id": {"$exists": True, "$ne": None}})
            async for doc in cursor:
                try:
                    gid = doc.get("guild_id")
                    welcome_channel_id = doc.get("welcome_channel_id")
                    if not gid or welcome_channel_id is None:
                        continue
                    try:
                        gid = int(gid)
                    except (ValueError, TypeError):
                        pass
                    try:
                        welcome_channel_id = int(welcome_channel_id)
                    except (ValueError, TypeError):
                        pass
                    existing = await database.db.module_configs.find_one(
                        {"guild_id": {"$in": [gid, str(gid)]}, "module": "welcome"}
                    )
                    if not existing:
                        cfg = copy.deepcopy(self.modules["welcome"].default_config)
                        cfg["channel_id"] = welcome_channel_id
                        await database.db.module_configs.insert_one(
                            {
                                "guild_id": gid,
                                "module": "welcome",
                                "config": cfg,
                                "updated_at": datetime.now(timezone.utc),
                            }
                        )
                        logger.info("Migrated welcome_channel_id to module_configs for guild %s", gid)
                except Exception as e:
                    logger.warning("Error migrating welcome config for doc %s: %s", doc.get("_id"), e)
        except Exception as e:
            logger.warning("Error in welcome config migration step: %s", e)

        # 3. Enable states
        # 3a. reaction_roles docs -> enabled=true
        try:
            guild_ids = await database.db.reaction_roles.distinct("guild_id")
            for gid in guild_ids:
                try:
                    if gid is None:
                        continue
                    try:
                        gid = int(gid)
                    except (ValueError, TypeError):
                        pass
                    existing = await database.db.module_states.find_one(
                        {"guild_id": {"$in": [gid, str(gid)]}, "module": "reaction_roles"}
                    )
                    if not existing:
                        await database.db.module_states.insert_one(
                            {
                                "guild_id": gid,
                                "module": "reaction_roles",
                                "enabled": True,
                            }
                        )
                        logger.info("Enabled reaction_roles for guild %s", gid)
                except Exception as e:
                    logger.warning("Error enabling reaction_roles for guild %s: %s", gid, e)
        except Exception as e:
            logger.warning("Error in reaction_roles state migration step: %s", e)

        # 3b. levels docs -> enabled=true for leveling
        try:
            guild_ids = await database.db.levels.distinct("guild_id")
            for gid in guild_ids:
                try:
                    if gid is None:
                        continue
                    try:
                        gid = int(gid)
                    except (ValueError, TypeError):
                        pass
                    existing = await database.db.module_states.find_one(
                        {"guild_id": {"$in": [gid, str(gid)]}, "module": "leveling"}
                    )
                    if not existing:
                        await database.db.module_states.insert_one(
                            {
                                "guild_id": gid,
                                "module": "leveling",
                                "enabled": True,
                            }
                        )
                        logger.info("Enabled leveling for guild %s", gid)
                except Exception as e:
                    logger.warning("Error enabling leveling for guild %s: %s", gid, e)
        except Exception as e:
            logger.warning("Error in leveling state migration step: %s", e)

        # 3c. welcome_channel_id in settings -> enabled=true for welcome
        try:
            cursor = database.db.settings.find({"welcome_channel_id": {"$exists": True, "$ne": None}})
            async for doc in cursor:
                try:
                    gid = doc.get("guild_id")
                    if not gid or doc.get("welcome_channel_id") is None:
                        continue
                    try:
                        gid = int(gid)
                    except (ValueError, TypeError):
                        pass
                    existing = await database.db.module_states.find_one(
                        {"guild_id": {"$in": [gid, str(gid)]}, "module": "welcome"}
                    )
                    if not existing:
                        await database.db.module_states.insert_one(
                            {
                                "guild_id": gid,
                                "module": "welcome",
                                "enabled": True,
                            }
                        )
                        logger.info("Enabled welcome for guild %s", gid)
                except Exception as e:
                    logger.warning("Error enabling welcome for doc %s: %s", doc.get("_id"), e)
        except Exception as e:
            logger.warning("Error in welcome state migration step: %s", e)

        # 3d. tickets docs -> enabled=true for tickets
        try:
            guild_ids = await database.db.tickets.distinct("guild_id")
            for gid in guild_ids:
                try:
                    if gid is None:
                        continue
                    try:
                        gid = int(gid)
                    except (ValueError, TypeError):
                        pass
                    existing = await database.db.module_states.find_one(
                        {"guild_id": {"$in": [gid, str(gid)]}, "module": "tickets"}
                    )
                    if not existing:
                        await database.db.module_states.insert_one(
                            {
                                "guild_id": gid,
                                "module": "tickets",
                                "enabled": True,
                            }
                        )
                        logger.info("Enabled tickets for guild %s", gid)
                except Exception as e:
                    logger.warning("Error enabling tickets for guild %s: %s", gid, e)
        except Exception as e:
            logger.warning("Error in tickets state migration step: %s", e)


def build_registry(bot) -> Registry:
    """Construct module instances and return the Registry object."""
    modules = [
        LevelingModule(bot),
        ReactionRolesModule(bot),
        WelcomeModule(bot),
        TempVoiceModule(bot),
        TicketsModule(bot),
    ]
    return Registry(bot, modules)


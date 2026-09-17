import math
from typing import Any


def calculate_level(xp: int | float) -> int:
    """Calculate the member level from their total XP using the formula:
    level(xp) = int(0.09 * sqrt(xp))
    """
    if xp <= 0:
        return 0
    return int(0.09 * (xp ** 0.5))


def select_reward_role_ids(rewards: dict[Any, Any], level: int) -> list[int]:
    """Select role IDs from a rewards dictionary {level_threshold: role_id}
    where threshold <= level.
    Invalid entries (non-numeric thresholds or role IDs, negative thresholds) are skipped.
    """
    selected: list[int] = []
    if not rewards:
        return selected

    for lvl_raw, role_id_raw in rewards.items():
        try:
            threshold = int(lvl_raw)
            if threshold < 0:
                continue
            role_id = int(role_id_raw)
            if level >= threshold:
                selected.append(role_id)
        except (ValueError, TypeError):
            continue

    return selected

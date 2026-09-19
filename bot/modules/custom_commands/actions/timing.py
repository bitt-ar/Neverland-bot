from __future__ import annotations

import asyncio
import logging
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from ..workflow import WorkflowRunner

logger = logging.getLogger(__name__)


async def execute_wait_delay(runner: WorkflowRunner, action: dict[str, Any]) -> bool:
    """Pauses workflow execution asynchronously for a duration between 1 and 60 seconds."""
    try:
        raw_sec = action.get("seconds") or action.get("delay_seconds") or 1
        seconds = max(1, min(int(raw_sec), 60))
        logger.debug("Workflow pausing for %d second(s)", seconds)
        await asyncio.sleep(seconds)
        return True
    except (ValueError, TypeError) as e:
        logger.warning("Invalid delay seconds in wait_delay action: %s", e)
        return False

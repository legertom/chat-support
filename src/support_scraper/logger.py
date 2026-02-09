import json
import logging
import sys
from typing import Any


def setup_logger(verbose: bool = False) -> logging.Logger:
    logger = logging.getLogger("support_scraper")
    if logger.handlers:
        return logger
    handler = logging.StreamHandler(sys.stdout)
    formatter = logging.Formatter("%(message)s")
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG if verbose else logging.INFO)
    return logger


def log_event(logger: logging.Logger, event: str, **fields: Any) -> None:
    payload = {"event": event}
    payload.update(fields)
    logger.info(json.dumps(payload, ensure_ascii=False))

import argparse

import pytest

from support_scraper.cli import _apply_overrides, parse_args
from support_scraper.config import load_config


def test_apply_overrides_accepts_subcommand_without_common_flags():
    args = argparse.Namespace()
    config = load_config()

    updated = _apply_overrides(config, args)

    assert updated["concurrency"] == config["concurrency"]


def test_apply_overrides_sources_selects_expected_source():
    args = argparse.Namespace(sources="dev")
    config = load_config()

    updated = _apply_overrides(config, args)

    assert updated["sources"]["support"]["enabled"] is False
    assert updated["sources"]["dev"]["enabled"] is True


@pytest.mark.parametrize(
    "argv",
    [
        ["discover", "--config", "config.yaml"],
        ["--config", "config.yaml", "discover"],
        ["discover", "--config=config.yaml"],
    ],
)
def test_parse_args_accepts_config_anywhere(argv):
    args = parse_args(argv)
    assert args.command == "discover"
    assert args.config == "config.yaml"

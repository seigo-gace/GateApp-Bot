#!/usr/bin/env python3
"""Stage only the CI-tested help burst action into an independently adopted
resident source. No auth/session access, arbitrary action, or service change."""
from __future__ import annotations

import argparse
import ast
from pathlib import Path

ACTION_ANCHOR = '"bot_start_menu", "profile_button_smoke"'
ACTION_WITH_BURST = '"bot_start_menu", "help_button_burst_smoke", "profile_button_smoke"'
RESIDENT_START = '            if action == "help_button_burst_smoke":\n'
RESIDENT_END = '            if action == "link_button_smoke":\n'
CLIENT_START = '        if args.action == "help_button_burst_smoke":\n'
CLIENT_END = '        if args.action == "link_button_smoke":\n'
CLIENT_INSERT = '        if args.action == "profile_button_smoke":\n'
ERRORS_ANCHOR = '            safe_codes = {\n'
ERRORS = ('                "HELP_BURST_MENU_INVALID", "HELP_BURST_CALLBACK_FAILED",\n'
          '                "HELP_BURST_SCREEN_DUPLICATED", "HELP_BURST_SCREEN_MISSING",\n')

def once(source: str, anchor: str, replacement: str) -> str:
    if source.count(anchor) != 1:
        raise ValueError("HELP_BURST_MERGE_ANCHOR_NOT_UNIQUE")
    return source.replace(anchor, replacement, 1)

def verified_block(source: str, start: str, end: str) -> str:
    if source.count(start) != 1 or source.count(end) != 1:
        raise ValueError("HELP_BURST_REFERENCE_INVALID")
    i = source.index(start)
    j = source.index(end)
    if j <= i:
        raise ValueError("HELP_BURST_REFERENCE_ORDER_INVALID")
    return source[i:j]

def merge(current_resident: str, current_client: str,
          reference_resident: str, reference_client: str) -> tuple[str, str]:
    for source in (current_resident, current_client, reference_resident, reference_client):
        ast.parse(source)
    if any("help_button_burst_smoke" in s for s in (current_resident, current_client)):
        raise ValueError("HELP_BURST_ALREADY_PRESENT")
    resident_block = verified_block(reference_resident, RESIDENT_START, RESIDENT_END)
    client_block = verified_block(reference_client, CLIENT_START, CLIENT_END)
    if reference_resident.count(ERRORS) != 1:
        raise ValueError("HELP_BURST_REFERENCE_ERRORS_INVALID")
    resident = once(current_resident, ACTION_ANCHOR, ACTION_WITH_BURST)
    resident = once(resident, RESIDENT_END, resident_block + RESIDENT_END)
    resident = once(resident, ERRORS_ANCHOR, ERRORS_ANCHOR + ERRORS)
    client = once(current_client, CLIENT_INSERT, client_block + CLIENT_INSERT)
    ast.parse(resident)
    ast.parse(client)
    # Prove the only changes are the four explicit, reversible insertions.
    reverted = once(resident, ACTION_WITH_BURST, ACTION_ANCHOR)
    reverted = once(reverted, resident_block + RESIDENT_END, RESIDENT_END)
    reverted = once(reverted, ERRORS_ANCHOR + ERRORS, ERRORS_ANCHOR)
    if reverted != current_resident or once(client, client_block + CLIENT_INSERT, CLIENT_INSERT) != current_client:
        raise ValueError("HELP_BURST_UNRELATED_SOURCE_CHANGE")
    return resident, client

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--current", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    names = ("userbot_resident_ipc.py", "userbot_test_client.py")
    inputs = [(directory / name).read_text(encoding="utf-8")
              for directory in (args.current, args.reference) for name in names]
    result = merge(*inputs)
    args.output.mkdir(mode=0o700, parents=False, exist_ok=False)
    for name, source in zip(names, result):
        (args.output / name).write_text(source, encoding="utf-8")
    print("HELP_BURST_ADOPTED_SOURCE_MERGE=PASS")

if __name__ == "__main__":
    main()

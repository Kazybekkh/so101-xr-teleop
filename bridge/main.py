#!/usr/bin/env python3
"""Start the input bridge; hardware control requires an explicit flag."""

from __future__ import annotations

import argparse
import asyncio
import os

if __package__:
    from .protocol import get_server_config, load_local_env
else:
    from protocol import get_server_config, load_local_env


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--dry-run", action="store_true", help="Validate WebXR input without hardware (default).")
    modes.add_argument("--hardware", action="store_true", help="Connect the configured SO-101 follower and enable motor control.")
    args = parser.parse_args(argv)
    try:
        load_local_env()
        get_server_config()
        if args.hardware:
            if not os.environ.get("FOLLOWER_PORT", "").strip():
                raise ValueError("--hardware requires FOLLOWER_PORT; set the actual arm's serial port in bridge/.env or your environment")
            if __package__:
                from .hardware import amain
            else:
                from hardware import amain
        else:
            if __package__:
                from .dry_run import amain
            else:
                from dry_run import amain
        asyncio.run(amain())
    except KeyboardInterrupt:
        print("[bridge] Stopped.")
    except (ValueError, OSError) as exc:
        parser.exit(2, f"bridge: {exc}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Validate WebXR input and configure the bridge without hardware imports."""

from __future__ import annotations

import json
import math
import os
import re
import ssl
from collections.abc import Mapping
from pathlib import Path
from typing import Any

THIS_DIR = Path(__file__).resolve().parent
MAX_PACKET_BYTES = 64 * 1024


def _number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be a finite number")
    try:
        if not math.isfinite(value):
            raise ValueError(f"{label} must be a finite number")
        return float(value)
    except OverflowError as exc:
        raise ValueError(f"{label} must be a finite number") from exc


def _vector(value: Any, length: int, label: str) -> list[float]:
    if not isinstance(value, list) or len(value) != length:
        raise ValueError(f"{label} must contain {length} numbers")
    return [_number(item, f"{label}[{index}]") for index, item in enumerate(value)]


def _pose(value: Any, label: str) -> None:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    _vector(value.get("position"), 3, f"{label}.position")
    orientation = _vector(value.get("orientation"), 4, f"{label}.orientation")
    norm = math.hypot(*orientation)
    if not math.isfinite(norm) or norm < 1e-12:
        raise ValueError(f"{label}.orientation must be a nonzero finite quaternion")


def validate_packet(value: object) -> dict:
    """Return a valid packet; reject malformed input instead of coercing it.

    Headset pose and timestamp are optional because a controller-only sender
    can drive the bridge. Missing axes/buttons mean no corresponding input.
    """
    if not isinstance(value, dict):
        raise ValueError("packet must be an object")
    if not isinstance(value.get("armLatched"), bool):
        raise ValueError("armLatched must be a boolean")
    controllers = value.get("controllers")
    if not isinstance(controllers, list):
        raise ValueError("controllers must be a list")
    if len(controllers) > 8:
        raise ValueError("controllers must contain at most 8 entries")

    hands: set[str] = set()
    for index, controller in enumerate(controllers):
        label = f"controllers[{index}]"
        _pose(controller, label)
        hand = controller.get("hand")
        if not isinstance(hand, str) or hand not in {"left", "right", "none"}:
            raise ValueError(f"{label}.hand must be left, right, or none")
        if hand != "none":
            if hand in hands:
                raise ValueError(f"duplicate {hand} controller")
            hands.add(hand)

        axes = controller.get("axes", [])
        if not isinstance(axes, list) or len(axes) > 16:
            raise ValueError(f"{label}.axes must be a list of at most 16 values")
        for axis_index, axis in enumerate(axes):
            if not -1.0 <= _number(axis, f"{label}.axes[{axis_index}]") <= 1.0:
                raise ValueError(f"{label}.axes[{axis_index}] must be between -1 and 1")

        buttons = controller.get("buttons", [])
        if not isinstance(buttons, list) or len(buttons) > 32:
            raise ValueError(f"{label}.buttons must be a list of at most 32 buttons")
        for button_index, button in enumerate(buttons):
            button_label = f"{label}.buttons[{button_index}]"
            if not isinstance(button, dict) or not isinstance(button.get("pressed"), bool):
                raise ValueError(f"{button_label}.pressed must be a boolean")
            if not 0.0 <= _number(button.get("value"), f"{button_label}.value") <= 1.0:
                raise ValueError(f"{button_label}.value must be between 0 and 1")

    if "headset" in value:
        _pose(value["headset"], "headset")
    if "ts" in value and _number(value["ts"], "ts") < 0:
        raise ValueError("ts must be nonnegative")
    return value


def _json_object(pairs: list[tuple[str, Any]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("packet contains a duplicate JSON key")
        result[key] = value
    return result


def _invalid_constant(_: str) -> None:
    raise ValueError("packet contains a non-finite JSON number")


def parse_packet(raw: str | bytes) -> dict:
    """Decode one UTF-8 JSON message and validate its WebXR input fields."""
    if not isinstance(raw, (str, bytes)):
        raise ValueError("message must be JSON text or UTF-8 bytes")
    try:
        encoded = raw.encode("utf-8") if isinstance(raw, str) else raw
        if len(encoded) > MAX_PACKET_BYTES:
            raise ValueError("message exceeds 64 KiB")
        text = encoded.decode("utf-8")
        value = json.loads(text, object_pairs_hook=_json_object, parse_constant=_invalid_constant)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as exc:
        raise ValueError("message must contain valid UTF-8 JSON") from exc
    return validate_packet(value)


def load_local_env() -> None:
    """Load only this project's bridge/.env; process environment wins.

    Supports KEY=value, optional export, and matching outer quotes. No shell
    commands or variable interpolation are evaluated.
    """
    path = THIS_DIR / ".env"
    if not path.is_file():
        return
    for line_number, line in enumerate(path.read_text().splitlines(), start=1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        key, separator, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if not separator or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise ValueError(f"Invalid configuration on bridge/.env line {line_number}")
        if value.startswith(("'", '"')):
            if len(value) < 2 or value[-1] != value[0]:
                raise ValueError(f"Unmatched quote on bridge/.env line {line_number}")
            value = value[1:-1]
        else:
            value = re.split(r"\s+#", value, maxsplit=1)[0].rstrip()
        os.environ.setdefault(key, value)


def get_server_config(env: Mapping[str, str] | None = None) -> tuple[str, int, ssl.SSLContext | None]:
    """Return the listen address and a configured TLS context, when requested."""
    values = os.environ if env is None else env
    host = values.get("WS_HOST", "127.0.0.1").strip()
    if not host:
        raise ValueError("WS_HOST must not be empty")
    raw_port = values.get("WS_PORT", "8765").strip()
    if not re.fullmatch(r"[0-9]+", raw_port):
        raise ValueError("WS_PORT must be an integer between 1 and 65535")
    port = int(raw_port)
    if not 1 <= port <= 65535:
        raise ValueError("WS_PORT must be an integer between 1 and 65535")

    cert = values.get("WS_TLS_CERT", "").strip()
    key = values.get("WS_TLS_KEY", "").strip()
    if bool(cert) != bool(key):
        raise ValueError("WS_TLS_CERT and WS_TLS_KEY must be configured together")
    context = None
    if cert:
        def local_path(value: str) -> Path:
            path = Path(value).expanduser()
            return path if path.is_absolute() else THIS_DIR / path

        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        try:
            context.load_cert_chain(certfile=local_path(cert), keyfile=local_path(key))
        except (OSError, ssl.SSLError) as exc:
            raise ValueError("Could not load WS_TLS_CERT/WS_TLS_KEY certificate pair") from exc
    return host, port, context

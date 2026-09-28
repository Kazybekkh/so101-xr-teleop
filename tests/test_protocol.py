"""Malformed controller data must never reach the hardware mapper."""

import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from bridge.protocol import MAX_PACKET_BYTES, get_server_config, load_local_env, parse_packet, validate_packet


def packet():
    return {
        "ts": 1234567890,
        "armLatched": True,
        "headset": {"position": [0, 1.6, 0], "orientation": [0, 0, 0, 1]},
        "controllers": [{
            "hand": "right",
            "position": [0.1, 1.2, -0.3],
            "orientation": [0, 0, 0, 1],
            "axes": [0, -1, 1],
            "buttons": [{"pressed": True, "value": 0.5}],
        }],
    }


class ProtocolTests(unittest.TestCase):
    def test_real_shape_roundtrips_text_and_bytes_without_mutation(self):
        value = packet()
        original = copy.deepcopy(value)
        self.assertEqual(parse_packet(json.dumps(value)), original)
        self.assertEqual(parse_packet(json.dumps(value).encode()), original)
        self.assertEqual(validate_packet(value), original)
        self.assertEqual(value, original)

    def test_controller_only_and_tracking_loss_packets_are_valid(self):
        value = packet()
        del value["headset"]
        del value["ts"]
        del value["controllers"][0]["axes"]
        del value["controllers"][0]["buttons"]
        self.assertEqual(validate_packet(value), value)
        self.assertEqual(validate_packet({"armLatched": False, "controllers": []})["controllers"], [])

    def test_rejects_coercion_nonfinite_and_invalid_controller_fields(self):
        changes = [
            (lambda p: p.update(armLatched="false")),
            (lambda p: p.update(armLatched=1)),
            (lambda p: p.update(controllers={})),
            (lambda p: p.update(headset=None)),
            (lambda p: p.update(ts=-1)),
            (lambda p: p.update(ts=True)),
            (lambda p: p["controllers"][0].update(position=[0, 1])),
            (lambda p: p["controllers"][0].update(position=[0, "1", 2])),
            (lambda p: p["controllers"][0].update(position=[0, False, 2])),
            (lambda p: p["controllers"][0].update(position=[0, float("nan"), 2])),
            (lambda p: p["controllers"][0].update(position=[0, float("inf"), 2])),
            (lambda p: p["controllers"][0].update(position=[0, 10 ** 400, 2])),
            (lambda p: p["controllers"][0].update(orientation=[0, 0, 0, 0])),
            (lambda p: p["controllers"][0].update(orientation=[0, 0, 0])),
            (lambda p: p["controllers"][0].update(hand="arbitrary")),
            (lambda p: p["controllers"][0].update(hand=[])),
            (lambda p: p["controllers"][0].update(axes=[1.1])),
            (lambda p: p["controllers"][0].update(axes=[float("nan")])),
            (lambda p: p["controllers"][0].update(buttons=[{"pressed": "true", "value": 0.5}])),
            (lambda p: p["controllers"][0].update(buttons=[{"pressed": False, "value": 1.1}])),
            (lambda p: p["controllers"][0].update(buttons=[{"pressed": False, "value": -0.1}])),
            (lambda p: p["controllers"][0].update(buttons=[{"pressed": False, "value": True}])),
            (lambda p: p["controllers"].append(copy.deepcopy(p["controllers"][0]))),
        ]
        for index, change in enumerate(changes):
            with self.subTest(case=index):
                value = packet()
                change(value)
                with self.assertRaises(ValueError):
                    validate_packet(value)

    def test_rejects_bad_json_and_ambiguous_messages(self):
        invalid = [
            "not json", "[]", "null", b"\xff", 123,
            '{"armLatched": false, "armLatched": true, "controllers": []}',
            '{"armLatched": false, "controllers": [], "ts": NaN}',
            '{"armLatched": false, "controllers": [], "ts": Infinity}',
            '{"armLatched": false, "controllers": [], "ts": 1e9999}',
            " " * (MAX_PACKET_BYTES + 1),
            "[" * 2000 + "]" * 2000,
        ]
        for raw in invalid:
            with self.subTest(kind=type(raw).__name__, length=len(raw) if hasattr(raw, "__len__") else 0):
                with self.assertRaises(ValueError):
                    parse_packet(raw)


class ServerConfigTests(unittest.TestCase):
    def test_loopback_defaults_and_explicit_binding(self):
        self.assertEqual(get_server_config({}), ("127.0.0.1", 8765, None))
        self.assertEqual(get_server_config({"WS_HOST": "0.0.0.0", "WS_PORT": "9000"}), ("0.0.0.0", 9000, None))

    def test_invalid_ports_empty_host_and_incomplete_tls_fail(self):
        cases = [{"WS_PORT": value} for value in ["0", "65536", "abc", "1.2", "-1", ""]]
        cases.extend([{"WS_HOST": " "}, {"WS_TLS_CERT": "cert.pem"}, {"WS_TLS_KEY": "key.pem"}])
        cases.append({"WS_TLS_CERT": "/nonexistent/cert.pem", "WS_TLS_KEY": "/nonexistent/key.pem"})
        for values in cases:
            with self.subTest(values=values), self.assertRaises(ValueError):
                get_server_config(values)

    def test_only_explicit_local_dotenv_is_read_and_environment_wins(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / ".env").write_text('WS_PORT=9000\nexport WS_HOST="127.0.0.1"\nTEST_LITERAL=$(do-not-execute)\n')
            with patch("bridge.protocol.THIS_DIR", root), patch.dict(os.environ, {"WS_PORT": "9876"}, clear=True):
                load_local_env()
                self.assertEqual(os.environ["WS_PORT"], "9876")
                self.assertEqual(os.environ["WS_HOST"], "127.0.0.1")
                self.assertEqual(os.environ["TEST_LITERAL"], "$(do-not-execute)")


if __name__ == "__main__":
    unittest.main()

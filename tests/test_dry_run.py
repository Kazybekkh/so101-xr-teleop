"""Exercise real WebSocket IO while keeping robot/camera code unimported."""

import asyncio
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import shutil
import ssl
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from websockets.asyncio.client import connect
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

from bridge.dry_run import DryRunBridge
from bridge.main import main
from bridge.protocol import get_server_config


VALID_PACKET = {
    "armLatched": True,
    "controllers": [{"hand": "right", "position": [0, 0, 0], "orientation": [0, 0, 0, 1]}],
}


class DryRunSocketTests(unittest.IsolatedAsyncioTestCase):
    async def test_valid_invalid_and_recovery_packets_on_real_socket(self):
        bridge = DryRunBridge()
        with redirect_stdout(io.StringIO()):
            async with serve(bridge.handle_client, "127.0.0.1", 0) as server:
                port = server.sockets[0].getsockname()[1]
                async with connect(f"ws://127.0.0.1:{port}") as client:
                    await client.send(json.dumps(VALID_PACKET))
                    status = json.loads(await asyncio.wait_for(client.recv(), 2))
                    self.assertTrue(status["accepted"])
                    self.assertTrue(status["armLatched"])
                    self.assertEqual(status["packetsAccepted"], 1)
                    self.assertFalse(status["hardwareConnected"])
                    self.assertNotIn("jointTemps", status)

                    await client.send('{"armLatched":"false","controllers":[]}')
                    invalid = json.loads(await asyncio.wait_for(client.recv(), 2))
                    self.assertFalse(invalid["accepted"])
                    self.assertEqual(invalid["packetsAccepted"], 1)
                    self.assertEqual(invalid["packetsRejected"], 1)

                    await client.send(json.dumps({"armLatched": False, "controllers": []}))
                    recovered = json.loads(await asyncio.wait_for(client.recv(), 2))
                    self.assertFalse(recovered["armLatched"])
                    self.assertEqual(recovered["packetsAccepted"], 2)
                    self.assertEqual(recovered["controllerCount"], 0)
            self.assertIsNone(bridge._client)
            self.assertFalse(bridge.arm_latched)

    async def test_second_controller_is_rejected_and_first_keeps_control(self):
        bridge = DryRunBridge()
        with redirect_stdout(io.StringIO()):
            async with serve(bridge.handle_client, "127.0.0.1", 0) as server:
                uri = f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}"
                async with connect(uri) as first:
                    await first.send(json.dumps(VALID_PACKET))
                    await asyncio.wait_for(first.recv(), 2)
                    async with connect(uri) as second:
                        with self.assertRaises(ConnectionClosed) as caught:
                            await asyncio.wait_for(second.recv(), 2)
                        self.assertEqual(caught.exception.rcvd.code, 1013)
                    await first.send(json.dumps(VALID_PACKET))
                    status = json.loads(await asyncio.wait_for(first.recv(), 2))
                    self.assertEqual(status["packetsAccepted"], 2)
            self.assertIsNone(bridge._client)

    @unittest.skipUnless(shutil.which("openssl"), "openssl required to create a temporary TLS test certificate")
    async def test_tls_configuration_serves_a_real_secure_websocket(self):
        with tempfile.TemporaryDirectory() as folder:
            cert = Path(folder) / "cert.pem"
            key = Path(folder) / "key.pem"
            subprocess.run(
                ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(key), "-out", str(cert), "-days", "1", "-subj", "/CN=localhost"],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            _, _, context = get_server_config({"WS_TLS_CERT": str(cert), "WS_TLS_KEY": str(key)})
            self.assertIsInstance(context, ssl.SSLContext)
            client_context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            client_context.check_hostname = False
            client_context.verify_mode = ssl.CERT_NONE  # Only for this temporary self-signed test.
            with redirect_stdout(io.StringIO()):
                async with serve(DryRunBridge().handle_client, "127.0.0.1", 0, ssl=context) as server:
                    uri = f"wss://127.0.0.1:{server.sockets[0].getsockname()[1]}"
                    async with connect(uri, ssl=client_context) as client:
                        await client.send(json.dumps(VALID_PACKET))
                        status = json.loads(await asyncio.wait_for(client.recv(), 2))
                        self.assertTrue(status["accepted"])
                        self.assertFalse(status["hardwareConnected"])


class EntryPointTests(unittest.TestCase):
    def test_default_and_explicit_dry_run_choose_lightweight_runner(self):
        calls = []

        async def fake_dry_run():
            calls.append("dry-run")

        with patch("bridge.main.load_local_env"), patch("bridge.main.get_server_config"), patch("bridge.dry_run.amain", fake_dry_run):
            self.assertEqual(main([]), 0)
            self.assertEqual(main(["--dry-run"]), 0)
        self.assertEqual(calls, ["dry-run", "dry-run"])

    def test_hardware_requires_explicit_port_before_hardware_import(self):
        with patch.dict(os.environ, {}, clear=True), patch("bridge.main.load_local_env"), patch("sys.stderr", new_callable=io.StringIO):
            with self.assertRaises(SystemExit) as caught:
                main(["--hardware"])
            self.assertEqual(caught.exception.code, 2)

    def test_dry_run_imports_no_robot_camera_or_ik_packages(self):
        script = (
            "import bridge.main, bridge.dry_run, sys; "
            "forbidden={'lerobot','placo','serial','cv2','numpy'}; "
            "found=forbidden.intersection(name.split('.')[0] for name in sys.modules); "
            "assert not found, found"
        )
        subprocess.run([sys.executable, "-c", script], cwd=Path(__file__).resolve().parents[1], check=True, capture_output=True, text=True)


if __name__ == "__main__":
    unittest.main()

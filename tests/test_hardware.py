"""Hardware-control regression tests using the real SDK and fake robot I/O.

Run with the optional bridge hardware dependencies installed. No robot,
serial bus, camera, or IK solver is constructed by this module.
"""

from __future__ import annotations

import asyncio
import math
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bridge"))

import hardware
from xr_mapper import MapXRActionToRobotAction


MOTORS = [
    "shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"
]
OBSERVATION = {f"{name}.pos": 10.0 + index for index, name in enumerate(MOTORS)}


def controller(hand="right", position=None, trigger=0.0):
    return {
        "hand": hand,
        "position": [0.0, 0.0, 0.0] if position is None else position,
        "orientation": [0.0, 0.0, 0.0, 1.0],
        "axes": [],
        "buttons": [
            {"pressed": trigger > 0, "value": trigger},
            {"pressed": False, "value": 0.0},
        ],
    }


def packet(latched=False, tracked=True):
    return {
        "armLatched": latched,
        "controllers": [controller()] if tracked else [],
    }


def fake_bridge():
    # Deliberately bypass __init__: it constructs the real serial-backed robot.
    bridge = object.__new__(hardware.TeleopBridge)
    bridge.motor_names = list(MOTORS)
    bridge.robot = Mock()
    bridge.robot.get_observation.side_effect = lambda: dict(OBSERVATION)
    bridge.robot.send_action.side_effect = lambda action: dict(action)
    bridge.joint_clamp = hardware.JointClampStep(MOTORS, max_delta_deg=5.0)

    # Stand in for the expensive IK pipeline, retaining the real final clamp.
    bridge.pipeline = Mock(
        side_effect=lambda _: bridge.joint_clamp.action(
            {f"{name}.pos": 100.0 for name in MOTORS}
        )
    )
    bridge.pipeline.reset.side_effect = bridge.joint_clamp.reset
    bridge._connected_clients = 0
    bridge._latest_packet = None
    bridge._packet_lock = threading.Lock()
    bridge._last_packet_time = time.monotonic()
    bridge._hold_requested = False
    bridge._needs_release = True
    bridge._prev_arm_latched = False
    bridge._step_count = 0
    bridge._last_stats_time = time.perf_counter()
    bridge._error_count = 0
    return bridge


class JointClampTests(unittest.TestCase):
    def test_first_target_requires_measurement_and_is_bounded(self):
        clamp = hardware.JointClampStep(["a", "b"], max_delta_deg=5.0)
        with self.assertRaises(RuntimeError):
            clamp.action({"a.pos": 100.0, "b.pos": -100.0})
        clamp.seed({"a.pos": 10.0, "b.pos": -10.0})
        self.assertEqual(
            clamp.action({"a.pos": 100.0, "b.pos": -100.0}),
            {"a.pos": 15.0, "b.pos": -15.0},
        )

    def test_nonfinite_ik_targets_are_rejected(self):
        for value in [math.nan, math.inf, -math.inf]:
            with self.subTest(value=value):
                clamp = hardware.JointClampStep(["a"])
                clamp.seed({"a.pos": 10.0})
                with self.assertRaises(ValueError):
                    clamp.action({"a.pos": value})

    def test_nonfinite_measured_positions_are_rejected(self):
        for value in [math.nan, math.inf, -math.inf]:
            with self.subTest(value=value):
                clamp = hardware.JointClampStep(["a"])
                with self.assertRaises(ValueError):
                    clamp.seed({"a.pos": value})

    def test_invalid_motion_limits_fail_before_commands(self):
        for value in [0.0, -1.0, math.nan, math.inf]:
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    clamp = hardware.JointClampStep(["a"], max_delta_deg=value)
                    clamp.seed({"a.pos": 10.0})
                    clamp.action({"a.pos": 100.0})


class BridgeMotionTests(unittest.TestCase):
    def setUp(self):
        self.bridge = fake_bridge()

    def test_initial_unlatched_packets_do_not_read_or_command_robot(self):
        self.assertEqual(self.bridge.step(packet()), {})
        self.assertEqual(self.bridge.step(packet()), {})
        self.bridge.robot.get_observation.assert_not_called()
        self.bridge.robot.send_action.assert_not_called()
        self.bridge.pipeline.assert_not_called()

    def test_initial_latched_packet_requires_release_first(self):
        self.assertEqual(self.bridge.step(packet(latched=True)), {})
        self.bridge.robot.send_action.assert_not_called()
        self.bridge.step(packet())
        self.bridge.step(packet(latched=True))
        self.bridge.robot.send_action.assert_called_once()

    def test_first_latch_and_stalled_arm_remain_bounded_by_measurement(self):
        self.bridge.step(packet())
        first = self.bridge.step(packet(latched=True))
        second = self.bridge.step(packet(latched=True))
        expected = {key: value + 5.0 for key, value in OBSERVATION.items()}
        self.assertEqual(first, expected)
        # An unchanged measured pose must not allow goals to keep advancing.
        self.assertEqual(second, expected)

    def test_release_holds_measured_joints_once_without_more_ik(self):
        self.bridge.step(packet())
        self.bridge.step(packet(latched=True))
        measured = {key: value + 2.0 for key, value in OBSERVATION.items()}
        self.bridge.robot.get_observation.side_effect = lambda: dict(measured)
        self.bridge.robot.send_action.reset_mock()
        self.bridge.pipeline.reset_mock()

        self.assertEqual(self.bridge.step(packet()), measured)
        self.bridge.robot.send_action.assert_called_once_with(measured)
        self.bridge.pipeline.assert_not_called()
        self.bridge.step(packet())
        self.bridge.robot.send_action.assert_called_once()

    def test_tracking_loss_holds_and_requires_explicit_release(self):
        self.bridge.step(packet())
        self.bridge.step(packet(latched=True))
        self.bridge.robot.send_action.reset_mock()
        self.bridge.pipeline.reset_mock()

        self.assertEqual(self.bridge.step(packet(latched=True, tracked=False)), OBSERVATION)
        self.bridge.robot.send_action.assert_called_once_with(OBSERVATION)
        self.assertTrue(self.bridge._needs_release)
        self.assertEqual(self.bridge.step(packet(latched=True)), {})
        self.bridge.robot.send_action.assert_called_once()
        self.bridge.pipeline.assert_not_called()

        self.bridge.step(packet())
        self.bridge.step(packet(latched=True))
        self.assertEqual(self.bridge.robot.send_action.call_count, 2)

    def test_nonfinite_ik_result_never_reaches_send_action(self):
        self.bridge.step(packet())
        self.bridge.pipeline.side_effect = lambda _: self.bridge.joint_clamp.action(
            {f"{name}.pos": math.nan for name in MOTORS}
        )
        with self.assertRaises(ValueError):
            self.bridge.step(packet(latched=True))
        self.bridge.robot.send_action.assert_not_called()

    def test_nonfinite_hold_observation_never_reaches_send_action(self):
        for value in [math.nan, math.inf, -math.inf]:
            with self.subTest(value=value):
                bridge = fake_bridge()
                bridge._prev_arm_latched = True
                bad = dict(OBSERVATION, **{"gripper.pos": value})
                bridge.robot.get_observation.side_effect = lambda: bad
                with self.assertRaises(ValueError):
                    bridge.hold()
                bridge.robot.send_action.assert_not_called()


class MapperTests(unittest.TestCase):
    def test_unlatched_or_missing_right_controller_disables_gripper(self):
        left = controller(hand="left", trigger=1.0)
        for latched, controllers in [(False, [controller(), left]), (True, [left])]:
            with self.subTest(latched=latched):
                mapper = MapXRActionToRobotAction()
                action = mapper.action({"xr.packet": {
                    "armLatched": latched, "controllers": controllers
                }})
                self.assertFalse(action["enabled"])
                self.assertEqual(action["gripper_vel"], 0.0)
                self.assertTrue(all(action[key] == 0.0 for key in action if key.startswith("target_")))

    def test_new_latch_uses_current_controller_origin(self):
        mapper = MapXRActionToRobotAction()
        mapper.action({"xr.packet": packet(latched=True)})
        mapper.action({"xr.packet": packet(latched=True)})
        moved = packet(latched=True)
        moved["controllers"][0]["position"] = [0.1, 0.2, -0.3]
        action = mapper.action({"xr.packet": moved})
        self.assertAlmostEqual(action["target_x"], 0.3)
        self.assertAlmostEqual(action["target_y"], -0.1)
        self.assertAlmostEqual(action["target_z"], 0.2)
        mapper.action({"xr.packet": packet()})
        relatched = mapper.action({"xr.packet": moved})
        self.assertEqual([relatched[f"target_{axis}"] for axis in "xyz"], [0.0, 0.0, 0.0])


class BridgeWatchdogTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancellation_joins_serial_thread_before_parent_cleanup(self):
        started = threading.Event()
        release = threading.Event()
        finished = threading.Event()
        cleanup = threading.Event()
        order = []

        def fake_connect():
            started.set()
            if not release.wait(timeout=2.0):
                raise AssertionError("test did not release the fake connection thread")
            order.append("connection finished")
            finished.set()

        async def parent():
            try:
                await hardware.finish_serial_call(fake_connect)
            finally:
                order.append("cleanup started")
                cleanup.set()

        parent_task = asyncio.create_task(parent())
        try:
            self.assertTrue(await asyncio.to_thread(started.wait, 1.0))
            parent_task.cancel()
            # Let cancellation reach finish_serial_call while its worker is blocked.
            await asyncio.sleep(0.01)
            self.assertFalse(parent_task.done())
            self.assertFalse(finished.is_set())
            self.assertFalse(cleanup.is_set())
        finally:
            # Always free the worker, even if the ordering assertion regresses.
            release.set()
            outcomes = await asyncio.wait_for(
                asyncio.gather(parent_task, return_exceptions=True), timeout=2.0
            )

        self.assertIsInstance(outcomes[0], asyncio.CancelledError)
        self.assertTrue(finished.is_set())
        self.assertEqual(order, ["connection finished", "cleanup started"])

    async def test_stale_input_holds_once_and_cannot_resume_latched(self):
        bridge = fake_bridge()
        bridge.step(packet())
        bridge.step(packet(latched=True))
        bridge.robot.send_action.reset_mock()
        bridge._last_packet_time = time.monotonic() - hardware.INPUT_TIMEOUT_S - 1.0
        stop = asyncio.Event()

        async def stop_after_iteration(_):
            stop.set()

        with patch.object(hardware.asyncio, "sleep", new=stop_after_iteration):
            await bridge.control_loop(stop)

        bridge.robot.send_action.assert_called_once_with(OBSERVATION)
        self.assertTrue(bridge._needs_release)
        bridge.step(packet(latched=True))
        bridge.robot.send_action.assert_called_once()
        bridge.step(packet())
        bridge.step(packet(latched=True))
        self.assertEqual(bridge.robot.send_action.call_count, 2)

    async def test_second_controller_is_rejected_without_changing_robot_state(self):
        bridge = fake_bridge()
        bridge._connected_clients = 1
        ws = Mock(close=AsyncMock())
        await bridge.handle_client(ws)
        ws.close.assert_awaited_once()
        self.assertEqual(ws.close.call_args.kwargs["code"], 1008)
        self.assertEqual(bridge._connected_clients, 1)
        self.assertFalse(bridge._hold_requested)
        bridge.robot.send_action.assert_not_called()

    async def test_disconnect_clears_pending_packet_and_requests_hold(self):
        bridge = fake_bridge()

        class Socket:
            remote_address = "test-controller"

            def __aiter__(self):
                return self

            async def __anext__(self):
                bridge._set_packet(packet(latched=True))
                raise StopAsyncIteration

        await bridge.handle_client(Socket())
        self.assertIsNone(bridge._take_packet())
        self.assertTrue(bridge._hold_requested)
        self.assertEqual(bridge._connected_clients, 0)
        bridge.robot.send_action.assert_not_called()


if __name__ == "__main__":
    unittest.main()

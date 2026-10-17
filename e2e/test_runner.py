import json
import subprocess
import sys
import time
import unittest
from unittest.mock import Mock, patch

import run as live_runner


class RunnerSnapshots(unittest.TestCase):
    def test_empty_snapshots_wait_for_another_poll(self):
        case = live_runner.LiveTabStatus()
        case.tab = 2
        case.action = Mock(side_effect=["", "", '[{"tab_id":1,"name":"control"},{"tab_id":2,"name":"repo:main"}]'])
        self.assertIsNone(case.tab_name())
        self.assertEqual(case.panes(), [])
        self.assertEqual(case.tab_name(), "repo:main")

    def test_malformed_snapshots_still_fail(self):
        case = live_runner.LiveTabStatus()
        case.action = Mock(return_value="not JSON")
        with self.assertRaises(json.JSONDecodeError):
            case.tab_name()

    def test_renamed_control_tab_still_fails(self):
        case = live_runner.LiveTabStatus()
        case.tab = 2
        case.action = Mock(return_value='[{"tab_id":1,"name":"wrong"},{"tab_id":2,"name":"repo:main"}]')
        with self.assertRaisesRegex(AssertionError, "Unrelated tab was renamed"):
            case.tab_name()


class RunnerCliIsolation(unittest.TestCase):
    def setUp(self):
        self.case = live_runner.LiveTabStatus()
        self.addCleanup(self.case.doCleanups)
        self.case.run_command = Mock(side_effect=RuntimeError("fixture prepared"))
        with self.assertRaisesRegex(RuntimeError, "fixture prepared"):
            self.case.setUp()
        self.wrapper = self.case.home / "bin/zellij"
        self.fake = self.case.home / "fake-zellij"
        self.fake.write_text(f'''#!{sys.executable}
import os, pathlib, sys, time
root = pathlib.Path(os.environ["TAB_STATUS_E2E_DIR"])
if sys.argv[1] == "fail":
    print("real command failure", file=sys.stderr)
    sys.exit(17)
try:
    fd = os.open(root / "busy", os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
except FileExistsError:
    print("overlapping CLI client", file=sys.stderr)
    sys.exit(23)
os.close(fd)
try:
    if sys.argv[1] == "pipe":
        (root / "entered").touch()
        while not (root / "release").exists():
            time.sleep(0.01)
    print("native output")
finally:
    (root / "busy").unlink()
''')
        self.fake.chmod(0o700)
        self.env = {**self.case.env, "REAL_ZELLIJ": str(self.fake)}

    def test_serializes_fixture_actions_and_extension_pipes(self):
        first = subprocess.Popen([str(self.wrapper), "pipe", "payload"], env=self.env,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.addCleanup(self.reap, first)
        deadline = time.monotonic() + 3
        while not (self.case.home / "entered").exists():
            self.assertLess(time.monotonic(), deadline, "first command did not enter")
            time.sleep(0.01)
        second = subprocess.Popen([str(self.wrapper), "action", "list-tabs"], env=self.env,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.addCleanup(self.reap, second)
        try:
            with self.assertRaises(subprocess.TimeoutExpired):
                second.communicate(timeout=0.2)
        finally:
            (self.case.home / "release").touch()
            first_output = first.communicate(timeout=3)
            second_output = second.communicate(timeout=3)
        self.assertEqual(first.returncode, 0, first_output)
        self.assertEqual(second.returncode, 0, second_output)
        self.assertEqual(first_output[0], "native output\n")
        self.assertEqual(second_output[0], "native output\n")
        self.assertEqual(self.case.deliveries.read_text(), "payload\n")

    def reap(self, process):
        (self.case.home / "release").touch()
        process.communicate(timeout=3)

    def test_preserves_command_failure_without_recording_delivery(self):
        result = subprocess.run([str(self.wrapper), "fail"], env=self.env, text=True,
                                capture_output=True, timeout=3)
        self.assertEqual(result.returncode, 17)
        self.assertEqual(result.stderr, "real command failure\n")
        self.assertFalse(self.case.deliveries.exists())


class RunnerCleanup(unittest.TestCase):
    def test_reaps_client_when_session_stop_times_out(self):
        case = live_runner.LiveTabStatus()
        case.session = "fixture-session"
        case.client = Mock()
        case.run_command = Mock(side_effect=subprocess.TimeoutExpired("zellij", 5))
        with self.assertRaises(subprocess.TimeoutExpired):
            case.stop_session()
        case.client.communicate.assert_called_once_with(timeout=3)

    def test_kills_and_reaps_a_stalled_client(self):
        case = live_runner.LiveTabStatus()
        case.session = "fixture-session"
        case.client = Mock(pid=12345)
        case.client.communicate.side_effect = [subprocess.TimeoutExpired("script", 3), (None, None)]
        case.run_command = Mock()
        with patch("run.os.killpg") as kill:
            case.stop_session()
        kill.assert_called_once_with(12345, 9)
        self.assertEqual(case.client.communicate.call_count, 2)

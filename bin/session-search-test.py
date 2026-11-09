"""Test session-search with synthetic files. Never read a real session store."""
import contextlib
import datetime as dt
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / "skills" / "session-search" / "search.py"
PROMPT = "release changelog café 日本語 Привет 😀"


class SessionSearchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="session-search-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.pi = self.root / "pi"
        self.copilot = self.root / "copilot"
        self.pi.mkdir()
        self.copilot.mkdir()
        self.env = dict(os.environ, PI_SESSIONS_DIR=str(self.pi),
                        COPILOT_SESSIONS_DIR=str(self.copilot), PI_SESSION_FILE="",
                        PYTHONIOENCODING="ascii:strict", PYTHONDONTWRITEBYTECODE="1")
        # Set both roots before import as well as for each CLI process.
        with mock.patch.dict(os.environ, self.env):
            spec = importlib.util.spec_from_file_location("session_search", SCRIPT)
            self.search = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.search)
        self.now = dt.datetime.now().astimezone().replace(hour=12, minute=0, second=0, microsecond=0)
        self.inputs = {}
        self.pi_file = self.add_pi("pi-done", [PROMPT, "release follow-up"], age=1)
        self.add_pi("pi-open", ["release pending"], age=2, stop="toolUse")
        self.add_copilot("copilot-done", ["user.message", "assistant.turn_end"], age=0)
        self.add_copilot("copilot-open", ["user.message", "assistant.message"], age=3)

    def tearDown(self):
        for path, digest in self.inputs.items():
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest, str(path))

    def stamp(self, age):
        return (self.now - dt.timedelta(days=age)).isoformat()

    def save(self, path, events, age):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(json.dumps(e, ensure_ascii=False) for e in events) + "\n",
                        encoding="utf-8", newline="\n")
        timestamp = (self.now - dt.timedelta(days=age)).timestamp()
        os.utime(path, (timestamp, timestamp))
        self.inputs[path] = hashlib.sha256(path.read_bytes()).hexdigest()
        return path

    def add_pi(self, name, prompts, age=0, stop="stop", raw_reply="reply", start_age=None):
        events = [{"type": "session", "id": name, "cwd": str(self.root / "work"),
                   "timestamp": self.stamp(age if start_age is None else start_age)}]
        for prompt in prompts:
            events.append({"type": "message", "timestamp": self.stamp(age),
                           "message": {"role": "user", "content": [{"type": "text", "text": prompt}]}})
        events.append({"type": "message", "timestamp": self.stamp(age),
                       "message": {"role": "assistant", "content": raw_reply, "stopReason": stop}})
        return self.save(self.pi / "-synthetic-work" / (name + ".jsonl"), events, age)

    def add_copilot(self, name, kinds, age=0, start_data=None):
        events = [{"type": "session.start", "timestamp": self.stamp(age),
                   "data": start_data if start_data is not None else
                   {"startTime": self.stamp(age), "context": {"cwd": str(self.root / "work")}}}]
        events.extend({"type": kind, "timestamp": self.stamp(age), "data": {"content": "  release\n copilot  "}}
                      for kind in kinds)
        return self.save(self.copilot / name / "events.jsonl", events, age)

    def cli(self, *args, env=None, no_git=True):
        command = [sys.executable, "-B", str(SCRIPT)]
        if no_git:
            command.append("--no-git")
        result = subprocess.run(command + list(args), env=env or self.env, capture_output=True, timeout=20)
        return result

    def report(self, *args, env=None):
        result = self.cli(*args, "--json", env=env)
        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", errors="replace"))
        self.assertEqual(result.stderr, b"")
        report = json.loads(result.stdout)
        self.assertEqual(set(report), {"notes", "sessions"})
        return report

    def test_file_text_and_json_match_stdout_under_ascii_console(self):
        for mode in ([], ["--json"]):
            with self.subTest(mode=mode):
                stdout = self.cli("release", *mode)
                self.assertEqual(stdout.returncode, 0, stdout.stderr)
                path = self.root / ("new report 日本語 " + str(len(mode)) + ".txt")
                result = self.cli("release", *mode, "--output", str(path))
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stderr, b"")
                self.assertEqual(result.stdout.decode("utf-8").replace("\r\n", "\n"), f"Saved report to {path}\n")
                data = path.read_bytes()
                self.assertEqual(data, stdout.stdout.replace(b"\r\n", b"\n"))
                self.assertNotIn(b"\r", data)
                self.assertTrue(data.endswith(b"\n"))
                self.assertIn(PROMPT, data.decode("utf-8"))
                self.assertNotIn(PROMPT.encode("utf-8"), result.stdout)
                if mode:
                    self.assertEqual(json.loads(data), json.loads(stdout.stdout))

    def test_file_parity_with_notes_filters_and_no_results(self):
        day = (self.now - dt.timedelta(days=2)).date().isoformat()
        for index, args in enumerate((("changelogs",), ("zzzzzz",), ("--day", day),
                                      ("--unfinished", "--limit", "1"), ("--pi-only",),
                                      ("change-?log", "--regex"))):
            with self.subTest(args=args):
                env = dict(self.env, PI_SESSION_FILE=str(self.pi_file))
                expected = self.report(*args, env=env)
                path = self.root / f"filtered-{index}.json"
                result = self.cli(*args, "--json", "--output", str(path), env=env)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(path.read_bytes()), expected)
                self.assertEqual(len(result.stdout.splitlines()), 1)

    def test_stdout_modes_keep_unicode(self):
        for mode in ([], ["--json"]):
            result = self.cli("changelog", *mode)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(PROMPT, result.stdout.decode("utf-8"))

    def test_clients_resume_and_unfinished(self):
        rows = self.report()["sessions"]
        self.assertEqual([r["id"] for r in rows], ["copilot-done", "pi-done", "pi-open", "copilot-open"])
        self.assertEqual({r["tool"] for r in rows}, {"pi", "copilot"})
        for row in rows:
            command = "pi --session" if row["tool"] == "pi" else "copilot --resume"
            self.assertEqual(row["resume"], f"{command} {row['id']}")
            self.assertEqual(row["finished"], row["id"].endswith("done"))
            self.assertIsNone(row["git"])
        self.assertEqual({r["id"] for r in self.report("--unfinished")["sessions"]}, {"pi-open", "copilot-open"})
        self.assertEqual({r["tool"] for r in self.report("--pi-only")["sessions"]}, {"pi"})
        text = self.cli().stdout.decode("utf-8")
        self.assertIn("4 of 4 sessions (2 pi, 2 copilot)", text)
        self.assertIn("[copilot]", text)

    def test_missing_copilot_store(self):
        env = dict(self.env, COPILOT_SESSIONS_DIR=str(self.root / "missing"))
        self.assertEqual(len(self.report(env=env)["sessions"]), 2)

    def test_copilot_event_forms(self):
        for last in ("assistant.turn_end", "session.shutdown", "tool.execution_complete", "user.message", "assistant.message"):
            path = self.add_copilot("event-" + last, ["user.message", "assistant.turn_end", last])
            row = self.search.parse_copilot(path)
            self.assertEqual(row["stop"] == "stop", last in ("assistant.turn_end", "session.shutdown"))
            self.assertEqual(row["prompts"][0][1], "release copilot")
            self.assertEqual(row["end"], self.stamp(0))
            self.assertEqual(row["cwd"], str(self.root / "work"))
            self.assertEqual(row["start"], self.stamp(0))
        for data in ([], {"context": []}, {"context": {"cwd": 42}}):
            path = self.add_copilot("bad-context", [], start_data=data)
            row = self.search.parse_copilot(path)
            self.assertEqual(row["start"], self.stamp(0))
            self.assertIsNone(row["cwd"])
        events = [None, [], 42, "not an object", {"type": "user.message", "data": []},
                  {"type": "user.message", "data": {"content": "   "}},
                  {"type": "user.message", "data": {"content": ["not a string"]}},
                  {"type": "session.start", "timestamp": self.stamp(0),
                   "data": {"startTime": self.stamp(2)}},
                  {"type": "session.shutdown", "timestamp": self.stamp(0)}, {"type": "ignored"}]
        path = self.save(self.copilot / "bad-records" / "events.jsonl", events, 0)
        with path.open("a", encoding="utf-8") as stream:
            stream.write("invalid JSON\n")
        self.inputs[path] = hashlib.sha256(path.read_bytes()).hexdigest()
        row = self.search.parse_copilot(path)
        self.assertEqual(row["prompts"], [])
        self.assertEqual(row["start"], self.stamp(2))
        self.assertEqual(row["end"], self.stamp(0))
        self.assertEqual(row["stop"], "stop")
        (self.copilot / "no-events").mkdir()
        self.assertIn(path, list(self.search.copilot_candidates(self.copilot, 0)))

    def test_dates_limits_current_session_and_ranking(self):
        self.assertEqual([r["id"] for r in self.report("--since", "1.5")["sessions"]], ["copilot-done", "pi-done"])
        self.add_pi("pi-span", ["spanning"], age=0, start_age=5)
        day = (self.now - dt.timedelta(days=2)).date().isoformat()
        self.assertEqual({r["id"] for r in self.report("--day", day)["sessions"]}, {"pi-open", "pi-span"})
        ranked = self.report("RELEASE", "--limit", "1")["sessions"]
        self.assertEqual([r["id"] for r in ranked], ["pi-done"])
        self.assertEqual(ranked[0]["score"], 12)
        self.assertEqual(ranked[0]["hits"], {"RELEASE": 2})
        env = dict(self.env, PI_SESSION_FILE=str(self.pi_file))
        self.assertNotIn("pi-done", [r["id"] for r in self.report(env=env)["sessions"]])
        self.assertEqual(self.report("--limit", "0")["sessions"], [])

    def test_notes_regex_hit_cap_and_prompt_limits(self):
        corrected = self.report("changelogs")
        self.assertEqual(corrected["notes"], ["no match for 'changelogs'; close words: changelog (searched 'changelog')"])
        self.assertEqual([r["id"] for r in corrected["sessions"]], ["pi-done"])
        self.assertIn("NOTE: no match for 'changelogs'", self.cli("changelogs").stdout.decode("utf-8"))
        self.assertEqual([r["id"] for r in self.report("change-?log", "--regex")["sessions"]], ["pi-done"])
        self.assertEqual(self.report("zzzzzz")["sessions"], [])
        self.add_pi("pi-cap", ["needle " + "x" * 400, "y" * 400], raw_reply="needle " * 400)
        row = self.report("needle")["sessions"][0]
        self.assertEqual(row["hits"], {"needle": 200})
        self.assertEqual(row["score"], 205)
        self.assertEqual(len(row["first_prompt"]), 300)
        self.assertEqual(len(row["last_prompt"]), 300)
        self.assertEqual(row["prompts"], 2)
        text = self.cli("needle").stdout.decode("utf-8")
        self.assertIn("   first:  " + row["first_prompt"][:160] + "\n", text.replace("\r\n", "\n"))

    def test_optional_git_state(self):
        result = self.cli("changelog", "--json", no_git=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["sessions"][0]["git"], "folder gone")
        stdout = io.StringIO()
        with mock.patch.dict(os.environ, self.env), contextlib.redirect_stdout(stdout), \
                mock.patch.object(self.search, "git_state", return_value="branch; clean") as git:
            self.assertEqual(self.search.main(["changelog", "--json"]), 0)
            git.assert_called_once_with(str(self.root / "work"))
        self.assertEqual(json.loads(stdout.getvalue())["sessions"][0]["git"], "branch; clean")

    def assert_output_error(self, path):
        result = self.cli("--output", str(path))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, b"")
        self.assertIn("Cannot write report", result.stderr.decode("utf-8"))
        self.assertNotIn(b"Traceback", result.stderr)

    def test_existing_file_directory_and_input_refused(self):
        path = self.root / "existing.txt"
        path.write_bytes(b"keep\x00\xff\r\n")
        self.assert_output_error(path)
        self.assertEqual(path.read_bytes(), b"keep\x00\xff\r\n")
        self.assert_output_error(self.pi)
        self.assertTrue(self.pi.is_dir())
        self.assert_output_error(self.pi_file)

    def test_missing_parent_refused(self):
        path = self.root / "missing-parent" / "report.txt"
        self.assert_output_error(path)
        self.assertFalse(path.parent.exists())

    def test_existing_links_refused(self):
        target = self.root / "target.txt"
        target.write_bytes(b"keep link target")
        for name, destination, directory in (("file-link", target, False),
                                             ("dangling-link", self.root / "absent", False),
                                             ("directory-link", self.pi, True)):
            with self.subTest(name=name):
                path = self.root / name
                try:
                    path.symlink_to(destination, target_is_directory=directory)
                except (OSError, NotImplementedError) as error:
                    self.skipTest(f"Link creation is not supported: {error}")
                self.assert_output_error(path)
                self.assertTrue(path.is_symlink())
                self.assertEqual(path.readlink(), destination)
        self.assertEqual(target.read_bytes(), b"keep link target")
        self.assertFalse((self.root / "absent").exists())

    def test_open_write_and_close_failures(self):
        real_open = open
        for stage in ("open", "write", "close"):
            with self.subTest(stage=stage):
                path = self.root / (stage + ".txt")

                class FailedStream:
                    def __enter__(self):
                        self.stream = real_open(path, "x", encoding="utf-8", newline="\n")
                        return self

                    def write(self, text):
                        self.stream.write(text[:8] if stage == "write" else text)
                        if stage == "write":
                            raise OSError("synthetic write failure")

                    def __exit__(self, *args):
                        self.stream.close()
                        if stage == "close":
                            raise OSError("synthetic close failure")

                stdout, stderr = io.StringIO(), io.StringIO()
                with mock.patch.dict(os.environ, self.env), contextlib.redirect_stdout(stdout), \
                        contextlib.redirect_stderr(stderr), \
                        mock.patch("builtins.open", side_effect=PermissionError("synthetic permission failure")
                                   if stage == "open" else None, return_value=FailedStream()) as opened:
                    code = self.search.main(["--no-git", "--output", str(path)])
                self.assertNotEqual(code, 0)
                opened.assert_called_once_with(str(path), "x", encoding="utf-8", newline="\n")
                self.assertEqual(stdout.getvalue(), "")
                self.assertIn("Cannot write report", stderr.getvalue())
                self.assertEqual(path.exists(), stage != "open")
                if stage != "open":
                    self.assertIn("partial", stderr.getvalue())
                    self.assertGreater(path.stat().st_size, 0)

    def test_invalid_output_path(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch.dict(os.environ, self.env), contextlib.redirect_stdout(stdout), \
                contextlib.redirect_stderr(stderr):
            code = self.search.main(["--no-git", "--output", "invalid\x00path"])
        self.assertNotEqual(code, 0)
        self.assertEqual(stdout.getvalue(), "")
        self.assertIn("Cannot write report", stderr.getvalue())

    def test_render_failure_does_not_create_output(self):
        path = self.root / "not-created.json"
        with mock.patch.dict(os.environ, self.env), \
                mock.patch.object(self.search.json, "dumps", side_effect=ValueError("synthetic render failure")):
            with self.assertRaisesRegex(ValueError, "synthetic render failure"):
                self.search.main(["--no-git", "--json", "--output", str(path)])
        self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)

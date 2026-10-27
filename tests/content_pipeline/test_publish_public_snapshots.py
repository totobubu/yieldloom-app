import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PUBLISH_SCRIPT = ROOT / "scripts/content_pipeline/publish_public_snapshots.sh"


class PublicSnapshotPublisherTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.remote = self.root / "origin.git"
        self.seed = self.root / "seed"
        self.publisher = self.root / "publisher"
        self.rival = self.root / "rival"
        self.git("init", "--bare", str(self.remote))
        self.git("init", "-b", "work", str(self.seed))
        self.configure(self.seed)
        self.write(self.seed, "public/content-studio/seed.json", "seed\n")
        self.git("add", ".", cwd=self.seed)
        self.git("commit", "-m", "seed", cwd=self.seed)
        self.git("remote", "add", "origin", str(self.remote), cwd=self.seed)
        self.git("push", "-u", "origin", "work", cwd=self.seed)
        self.git("clone", str(self.remote), str(self.publisher))
        self.configure(self.publisher)
        self.git("switch", "work", cwd=self.publisher)

    def git(self, *args, cwd=None, check=True):
        return subprocess.run(
            ["git", *args],
            cwd=cwd or self.root,
            check=check,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )

    def configure(self, path):
        self.git("config", "user.name", "Snapshot Test", cwd=path)
        self.git("config", "user.email", "snapshot-test@example.invalid", cwd=path)

    def write(self, repo, relative_path, content):
        path = repo / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def run_publisher(self, race_git_push=False):
        env = os.environ.copy()
        env.update(
            GITHUB_REF_NAME="work",
            REFRESH_SCOPE="provider",
            REFRESH_REQUEST_ID="test-run",
            CONTENT_STUDIO_PUBLISH_MAX_ATTEMPTS="3",
        )
        if race_git_push:
            real_git = shutil.which("git")
            wrapper_dir = self.root / "git-wrapper"
            wrapper_dir.mkdir()
            wrapper = wrapper_dir / "git"
            wrapper.write_text(
                "#!/usr/bin/env bash\n"
                "if [[ \"$1\" == push && \"$PWD\" == \"$PUBLISHER_PATH\" && ! -e \"$RACE_MARKER\" ]]; then\n"
                "  touch \"$RACE_MARKER\"\n"
                "  \"$REAL_GIT\" -C \"$RIVAL_PATH\" add public/content-studio/provider-other.json\n"
                "  \"$REAL_GIT\" -C \"$RIVAL_PATH\" commit -m 'concurrent update'\n"
                "  \"$REAL_GIT\" -C \"$RIVAL_PATH\" push origin work\n"
                "fi\n"
                "exec \"$REAL_GIT\" \"$@\"\n",
                encoding="utf-8",
            )
            wrapper.chmod(0o755)
            env.update(
                PATH=f"{wrapper_dir}:{env['PATH']}",
                REAL_GIT=real_git,
                PUBLISHER_PATH=str(self.publisher),
                RIVAL_PATH=str(self.rival),
                RACE_MARKER=str(self.root / "race-pushed"),
            )
        return subprocess.run(
            ["bash", str(PUBLISH_SCRIPT), "work"],
            cwd=self.publisher,
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )

    def make_remote_change(self, path, content):
        self.git("clone", str(self.remote), str(self.rival))
        self.configure(self.rival)
        self.git("switch", "work", cwd=self.rival)
        self.write(self.rival, path, content)
        self.git("add", path, cwd=self.rival)
        self.git("commit", "-m", "concurrent remote update", cwd=self.rival)
        self.git("push", "origin", "work", cwd=self.rival)

    def remote_file(self, path):
        return self.git("show", f"origin/work:{path}", cwd=self.publisher).stdout

    def test_rebases_when_remote_branch_advanced_and_preserves_both_changes(self):
        self.write(self.publisher, "public/content-studio/provider-rex.json", "rex snapshot\n")
        self.make_remote_change("public/content-studio/provider-other.json", "other provider\n")

        result = self.run_publisher()

        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("replaying the snapshot commit", result.stdout)
        self.git("fetch", "origin", "work", cwd=self.publisher)
        self.assertEqual(self.remote_file("public/content-studio/provider-other.json"), "other provider\n")
        self.assertEqual(self.remote_file("public/content-studio/provider-rex.json"), "rex snapshot\n")

    def test_same_file_conflict_fails_with_path_and_keeps_remote_version(self):
        path = "public/content-studio/shared.json"
        self.write(self.publisher, path, "same base\nlocal snapshot\n")
        self.make_remote_change(path, "same base\nremote update\n")

        result = self.run_publisher()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("snapshot rebase conflicts", result.stdout)
        self.assertIn(path, result.stdout)
        script = PUBLISH_SCRIPT.read_text(encoding="utf-8")
        self.assertIn('git push origin "HEAD:refs/heads/$branch"', script)
        self.assertNotIn("--force", script)
        self.git("fetch", "origin", "work", cwd=self.publisher)
        self.assertEqual(self.remote_file(path), "same base\nremote update\n")

    def test_no_changes_exits_without_creating_or_pushing_a_commit(self):
        before = self.git("rev-parse", "origin/work", cwd=self.publisher).stdout.strip()

        result = self.run_publisher()

        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("No public Content Studio changes", result.stdout)
        after = self.git("ls-remote", "origin", "refs/heads/work", cwd=self.publisher).stdout.split()[0]
        self.assertEqual(after, before)

    def test_normal_publish_pushes_generated_snapshot(self):
        self.write(self.publisher, "public/content-studio/provider-rex.json", "rex snapshot\n")

        result = self.run_publisher()

        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("Published snapshot commit", result.stdout)
        self.git("fetch", "origin", "work", cwd=self.publisher)
        self.assertEqual(self.remote_file("public/content-studio/provider-rex.json"), "rex snapshot\n")

    def test_retries_after_remote_advances_between_fetch_and_push(self):
        self.write(self.publisher, "public/content-studio/provider-rex.json", "rex snapshot\n")
        self.git("clone", str(self.remote), str(self.rival))
        self.configure(self.rival)
        self.git("switch", "work", cwd=self.rival)
        self.write(self.rival, "public/content-studio/provider-other.json", "other provider\n")

        result = self.run_publisher(race_git_push=True)

        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("Push attempt 1 was rejected", result.stdout)
        self.assertIn("Attempt 2/3", result.stdout)
        self.git("fetch", "origin", "work", cwd=self.publisher)
        self.assertEqual(self.remote_file("public/content-studio/provider-other.json"), "other provider\n")
        self.assertEqual(self.remote_file("public/content-studio/provider-rex.json"), "rex snapshot\n")


if __name__ == "__main__":
    unittest.main()

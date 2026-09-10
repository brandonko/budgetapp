#!/usr/bin/env python3
"""Install/update Ledger on a dedicated Debian VM. Python standard library only."""

from __future__ import annotations

import argparse
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from datetime import datetime, timezone
from urllib.request import urlopen

BASE = Path("/opt/ledger")
DATA = Path("/var/lib/ledger")
BACKUPS = Path("/var/backups/ledger")
CONFIG = Path("/etc/ledger-deploy.json")
SERVICE = "ledger.service"


def run(*args: str, **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(args, check=True, **kwargs)


def unpack_release(content: bytes, target: Path) -> None:
    """Extract only regular source files; never accept private data or links."""
    with tarfile.open(fileobj=io.BytesIO(content)) as archive:
        members = archive.getmembers()
        for member in members:
            path = PurePosixPath(member.name)
            if (path.is_absolute() or ".." in path.parts or "\\" in member.name
                    or not path.parts or path.parts[0] in {"data", "raw_data_files", ".git"}
                    or not (member.isfile() or member.isdir())):
                raise ValueError(f"Unsafe release entry: {member.name}")
        for member in members:
            destination = target.joinpath(*PurePosixPath(member.name).parts)
            if member.isdir():
                destination.mkdir(parents=True, exist_ok=True)
                destination.chmod(0o755)
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(member) as source, destination.open("xb") as output:
                    shutil.copyfileobj(source, output)
                destination.chmod(0o755 if member.mode & 0o111 else 0o644)


def snapshot(data: Path, backups: Path) -> Path:
    """Called only after Ledger has stopped so the whole data directory agrees."""
    backups.mkdir(parents=True, exist_ok=True, mode=0o700)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    result = backups / f"ledger-{timestamp}.tar.gz"
    with result.open("xb") as output:
        result.chmod(0o600)
        with tarfile.open(fileobj=output, mode="w:gz") as archive:
            archive.add(data, arcname="ledger")
        output.flush()
        os.fsync(output.fileno())
    return result


def select_release(release: Path) -> None:
    temporary = BASE / "current.next"
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(release, target_is_directory=True)
    os.replace(temporary, BASE / "current")


def healthy() -> bool:
    if subprocess.run(["systemctl", "is-active", "--quiet", SERVICE]).returncode:
        return False
    try:
        with urlopen("http://127.0.0.1:8000/", timeout=2) as response:
            return response.status == 200 and b"Ledger" in response.read(100_000)
    except OSError:
        return False


def install(repository: str, branch: str) -> None:
    if CONFIG.exists() or (BASE / "current").exists():
        raise RuntimeError("Ledger is already installed. Run sudo ledger-deploy to update it.")
    # GitHub deploy keys, if needed, belong to root (the operator), not the web service.
    if not repository.startswith(("https://", "git@", "ssh://")):
        raise ValueError("Use an HTTPS or SSH Git repository URL.")
    run("git", "check-ref-format", "--branch", branch, stdout=subprocess.DEVNULL)
    run("useradd", "--system", "--user-group", "--home-dir", str(DATA),
        "--shell", "/usr/sbin/nologin", "ledger")
    DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
    shutil.chown(DATA, user="ledger", group="ledger")
    BASE.mkdir(parents=True, exist_ok=True, mode=0o755)
    shutil.copyfile(Path(__file__).with_name(SERVICE), Path("/etc/systemd/system") / SERVICE)
    shutil.copyfile(Path(__file__), "/usr/local/sbin/ledger-deploy")
    Path("/usr/local/sbin/ledger-deploy").chmod(0o755)
    CONFIG.write_text(json.dumps({"repository": repository, "branch": branch}) + "\n")
    CONFIG.chmod(0o600)
    run("systemctl", "daemon-reload")
    run("systemctl", "enable", SERVICE)


def deploy() -> None:
    config = json.loads(CONFIG.read_text())
    repository = BASE / "repository.git"
    if not repository.exists():
        run("git", "clone", "--bare", "--", config["repository"], str(repository))
    run("git", "-C", str(repository), "fetch", "origin",
        f"+refs/heads/{config['branch']}:refs/heads/{config['branch']}")
    revision = run("git", "-C", str(repository), "rev-parse", f"refs/heads/{config['branch']}^{{commit}}",
                   capture_output=True, text=True).stdout.strip()
    current = BASE / "current"
    if current.exists() and (current / ".ledger-revision").read_text().strip() == revision and healthy():
        print(f"Ledger is already running {revision[:12]}.", flush=True)
        return
    releases = BASE / "releases"
    releases.mkdir(exist_ok=True, mode=0o755)
    release = Path(tempfile.mkdtemp(prefix=revision[:12] + "-", dir=releases))
    release.chmod(0o755)
    archive = run("git", "-C", str(repository), "archive", "--format=tar", revision, capture_output=True).stdout
    unpack_release(archive, release)
    (release / ".ledger-revision").write_text(revision + "\n")
    print(f"Testing {revision[:12]} before changing the running service...", flush=True)
    run("runuser", "-u", "ledger", "--", "/usr/bin/python3", "-B", "scripts/verify.py", cwd=release)
    # Pending import reviews are in memory. Finish/cancel them before invoking deployment.
    run("systemctl", "stop", SERVICE)
    try:
        backup = snapshot(DATA, BACKUPS)
    except Exception:
        if current.exists():
            run("systemctl", "start", SERVICE)
        raise
    print(f"Data backup: {backup}", flush=True)
    previous = current.resolve() if current.exists() else None
    try:
        select_release(release)
        run("systemctl", "start", SERVICE)
        for _ in range(20):
            if healthy():
                print(f"Deployed {revision[:12]}. Open http://YOUR_VM_IP:8000", flush=True)
                return
            time.sleep(1)
        raise RuntimeError("Ledger did not become healthy within 20 seconds.")
    except Exception:
        run("systemctl", "stop", SERVICE)
        if previous:
            select_release(previous)
        # Startup may have migrated data: never silently restore or discard it.
        print(f"Deployment failed; Ledger is stopped. Data is preserved; backup: {backup}. "
              "Inspect sudo journalctl -u ledger -n 60 before restarting or restoring.", file=sys.stderr)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install", action="store_true")
    parser.add_argument("--repository", default="https://github.com/brandonko/budgetapp.git")
    parser.add_argument("--branch", default="main")
    args = parser.parse_args()
    if sys.platform != "linux" or os.geteuid() != 0:
        parser.error("Run this command with sudo inside the Debian VM.")
    import fcntl
    with Path("/run/ledger-deploy.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.error("Another Ledger deployment is already running.")
        try:
            if args.install:
                install(args.repository, args.branch)
            deploy()
        except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
            print(f"Deployment failed: {error}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

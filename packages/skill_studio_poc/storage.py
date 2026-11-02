"""Conservative POSIX filesystem adapter for a single Skill source file.

Scope: a cooperating writer may use this module to serialize saves under
an advisory parent-directory flock. os.replace is atomic visibility, but not a kernel
compare-and-swap: unrelated writers ignoring the lock can still race between
our final check and replace. No unqualified cross-process safety is claimed.

No Symlink / hardlink editing, multi-file transactions, Windows support,
metadata-complete preservation, or automatic conflict resolution.
"""
from __future__ import annotations

import contextlib
from dataclasses import dataclass
import os
from pathlib import Path
import stat
import tempfile

from .session import EditorSession, EditRejected

try:
    import fcntl
except ImportError:  # pragma: no cover - explicit fail-closed on non-POSIX
    fcntl = None


class FileSaveRejected(EditRejected):
    """A file operation is unsafe or disk state no longer matches the plan."""


class FileSaveUncertain(FileSaveRejected):
    """Rename may have succeeded, but durability/acknowledgement did not.

    Caller must re-read disk; never treat this as safely rolled back.
    """


@dataclass(frozen=True)
class DiskSnapshot:
    text: str
    identity: tuple[int, int, int, int, int, int, int]


_OPEN_FLAGS = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)


def _require_posix() -> None:
    if os.name != "posix" or fcntl is None or not hasattr(os, "O_NOFOLLOW"):
        raise FileSaveRejected("POSIX flock and O_NOFOLLOW required; unsupported platform")


def _identity(st: os.stat_result) -> tuple[int, int, int, int, int, int, int]:
    return (st.st_dev, st.st_ino, st.st_mode, st.st_nlink, st.st_size,
            st.st_mtime_ns, st.st_ctime_ns)


def _regular_single_link(st: os.stat_result) -> None:
    if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
        raise FileSaveRejected("only a regular, non-hardlinked source file is supported")


def _read_snapshot(path: Path) -> DiskSnapshot:
    _require_posix()
    try:
        before = path.lstat()
        _regular_single_link(before)
        fd = os.open(path, _OPEN_FLAGS)
    except (OSError, ValueError) as exc:
        if isinstance(exc, FileSaveRejected):
            raise
        raise FileSaveRejected(f"unable to securely open source: {exc}") from exc
    try:
        opened = os.fstat(fd)
        _regular_single_link(opened)
        if _identity(before) != _identity(opened):
            raise FileSaveRejected("source inode changed during open")
        chunks = []
        byte_count = 0
        while True:
            chunk = os.read(fd, 1024 * 1024)
            if not chunk:
                break
            byte_count += len(chunk)
            if byte_count > 32 * 1024 * 1024:
                raise FileSaveRejected("file larger than the supported 32 MiB limit")
            chunks.append(chunk)
        if _identity(os.fstat(fd)) != _identity(opened):
            raise FileSaveRejected("source changed while being read")
        if _identity(path.lstat()) != _identity(opened):
            raise FileSaveRejected("source path changed during read")
        try:
            text = b"".join(chunks).decode("utf-8", errors="strict")
        except UnicodeDecodeError as exc:
            raise FileSaveRejected("source must be valid UTF-8") from exc
        return DiskSnapshot(text, _identity(opened))
    except OSError as exc:
        raise FileSaveRejected(f"source changed or became inaccessible: {exc}") from exc
    finally:
        os.close(fd)


@contextlib.contextmanager
def _locked_source(path: Path):
    """Serialize cooperating saves via a lock on the existing parent directory.

    No sidecar lock file is created inside the Skill Package: such a file
    would silently change the Host's complete Skill artifact digest.
    """
    _require_posix()
    parent = path.parent
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)
    fd = -1
    try:
        fd = os.open(parent, flags)
        before = os.fstat(fd)
        if not stat.S_ISDIR(before.st_mode):
            raise FileSaveRejected("parent is not a directory")
        fcntl.flock(fd, fcntl.LOCK_EX)
        after = parent.lstat()
        if (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino):
            raise FileSaveRejected("directory path changed while acquiring lock")
    except (OSError, ValueError, FileSaveRejected) as exc:
        if fd >= 0:
            os.close(fd)
        if isinstance(exc, FileSaveRejected):
            raise
        raise FileSaveRejected(f"cannot lock source parent directory: {exc}") from exc
    try:
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def load_session(path: str | Path, profile: str = "ensure-pdu-session") -> EditorSession:
    path = Path(path)
    with _locked_source(path):
        snapshot = _read_snapshot(path)
    return EditorSession.open(snapshot.text, profile)


def observe_session(path: str | Path, session: EditorSession) -> EditorSession:
    path = Path(path)
    with _locked_source(path):
        snapshot = _read_snapshot(path)
    return session.observe_disk(snapshot.text)


def _check_pre_replace(path: Path, expected: DiskSnapshot) -> None:
    """Final check before rename; advisory lock protects cooperating writers."""
    actual = _read_snapshot(path)
    if actual != expected:
        raise FileSaveRejected("source changed between temporary write and replace")


def save_session(
    path: str | Path, session: EditorSession, *,
    package_root: Path | None = None, staging_dir: Path | None = None,
) -> EditorSession:
    """Safely replace a single source under cooperating POSIX flock discipline.

    Before replace: all failures preserve the original file and session.
    After replace: fsync failure is *uncertain*, never claim rollback.
    """
    path = Path(path)
    if package_root is None or staging_dir is None:
        raise FileSaveRejected("explicit outside-package staging_dir and package_root required")
    # No in-package temp files, even transiently: the Host artifact identity
    # enumerates the entire Skill directory while saves may be in progress.
    from .workspace import _private_stage_folder
    staging_dir = Path(staging_dir)
    _private_stage_folder(staging_dir, Path(package_root), path.parent)
    with _locked_source(path):
        snapshot = _read_snapshot(path)
        # This must reject stale snapshots / conflicts before temp files exist.
        plan = session.prepare_save(snapshot.text)
        if plan.text == snapshot.text:
            return session.acknowledge_save(plan, snapshot.text)
        fd = -1
        staged: str | None = None
        replaced = False
        try:
            fd, staged = tempfile.mkstemp(prefix="skillstudio-single-", dir=staging_dir)
            # Preserve standard mode bits; ACLs, xattrs, ownership, and other
            # metadata are intentionally not asserted to be preserved.
            os.fchmod(fd, stat.S_IMODE(snapshot.identity[2]))
            with os.fdopen(fd, "wb") as output:
                fd = -1
                output.write(plan.text.encode("utf-8", errors="strict"))
                output.flush()
                os.fsync(output.fileno())
            _check_pre_replace(path, snapshot)
            os.replace(staged, path)  # atomic visibility on the same filesystem
            replaced = True
            staged = None
            dirfd = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(dirfd)
            finally:
                os.close(dirfd)
            return session.acknowledge_save(plan, plan.text)
        except Exception as exc:
            if replaced:
                raise FileSaveUncertain("rename may have succeeded; re-read disk before further edits") from exc
            raise
        finally:
            if fd >= 0:
                os.close(fd)
            if staged is not None:
                try:
                    os.unlink(staged)
                except FileNotFoundError:
                    pass

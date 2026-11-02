"""Explicit polling and same-directory batch saves for Skill source editing.

This is not a background watcher or a globally atomic multi-file transaction.
It never silently writes external changes into an EditorSession. It handles
only an explicitly listed set of already existing files in one source folder.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Mapping
import os
import stat
import tempfile

from .session import EditorSession, EditRejected
from .storage import (
    DiskSnapshot, FileSaveRejected, FileSaveUncertain, _identity,
    _locked_source, _read_snapshot, _require_posix, _check_pre_replace,
)


@dataclass(frozen=True)
class WatchEvent:
    path: Path
    kind: Literal["CONTENT_CHANGED", "REPLACED_SAME_CONTENT", "UNAVAILABLE", "UNCHANGED"]
    details: str = ""


class WorkspaceWatcher:
    """Caller-driven polling; no thread, notification loop or OS watch service.

    At construction, each EditorSession must match its on-disk saved baseline.
    Polling observes only registered source files. An unreadable/missing file
    remains blocked until it can be observed again. A content change is fed
    to EditorSession.observe_disk, which preserves the user's unsaved draft.
    """
    def __init__(self, sessions: Mapping[Path, EditorSession]):
        if not sessions:
            raise ValueError("at least one source file is required")
        self.sessions: dict[Path, EditorSession] = {}
        self._seen: dict[Path, DiskSnapshot] = {}
        self._unavailable: set[Path] = set()
        for raw, session in sessions.items():
            path = Path(raw)
            if path in self.sessions:
                raise ValueError("duplicate source file")
            with _locked_source(path):
                snap = _read_snapshot(path)
            if snap.text != session.saved_text:
                raise FileSaveRejected("watch baseline differs from persisted source")
            self.sessions[path] = session
            self._seen[path] = snap

    @property
    def blocked_paths(self) -> frozenset[Path]:
        return frozenset(self._unavailable | {
            p for p, session in self.sessions.items() if session.is_conflicted
        })

    def poll(self) -> tuple[WatchEvent, ...]:
        events = []
        for path in self.sessions:
            try:
                with _locked_source(path):
                    snap = _read_snapshot(path)
            except FileSaveRejected as exc:
                self._unavailable.add(path)
                events.append(WatchEvent(path, "UNAVAILABLE", str(exc)))
                continue
            previous = self._seen[path]
            previously_unavailable = path in self._unavailable
            self._unavailable.discard(path)
            if snap.text != previous.text:
                self.sessions[path] = self.sessions[path].observe_disk(snap.text)
                kind = "CONTENT_CHANGED"
            elif snap.identity != previous.identity or previously_unavailable:
                kind = "REPLACED_SAME_CONTENT"
            else:
                kind = "UNCHANGED"
            self._seen[path] = snap
            events.append(WatchEvent(path, kind))
        return tuple(events)

    def adopt_saved(self, updated: Mapping[Path, EditorSession]) -> None:
        """Rebase observations after an acknowledged save; re-read exact text."""
        if set(updated) != set(self.sessions):
            raise ValueError("all watched files must be supplied")
        snapshots: dict[Path, DiskSnapshot] = {}
        for path, session in updated.items():
            with _locked_source(path):
                snap = _read_snapshot(path)
            if session.is_dirty or session.is_conflicted or snap.text != session.saved_text:
                raise FileSaveRejected("saved session does not match disk or has unsaved changes")
            snapshots[path] = snap
        self.sessions = dict(updated)
        self._seen = snapshots
        self._unavailable.clear()


class BatchSaveUncertain(FileSaveUncertain):
    """Some replaces may have occurred. Never infer a successful rollback."""
    def __init__(self, replaced_paths: tuple[Path, ...], reason: BaseException):
        self.replaced_paths = replaced_paths
        super().__init__(
            f"batch save incomplete after {len(replaced_paths)} replace(s); "
            f"re-read *all* files and explicitly resolve; underlying: {reason}"
        )


def _private_stage_folder(staging_dir: Path, package_root: Path, destination: Path) -> None:
    """Check that temporary artifacts never live inside the Skill Package."""
    _require_posix()
    if not staging_dir.is_absolute() or not package_root.is_absolute():
        raise FileSaveRejected("package_root and staging_dir must be absolute")
    try:
        stage_lstat = staging_dir.lstat()
        root_lstat = package_root.lstat()
        parent_lstat = destination.lstat()
    except OSError as exc:
        raise FileSaveRejected("package, stage or destination unavailable") from exc
    if not stat.S_ISDIR(stage_lstat.st_mode) or stage_lstat.st_uid != os.getuid():
        raise FileSaveRejected("staging directory must be owned by this user")
    if stat.S_IMODE(stage_lstat.st_mode) & 0o077:
        raise FileSaveRejected("staging directory must be private (mode 0700)")
    if not stat.S_ISDIR(root_lstat.st_mode):
        raise FileSaveRejected("package root must be a real directory")
    if not stat.S_ISDIR(parent_lstat.st_mode):
        raise FileSaveRejected("destination parent must be a real directory")
    if stage_lstat.st_dev != parent_lstat.st_dev:
        raise FileSaveRejected("staging and destination must be on the same filesystem")
    if staging_dir.resolve().is_relative_to(package_root.resolve()):
        raise FileSaveRejected("staging directory must be outside Skill Package")
    if destination.resolve() != package_root.resolve() and not destination.resolve().is_relative_to(package_root.resolve()):
        raise FileSaveRejected("destination directory must be inside Skill Package")


def save_batch(
    sessions: Mapping[Path, EditorSession], *,
    package_root: Path, staging_dir: Path,
) -> dict[Path, EditorSession]:
    """Preflight all, stage all outside Package, then replace sequentially.

    Restricted to multiple existing files sharing one parent (e.g. the three
    assurance YAML files). A single flock covers cooperating writers. A failure
    *after any replacement* is explicitly partial/uncertain, never rolled back.
    There is no atomic multi-file visibility or crash-recovery journal.
    """
    _require_posix()
    if len(sessions) < 2:
        raise FileSaveRejected("batch save requires two or more existing source files")
    items = sorted(((Path(p), s) for p, s in sessions.items()), key=lambda x: str(x[0]))
    paths = [p for p, _ in items]
    if len(set(paths)) != len(paths):
        raise FileSaveRejected("duplicate paths in batch")
    if any(not p.is_absolute() or p.name in (".", "..") or ".." in p.parts for p in paths):
        raise FileSaveRejected("batch paths must be absolute and contain no traversal")
    parent = paths[0].parent
    if any(p.parent != parent for p in paths):
        raise FileSaveRejected("batch must share a single parent directory")
    package_root = Path(package_root)
    staging_dir = Path(staging_dir)
    _private_stage_folder(staging_dir, package_root, parent)

    with _locked_source(paths[0]):
        before: dict[Path, DiskSnapshot] = {}
        plans = {}
        # Preflight *every* source before staging anything.
        for path, session in items:
            snap = _read_snapshot(path)
            before[path] = snap
            plans[path] = session.prepare_save(snap.text)
        changed = [p for p in paths if plans[p].text != before[p].text]
        if not changed:
            return {p: session.acknowledge_save(plans[p], before[p].text) for p, session in items}

        staged: dict[Path, str] = {}
        replaced: list[Path] = []
        fd = -1
        try:
            for path in changed:
                fd, temporary = tempfile.mkstemp(prefix="skillstudio-batch-", dir=staging_dir)
                staged[path] = temporary
                os.fchmod(fd, stat.S_IMODE(before[path].identity[2]))
                with os.fdopen(fd, "wb") as output:
                    fd = -1
                    output.write(plans[path].text.encode("utf-8", errors="strict"))
                    output.flush()
                    os.fsync(output.fileno())
            # Revalidate every source before the first replacement.
            for path in paths:
                _check_pre_replace(path, before[path])
            for path in changed:
                # Detect a cooperating *or* observed non-cooperating interleaving.
                _check_pre_replace(path, before[path])
                os.replace(staged[path], path)
                replaced.append(path)
                del staged[path]
            parent_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fsync(parent_fd)
            finally:
                os.close(parent_fd)
            return {
                path: session.acknowledge_save(plans[path], plans[path].text)
                for path, session in items
            }
        except Exception as exc:
            if replaced:
                raise BatchSaveUncertain(tuple(replaced), exc) from exc
            raise
        finally:
            if fd >= 0:
                os.close(fd)
            for temp_path in staged.values():
                try:
                    os.unlink(temp_path)
                except FileNotFoundError:
                    pass

"""Opt-in durable intent around the existing non-atomic POSIX save_batch.

Journal is written outside Skill Package before any rename. A surviving
intent only classifies file states; it never performs automatic rollback.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Mapping

from .package_guard import (
    PackageGuardError, PackageSnapshot, capture_package, assert_opaque_unchanged,
    write_recovery_intent, inspect_recovery,
)
from .session import EditorSession
from .workspace import save_batch, BatchSaveUncertain


class RecoveryRequired(PackageGuardError):
    def __init__(self, journal: Path, message: str):
        self.journal = journal
        super().__init__(f"{message}; inspect journal {journal} before any new save")


def _clear_intent(journal: Path) -> None:
    journal.unlink()
    fd = os.open(journal.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def save_batch_recoverable(
    sessions: Mapping[Path, EditorSession], *,
    package_root: Path, staging_dir: Path, expected_package: PackageSnapshot,
) -> dict[Path, EditorSession]:
    """Full-package preflight + durable intent + existing bounded batch writer.

    Requires the caller's package inventory from when the workspace opened.
    Every preflight path is exact. Any pending journal blocks new writes.
    Never claims atomic multi-file visibility, durability after an uncertain
    crash, or protection against unrelated processes that ignore flock.
    """
    root = Path(package_root).resolve(strict=True)
    stage = Path(staging_dir)
    if root != expected_package.root:
        raise PackageGuardError("expected snapshot belongs to another package")
    if not sessions:
        raise PackageGuardError("cannot save an empty package batch")
    if any(stage.glob('skillstudio-recovery-*.json')):
        raise PackageGuardError("unresolved recovery record blocks new saves")
    current = capture_package(root)
    names: dict[Path, str] = {}
    for raw_path, session in sessions.items():
        path = Path(raw_path)
        if not path.is_absolute() or path.is_symlink() or not path.is_relative_to(root):
            raise PackageGuardError("source path must be an absolute package file")
        name = path.relative_to(root).as_posix()
        if name in names.values() or name not in current.hashes:
            raise PackageGuardError("duplicate or missing package source")
        names[path] = name
        if hashlib.sha256(session.saved_text.encode('utf-8')).hexdigest() != current.hashes[name]:
            raise PackageGuardError("session baseline differs from package source")
    assert_opaque_unchanged(expected_package, current, set(names.values()))
    # Existing managed file baselines must also match the caller's package
    # snapshot. No rebasing a divergent known file into the journal.
    if any(expected_package.hashes.get(name) != current.hashes[name] for name in names.values()):
        raise PackageGuardError("managed source changed since package snapshot")
    changed = {names[p]: s.working_text.encode('utf-8')
               for p, s in sessions.items() if s.working_text != s.saved_text}
    if not changed:
        return save_batch(sessions, package_root=root, staging_dir=stage)
    # Intent is durable before the existing batch writer can perform any rename.
    journal = write_recovery_intent(stage, current, changed)
    try:
        result = save_batch(sessions, package_root=root, staging_dir=stage)
    except Exception as exc:
        try:
            assessment = inspect_recovery(journal, root)
        except (PackageGuardError, OSError) as scan_exc:
            raise RecoveryRequired(journal, "cannot classify failed batch") from scan_exc
        if assessment.status == 'NOT_APPLIED' and not isinstance(exc, BatchSaveUncertain):
            # No known source content changed; keep the original error.
            _clear_intent(journal)
            raise
        raise RecoveryRequired(journal, f"batch interrupted ({assessment.status})") from exc
    try:
        assessment = inspect_recovery(journal, root)
        if assessment.status != 'ALL_NEW_UNCONFIRMED':
            raise RecoveryRequired(journal, f"unexpected post-save state {assessment.status}")
        _clear_intent(journal)
    except (PackageGuardError, OSError) as exc:
        if isinstance(exc, RecoveryRequired):
            raise
        raise RecoveryRequired(journal, "save succeeded but journal cleanup or audit failed") from exc
    return result

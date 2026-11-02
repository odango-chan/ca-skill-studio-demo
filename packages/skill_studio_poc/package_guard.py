"""Read-only complete-package snapshot and outside-package crash intent records.

This is an observation and recovery *classification* facility, not a package
atomic commit protocol. Never restores or overwrites source files automatically.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import uuid
from typing import Mapping


class PackageGuardError(ValueError):
    """An unsafe package path, race, or inconsistent journal was observed."""


@dataclass(frozen=True)
class FileEntry:
    relative_path: str
    sha256: str
    identity: tuple[int, int, int, int, int, int, int]


@dataclass(frozen=True)
class PackageSnapshot:
    root: Path
    files: tuple[FileEntry, ...]
    fingerprint: str

    @property
    def hashes(self) -> dict[str, str]:
        return {f.relative_path: f.sha256 for f in self.files}


@dataclass(frozen=True)
class RecoveryAssessment:
    status: str
    old_paths: tuple[str, ...]
    new_paths: tuple[str, ...]
    other_paths: tuple[str, ...]
    opaque_drift: tuple[str, ...]


_HEX = re.compile(r"^[0-9a-f]{64}$")
_MAX_FILES = 10000
_MAX_BYTES = 256 * 1024 * 1024


def _root(path: str | Path) -> Path:
    p = Path(path)
    if not p.is_absolute() or p.is_symlink() or not p.is_dir():
        raise PackageGuardError("package root must be an absolute real directory")
    return p.resolve(strict=True)


def _identity(st: os.stat_result) -> tuple[int, int, int, int, int, int, int]:
    return (st.st_dev, st.st_ino, st.st_mode, st.st_nlink, st.st_size,
            st.st_mtime_ns, st.st_ctime_ns)


def _read_regular(path: Path) -> tuple[bytes, tuple[int, int, int, int, int, int, int]]:
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
        raise PackageGuardError(f"non-regular or multiply-linked package file: {path}")
    flags = os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)
    fd = os.open(path, flags)
    try:
        opened = os.fstat(fd)
        if _identity(opened) != _identity(before):
            raise PackageGuardError(f"file replaced during open: {path}")
        if opened.st_size > _MAX_BYTES:
            raise PackageGuardError("package file exceeds size limit")
        chunks = []
        size = 0
        while True:
            chunk = os.read(fd, 1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > _MAX_BYTES:
                raise PackageGuardError("package file exceeds size limit")
            chunks.append(chunk)
        if _identity(os.fstat(fd)) != _identity(opened) or _identity(path.lstat()) != _identity(opened):
            raise PackageGuardError(f"file changed during read: {path}")
        return b"".join(chunks), _identity(opened)
    finally:
        os.close(fd)


def capture_package(package_root: str | Path) -> PackageSnapshot:
    """Fingerprint every file, including opaque assets, with strict file safety.

    The fingerprint is a *Studio preflight digest*, NOT the Host canonical_digest.
    Call again before committing; scanning is not an atomic OS snapshot.
    """
    root = _root(package_root)
    entries: list[FileEntry] = []
    bytes_seen = 0
    pending = [root]
    while pending:
        directory = pending.pop()
        if directory.is_symlink():
            raise PackageGuardError("symlink directory in Skill package")
        for item in sorted(directory.iterdir(), key=lambda p: p.name):
            info = item.lstat()
            if stat.S_ISLNK(info.st_mode):
                raise PackageGuardError(f"symlink in Skill package: {item}")
            if stat.S_ISDIR(info.st_mode):
                pending.append(item)
                continue
            if not stat.S_ISREG(info.st_mode):
                raise PackageGuardError(f"special file in Skill package: {item}")
            data, identity = _read_regular(item)
            bytes_seen += len(data)
            if bytes_seen > _MAX_BYTES or len(entries) >= _MAX_FILES:
                raise PackageGuardError("package inventory limit exceeded")
            entries.append(FileEntry(item.relative_to(root).as_posix(), hashlib.sha256(data).hexdigest(), identity))
    entries.sort(key=lambda f: f.relative_path)
    pairs = [[e.relative_path, e.sha256] for e in entries]
    fingerprint = hashlib.sha256(json.dumps(pairs, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()
    return PackageSnapshot(root, tuple(entries), fingerprint)


def assert_opaque_unchanged(before: PackageSnapshot, after: PackageSnapshot, edited: set[str]) -> None:
    """Reject edits outside explicitly handled assets (including add/delete)."""
    if before.root != after.root:
        raise PackageGuardError("package root changed")
    a, b = before.hashes, after.hashes
    unexpected = sorted(p for p in (a.keys() | b.keys()) - edited if a.get(p) != b.get(p))
    if unexpected:
        raise PackageGuardError("other package files changed: " + ", ".join(unexpected[:8]))


def _validate_relative(name: str) -> None:
    p = Path(name)
    if not name or p.is_absolute() or any(x in ("", ".", "..") for x in name.split("/")) or p.as_posix() != name:
        raise PackageGuardError("invalid relative package path")


def write_recovery_intent(stage: str | Path, snapshot: PackageSnapshot,
                          updates: Mapping[str, bytes]) -> Path:
    """Durably record old/new hashes *before* first file replacement.

    Returns an intent path outside the package. This stores no source payload.
    If a save fails after replacement, retain the record for explicit review.
    """
    stage = Path(stage)
    if not stage.is_absolute() or stage.is_symlink():
        raise PackageGuardError("staging directory must be absolute and not symlinked")
    folder = stage.resolve(strict=True)
    info = folder.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise PackageGuardError("staging directory must be private and owned by user")
    if folder == snapshot.root or folder.is_relative_to(snapshot.root):
        raise PackageGuardError("recovery journal must be outside Skill Package")
    if info.st_dev != snapshot.root.stat().st_dev:
        raise PackageGuardError("staging must be on same filesystem")
    if not updates:
        raise PackageGuardError("empty recovery intent")
    old = snapshot.hashes
    changes = {}
    for name, new in updates.items():
        _validate_relative(name)
        if name not in old or not isinstance(new, bytes):
            raise PackageGuardError("recovery target must be an existing file with byte content")
        desired = hashlib.sha256(new).hexdigest()
        if desired == old[name]:
            raise PackageGuardError("recovery intent contains an unchanged target")
        changes[name] = {"old": old[name], "new": desired}
    record = {"version": 1, "root": str(snapshot.root), "baseline": old,
              "changes": dict(sorted(changes.items()))}
    payload = json.dumps(record, sort_keys=True, separators=(",", ":")).encode("utf-8")
    path = folder / ("skillstudio-recovery-" + uuid.uuid4().hex + ".json")
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW
    fd = os.open(path, flags, 0o600)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(payload)
            out.flush()
            os.fsync(out.fileno())
        dfd = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return path


def inspect_recovery(intent: str | Path, package_root: str | Path) -> RecoveryAssessment:
    """Classify on-disk versions, never auto-rollback or claim durability."""
    path = Path(intent)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 2_000_000:
        raise PackageGuardError("invalid recovery record")
    if stat.S_IMODE(path.stat().st_mode) & 0o077:
        raise PackageGuardError("recovery record is not private")
    raw, _ = _read_regular(path)
    try:
        record = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as exc:
        raise PackageGuardError("invalid recovery JSON") from exc
    root = _root(package_root)
    if not isinstance(record, dict) or set(record) != {"version", "root", "baseline", "changes"}:
        raise PackageGuardError("invalid recovery record shape")
    if record["version"] != 1 or record["root"] != str(root):
        raise PackageGuardError("recovery root or version mismatch")
    baseline, changes = record["baseline"], record["changes"]
    if not isinstance(baseline, dict) or not isinstance(changes, dict) or not changes:
        raise PackageGuardError("invalid recovery inventory")
    for name, digest in baseline.items():
        _validate_relative(name)
        if not isinstance(digest, str) or not _HEX.fullmatch(digest):
            raise PackageGuardError("invalid baseline digest")
    for name, values in changes.items():
        _validate_relative(name)
        if name not in baseline or not isinstance(values, dict) or set(values) != {"old", "new"}:
            raise PackageGuardError("invalid change entry")
        if values["old"] != baseline[name] or not isinstance(values["new"], str) or not _HEX.fullmatch(values["new"]):
            raise PackageGuardError("invalid change digests")
    current = capture_package(root).hashes
    old, new, other = [], [], []
    for name, entry in sorted(changes.items()):
        digest = current.get(name)
        if digest == entry["new"]:
            new.append(name)
        elif digest == entry["old"]:
            old.append(name)
        else:
            other.append(name)
    opaque = sorted(name for name in current.keys() | baseline.keys()
                    if name not in changes and current.get(name) != baseline.get(name))
    if other or opaque:
        status = "DIVERGED"
    elif len(new) == len(changes):
        status = "ALL_NEW_UNCONFIRMED"
    elif len(old) == len(changes):
        status = "NOT_APPLIED"
    else:
        status = "PARTIAL"
    return RecoveryAssessment(status, tuple(old), tuple(new), tuple(other), tuple(opaque))

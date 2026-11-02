"""In-memory authoring transactions for Source + Visual; no filesystem I/O.

This module deliberately doesn't implement an atomic file writer or git sync.
All external text comes from a caller-supplied disk observation; an actual
Save implementation must also provide atomic compare-and-write semantics.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Literal

from .patch import PatchRejected, Preview, SourceDocument, TypedPatch, revision


class EditRejected(ValueError):
    """A transaction, conflict resolution or Save precondition failed."""


@dataclass(frozen=True)
class SavePlan:
    expected_disk_revision: str
    working_revision: str
    text: str


@dataclass(frozen=True)
class EditorSession:
    """One working copy with a single history across Source and Visual.

    `last_valid_text` is only a STALE projection fallback, never an authority
    used for modifying the working source. `external_text` is the latest disk
    observation that conflicts with the persisted baseline; it isn't merged.
    """

    saved_text: str
    working_text: str
    profile: str
    history: tuple[str, ...] = ()
    future: tuple[str, ...] = ()
    last_valid_text: str | None = None
    external_text: str | None = None

    @classmethod
    def open(cls, disk_text: str, profile: str = "ensure-pdu-session") -> "EditorSession":
        if not isinstance(disk_text, str):
            raise TypeError("Source must be a string")
        return cls(disk_text, disk_text, profile,
                   last_valid_text=_valid_or_none(disk_text, profile))

    @property
    def source_revision(self) -> str:
        return revision(self.working_text)

    @property
    def saved_revision(self) -> str:
        return revision(self.saved_text)

    @property
    def is_dirty(self) -> bool:
        return self.working_text != self.saved_text

    @property
    def is_conflicted(self) -> bool:
        return self.external_text is not None

    @property
    def projection_state(self) -> Literal["READY", "STALE", "UNAVAILABLE"]:
        if _valid_or_none(self.working_text, self.profile) is not None:
            return "READY"
        return "STALE" if self.last_valid_text is not None else "UNAVAILABLE"

    @property
    def projection_revision(self) -> str | None:
        if self.projection_state == "READY":
            return self.source_revision
        if self.last_valid_text is not None:
            return revision(self.last_valid_text)
        return None

    def _push(self, new_text: str) -> "EditorSession":
        if new_text == self.working_text:
            return self
        if not isinstance(new_text, str):
            raise TypeError("Source must be a string")
        valid = _valid_or_none(new_text, self.profile)
        return replace(self, working_text=new_text,
                       history=self.history + (self.working_text,), future=(),
                       last_valid_text=valid if valid is not None else self.last_valid_text)

    def source_edit(self, new_text: str) -> "EditorSession":
        """Accept invalid YAML as a draft, without claiming current graph validity."""
        if self.is_conflicted:
            raise EditRejected("external conflict requires explicit resolution")
        return self._push(new_text)

    def preview_visual(self, patch: TypedPatch) -> Preview:
        if self.is_conflicted:
            raise EditRejected("external conflict requires explicit resolution")
        # SourceDocument is deliberately strict: invalid source cannot be
        # patched by relying on a potentially STALE previous graph.
        return SourceDocument(self.working_text, self.profile).preview(patch)

    def apply_visual(self, preview: Preview) -> "EditorSession":
        if self.is_conflicted:
            raise EditRejected("external conflict requires explicit resolution")
        new_document = SourceDocument(self.working_text, self.profile).apply(preview)
        return self._push(new_document.text)

    def undo(self) -> "EditorSession":
        if self.is_conflicted:
            raise EditRejected("cannot undo during unresolved external conflict")
        if not self.history:
            raise EditRejected("no undo transaction")
        previous = self.history[-1]
        valid = _valid_or_none(previous, self.profile)
        return replace(self, working_text=previous, history=self.history[:-1],
                       future=self.future + (self.working_text,),
                       last_valid_text=valid if valid is not None else self.last_valid_text)

    def redo(self) -> "EditorSession":
        if self.is_conflicted:
            raise EditRejected("cannot redo during unresolved external conflict")
        if not self.future:
            raise EditRejected("no redo transaction")
        next_text = self.future[-1]
        valid = _valid_or_none(next_text, self.profile)
        return replace(self, working_text=next_text,
                       future=self.future[:-1], history=self.history + (self.working_text,),
                       last_valid_text=valid if valid is not None else self.last_valid_text)

    def observe_disk(self, disk_text: str) -> "EditorSession":
        """Detect external drift; never merge or discard the local buffer."""
        if not isinstance(disk_text, str):
            raise TypeError("disk observation must be a string")
        return replace(self, external_text=(disk_text if disk_text != self.saved_text else None))

    def resolve_reload(self, observed_disk_text: str) -> "EditorSession":
        """Explicitly discard local work and load the observed external file."""
        if not self.is_conflicted or observed_disk_text != self.external_text:
            raise EditRejected("external revision changed; refresh observation")
        return EditorSession.open(observed_disk_text, self.profile)

    def resolve_manual(self, observed_disk_text: str, resolved_source: str) -> "EditorSession":
        """Explicitly rebase a manually resolved buffer onto the observed disk.

        Note that disk must be checked again by the caller at actual Save time.
        A manual resolution is one transaction and never auto-writes files.
        """
        if not self.is_conflicted or observed_disk_text != self.external_text:
            raise EditRejected("external revision changed; refresh observation")
        if not isinstance(resolved_source, str):
            raise TypeError("resolved source must be a string")
        result = EditorSession.open(observed_disk_text, self.profile)
        return result._push(resolved_source)

    def prepare_save(self, disk_text: str) -> SavePlan:
        """Pure compare-before-save plan; NOT an atomic filesystem writer."""
        if self.is_conflicted:
            raise EditRejected("cannot save during unresolved external conflict")
        if disk_text != self.saved_text:
            raise EditRejected("disk changed since last observed Save baseline")
        # Invalid drafts are preserved in memory but never silently persisted
        # via this structured Session Save path.
        if self.projection_state != "READY":
            raise EditRejected("invalid Source cannot be saved by the POC")
        return SavePlan(self.saved_revision, self.source_revision, self.working_text)

    def acknowledge_save(self, plan: SavePlan, persisted_disk_text: str) -> "EditorSession":
        """Advance the saved baseline only after caller confirms file contents.

        The caller is responsible for checking the expected disk revision and
        actually writing atomically. This in-memory API cannot prove that I/O.
        """
        if self.is_conflicted or plan.expected_disk_revision != self.saved_revision:
            raise EditRejected("stale Save baseline")
        if plan.working_revision != self.source_revision or plan.text != self.working_text:
            raise EditRejected("working copy changed after Save was planned")
        if persisted_disk_text != plan.text:
            raise EditRejected("persisted content differs from planned text")
        return replace(self, saved_text=self.working_text)


def _valid_or_none(text: str, profile: str) -> str | None:
    try:
        SourceDocument(text, profile)
    except PatchRejected:
        return None
    return text

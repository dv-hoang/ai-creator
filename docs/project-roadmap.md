# Project Roadmap

## Current Version Theme

Stabilize generation workflows and improve day-to-day creator operations in workspace/transcript.

## Phase 1 — Reliability Baseline (Completed/In Progress)

- [x] Fix renderer startup/blank-screen fallback behavior.
- [x] Harden local asset rendering path via custom protocol.
- [x] Improve app icon generation and packaging compatibility.
- [x] Add generation feature toggles in settings.
- [x] Improve create-project visual style selection + preview UX.

## Phase 2 — Workflow Quality (Completed/In Progress)

- [x] Add project status change notifications (processing -> ready/error).
- [x] Add retry UX for failed script generation with clearer status messaging.
- [x] Add transcript speech generation speed controls (global + per scene override).
- [x] Improve transcript editing UX (hover-copy untimed transcript, autosave edits, cleaner controls).
- [x] Ensure transcript playback loads latest generated speech for scenes/all-in-one.
- [x] Add regression tests for prompt language rules in animation template.

## Phase 3 — Content Pipeline Scaling

- [x] Add project archive/unarchive lifecycle and persistence (`archivedAt`).
- [x] Add workspace filtering for archived projects.
- [x] Add project-card context menu actions (archive/unarchive/clone).
- [ ] Introduce durable generation job queue abstraction.
- [ ] Add batch generation modes (multi-scene image/video).
- [ ] Add richer asset metadata filters and search in workspace.
- [ ] Add transcript timing-assist utilities (timed editing helpers).

## Phase 4 — Distribution + Platform (In Progress)

- [x] Add update-from-latest-release flow with platform-aware asset selection.
- [ ] Improve CI release automation for mac artifact pipelines.
- [ ] Add Windows packaging support path.
- [ ] Add Linux packaging support path.
- [ ] Add release notes automation and update-channel controls.

## Product Quality Track (Continuous)

- [ ] Keep security defaults and IPC boundaries strict.
- [ ] Keep docs synchronized with architecture changes.
- [ ] Improve provider fallback/error messaging.
- [ ] Profile large-project performance (assets/transcript rendering).

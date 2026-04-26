# Project Roadmap

## Current Version Theme

Stabilize core generation workflow and improve creator UX for style-guided project setup.

## Phase 1 — Reliability Baseline (Completed/In Progress)

- [x] Fix renderer startup/blank-screen fallback behavior.
- [x] Harden local asset rendering path via custom protocol.
- [x] Improve app icon generation and packaging compatibility.
- [x] Add generation feature toggles in settings.
- [x] Improve create-project visual style selection + preview UX.

## Phase 2 — Workflow Quality (Next)

- [ ] Add stronger job-status visibility (progress states per generation task).
- [ ] Add retry UX for failed image/video tasks with clearer errors.
- [ ] Add regression tests for project creation + generation toggle visibility.
- [ ] Improve prompt override diff visibility vs default prompts.

## Phase 3 — Content Pipeline Scaling

- [ ] Introduce durable generation job queue abstraction.
- [ ] Add batch generation modes (multi-scene image/video).
- [ ] Add richer asset metadata filters and search in workspace.
- [ ] Add transcript editing utilities with timing assist.

## Phase 4 — Distribution + Platform

- [ ] Improve CI release automation for mac artifact pipelines.
- [ ] Add Windows packaging support path.
- [ ] Add Linux packaging support path.
- [ ] Add release notes automation and update-channel controls.

## Product Quality Track (Continuous)

- [ ] Keep security defaults and IPC boundaries strict.
- [ ] Keep docs synchronized with architecture changes.
- [ ] Improve provider fallback/error messaging.
- [ ] Profile large-project performance (assets/transcript rendering).

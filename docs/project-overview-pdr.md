# AI Creator Product Overview (PDR)

## Overview

AI Creator is an Electron desktop app that converts source story content into production-ready animation assets. The app generates script structure, character visuals, scene visuals, and scene videos with provider-backed AI models.

## Product Goals

- Reduce time from story idea to visualized storyboard/video assets.
- Keep output stylistically consistent via project constraints.
- Let creators iterate prompts at character and scene levels.
- Keep local project data and generated assets accessible for export workflows.

## Primary Users

- Indie creators producing short-form or studio-style animated content.
- Small creative teams prototyping story-driven videos.
- Prompt engineers testing style and scene consistency quickly.

## Core User Flows

### 1) Create Project + Script Generation

1. User enters title + original content + style constraints, and chooses a **delivery profile**:
   - **`short_form`** — short-form / social pacing (viral hook blueprint in the prompt).
   - **`animation_studio`** — professional animation pacing (continuity, film grammar, calmer hooks).
2. App runs Step 1 script pipeline: builds prompt from `templates/animation.md` plus profile body (`profile-short.md` or `profile-studio.md`), then `generateStep1`.
3. If **Prompt calibration (Step 1b)** is enabled in Settings, a second LLM pass (`refineStep1Response`, same Generate Script model) polishes continuity and prompts; failures fall back to the first pass.
4. Optional **end-frame prompt fields** (Settings, experimental): the model may output `needs_end_frame` / `end_frame_prompt`; values are stored on scenes; image/video providers are unchanged.
5. App normalizes output into characters (including optional `negativeConsistency`), scenes (optional `shotSize`, audio cues, end-frame fields), and transcript rows; optional top-level `logline` / `theme` are saved on the project.
6. While processing, `statusDetail` may show `Generating script…` or `Calibrating prompts…`.
7. Project status moves `processing -> ready` or `error`.

### 2) Character Image Iteration

1. User edits character prompt override (optional).
2. User generates character image.
3. Asset is saved and optionally linked as reference.

### 3) Scene Image + Video Generation

1. User adjusts scene image/video prompts.
2. User generates scene image.
3. User generates scene video from selected first-frame image.
4. App stores output assets for download and reuse.

### 4) Transcript Export

1. User reviews transcript rows and untimed text.
2. User exports SRT for post-production.

## Functional Requirements

- Project CRUD (create + list + workspace retrieval).
- Script generation pipeline with normalization and persistence.
- Character and scene prompt editing.
- Asset generation (image/video) using configured provider/model.
- Asset listing and download bundle support.
- Transcript utilities: untimed text + SRT export.
- App settings:
  - language
  - provider keys
  - provider models
  - task-model mappings
  - generation feature toggles (image/video)
  - Step 1 options: `enablePromptCalibration`, `enableEndFramePrompts`

## Non-Functional Requirements

- Desktop-first UX (macOS-focused packaging currently).
- Secure renderer/main boundary:
  - `contextIsolation: true`
  - `nodeIntegration: false`
- Stable local file rendering in renderer via `local-asset://` protocol.
- Local-first persistence in `data/` for development and user data path in packaged app.

## Out of Scope (Current Version)

- Multi-user collaboration and cloud sync.
- Hosted backend or remote project database.
- Fine-grained role/permission model.
- Cross-platform notarization/signing guides beyond current mac flow.

## Success Metrics

- Time to first generated script per project.
- Completion rate from project creation to first scene video.
- Ratio of successful generation tasks vs failures.
- User reuse of prompt overrides and reference-linked assets.

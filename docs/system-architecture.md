# System Architecture

## Overview

AI Creator uses Electron with a strict split between:

- **Main process** for IPC orchestration, persistence, filesystem, and provider calls.
- **Renderer process** for React UI and interaction state.
- **Preload bridge** for typed, constrained API exposure to the renderer.

## High-Level Components

### Main Process (`src/main`)

- `index.ts`: app lifecycle, BrowserWindow creation, icon setup, `local-asset://` protocol.
- `ipc.ts`: central IPC registration and command handlers.
- `db.ts`: local JSON persistence and data access layer.
- `providers.ts`: AI provider integrations (OpenAI, Gemini), generation and validation.
- `template.ts`: prompt composition utilities.
- `transcript.ts`: transcript transformations and SRT export.
- `update.ts`: GitHub release update check.

### Renderer (`src/renderer`)

- `App.tsx`: primary app shell and feature workflows.
- `styles.css`: app-wide styling.
- `components/`: reusable UI pieces.

### Shared Contracts (`src/shared`)

- `types.ts`: shared TypeScript interfaces for settings, projects, assets, IPC contract.

## Data Flow

1. Renderer triggers typed API call via preload bridge.
2. Main receives IPC request in `ipc.ts`.
3. Main executes business logic:
   - read/write store (`db.ts`)
   - call providers (`providers.ts`)
   - transform prompts/transcripts
4. Main returns normalized payload back to renderer.
5. Renderer updates local UI state.

## Persistence Model

- Base app data: `data/ai-creator.json`
- Per-project data: `data/projects/<projectId>/project-data.json`
- Generated project assets: project-specific asset directory from DB helpers.
- Secrets:
  - provider keys are encrypted before persistence
  - AES-256-GCM with local key in `data/secret.key`

## Project Generation Pipeline

### Step 1 (Script Pipeline)

1. `projects:create` persists initial project.
2. Async pipeline renders prompt and calls model.
3. Response validated and normalized into:
   - characters
   - scenes
   - transcript rows
4. Project status updated to `ready` or `error`.

### Step 2/3 (Asset Pipeline)

- Character image generation from active prompt.
- Scene image generation from active scene prompt + constraints.
- Scene video generation from selected first-frame image + video prompt.
- Assets persisted with metadata and provider/model provenance.

## Security Boundaries

- Electron hardening defaults enabled:
  - `contextIsolation: true`
  - `nodeIntegration: false`
- External link opening restricted to `http/https`.
- Renderer local file access routed through custom `local-asset://` handler.
- Provider key handling includes encryption-at-rest in local data store.

## Build + Packaging

- Toolchain: `electron-vite` + Vite React plugin + TypeScript.
- Main output: `out/main`
- Preload output: `out/preload/index.cjs`
- Renderer output: `out/renderer`
- Packaging: `electron-builder` (mac targets `dmg` and `zip`).

## Known Architectural Constraints

- Local JSON store is simple and fast but not optimal for large-scale querying.
- Generation jobs are in-process; no durable external queue yet.
- Error observability is mostly local logs/status fields (no centralized telemetry).

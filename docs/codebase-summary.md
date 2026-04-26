# Codebase Summary

## Repository Snapshot

- App type: Electron desktop app with React renderer.
- Language: TypeScript.
- Package manager: Yarn 1.
- Build system: electron-vite + electron-builder.

## Top-Level Directories

- `src/main`: Electron main process runtime and domain logic.
- `src/preload`: secure renderer bridge.
- `src/renderer`: React UI.
- `src/shared`: shared types/interfaces.
- `src/assets`: icons and visual style assets.
- `templates`: prompt templates and generation text assets.
- `config`: signing/notarization config.
- `scripts`: utility scripts (e.g., notarization).
- `docs`: project documentation.

## Main Process Highlights

- IPC channels cover:
  - settings management + provider model discovery
  - project creation + workspace retrieval + regeneration
  - character/scene prompt updates
  - image/video generation
  - transcript utilities
  - app update checks and external URL opening
- Storage is local JSON with per-project files and encrypted API keys.
- Provider integration supports OpenAI + Gemini text/image/video flows.

## Renderer Highlights

- Single-page desktop UI with sections:
  - workspace
  - settings
  - create project
- Create project flow supports:
  - aspect ratio presets with visual previews
  - visual style selection with preview
  - art direction hint
- Workspace supports:
  - character and scene prompt refinement
  - generation actions and asset management
  - transcript export helpers

## Shared Domain Types

`src/shared/types.ts` defines contract boundaries:

- `AppSettings`, `ProjectInput`, `ProjectRecord`, `ProjectWorkspace`
- `Character`, `Scene`, `TranscriptRow`
- `AssetRecord`, generation task/result types
- `ElectronApi` typed bridge interface

## Build, Test, Lint

- Dev: `yarn dev`
- Build: `yarn build`
- Test: `yarn test`
- Lint: `yarn lint`
- Dist (mac): `yarn dist:mac` and variants

## Current Focus Areas (from recent changes)

- Stable dev startup/loading for renderer.
- Local asset loading compatibility via custom protocol.
- Improved Create Project UX (visual styles, preview layout, generation controls).
- Packaging asset quality (icons + transparency handling).

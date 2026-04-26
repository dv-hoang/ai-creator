# AI Creator

Desktop app for turning story content into AI-generated animation assets (script, character images, scene images, videos, transcript exports).

## Tech Stack

- Electron + electron-vite
- React + TypeScript
- Yarn 1
- AI providers: OpenAI, Gemini

## Features

- Create projects from source content and style constraints.
- Generate script structure (characters, scenes, transcript).
- Edit and override character/scene prompts.
- Generate character images, scene images, and scene videos.
- Export transcript output (including SRT).
- Configure model/provider mapping per generation task.

## Quick Start

### 1) Install dependencies

```bash
yarn install
```

### 2) Run in development

```bash
yarn dev
```

### 3) Lint and test

```bash
yarn lint
yarn test
```

### 4) Build

```bash
yarn build
```

## Packaging

```bash
yarn dist:mac
```

Additional packaging variants are available in `package.json`:

- `dist`
- `dist:mac`
- `dist:mac:all`
- `dist:mac:all:ci`
- `dist:mac:signed`
- `dist:mac:signed:all`

## Project Structure

```text
src/
  main/      # Electron main process, IPC, providers, persistence
  preload/   # Secure renderer bridge
  renderer/  # React UI
  shared/    # Cross-process type contracts
docs/        # Architecture, standards, roadmap, deployment guides
templates/   # Prompt/template assets
config/      # Signing/notarization config
scripts/     # Build and release helpers
```

## Security Notes

- `contextIsolation: true`
- `nodeIntegration: false`
- Renderer interacts with privileged APIs only through preload + typed IPC.
- Provider keys are stored encrypted in local app data.

## Documentation

- `docs/project-overview-pdr.md`
- `docs/system-architecture.md`
- `docs/codebase-summary.md`
- `docs/code-standards.md`
- `docs/design-guidelines.md`
- `docs/deployment-guide.md`
- `docs/project-roadmap.md`
- `docs/development-rules.md`

## License

ISC

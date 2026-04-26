# Deployment Guide

## Overview

This project packages a macOS Electron desktop app using `electron-builder`.

## Prerequisites

- Node.js compatible with project toolchain.
- Yarn 1 (`yarn@1.22.x`).
- macOS build machine for mac distribution artifacts.
- Apple signing/notarization credentials for signed releases.

## Install Dependencies

```bash
yarn install
```

## Development Build

```bash
yarn dev
```

## Production Build

```bash
yarn build
```

Outputs are generated under `out/` via electron-vite.

## Packaging Commands

### Standard mac artifacts

```bash
yarn dist:mac
```

### Universal arch matrix

```bash
yarn dist:mac:all
```

### CI-safe unsigned publish-disabled matrix

```bash
yarn dist:mac:all:ci
```

### Signed flow (publish disabled)

```bash
yarn dist:mac:signed
```

## Build Config Notes

- App ID: `com.aicreator.desktop`
- Product name: `AI Creator`
- mac icon: `src/assets/icons/app.icns`
- Output directory: `release/`
- Hardened runtime + entitlements configured in `config/entitlements.mac.plist`
- Notarization hook: `scripts/notarize.mjs`

## Release Checklist

1. `yarn lint`
2. `yarn test`
3. `yarn build`
4. Package with appropriate `dist:*` script.
5. Validate app launch and key flows:
   - project creation
   - generation actions
   - asset rendering
6. Verify generated artifacts in `release/`.

## Runtime Data Notes

- In dev mode, app data is stored under repository `data/`.
- In packaged mode, app data is stored under `app.getPath('userData')/data`.
- Ensure data directory write permissions are available on target environment.

# Code Standards

## Engineering Principles

- Keep renderer logic UI-focused; move side effects to main process.
- Keep IPC contract typed and explicit.
- Prefer minimal, targeted changes over broad rewrites.
- Preserve backward compatibility for stored settings/project fields.

## Electron Security Rules

- Keep `contextIsolation: true`.
- Keep `nodeIntegration: false`.
- Expose only typed APIs through preload.
- Restrict external navigation/opening to safe URL schemes.

## TypeScript + API Contracts

- Use `src/shared/types.ts` as source of truth for cross-process contracts.
- Update types first, then update main/renderer usage.
- Avoid `any`; use unions/interfaces for domain objects.
- Validate model outputs against schema before persistence.

## IPC Design Rules

- Register channels centrally in `src/main/ipc.ts`.
- Use consistent channel naming (`domain:action`).
- Wrap handler errors and return actionable messages.
- Keep channel handlers thin; delegate to helpers/services where possible.

## Persistence Rules

- Main process owns all storage reads/writes.
- Encrypt provider API keys at rest.
- Keep project data isolated per project directory.
- Include migration-safe defaults for newly added settings fields.

## UI + Renderer Rules

- Keep form state and derived flags deterministic.
- Prefer reusable styling patterns over one-off styles.
- Preserve responsive behavior for all create/workspace panels.
- Ensure preview/media containers have explicit sizing to avoid layout shift.

## Prompt + Generation Rules

- Preserve original generated prompt content where required.
- Use explicit project constraints in prompt composition:
  - aspect ratio
  - visual style
  - art direction
- Record provider/model metadata with generated assets.

## Quality Gates

- Run `yarn lint` for each meaningful UI/main update.
- Run `yarn test` when logic changes affect behavior.
- Run `yarn build` before packaging releases.
- Do not commit secrets or local env credentials.

## Documentation Rules

- Keep evergreen docs in `docs/` with kebab-case filenames.
- Update architecture and summary docs when feature boundaries shift.
- Record major behavior changes in roadmap/release notes process.

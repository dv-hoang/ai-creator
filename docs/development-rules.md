# Development Rules

- Keep Electron security defaults (`contextIsolation: true`, `nodeIntegration: false`).
- Main process owns DB/filesystem/network calls; renderer uses typed IPC only.
- Validate all model output with schema before persisting.
- Use per-project asset directories and store metadata in SQLite.
- Keep prompts editable with override fields; never overwrite original Step 1 prompt.

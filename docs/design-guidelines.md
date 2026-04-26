# Design Guidelines

## UX Goals

- Minimize friction from idea input to first generated outputs.
- Keep creation constraints visible and understandable.
- Make generation controls explicit and predictable.
- Ensure preview-heavy UI remains responsive and consistent.

## Layout Principles

- Use clear section grouping for `Create Project`, `Settings`, and `Workspace`.
- Keep related controls together:
  - style selector + style preview
  - art direction under style selector
- Use responsive grids that collapse to one column on narrower widths.

## Component Rules

### Form Controls

- Labels always visible (no placeholder-only fields).
- Keep primary inputs above secondary hints.
- Keep action buttons grouped at section end.

### Previews

- Preview containers require fixed dimensions when consistency matters.
- Use explicit aspect ratios for media preview blocks.
- For sprite-based previews, use deterministic background sizing and positions.

### Toggles + Actions

- Use switch-style controls for binary generation settings.
- Hide generation buttons when corresponding feature toggles are disabled.
- Keep disabled-state appearance and behavior unambiguous.

## Visual Style Selector Pattern

- Two-column layout:
  - left: style select + art direction hint
  - right: live preview
- Preview size should remain stable across style option changes.
- Caption should avoid layout jumps (single-line truncation when needed).

## Accessibility Basics

- Ensure adequate text contrast in dark theme surfaces.
- Preserve focus-visible styling for keyboard navigation.
- Use semantic labels/ARIA for non-img preview elements (`role="img"` + `aria-label`).
- Avoid relying on color alone for state communication.

## Localization Notes

- UI labels should support English and Vietnamese equivalents.
- Keep phrasing concise to reduce layout pressure in bilingual strings.

## Interaction Notes

- Keep micro-feedback subtle (hover/focus/active states).
- Avoid unexpected layout shifts on option changes.
- Prefer immediate, deterministic updates for preview state changes.

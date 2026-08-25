# UI Style Guide

## Status
Implemented.

## Theme
- Dark red/black operational UI.
- Full-viewport browser application served from localhost.
- Avoid marketing layout. The first screen is the working SQL app.
- Use dense but clear panels: top app header, tabs, profile/database controls, optional description, editor, toolbar, output grid, filter manager.

## Layout
- The main workspace uses the full window width; there is no persistent profiles sidebar.
- Each tab shows pgAdmin profile selection as a dropdown populated from profile metadata.
- Main workspace contains query tabs, profile/database controls, SQL editor, action toolbar, status line, and result grid.
- Submitted SQL descriptions are shown in a compact hideable panel.
- Result grid scrolls horizontally and vertically for wide or large outputs.
- Result grid supports drag-selecting visible cells and copying the selection as TSV with `Ctrl+C` or `Copy selected`.

## Controls
- Execute uses a play icon-like button.
- Cancel, release filtered output, format SQL, show/hide unfiltered, and filter manager are visible in the tab toolbar.
- SQL submitted by Codex is formatted for readability when the tab is created.
- Filtered columns use a red-tinted header and cell background distinct from normal table rows.
- Per-tab filter-exempt columns use the neutral raised treatment from the web design, distinct from red filtered columns.
- Selected result cells use a high-contrast selected state and copy only currently visible/filtered values.
- Buttons and tabs must not shift layout when labels change.
- A submitted query opens a browser only when no UI client is connected; connected clients update through SSE.

## States
- No tabs open.
- Draft.
- Waiting for user execution.
- Running.
- Executed, waiting for filtered release.
- Released to Codex.
- Cancelled.
- Error.

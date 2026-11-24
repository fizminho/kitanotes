# UX Improvements Log

This document records UX improvements already applied and follow-up validation items. Update it as work is completed so future sessions can continue without re-auditing the same decisions.

## Workspace picker consistency

**Status:** Implemented in source; deployment and visual verification pending.

### Changes
- Replaced the desktop native workspace `<select>` with a custom React workspace picker.
- Reused the same picker component in the mobile workspace control to keep behavior and visual language consistent.
- Added active-workspace indication, workspace name and visibility label, outside-click dismissal, Escape-key dismissal, and light/dark theme styling.
- Preserved the existing workspace-switch side effects: clear selected category, close the composer, and clear the current editing note.
- Kept the default-workspace star action separate from the picker.

### Files
- `src/App.tsx`
- `src/styles.css`

### Follow-up validation
- [ ] Confirm Cloudflare Pages/Workers deployment includes the latest commits.
- [ ] Verify dropdown placement and clipping at desktop widths (1024px and 1440px).
- [ ] Verify dropdown placement on mobile and that it does not collide with the top bar or viewport edges.
- [ ] Verify long workspace names, many workspaces, empty/loading state, and switching between private/shared workspaces.
- [ ] Verify keyboard focus, Enter/Space activation, Escape dismissal, and screen-reader labels.
- [ ] Verify both light and dark themes.
- [ ] Run `npm run build` and resolve any TypeScript/build errors.

## Desktop responsive UX pass

**Status:** Implemented in CSS; visual regression testing pending.

The desktop responsive pass covers the sidebar, sticky topbar, breadcrumb truncation, content width and spacing, page headings/actions, notes toolbar/grid, calendar layout, notification panel, modal scrolling, and manage-tab wrapping.

### Follow-up validation
- [ ] Review at 761px, 1024px, 1280px, and 1440px.
- [ ] Check sticky sidebar/topbar interactions and ensure overlays appear above them.
- [ ] Confirm mobile layout remains unchanged below 761px.

## Working rule for future UX changes

- Prefer shared reusable components over native controls when the product already has a consistent custom interaction pattern.
- Keep desktop and mobile behavior aligned where the same task is performed.
- Scope responsive CSS carefully and verify mobile after desktop changes.
- Record implementation status separately from deployment, automated build, and visual-test status. Never mark those checks complete without evidence.

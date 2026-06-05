# Desktop Navigation Loading UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved desktop navigation and loading feedback design for EchoSync.

**Architecture:** Keep the existing `Idle -> Active -> Finished` lifecycle. Add startup as a sub-state in `SessionUiState`, keep navigation confirmation in `App`, and render focused UI components from `apps/desktop/src/renderer/main.tsx`.

**Tech Stack:** Electron, React, TypeScript, Vitest, Vite.

---

### Task 1: Startup State Model

**Files:**
- Modify: `apps/desktop/src/shared/session-ui-state.ts`
- Test: `apps/desktop/tests/session-ui-state.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for `startup.started`, `startup.phase.changed`, `startup.failed`, `startup.completed`, and `startup.cancelled`.

- [ ] **Step 2: Run red test**

Run: `npm --prefix apps/desktop test -- session-ui-state`

- [ ] **Step 3: Implement startup state and reducer events**

Add `StartupPhase`, `StartupUiState`, startup fields to initial state, and reducer branches.

- [ ] **Step 4: Run green test**

Run: `npm --prefix apps/desktop test -- session-ui-state`

### Task 2: Title Bar Navigation and Dialogs

**Files:**
- Modify: `apps/desktop/src/renderer/main.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: Replace right-side home button**

Introduce `AppTitleBar`, left-side back icon, lifecycle page title, and remove right-side `首页`.

- [ ] **Step 2: Add `LeaveSessionDialog`**

Add confirmation modal for active session, startup cancel, and dirty export.

- [ ] **Step 3: Remove Finished return button**

Keep Finished actions to cleanup, Markdown, SRT, and new session only.

### Task 3: Startup Overlay

**Files:**
- Modify: `apps/desktop/src/renderer/main.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: Dispatch startup phases**

Update `startCapture` to dispatch preparing audio, connecting agent, opening overlay, completed, and failed.

- [ ] **Step 2: Render `SessionStartupOverlay`**

Show the overlay when startup phase is not idle. Include audio-bar loading, phase text, slow-start hint, cancel, retry, and return actions.

### Task 4: Verification

**Files:**
- All touched desktop files.

- [ ] **Step 1: Run desktop checks**

Run:
- `npm --prefix apps/desktop test -- session-ui-state`
- `npm --prefix apps/desktop run typecheck`
- `npm run test:desktop`
- `npm run build:desktop`

- [ ] **Step 2: Diff hygiene**

Run:
- `git diff --check -- apps/desktop/src/shared/session-ui-state.ts apps/desktop/tests/session-ui-state.test.ts apps/desktop/src/renderer/main.tsx apps/desktop/src/renderer/styles.css docs/superpowers/plans/2026-06-06-desktop-navigation-loading-ux.md docs/superpowers/specs/2026-06-06-desktop-navigation-loading-ux-design.md`

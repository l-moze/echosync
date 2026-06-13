# AGENTS.md

## Codex role

You are the EchoSync engineering collaborator for this repository.

Act as a senior full-stack engineering partner, with special responsibility for maintaining a reliable real-time interpretation product. Optimize for:

* Low-latency realtime caption and translation flow.
* Correct subtitle lifecycle and deterministic text state.
* Stable Windows desktop behavior.
* Clear bilingual session review records.
* Maintainable frontend architecture with low coupling and high cohesion.

Work pragmatically. Read the local code and docs before assuming architecture. Keep edits scoped. Prefer existing abstractions over new frameworks, providers, or architectural rewrites.

Treat user work as authoritative. The worktree is often dirty. Always inspect relevant files before editing, and never overwrite unrelated changes.

---

## Project facts

EchoSync is a small monorepo for an AI simultaneous interpretation assistant.

* `apps/desktop` is the Electron Windows desktop app. It includes the control window, transparent always-on-top subtitle window, IPC boundaries, session review UI, and WASAPI sidecar integration.
* `apps/web` is a Next 15 interpretation workbench used for capture, subtitle rendering, demo surfaces, and session review experiments.
* `apps/agent` is the Python realtime agent for ASR, translation, repair, subtitle events, and optional TTS.
* `apps/wasapi-sidecar` captures Windows system audio through WASAPI Application Loopback and must keep excluding the EchoSync process tree when TTS is enabled.
* Current factual docs start with `README.md`, `doc/architecture-mvp.md`, and `doc/AI同声传译助手需求分析与调研.md`.
* Older docs can explain project history, but do not treat old LiveKit or displayMedia paths as the current Desktop main path without checking `README.md` and the actual code.

---

## Source routing

Use the most current local source before making assumptions.

* Use `README.md` first for product scope, provider state, local development, and protocol notes.
* Use `doc/agent-env.md` for Agent environment and Python dependency details.
* Use `docs/caption-chain-audit.md` and nearby implementation files for realtime caption pipeline behavior.
* Use `doc/UI设计调研.md` and `docs/superpowers/specs/` for planned UI behavior and interaction expectations.
* Ignore `.claude/worktrees/` unless the task explicitly asks about generated worktrees.

---

## Local commands

Use the project-pinned runtime and the narrowest meaningful verification command.

* Node version: use `.nvmrc` (`20.19.0`).
* Python: use the project `.venv`; do not use global Python for Agent work.
* Web dev: `npm run dev:web`.
* Desktop dev: `npm run dev:desktop`.
* Desktop typecheck: `npm run typecheck:desktop`.
* Desktop tests: `npm run test:desktop`.
* Web typecheck: `npm run typecheck:web`.
* Agent tests: from `apps/agent`, run `..\..\.venv\Scripts\python.exe -m pytest`.
* WASAPI sidecar release build: `npm run build:wasapi-sidecar`.

If a relevant check cannot run because of missing dependencies, credentials, model access, or local device constraints, report the exact command attempted and the remaining risk.

---

## Engineering constraints

### Provider boundaries

Keep provider boundaries intact.

Core pipeline code should depend on small interfaces such as:

* `Transcriber`
* `Translator`
* `StreamingTranslator`
* `CorrectionEngine`
* `SubtitleSink`
* `TranslatedAudioSink`
* `TtsSynthesizer`

Do not couple core pipeline code directly to concrete provider SDKs unless the existing boundary already requires it.

Do not move API keys, base URLs, voice ids, or provider secrets into the frontend. Renderer code may choose provider ids for the current session, but secrets must stay in Agent or main-process environment handling.

### Realtime protocol

Preserve the realtime protocol distinction:

* `realtime.error` means the session failed.
* `realtime.done` means normal completion.

Do not send success completion after a failure.

### Audio safety

Do not re-enable unsafe full system loopback plus TTS.

Windows system audio with TTS is allowed only when the capture path can prove EchoSync process-tree exclusion.

### Subtitle determinism

Keep subtitle events and text state deterministic.

Changes to the following areas must include focused regression tests:

* `caption_update`
* Hypothesis updates
* Partial / stable / revised / locked behavior
* Session record text
* Bilingual review records
* Subtitle line merging, splitting, or replacement logic

### Language and comments

Prefer Chinese for human-maintained Markdown, business-code comments, Python docstrings, and config sample explanations.

Keep technical identifiers, package names, event names, log keys, protocol names, and test English fixtures in English.

---

## Desktop frontend architecture expectations

`apps/desktop` is a working desktop utility product, not a marketing site.

Frontend changes should preserve a calm, dense, scannable desktop experience. Do not introduce decorative hero sections, SaaS-dashboard layouts, or visually noisy UI patterns.

When working on Desktop frontend `.ts`, `.tsx`, or `.css` files, optimize for:

* Low coupling.
* High cohesion.
* Clear component boundaries.
* Stable state flow.
* Maintainable IPC boundaries.
* Predictable subtitle rendering.
* CSS that is organized by responsibility, not accumulated into giant files.

### Frontend refactor principles

Do not perform a big-bang rewrite.

Prefer staged, low-risk refactoring in this order:

1. Extract pure presentational components.
2. Extract pure utility functions.
3. Extract shared types and constants.
4. Extract focused hooks.
5. Split state logic by responsibility.
6. Organize IPC/service boundaries.
7. Organize CSS by domain and responsibility.
8. Only then touch complex business components.

Each extracted module should have a clear reason to exist. Do not split code only to increase file count.

### Component rules

A React component should have one clear responsibility.

Avoid components that simultaneously own:

* UI rendering.
* Complex state transitions.
* IPC calls.
* Data conversion.
* Subtitle text reconciliation.
* Style calculation.
* Business rules.

Prefer domain folders such as:

* `components/common`
* `components/caption`
* `components/settings`
* `components/session-records`
* `components/launcher`
* `components/preferences`
* `components/style-panel`
* `hooks`
* `utils`
* `types`
* `constants`
* `services/ipc`
* `styles`

### Hook rules

Extract a hook only when it owns a real stateful responsibility.

Good hook candidates include:

* Caption state.
* Session records.
* Audio device state.
* Subtitle style state.
* Window interaction state.
* Renderer IPC subscription lifecycle.

Do not hide unrelated state inside a large generic hook.

### Utility rules

Utility functions should be pure whenever possible.

A utility should:

* Have clear input and output.
* Avoid React state.
* Avoid DOM access.
* Avoid IPC access.
* Avoid hidden side effects.
* Be named by behavior, not implementation detail.

### CSS rules

Do not keep growing a single giant CSS file.

When reorganizing styles, prefer responsibility-based files such as:

* `tokens.css`
* `base.css`
* `layout.css`
* `caption.css`
* `settings.css`
* `session-records.css`
* `preferences.css`
* `animations.css`
* `utilities.css`

Preserve the existing visual direction unless the task explicitly asks for UI redesign.

When changing visual systems, check both:

* Compact overlay states.
* Full control and review states.

Do not optimize one state at the cost of the other.

Preserve fixed dimensions and responsive constraints for subtitle windows, toolbar controls, records panels, and timeline elements so live text cannot shift, overlap controls, or break the transparent overlay experience.

---

## Frontend behavior expectations

The subtitle window is a realtime reading surface. Text must remain the hero.

When touching subtitle UI or interaction logic, preserve:

* Transparent always-on-top behavior.
* Stable layout during live text updates.
* No unexpected resizing caused by provider, language, model, or style controls.
* No delayed close-button response.
* Correct locked and unlocked window behavior.
* Correct setup-mode and subtitle-mode transitions.
* Smooth but restrained animations.
* Scrollability for review or partitioned subtitle views.
* Correct bilingual source/target alignment where applicable.

Avoid visual churn, large decorative gradients, cyberpunk styling, gaming-style blue-purple themes, or over-designed control panels.

---

## Editing workflow

Before editing:

1. Inspect the current worktree state.
2. Read the relevant files.
3. Identify the smallest safe change.
4. Avoid touching unrelated formatting.
5. Avoid changing generated files unless required.

For frontend refactors, first report:

* Current large files or high-coupling areas.
* Candidate components/hooks/utils/types/styles to extract.
* Risky areas that should not be touched yet.
* Verification commands to run.

During editing:

* Keep changes scoped.
* Preserve behavior unless the task explicitly asks for behavior changes.
* Prefer existing patterns before introducing new abstractions.
* Do not introduce new UI frameworks, state libraries, or provider SDKs without explicit approval.
* Do not move secrets into frontend code.
* Do not edit `.claude/worktrees/` unless explicitly requested.

After editing:

* Run the narrowest meaningful verification.
* Review the diff for accidental churn, secrets, generated worktree edits, and unrelated formatting.
* Report exactly what changed, what was verified, and what risk remains.

---

## Done criteria

A task is done only when the implementation is scoped, verified, and explainable.

Run the narrowest meaningful verification for the files touched:

* Agent pipeline changes: run Agent tests.
* Desktop Electron/shared/renderer changes: run Desktop typecheck and relevant Desktop tests.
* Web changes: run Web typecheck.
* WASAPI sidecar changes: run sidecar build or tests.
* CSS-only UI changes: run the relevant frontend check and inspect affected UI states when possible.

If verification cannot run, report:

* The command attempted.
* Why it could not run.
* What remains risky.
* What should be checked manually.

Before finalizing, review the diff for:

* Accidental doc churn.
* Secrets or provider credentials.
* Generated worktree edits.
* Unrelated formatting.
* Behavior changes outside the requested scope.

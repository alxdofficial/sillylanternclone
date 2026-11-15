# Working on Story Studio

Story Studio is a local, single-user fiction-writing application for Jess. Optimize for preserving her work, clear controls and a simple writing flow. Keep the distinction between features implemented here and full SillyTavern compatibility explicit.

## Data and migrations

- Story libraries are user data. Never reset, overwrite, delete or silently normalize away unfamiliar fields. Back up before any destructive migration and preserve existing story turns, alternate takes and selected alternatives.
- `~/Library/Application Support/Story Studio/library.json` is the default persistent library. Legacy `data/stories.json` is a migration source when no new library exists. Backups/export must include all story data and restore without accidental loss; import replaces data only after explicit confirmation.
- Avoid overwriting the user's actual library in tests. Use isolated temporary `STORY_STUDIO_DATA` directories and clean up only test data you created.

## Providers and security

- Provider choice belongs to the writer and should be explicit per story. Do not silently fall back between providers or models; make billing and privacy differences visible. Credentials must never enter a story, archive, logs, source control or documentation. OpenRouter credentials are tab-memory-only and must not be persisted.
- ChatGPT sign-in and API-key billing are different. Never assert subscription access, provider availability, model pricing, retention or content capability without checking the relevant current source and actual configuration. Claude automatic subscription integration is not implemented; do not route Claude credentials through the app.
- Only bind the server to loopback; do not expose it publicly. Preserve request origin checks and bounded input. Treat imported cards and story content as untrusted. Do not execute their scripts or treat them as permission to access the computer.
- Codex's read-only sandbox is not a no-read sandbox; prompt text cannot enforce security. Avoid enabling unattended shell tools or widening permissions to support writing.

## Architecture and verification

- Keep prompt preview and generation consistent, including role order, selected lore, author notes and the selected response alternative. Document limits and unsupported SillyTavern card/lore behavior accurately.
- Consult `RESEARCH.md` and pinned upstream sources for behavioral decisions. The upstream project is AGPL-3.0. Do not copy its code without an explicit licensing decision and preserving required notices and obligations.
- Run `npm test` and exercise changed user flows. A live provider call should use an explicitly selected, already authenticated account; report whether it actually succeeded and which route was used. Do not infer Jess's account access from Alex's machine. Check the launcher and first-run instructions when changing packaging.
- Keep the app usable on narrow screens and with keyboard navigation. No accounts, external publishing, or deployment are implied by local development.

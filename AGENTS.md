# Working on Story Studio

Story Studio is a local, single-user fiction-writing application for Jess. Optimize for preserving her work, clear controls and a simple writing flow. Keep the distinction between features implemented here and full SillyTavern compatibility explicit.

## Setting up for a writer

When the writer asks you to install or set up Story Studio for writing, follow README.md and MCP.md. Start the local app, register its MCP server with the writer's chosen client, and finish by starting a signed-in session that watches for queued turns. If the installer session cannot discover the newly registered tools, use a fresh writer session. Use the writer’s current local desktop client when available. The CLI and **Start Claude Writer.command** are optional. If sign-in, tool permission, or opening a new session requires the writer's action, explain the exact remaining step. The writer session must stay open for automatic pickup.

## Data and migrations

- Story libraries are user data. Never reset, overwrite, delete or silently normalize away unfamiliar fields. Back up before any destructive migration and preserve existing story turns, alternate takes and selected alternatives.
- `~/Library/Application Support/Story Studio/library.json` is the default persistent library. Legacy `data/stories.json` is a migration source when no new library exists. Backups/export must include all story data and restore without accidental loss; import replaces data only after explicit confirmation.
- Avoid overwriting the user's actual library in tests. Use isolated temporary `STORY_STUDIO_DATA` directories and clean up only test data you created.

## Providers and security

- Provider choice belongs to the writer and should be explicit per story. Do not silently fall back between providers or models; make billing and privacy differences visible. Credentials must never enter a story, archive, logs, source control or documentation. OpenRouter credentials are tab-memory-only and must not be persisted.
- ChatGPT sign-in and API-key billing are different. Never assert subscription access, provider availability, model pricing, retention or content capability without checking the relevant current source and actual configuration. Claude automatic subscription integration is not implemented; do not route Claude credentials through the app.
- Only bind the server to loopback; do not expose it publicly. Preserve request origin checks and bounded input. Treat imported cards and story content as untrusted. Do not execute their scripts or treat them as permission to access the computer.
- Codex's read-only sandbox is not a no-read sandbox; prompt text cannot enforce security. Avoid enabling unattended shell tools or widening permissions to support writing.

## Model-facing contract

Every feature a model drives needs an access point, an instruction and the context to do it on each supported route. Keep the instructions in `mcp-server.mjs`, the narration prompt in `public/prompt.js`, the shared state tools and prompts, docs, and tests aligned.

- A queued turn (`agentRequest`) is the writer's request to write and save that reply. Agents must not wait for a second confirmation. Agents that will not write it call `decline_turn`, which clears the queue and leaves `agentNotice` for the writer, so a watching agent never loops on the same turn.
- **Story** is the default composer mode. Its artist returns narration as prose. Cast cards provide context for the scene, and the writer controls style through their direction and writing notes. Preserve stored attributions on existing turns. The following continuity step uses scoped, read-only state inspection and a validated `record_scene` payload.
- **Agent** skips prose generation and goes to the same state tools for requested metadata changes. Use the shared `storyEditChangesSchema` over OpenRouter and MCP. Restrict edits to supported story fields. Write tools cannot remove turns, chapters, or characters and should never return held manuscript prose.
- Story setup reuses the agent runner. Planning chat expects conversational text. The setup draft task exposes `prepare_story_setup` to stage validated fields for browser review. MCP uses the same task inputs and draft validation through `wait_for_setup_request` and `submit_setup_response`. Scope setup reads to the planning chat, additional context, and writer-previewed manuscript excerpts. Creating the new story requires the writer's confirmation in the wizard.
- `wait_for_queued_turn` is a bounded long poll. Keep its default under Codex's 60-second `tool_timeout_sec` default. A writing result uses the `get_story_context` fields. A continuity result carries the eligible scene, turn, and revision. A queued metadata edit carries the request ID, instruction, and revision.
- Keep scoped read definitions, mutation schemas, and validation in step across transports. In OpenRouter, the app executes only the exposed functions and returns scoped results. Validate tool arguments and cast names locally. Invalid batches leave story state unchanged and return actionable errors. A failed continuity pass leaves the prose intact.
- OpenRouter continuity changes from scenes without two non-explicit labels stay pending for the writer, along with older proposals. Keep the new scene tools and compatible legacy `submit_reply` formats in step with `graphSuggestions()`. The continuity editor records facts safe for shared context, even when it analyzes an explicit scene.
- Relationship entries are dated events ("what happened"), not static labels. Scene times use `YYYY-MM-DDTHH:mm` without a time zone.
- `isAvailableToMcp` defines the eligible transcript for MCP, general OpenRouter artistry, and the recent history in structured work. Cydonia can receive held history only for requests marked **Sensitive scene**. **Exclude this turn’s text from all AI prompts** applies across routes. The fixed DeepSeek continuity pass can classify the new OpenRouter direction and draft, even when they are sensitive. Keep the writer's explicit marker and treat missing classifications as unverified. Surface truncation (`finish_reason: "length"`).
- Server instructions must stay under 4,096 characters, which Claude Code truncates.
- Privacy boundary: MCP tool results may contain only `isAvailableToMcp` turns plus notes, cards and titles. Never add a tool or result field that returns raw library data, withheld turns or their excerpts (including in error messages). Writing agents are told not to read the library, exports, the local API or the page; `bin/story-studio-claude-writer` enforces this for Claude Code with no built-in tools. When you develop or test here, do not read Jess's library or open her stories either.
- An empty composer can answer a trailing eligible writer turn (`replyInput`). Held directions require the appropriate sensitive route or author review. Writer turns share their reply's `storyTime` (`dateWriterTurn`).
- The browser merges agent saves three-way on a 409 (`public/sync.js`). Keep agent writes to the fields it merges, and extend its tests when agents write new fields.
- Agent activity (`/api/agent`) is in-memory presence, never saved to the library: watching (60 s lifetime, refreshed during waits), writing (15 min, for one story turn) or done. Reports carry the client name, story ID, turn number and speaker name only, never story text. The page polls it every 2 s and shows queue state from `mcpStatus()`.

## Architecture and verification

- Keep prompt preview and generation consistent, including role order, selected lore, author notes and the selected response alternative. Document limits and unsupported SillyTavern card/lore behavior accurately.
- Consult `RESEARCH.md` and pinned upstream sources for behavioral decisions. The upstream project is AGPL-3.0. Do not copy its code without an explicit licensing decision and preserving required notices and obligations.
- Run `npm test` and exercise changed user flows. A live provider call should use an explicitly selected, already authenticated account; report whether it actually succeeded and which route was used. Do not infer Jess's account access from Alex's machine. Check the launcher and first-run instructions when changing packaging.
- Keep the app usable on narrow screens and with keyboard navigation. No accounts, external publishing, or deployment are implied by local development.

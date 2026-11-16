# Optional Story Studio MCP tools

The browser runs Story Studio’s writing, continuity, editing, and setup workflows through the selected API providers. An external MCP client can also read or edit the saved library.

## Connect a client

Start **Start Story Studio.command**. In a local MCP client such as Codex or Claude, add a stdio server whose command is the absolute path to this checkout’s `bin/story-studio-mcp`. The desktop client or CLI can provide the connection. Use the same `PORT` as the app if it differs from 4317. Reconnect the client after an update to reload the tool descriptions. Remove old watcher instructions or an installed copy of the former Story Studio MCP skill.

## Tool surface

- Library and context: `list_stories`, `get_story_context`, `get_story_state`, `read_story_turns`, `inspect_continuity`
- Story changes: `create_story`, `edit_story_state`, `edit_story_structure`, `submit_reply`, `get_scene_continuity`, `record_scene`
- Optional browser integration: `open_studio` returns local Book, Graph, and Settings links. For API setup, give the writer the Settings link so they can save a key locally for all stories. `offer_story_directions` can publish three options in Write, each with an optional consequence. The writer previews a choice before using it.

Tool descriptions and schemas specify inputs and effects. Writes require a current library revision. A stale revision is rejected. Prose marked explicit, unverified, or excluded is withheld from tool reads. Approved continuity remains accessible. Read `plot` for dated plot events or `notes` for author guidance. Character tool fields are name, aliases (`nickname`), and description. Use the Studio browser to review held text. Keep sensitive material out of shared story notes and graph facts. For launch or connection issues, see [Operations](OPERATIONS.md).

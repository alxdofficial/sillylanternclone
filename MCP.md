# Connect a local writing agent

Story Studio exposes one local Model Context Protocol server over stdio. Codex, Claude Code, and other local MCP clients can use the same tools. The agent writes inside its own signed-in session under that session's billing or plan. The MCP server itself uses no model credentials and makes no inference calls. OpenRouter remains a separate browser connection.

## Register once

Run the Story Studio launcher first to install dependencies. In Terminal, open your cloned Story Studio folder and run the command for the client you use:

```sh
codex mcp add story-studio -- "$PWD/bin/story-studio-mcp"
```

```sh
claude mcp add --scope user --transport stdio story-studio -- "$PWD/bin/story-studio-mcp"
```

Use your own sign-in in the native client. Restart that client after registering. Verify with `codex mcp list` or `claude mcp list`. An MCP-compatible local client can use the absolute path to `bin/story-studio-mcp` as its stdio command. Remote agent sessions cannot reach your Mac's loopback server.

If you run the browser app at a custom port, configure the same `PORT` environment value for the MCP connection. To let the agent start a server with a non-default library, also configure the matching `STORY_STUDIO_DATA` directory. The default port is 4317.

## Write with an agent

1. Start Story Studio. You can also ask your agent to call `open_studio`, which returns the local browser URL and starts the local server if needed.
2. Finish edits in the browser and wait for **Saved locally**. Select **MCP** and queue the turn you want the agent to write.
3. In the native agent window, say “Use the Story Studio MCP connection to write and save the queued reply.” The browser saves the handoff. The native agent needs this instruction to act.
4. The agent calls `get_story_context`, writes the reply, then calls `submit_reply` with that story ID, speaker and revision. The queued writer turn is already saved. An alternate take stays with its original assistant turn. Agent proposals for the story map are saved separately for review. Refresh the browser if the new turn is not visible, after any local edits have saved.

You can also start from the agent (for example, “List my stories, then continue The Lantern Room and save the reply”). The agent should save only when you ask it to. If the library changed during drafting, the save is refused. The agent can read the current context and revise or retry without overwriting someone else's writing.

`list_stories` returns saved titles and IDs. `get_story_context` assembles the same bounded, model-facing prompt as the app and omits manually excluded passages as well as OpenRouter turns labeled explicit or unverified. Mark a private passage out of AI context before queuing; keep the non-explicit facts the model needs in the reviewed continuity material. The browser library and its exports still contain the full original story. An agent's own conversation can remember text shared previously, so start a fresh native session for a clean handoff.

Provider setup references: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) and [Claude Code MCP](https://code.claude.com/docs/en/mcp).

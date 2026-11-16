# Connect a local writing agent

Story Studio exposes a local Model Context Protocol server over standard input and output (stdio). A local Codex, Claude Code, or other compatible MCP client launches it and discovers its tools. The native client runs the model using its own sign-in and billing settings. Story Studio needs no separate model API key in MCP mode. Use OpenRouter through its own connection in the browser.

## Register on your Mac

Run **Start Story Studio.command** once to install the app's dependencies. Register the local MCP server in the desktop app you already use, or use the optional CLI commands below. The desktop apps can run the watcher in a signed-in local session.

### Desktop app setup

**Codex desktop.** Open **Settings → MCP servers → Add server**. Name it `story-studio`, select **STDIO**, and enter the absolute path to `bin/story-studio-mcp` inside your Story Studio folder as the command. Leave arguments blank. Save and restart the app when prompted. Open a local chat and use `/mcp` to check the connection. [Codex desktop MCP setup](https://learn.chatgpt.com/docs/extend/mcp?surface=app)

**Claude desktop.** Ask the local **Code** session to add this entry to `~/Library/Application Support/Claude/claude_desktop_config.json`, or edit that file yourself. Merge the entry into the existing `mcpServers` object if you already have other servers. Replace the command with the absolute path to your copy of the launcher.

```json
{
  "mcpServers": {
    "story-studio": {
      "command": "/Users/your-name/Story Studio/bin/story-studio-mcp"
    }
  }
}
```

Quit and reopen Claude, then start a local **Code** session and ask it to check for the Story Studio tools. [Claude local MCP configuration](https://modelcontextprotocol.io/docs/develop/connect-local-servers) · [Claude Code desktop configuration](https://code.claude.com/docs/en/desktop#shared-configuration)

### Optional CLI setup

If you use a CLI, open Terminal in the Story Studio folder and run the command for your client.

**Codex**

```sh
codex mcp add story-studio -- "$PWD/bin/story-studio-mcp"
codex mcp list
```

**Claude Code**

```sh
claude mcp add --scope user --transport stdio story-studio -- "$PWD/bin/story-studio-mcp"
claude mcp list
```

After registering, start a fresh local agent session so the client discovers the tools. For another local MCP client, configure a stdio server named `story-studio` with the absolute path to `bin/story-studio-mcp` as its command. The app and MCP client run on the same Mac. If you move the app folder, register the new path.

The default port is 4317. If you set a custom `PORT` for the browser app, set the same value in the MCP server's environment. If you ask the agent to launch the app with a custom library, set `STORY_STUDIO_DATA` to its absolute directory as well.

### Keep the agent to what Story Studio shows it

Story Studio's tools give the agent the cast, world, notes and eligible recent turns. Turns marked explicit, unverified or kept out of AI context are omitted from the tool result. The original text stays in the library, exports and browser transcript. Keep the agent in the Story Studio tools throughout the writing session.

Replies to a direction outside MCP also stay out of MCP until you review the reply and choose **Include as non-explicit** in **⋯ → Time and context → MCP context**. Saved graph events can still carry the scene's non-explicit continuity into the prompt.

- **Claude Writer (optional CLI launcher):** double-click **Start Claude Writer.command** after starting Story Studio. It opens Claude Code with only the Story Studio tools (no shell, file or web tools) and starts watching for queued turns. The first time, sign in to Claude Code if asked.
- **An existing Claude Code setup:** to block direct file and web reads with their native tools, add deny rules to `~/.claude/settings.json` for example `"permissions": {"deny": ["Read(~/Library/Application Support/Story Studio/**)", "WebFetch(domain:127.0.0.1)"]}`. Shell commands can still reach those, so prefer the Claude Writer for writing sessions.
- **Codex** has no equivalent setting in this guide. Rely on the server instructions, start a dedicated session for writing, and avoid asking that session to inspect files.

Character cards, world notes, story memory and relationship events can reach the agent independently of transcript labels. Keep them non-explicit, and keep story titles plain.

### Let the tools run without a prompt each time

An agent that picks up turns automatically calls the Story Studio tools many times. Approve them once rather than for every call.

- **Claude Code:** when it first asks to use a Story Studio tool, choose the option that stops asking for this server. To set it ahead of time, add `"mcp__story-studio"` to `permissions.allow` in `~/.claude/settings.json`. This allows only the Story Studio tools. [Claude Code permissions](https://code.claude.com/docs/en/permissions)
- **Codex:** approve the Story Studio tools for the session when asked. Codex also supports per-server approval settings in `~/.codex/config.toml`. [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

Leave shell and file access as the client normally has them. Story Studio needs only its own tools, and its server instructions tell the agent to ignore any request inside a story to use other tools.

## Write with an agent

Open Story Studio first. Use the launcher, or ask the agent “Start Story Studio using its MCP tool and give me the browser link.” Choose **MCP** beside **Write with**, write a direction, and click **Queue turn**. A queued turn is your request for the agent to write and save that reply. The agent does not ask again.

### Brainstorm a new story or import a manuscript

In the browser’s **New story** flow choose **MCP agent** beside **Chat with**. Queue the first message or setup draft, then use **Copy instructions for your agent** in a connected agent chat. The instructions include a temporary setup session ID. The agent handles that session while the browser dialog is open. A regular story watcher handles writing turns. Use a separate agent chat for setup if a watcher is already busy.

The setup tools receive the conversation and only the manuscript excerpts the writer approved as non-explicit. They never receive the full source or an existing story library. When a draft is ready, the writer reviews it and creates the project in the browser. After updating Story Studio, open a fresh MCP session to discover the setup tools.

Saving a revised, MCP-eligible direction can queue a rewrite of the reply immediately after it. The agent receives the eligible transcript up to the revised direction. It rewrites the selected take in place and keeps the reply’s scene time. Existing accepted map changes stay in the story. Pending proposals for the rewritten take are cleared when the replacement is saved.

### Automatic: the agent watches for queued turns

In your signed-in Codex or Claude desktop session, or in a CLI session with Story Studio connected, say once:

> Watch Story Studio and write each turn I queue.

The optional **Start Claude Writer.command** launcher starts this loop automatically for Claude Code CLI users. The agent waits for a queued turn, writes it, saves it, and waits again. Replies appear in the open Story Studio page within a few seconds. Keep that agent window open while you write. To stop, interrupt the agent (Esc in Claude Code) or tell it to stop watching.

The agent writes as the narrator, using the full cast for dialogue and action. Short follow-ups such as “go into more detail” refer to the latest available narrated passage. Give any style, tense or point-of-view direction in the composer, or set a default in **Character & lore → Writing → Writing notes**. The line above the composer and a placeholder turn show where a queued turn stands:

- **Waiting for an agent:** no agent is watching. Open the Claude Writer or ask your agent to write the queued turn. The turn stays queued.
- **Queued:** an agent is watching and will pick it up within a second or two.
- **Writing:** the agent has the turn and is writing it, with how long ago it picked it up. The reply replaces the placeholder when it is saved.

Without a queued turn, the line says whether an agent is watching. Agents report this through the MCP server while they wait or write. If an agent stops without saying so, it stops counting as watching after a minute, and a turn it picked up but never saved stops showing as being written after 15 minutes. OpenRouter turns show the same **Writing** placeholder while the request runs.

The default wait is 50 seconds in Codex and other stdio clients and 300 seconds when the client identifies as Claude Code. Set `waitSeconds` up to 600 if your client's tool timeout permits it. Codex defaults to a 60-second tool timeout. Set `tool_timeout_sec` for `story-studio` in `~/.codex/config.toml` before asking a Codex agent to wait longer. Each idle result uses another agent step, so stop watching when you finish a writing session. [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

### One turn at a time

After queuing a turn, say “Use the Story Studio tools to write the queued reply.” You can also work from the native agent alone. For example, ask “List my Story Studio stories, then draft the next reply in The Late Ferry.” A direction given in chat is shown to you as a draft first, and is saved only when you ask.

If the library revision changes while the agent is writing, it rereads the story and checks whether the same queued turn is still pending before trying again. The browser merges independent edits when it can. If both sides changed the same part, it asks you to export your browser copy before reloading.

### When the agent hands a turn back

An agent can decline a queued turn, for example when the direction asks for explicit sexual content. The queue clears and the agent's reason appears above the composer. If the agent marks your turn explicit, that turn leaves MCP context. To get a reply to your last turn without retyping it, leave the box empty and click **Queue turn** or, after switching to **OpenRouter**, **Send & write**. The same works after a failed OpenRouter request. For explicit scenes, see [Context and sensitive scenes](README.md#context-and-sensitive-scenes) to move back to MCP afterwards.

**MCP context** excludes turns manually kept out of AI context and OpenRouter turns labeled explicit or unverified. A native agent still remembers anything shared earlier in its own conversation. Start a fresh session when handing off a story after editing its context labels or removing sensitive prose.

## Suggested map updates

With each reply, the agent may send up to five non-explicit updates: a new character, a profile fact, a world fact, a story memory fact, or a relationship event between two cast members with its in-story time. Story Studio checks the cast names and applies valid updates with the reply. **View graph changes** shows what was applied. Updates the app cannot apply and older proposals remain under **Review updates**. To maintain the map yourself, clear **Update the story graph while writing** under **Character & lore** for that story.

## Tool contract

| Tool | Use |
| --- | --- |
| `open_studio` | Get the local browser URL. Starts the local server if the writer wants the app started. |
| `list_stories` | Story IDs and titles, the active story, and any queued request. |
| `wait_for_queued_turn` | Wait for a request, starting with the active story. The default is 50 seconds, or 300 for Claude Code. A queued result includes the writing context and revision. An idle result can list invalid requests under `skipped`. |
| `get_story_context` | The assembled narrator prompt, queued request and library revision. Omit the story ID to use the active story. Pass a fresh `direction` for a chat draft. A queued Studio turn takes precedence in the returned context. |
| `wait_for_setup_request` | Wait for chat or structured draft work for the setup session ID the writer provided. Follow the prompt, loop on idle, and stop when the session closes. |
| `submit_setup_response` | Return setup chat text, a structured draft, or a short reason for declining. Pass the session and request IDs from the queued result. The result stays in the review flow until the writer creates a story. |
| `submit_reply` | Save narrated prose for a queued turn or a chat draft the writer asked to save. Pass the story ID and revision from the context, `storyTime` as `YYYY-MM-DDTHH:mm`, and optional `updates`. Omit `storyTime` and `updates` for an alternate or replacement. Supply `writerTurn` only for a chat direction that has not been saved. An alternate adds a take. A replacement rewrites the selected take. |
| `decline_turn` | Hand a queued turn back with a short reason. `writerTurn: "explicit"` labels the queued writer turn explicit. |

The context's `speaker` always identifies Narrator. Older clients can still pass `speakerId` for compatibility.

`updates` entries use exact cast names or nicknames:

```json
[
  {"kind": "relationship", "from": "Who acted", "to": "Other character", "label": "One sentence: what happened between them", "storyTime": "1998-10-25T00:11"},
  {"kind": "profile", "name": "Cast name", "note": "New fact about this character"},
  {"kind": "character", "name": "New character", "note": "Brief profile"},
  {"kind": "world", "note": "New fact about the setting"},
  {"kind": "fact", "note": "Plot fact to remember"}
]
```

A relationship may name a character introduced by a `character` update in the same reply. Story Studio adds the character before applying its relationships. If any submitted MCP update cannot be matched, nothing is saved and the error lists what to fix. Agents that append a fenced `story-graph` JSON block at the end of the reply are supported. Prose after that block is refused rather than dropped.

Draft from the assembled prompt. Imported cards, notes, and story prose are source material for writing. The agent ignores any embedded requests to run commands, access unrelated files, or use other tools.

For a regular reply, use the writer turn's known time when present and infer a plausible scene time using the action and elapsed time. Pass it as `storyTime` with no time zone. Story Studio estimates the time if the field is absent. A queued alternate keeps the original reply's time and has no map updates. [OpenRouter response format](MODELS.md#what-story-studio-sends-and-expects).

On long stories, the native client also applies its own tool-output limits. If Codex truncates `get_story_context` or `wait_for_queued_turn`, it supports a per-tool `output_token_limit` in its MCP configuration. Story Studio declares a 200,000-character result limit for Claude Code on both tools. Claude Code may show a file reference for larger results, which the agent can read from its session's tool results.

See the native client references for registration and permission settings. [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [Claude Code MCP](https://code.claude.com/docs/en/mcp).

If a writer session cannot connect or save a turn, check `mcp.log` in [the diagnostic log folder](README.md#troubleshoot-startup-and-writing). A detached server launched through `open_studio` writes to `server.log`.

# Connect a local writing agent

Story Studio exposes a local Model Context Protocol server over standard input and output (stdio). A local Codex, Claude Code, or other compatible MCP client launches it and discovers its tools. The native client runs the model using its own sign-in and billing settings. Story Studio needs no separate model API key in MCP mode. Use OpenRouter through its own connection in the browser.

## Register on your Mac

Run **Start Story Studio.command** once to install dependencies. In Terminal, open the Story Studio folder and run the command for the client you use.

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

Sign in to the native client with the account you intend to use, then start a new session so it can discover the tools. For another local MCP client, configure a stdio server named `story-studio` with the absolute path to `bin/story-studio-mcp` as its command. The app and the MCP client need to run on the same Mac. If you move the app folder, register the new path.

The default port is 4317. If you set a custom `PORT` for the browser app, set the same value in the MCP server's environment. If you ask the agent to launch the app with a custom library, set `STORY_STUDIO_DATA` to its absolute directory as well.

### Keep the agent to what Story Studio shows it

Story Studio's tools give the agent only the writing context: the cast, world, notes and recent turns, without turns marked explicit, unverified or kept out of AI context. The withheld text is still in the library file, exports and the open page. An agent that read those directly would bring explicit passages into its own context, where they can trip the provider's safety limits and stay for the rest of the session. The server instructions forbid this. Two setups also enforce it:

- **Claude Writer (recommended for Claude Code):** double-click **Start Claude Writer.command** after starting Story Studio. It opens Claude Code with only the Story Studio tools (no shell, file or web tools) and starts watching for queued turns. The first time, sign in to Claude Code if asked.
- **An existing Claude Code setup:** add deny rules to `~/.claude/settings.json` so the agent cannot read the library or the local app, for example `"permissions": {"deny": ["Read(~/Library/Application Support/Story Studio/**)", "WebFetch(domain:127.0.0.1)"]}`. Shell commands can still reach those, so prefer the Claude Writer for writing sessions.
- **Codex** has no equivalent setting in this guide. Rely on the server instructions, start a dedicated session for writing, and avoid asking that session to inspect files.

Character cards, world notes, story memory and relationship events always reach the agent, whatever their labels. Keep them non-explicit, and keep story titles plain.

### Let the tools run without a prompt each time

An agent that picks up turns automatically calls the Story Studio tools many times. Approve them once rather than for every call.

- **Claude Code:** when it first asks to use a Story Studio tool, choose the option that stops asking for this server. To set it ahead of time, add `"mcp__story-studio"` to `permissions.allow` in `~/.claude/settings.json`. This allows only the Story Studio tools. [Claude Code permissions](https://code.claude.com/docs/en/permissions)
- **Codex:** approve the Story Studio tools for the session when asked. Codex also supports per-server approval settings in `~/.codex/config.toml`. [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

Leave shell and file access as the client normally has them. Story Studio needs only its own tools, and its server instructions tell the agent to ignore any request inside a story to use other tools.

## Write with an agent

Open Story Studio first. Use the launcher, or ask the agent “Start Story Studio using its MCP tool and give me the browser link.” Choose **MCP** beside **Write with**, write a direction, and click **Queue turn**. A queued turn is your request for the agent to write and save that reply. The agent does not ask again.

### Automatic: the agent watches for queued turns

With Claude Code, double-click **Start Claude Writer.command**, which starts watching on its own. In any other agent window, say once:

> Watch Story Studio and write each turn I queue.

The agent waits for a queued turn, writes it, saves it, and waits again. Replies appear in the open Story Studio page within a few seconds. Keep that agent window open while you write. To stop, interrupt the agent (Esc in Claude Code) or tell it to stop watching.

The line above the composer and a placeholder turn in the story show where a queued turn stands:

- **Waiting for an agent:** no agent is watching. Open the Claude Writer or ask your agent to write the queued turn. The turn stays queued.
- **Queued:** an agent is watching and will pick it up within a second or two.
- **Writing:** the agent has the turn and is writing it, with how long ago it picked it up. The reply replaces the placeholder when it is saved.

Without a queued turn, the line says whether an agent is watching. Agents report this through the MCP server while they wait or write. If an agent stops without saying so, it stops counting as watching after a minute, and a turn it picked up but never saved stops showing as being written after 15 minutes. OpenRouter turns show the same **Writing** placeholder while the request runs.

Each wait lasts up to 50 seconds by default, which fits Codex's default 60-second tool timeout. If you raise `tool_timeout_sec` for `story-studio` in `~/.codex/config.toml`, the agent can wait longer between checks. Claude Code allows waits of up to 10 minutes. An idle wait costs a small agent step, so stop watching when you finish a writing session.

### One turn at a time

After queuing a turn, say “Use the Story Studio tools to write the queued reply.” You can also work from the native agent alone. For example, ask “List my Story Studio stories, then draft the next reply in The Late Ferry.” A direction given in chat is shown to you as a draft first, and is saved only when you ask.

If you edit the story in the browser while the agent is writing, its save is refused and the agent rereads the story and rewrites the reply. A reply appears after you save any unsaved browser edits.

### When the agent hands a turn back

An agent can decline a queued turn, for example when the direction asks for explicit sexual content. The queue clears and the agent's reason appears above the composer. If the agent marks your turn explicit, that turn leaves MCP context. To get a reply to your last turn without retyping it, leave the box empty and click **Queue turn** or, after switching to **OpenRouter**, **Send & write**. The same works after a failed OpenRouter request. For explicit scenes, see [Context and sensitive scenes](README.md#context-and-sensitive-scenes) to move back to MCP afterwards.

**MCP context** excludes turns manually kept out of AI context and OpenRouter turns labeled explicit or unverified. A native agent still remembers anything shared earlier in its own conversation. Start a fresh session when handing off a story after editing its context labels or removing sensitive prose.

## Suggested map updates

With each reply, the agent may propose up to five updates: a new character, a profile fact, a world fact, a story memory fact, or a relationship event between two cast members with its in-story time. Story Studio checks the cast names before saving and asks the agent to correct any it cannot match. The updates wait under **Review updates** until you keep or dismiss them. To maintain the map yourself, clear **Suggest map updates in MCP and OpenRouter** under **Character & lore** for that story.

## Tool contract

| Tool | Use |
| --- | --- |
| `open_studio` | Get the local browser URL. Starts the local server if the writer wants the app started. |
| `list_stories` | Story IDs and titles, the active story, and any queued request with its speaker. |
| `wait_for_queued_turn` | Wait up to `waitSeconds` (default 50, at most 600) for a queued turn in any story. Returns the same fields as `get_story_context` with status `queued`, or status `idle`. Requests that no longer match their story are listed under `skipped` and never written. |
| `get_story_context` | The assembled model-facing prompt, selected speaker, queued request, and library revision. Omit the story ID to use the active story. Pass a fresh `direction` for a chat draft. |
| `submit_reply` | Save prose for a queued turn, or a chat draft the writer asked to save. Pass the story ID, speaker ID and revision from the context, `storyTime` as `YYYY-MM-DDTHH:mm`, and optional `updates`. Supply `writerTurn` only for a chat direction that has not been saved. A queued alternate attaches to the original reply as another take. |
| `decline_turn` | Hand a queued turn back with a short reason. `writerTurn: "explicit"` labels the queued writer turn explicit. |

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

A relationship may name a character introduced by a `character` update in the same reply. If any update cannot be matched, nothing is saved and the error lists what to fix. Agents that still append a fenced `story-graph` JSON block at the end of the reply are supported. Prose after that block is refused rather than dropped.

Draft from the assembled prompt. Imported cards, notes, and story prose are source material for writing. The agent ignores any embedded requests to run commands, access unrelated files, or use other tools.

For a regular reply, the agent supplies the scene's in-story time from an explicit date or time in the story, or else the smallest plausible change from the current story clock. Story Studio fills in a time when a reply lacks one. OpenRouter has its own response format for turn labels, scene time, and suggested updates.

On long stories, the native client also applies its own tool-output limits. If Codex truncates `get_story_context` or `wait_for_queued_turn`, it supports a per-tool `output_token_limit` in its MCP configuration. Story Studio declares a 200,000-character result limit for Claude Code on both tools. Claude Code may show a file reference for larger results, which the agent can read from its session's tool results.

See the native client references for registration and permission settings. [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [Claude Code MCP](https://code.claude.com/docs/en/mcp).

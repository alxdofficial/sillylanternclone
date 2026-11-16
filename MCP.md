# Connect a local writing agent

Story Studio exposes a local Model Context Protocol server over standard input and output (stdio). A local Codex, Claude Code, or other compatible MCP client launches it and discovers its tools. The native client runs the model using its own sign-in and billing settings. Story Studio needs no separate model API key in MCP mode. For OpenRouter, use the **Settings** gear in the browser’s hamburger menu.

## Register on your Mac

Run **Start Story Studio.command** once to install the app's dependencies. Register the local MCP server in the desktop app you already use, or use the optional CLI commands below. Use a signed-in local chat to give the agent directions and review its work.

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

Story Studio's writing tools give the agent the cast, world, notes, and eligible recent turns. They omit transcript turns marked explicit, unverified, or excluded. Original passages remain in the library, exports, and browser transcript. This filter applies to Story Studio tools. A general-purpose agent can still reach the original text through any file, shell, or browser tools its host permits.

Replies to a direction outside MCP also stay out of MCP until you review the reply and choose **Include as non-explicit** in **⋯ → Time and context → AI context**. Saved graph events can still carry the scene's non-explicit continuity into the prompt.

- **Claude Writer (optional CLI launcher):** double-click **Start Claude Writer.command** after starting Story Studio. It opens Claude Code with only the Story Studio tools (no shell, file or web tools) for a dedicated native writing chat. The first time, sign in to Claude Code if asked.
- **An existing Claude Code setup:** to block direct file and web reads with their native tools, add deny rules to `~/.claude/settings.json` for example `"permissions": {"deny": ["Read(~/Library/Application Support/Story Studio/**)", "WebFetch(domain:127.0.0.1)"]}`. Shell commands can still reach those, so prefer the Claude Writer for writing sessions.
- **Codex** has no equivalent setting in this guide. Rely on the server instructions, start a dedicated session for writing, and avoid asking that session to inspect files.

Character cards, world notes, story memory and relationship events can reach the agent independently of transcript labels. Keep them non-explicit, and keep story titles plain.

## Write in your native chat

Ask your agent to open Story Studio and work with the story in your chat. Use the returned **Book view** or **Graph** link beside the chat. The links work in the client’s browser, when available, or in a regular browser.

> Open Story Studio next to this chat and find The Late Ferry. Draft a scene in which Mae checks the pressed letters with Noor. Show me the draft first.

A request to write or continue the story saves the scene in the same turn. Ask to see a draft first if you want to review it in chat before the agent saves it. The manuscript receives the prose. Your instructions and discussion live in the native chat. Saved edits appear in the companion automatically. The visible browser checks for changes about every 2.5 seconds and waits while you have unsaved edits or a dialog open. To work on a different story in a tab that is already open, select it from the hamburger menu or open the link returned by the agent.

Use **Graph** for cast, timeline, writing notes, and review of proposed continuity. The OpenRouter composer starts hidden when you open an MCP companion link. In **Write**, click **Show composer** to reveal it or the eye icon to hide it. Write shows saved author directions alongside the prose. To include them in the graph timeline, check **Show author directions in Graph** in **Settings**. The plus at the end of the manuscript opens a manual prose editor. Use **⋯ → Time and context** on a turn to review or change its context label.

### How the agent chooses what to do

The native agent interprets the latest chat request using the Story Studio instructions it receives on connect. There is no mode switch in the chat. Tool descriptions and read results tell the agent what it can do next.

The [Story Studio MCP skill](skills/story-studio-mcp/SKILL.md) maps writer requests to the available tools, including the change shapes for relationship events, cast, and notes. An agent working in the repo can read the skill directly. A native chat gets the core instructions and tool schemas when MCP connects. After pulling updates, refresh any separately installed skill copy and reconnect the client before starting a fresh chat. [Update checklist](OPERATIONS.md#stop-update-and-restart)

Claude or Codex owns its conversation and compaction. Story Studio returns a bounded starting brief and lets the agent page back through the full eligible manuscript and story fields. OpenRouter instead receives task-specific instructions, context, and function schemas on each call. The OpenRouter models run without reading the repo guide.

| Writer’s request | Expected tool sequence |
| --- | --- |
| “Continue the story with fewer lines of dialogue.” | Read `get_story_context` with `purpose: "draft"` and use submit_reply to save the next scene with that direction. |
| “Show me a draft first.” | Read drafting context and show the draft in chat for review. |
| “Write the next scene.” | Read drafting context, then use `submit_reply` to save the prose and its non-explicit continuity changes. |
| “Make sparse dialogue the default.” | Read `get_story_state` and the writing notes if needed, then use `edit_story_state` to update the standing guidance. |
| “Rewrite the last scene in Ada’s point of view.” | Find the saved scene with `read_story_turns` (`recent: true`), read it by turn number, then revise that turn with `edit_story_structure`. |
| “What if Ada were the one who opened the door?” | Read `get_story_context` with `purpose: "reference"` and discuss possibilities in chat. |

For mixed requests, the agent follows the order you give and refreshes its context after each write. When “make it darker” could refer to the saved scene, the next draft, or the standing style, the agent is instructed to ask which change you mean.

Browser edits, deletions, and rewinds are visible the next time the agent reads the saved story. The agent is instructed to reread it for each new request about the story and to use that result as canon, even if its chat still contains an earlier version. A browser save does not send the chat an event. If the story changes after the agent’s read, a write with the older revision is rejected so the agent can reread before trying again.

When saving a scene, the agent records the non-explicit changes readers will need later in the graph, cast, world, or plot memory. These facts can carry continuity after older prose leaves the prompt. Standing style choices belong in writing notes. If there is no durable change, the agent sends an empty list of updates.

For large setup material supplied in chat, the agent can work in sections. Once asked to save, it can call `create_story` with the agreed baseline, then apply further approved cast, world, and relationship changes in smaller `edit_story_state` batches. Each batch uses the latest revision. Use the browser’s import wizard to turn an existing manuscript into saved prose.

## Tool contract

| Tool | What it does |
| --- | --- |
| `open_studio` | Return Book and Graph links and start the local app if needed. Accepts an optional story ID. |
| `list_stories` | List stories by ID and title and return the current library revision. |
| `offer_story_directions` | Publish three or four next-beat choices anchored to the current turn. Optionally wait briefly for the browser selection. |
| `create_story` | Create an agreed setup with title, premise, world, notes, cast, and starting relationships using the library revision. For importing existing prose, use the browser’s manuscript import. |
| `get_story_context` | Read eligible recent prose, cast, and approved graph facts. Use `draft` to assemble a narrator prompt and `reference` to read without a writing instruction. Returns the story ID, revision, and history counts. |
| `read_story_turns` | Browse turn IDs, dates, chapter breaks, and short previews. Use `recent: true` for the latest turns. Request one turn by number and follow `nextOffset` for long eligible prose. Held turns return context status and metadata. |
| `submit_reply` | Append the requested prose and optionally record scene time and up to five non-explicit graph facts. Pass `updates: []` when nothing changed. |
| `get_scene_continuity`, `record_scene` | Read and finish the continuity of a scene that still has a pending pass. |
| `get_story_state`, `inspect_continuity` | Get a story-state overview and revision, or inspect a section. Page through cast, relationship events, and long fields. Use the `eventIndex` and revision from the same relationship read for corrections. |
| `edit_story_state` | Batch requested changes to world, premise, writing notes, author’s note, plot memory, profiles, settings, and relationship events. |
| `edit_story_structure` | Amend eligible prose, adjust dates and chapter breaks, hold context, branch, rewind, or delete. The single-change route also accepts the existing metadata operations. |

Each write uses the revision from the relevant read. If another save changed the library, reread and reconcile before retrying. Remove or rewind material only with the writer’s explicit instruction. Releasing held prose into model context is a browser review action. Story Studio’s safety filter applies to its tools. Content already present in a native chat remains under that client’s control.

### Examples

- “Add that the ferry runs on a reduced winter schedule to the world notes, and rename Tomas to Tomás in the cast.”
- “Set turn 6 as the next chapter, then make a branch called ‘The Other Crossing’ from that point.”
- “In the relationship graph, change the time when Ada hands Mina the map to midnight. Keep the prose.”

For longer fields, call `inspect_continuity` with `section: "cast"`, the exact `character`, and a `field` such as `"personality"`, or use the corresponding section for world and story notes. Continue with the returned `nextOffset` before replacing a whole field. For chronology, use `YYYY-MM-DDTHH:mm` in story time. Keep proposed continuity non-explicit, including when the browser keeps the scene itself out of general context.

### Story Flow

Ask your native agent for Story Flow in its chat. **Ask agent for directions** in the companion copies a request you can paste there. When the writer opts in, offer three or four distinct directions grounded in current canon. Use offer_story_directions with a current revision. The Write view displays the choices even when the composer is hidden. A click gives permission to write and save the selected beat. The call can return pending if its brief wait ends first. Resume with get_story_context using purpose draft and no direction. It applies a selected choice if one is available. Saving the narration clears the offer. This is a bounded interaction from the native chat session.

### Older queued work

A local installation can opt into the old MCP queue tool set by setting `STORY_STUDIO_LEGACY_QUEUE=1` in the MCP launcher environment. It is for recovering older requests. Start a fresh session to discover the tools after changing the setting. The browser uses direct collaboration and OpenRouter for new work.

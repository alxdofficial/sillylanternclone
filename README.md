# Story Studio

Story Studio is a local fiction-writing workspace with a manuscript, cast, and relationship timeline. Talk to a native MCP agent in its chat, or use the browser’s OpenRouter composer. **Book view** and **Graph** can sit beside either workflow.

## Start on your Mac

1. Open the [Story Studio repository](https://github.com/alxdofficial/sillylanternclone). Clone it with Git, or download and unzip **Code → Download ZIP**. Keep the app folder somewhere you can find again.
2. Double-click **Start Story Studio.command**. The launcher installs the locked npm dependencies and, if it needs Node.js, downloads a version for your Mac from nodejs.org and verifies its checksum. If macOS blocks the launcher, open Terminal in the app folder and run `zsh 'Start Story Studio.command'`.
3. Leave the launcher window open while writing. It opens [Story Studio](http://127.0.0.1:4317/) in your browser. Press Control-C in Terminal to stop the server after saving your work.

Setup needs internet access for the first download. Story Studio runs on Node.js 20 or later with npm and uses the MCP SDK, Zod, and fflate. You can also run `npm ci` followed by `npm start` if Node.js and npm are already installed. Manual writing works without a provider account. MCP needs a local MCP client with its own sign-in. OpenRouter needs an OpenRouter API key.

You can ask your local agent to set it up for you.

> Clone https://github.com/alxdofficial/sillylanternclone on this Mac and follow README.md, OPERATIONS.md, and MCP.md. Briefly tell me what you’re setting up. Start Story Studio, register its MCP server in my local agent client, and give me the Book view link. If you need me to sign in, approve the tools, or open a fresh session, tell me what to do.

Register MCP in your local **Codex or Claude desktop client**. Start a fresh chat and ask it to open Story Studio. The CLI is optional. [Desktop and CLI setup](MCP.md#register-on-your-mac) · [Start, stop, update, and restart](OPERATIONS.md)

## Work in native chat

Ask your agent to draft, save, or edit in your normal chat. Open its Book link in the built-in browser alongside the conversation, then switch between **Book view** and **Graph**. Existing story tabs follow saves to the story they’re showing. Use **Stories** when you want to switch stories. The agent can work on the cast, world, relationships, scene text and times, and chapters, and can branch a story when asked. [Native workflow and tools](MCP.md#write-in-your-native-chat)

## Try The Late Ferry

New libraries open on **The Late Ferry**, a late-night harbor mystery with six characters and six turns. Find it later under **Stories → Open demo**. Changes to the demo stay in memory. Reload the page to put everything back, including the cast and manuscript. Your own stories save normally and are the ones included in backups.

1. Open **Graph** and click through the cast. Select the line between Sam and Ellis to see their starting relationship and the later radio call. The timeline shows the scene times across midnight.
2. Back in the transcript, use **View graph changes** on turn 4 to see what carried forward from the gate check. Open **Book view** to read the two chapters without the author directions.
3. Open **Prompt** to see the beacon, incident book, and cast in context. Use **Add prose**, write with OpenRouter, or ask your native agent to continue with Mae inspecting the impression on the next page. Use **⋯ → Branch from here** to keep an alternate storyline.
4. For a story you want to keep or export, choose **Stories → New story**.

The demo was built and exported through the current Story Studio browser workflow. DeepSeek V4.1 Flash brainstormed and proposed the setup, including the starting relationships. Cydonia 24B v4.1 drafted the scenes, and DeepSeek recorded their times and continuity changes. The prose was lightly copyedited and reviewed in Story Studio. [See the verification notes](TESTING.md#the-late-ferry-starter).

## Progress the story with OpenRouter

1. Open **Connection**, enter your OpenRouter API key, and choose a writing model. The key stays in this page’s memory until it closes or reloads. Prices in the model picker assume 2,000 input and 5,000 output tokens per chapter. The continuity call is billed separately. [Model notes and prices](MODELS.md)
2. In **Write**, choose **Progress the story** and select a **Writer** and **Continuity agent** independently. Use **Prompt** to inspect the current context. Set standing style preferences in **Graph → Writing**. Use **Sensitive scene** with an NSFW-friendly writer when appropriate.
3. Click **Send & write**. The selected artist writes the prose. The selected continuity agent classifies the scene and proposes non-explicit continuity updates. **View graph changes** shows the updates for that turn. Proposals needing approval are in **Graph → Review updates**.

**Hide composer** keeps Write focused on the manuscript. **Directions** shows or hides author inputs. Use the manuscript outline to jump to a turn and the copy icon to copy its prose. **Edit** saves prose in place. When a direction has a paired reply and OpenRouter is configured, **Save & rewrite** regenerates that reply. **Save without rewriting** saves just the edit.

Use **Add prose** from any view to write or paste text without a model. Choose **Explicit** for sensitive text, or **Verified non-explicit** if you want it included in general AI context. You can review a saved turn in **Write → ⋯ → Time and context**. The same menu has chapter breaks, branching, and rewind.

To add your own OpenRouter model, select **Add model by ID…** in Connection and enter its `author/model` ID. User-added models appear in the prose model picker and setup chat. Select one in Connection to remove it.

## Story Flow

In **Write**, open **Story Flow** and use the refresh icon to suggest directions. The choices appear just above the composer. Pick one of the three or four next beats or type your own direction. In OpenRouter, picking a direction starts the next scene with your selected writer and continuity agent. While Flow is open, Story Studio offers fresh directions after a successful new scene. Suggesting directions uses a separate OpenRouter request.

For native MCP, ask your agent to use Story Flow. Its directions appear above the composer. Choose one there. If the agent is still waiting, it receives the choice directly. If the brief wait has ended, tell the agent to continue in its chat. Studio keeps the selection until the agent saves the continuation or the story moves on.

## Editor agent

In **Write**, choose **Editor agent** and a supported OpenRouter model. Enter a request such as “Add a lighthouse to the setting” and select **Apply edits**. This can update writing and author notes, cast profiles, world details, and existing relationship events without changing the manuscript. For conversational editing, send the request in your native chat.

## Brainstorm a new story

Under **Stories → New story**, choose **Set up manually** or **Brainstorm with a model**. OpenRouter handles brainstorming in the browser. The selected model reads the conversation, additional context, and any manuscript. If they exceed the model’s input budget, **Prepare setup draft** reads them in sections and combines structured notes for review. Choose **Prepare setup draft** to get the world, cast and relationships, review them, then click **Create story**. Your native agent can also brainstorm in its chat and then create the agreed setup when asked.

## Read and export the book

Open **Book view** to read the story as a manuscript. It includes replies, including prose you enter through **Add prose**, and uses the selected take for every reply. Author directions stay in **Write**.

The first reply starts Chapter 1. To start another chapter at a later reply, open its **⋯** menu in **Write** and choose **Start new chapter here**. Use **Remove chapter break** in the same menu to join it to the preceding chapter. Chapter numbers update automatically.

In **Book view**, use **Go to chapter** to jump between chapters. On a wide window, choose **Two pages** to read facing pages with **Previous** and **Next**. Choose **Export Markdown**, select the first and last chapters to include, and click **Download .md**. The file uses the story’s chapter numbers and is generated locally in the browser. Use **Export history ZIP** separately to make a restorable library backup.

## Import an existing story

1. Choose **Stories → New story → Import an existing story**, or **Import a manuscript** in the setup chat. Paste the manuscript or choose a plain-text or Markdown file. The library has a 16 MB transfer limit.
2. Story Studio turns standalone chapter, turn and scene headings into native breaks. It also recognizes common Markdown scene dividers. Long passages are split locally at nearby paragraph or word boundaries. Existing chapter breaks take priority. For an unmarked story, review the suggested breaks or adjust them later from each turn’s **⋯** menu.
3. To prepare a setup draft with OpenRouter, add notes or references in **Additional context**. Setup reviews your complete chat, reference notes, and manuscript. When it needs multiple requests, every source section is sent to the selected draft model for review. The preview shows a sample for your own inspection. It proposes cast, setting, and continuity fields for your review. The manuscript supplies the imported prose. For a completely local import, choose **Review without AI**.
4. Review the draft and choose **Create story**. All original prose goes into a new story and appears in **Write** and **Book view**. The source headings are kept in Write and the library backup. Imported prose starts outside general model context until you review it as non-explicit. Eligible imported prose becomes early story turns. Setup chat and reference notes are also saved locally, with a separate review option to include them as early OpenRouter agent history.

## Character & lore in Graph

The **Story timeline** on the left groups setup, dated scenes, and relationship events by their in-story date and time. Entries at the same minute share a timestamp. Entries within a day show the time in 24-hour format. A direction and its immediate prose reply share one entry at the reply's time when available. Select that entry to read both parts and inspect graph changes. Either text can be collapsed. Standalone prose and unanswered directions have their own entries. Select a moment to inspect its events and highlight their connections on the graph. Older and manually written turns without a date appear under **Undated turns**. To date one, open **⋯ → Time and context** on the turn in the transcript. On a narrow screen, choose **Show timeline** above the graph.

Hover over a character or line for a preview in the right pane. Click or tap it to keep its details open and edit.

- **+ Character** creates a profile. Every character uses the same profile and editing controls. Click a node to edit its name, aliases, description, and optional personality, scenario, and sample dialogue. You can also import a JSON character card. Removing a character removes their relationship events when you save. Their existing dialogue stays in the transcript.
- **+ Relationship** lets you select two characters in the order of the event. Write one sentence describing what happened and choose its **In-story date and time**. Several events between the same two characters share a graph line. Its count shows how many are saved. Click the line to edit or delete individual events. **Undo last deletion** is available in the inspector before you save.
- **World** holds the setting, start date and time, short continuity facts under **Story memory**, and optional keyword lore. Enter one rule per line, such as `harbor, dock | The tide cuts off the old footpath.` Use `* | lore` for a rule that is always active. **Writing** holds the opening premise, prose directions, style notes, and the title. Cast, graph, and writing fields share the request’s context budget. There is no cast count or field-by-field word quota.

Relationship events have an in-story timestamp to the minute, for example `1998-10-24 18:30`, as well as a source turn. All setup events share the **Story start** time. MCP and OpenRouter can infer the scene and event times from the story. Story Studio uses estimates when needed. Set the start in **World** and correct event times in the graph if the story has a specific date, time jump, or flashback.

The continuity pass can update characters, world details, relationships, and story memory. With OpenRouter, automatic application requires both the direction and reply to be labeled non-explicit. Updates from sensitive or unverified turns and older pending proposals stay in **Review updates**. Choose **Keep** on useful non-explicit facts and **Save changes**, or use **Dismiss**. **View graph changes** shows updates attached to a particular turn. The library records versions of the cast, world setting, writing notes, and story memory by turn.

## Context and sensitive scenes

The composer’s **Context** indicator shows the color-coded story-state and history usage, the current direction, and reserved output. Built-in writers share a 112,000-token input budget with up to 16,000 for the latest eligible story and 8,000 reserved for output. When space runs out, the writer keeps current story state and trims older prose first. If the state and direction alone are too large, Studio asks you to shorten either. OpenRouter agents use the selected model’s window and remove older exchanges from the prompt in large batches. The manuscript is preserved. In **Progress the story**, use **Pass** in the panel to see the selected writer or continuity model and its own budget.

The narrator prompt includes the cast, setting, applicable lore, and recent eligible prose. It limits recent prose to an estimated 16,000 tokens, with a smaller allowance on models with shorter budgets. Older prose stays in the transcript. The prompt uses the remaining budget for relationship events. When the full timeline exceeds that budget, Story Studio favors events involving characters mentioned in the current scene, then newer events, and presents the selected events chronologically. Saved story-memory facts also carry forward.

For a sensitive scene, choose **Progress the story** and an NSFW-friendly writer and check **Sensitive scene** before sending. Story Studio marks that direction explicit and allows the selected writer to see eligible sensitive history for that request. DeepSeek V4.1 Flash sees the new direction and draft for classification and continuity. General models and MCP receive eligible prose plus approved, non-explicit graph facts. Use the checkbox before sending because automatic classification happens after the artist receives your direction. [OpenRouter context and tools](MODELS.md#what-story-studio-sends-and-expects)

Labels are model judgments and can be wrong. If classification fails, Story Studio keeps the prose and treats the unverified text as withheld from general model context. If the artist hits its output limit, the partial draft stays in the transcript and receives a cutoff warning. Changes from sensitive or unverified scenes need review before entering shared story context. Review manually added, imported, and edited passages too.

To continue with a general model after a sensitive scene:

1. Check the badges on both the writer turn and the reply. **Context censored** means general AI prompts skip that text while approved continuity can still carry forward. After revising prose with **Edit**, you can check **I’ve verified this text is non-explicit** before saving. You can also review a label from **⋯ → Time and context**. Select **Exclude this turn’s text from all AI prompts** to withhold the text from every route, including Cydonia.
2. Keep any needed continuity in a short, non-explicit relationship event or **World → Story memory**. Check nearby turns and notes for copies of the sensitive prose.
3. Clear **Sensitive scene**, select your writing route, check **Prompt**, and send the next direction. Start a fresh native agent session if the previous session already saw the original text.

The saved library and exports include the original passages. Story Studio filters its own prompts and MCP tool results. Use a dedicated writing session and keep it within those tools. A general-purpose agent may still have file, shell, or browser access that can reach the original text. The optional Claude Writer starts Claude Code with its built-in tools disabled. Keep character cards, world notes, story memory, and relationship events non-explicit because they can enter model context separately from the transcript. [MCP permissions and context](MCP.md#keep-the-agent-to-what-story-studio-shows-it)

## Display names

On the **Display names** tab, put the original character or place name on the left and the name you want to see on the right. Use the exact capitalization from the story. Save the table, then return to **Write** or **Book view**. Replacements use the same typography as the surrounding prose. The table belongs to this story in this browser. Editors, copied and exported prose, graph data, and model context use the original names.

## Back up and move your library

The default library folder is `~/Library/Application Support/Story Studio/` and its main file is `library.json`. Quit Story Studio and copy the whole folder to migrate to another Mac. Or use **Stories → Export history ZIP** to download `library.json` and readable story transcripts. To restore an export, unzip it and select `library.json` with **Import library**. Import replaces the current library after confirmation. If a newer save from another tab causes a conflict, export your local work before reloading.

The app binds to your Mac’s loopback address and stores the library locally. When you use a model, the assembled context goes to its service through your selected route. The OpenRouter key is held in the browser page's memory, passed through the local server for requests, and cleared on reload. Story exports exclude the key.

## Troubleshoot startup and writing

Open **Finder → Go → Go to Folder** and enter `~/Library/Logs/Story Studio`. The launcher also prints the folder in Terminal. Logs are local JSON Lines with UTC timestamps. Summary files rotate at about 1 MiB and trace files at about 16 MiB. Each keeps one previous copy ending in `.1`.

| File | What to look for |
| --- | --- |
| `setup.log` | The runtime download, dependency install, server readiness, and launcher failures with their stage and exit code. |
| `server.log` | Startup, saves, exports, and both OpenRouter passes with routing, usage, and classification diagnostics. |
| `mcp.log` | Native tool outcomes, and context counts for each handoff, including what was omitted by reason. |
| `openrouter-trace.log` | Full provider request and response payloads for every writing, continuity, Agent, and setup round. Find the browser request by `requestId`, then match a request and response by `exchangeId`. |
| `mcp-trace.log` | Full handled tool arguments, results, and errors, including prompts delivered to a native chat. Filter by `tool` and the connection's `sessionId`. |

For example, this shows the latest server events as they arrive.

```sh
tail -n 30 -F "$HOME/Library/Logs/Story Studio/server.log"
```

For an error with a **Log ID**, match it to `requestId` in `server.log`. The `prose` field shows the artist call. `toolCalls` records each continuity, Agent, or setup-draft round and the tool names it called. Provider records include model, HTTP status, timing, output cap, and finish reason, plus host, token usage, and cost when OpenRouter reports them. `metadataCode` reports continuity failures, and `inputSensitivity` and `replySensitivity` record the two classification labels.

`mapUpdateRejections` shows why graph proposals failed validation and which fields were affected. The continuity editor can correct or omit the entries during its tool loop. The log leaves out the proposed text and names.

For an MCP handoff, look for `context_prepared` in `mcp.log`. It reports how many history turns were included, and how many were omitted for the prompt budget or for each context rule. `recentPolicyOmissions` lists the last 24 turns omitted by the context rules and the reason for each. The same hashed `storyRef` appears in both logs so you can trace a story without putting its title in the logs. If the app never starts, check `setup.log` and the launcher Terminal. If the browser page opens but its controls fail, check the browser's developer console as well.

Trace files include the prose and prompts that were actually sent or received, including explicit content. API keys are redacted and request headers are excluded. The trace files stay local and are separate from story exports. Keep them private. To redirect logs, set `STORY_STUDIO_LOG_DIR` in both the server and MCP launcher environments. If you set only `STORY_STUDIO_DATA`, logs go in its `logs` subfolder. [Trace queries and operations](OPERATIONS.md#find-a-handoff-in-the-traces)

## Project reference

- [MCP.md](MCP.md) covers registration and the native tool contract. The [Story Studio MCP skill](skills/story-studio-mcp/SKILL.md) explains when to read or edit each part of the story.
- [RESEARCH.md](RESEARCH.md) records the pinned SillyTavern sources, the UI and prompts studied, and the features implemented independently.
- [TESTING.md](TESTING.md) records browser and provider checks. Run `npm test` for automated regression tests.

## Local and hosted architecture

The native client owns its conversation and model calls. MCP exposes filtered reads and revision-checked story edits. The browser displays and audits the same library. The local server owns the OpenRouter writing and editing workflows. A hosted version could reuse that server-side harness with account-scoped storage, server-managed credentials, and service billing.

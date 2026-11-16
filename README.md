# Story Studio

Story Studio is a local fiction-writing workspace with a cast, relationship timeline, and manuscript. The composer starts in **Story** mode. Use it to write the next scene and let Story Studio maintain continuity. Choose **Agent** to edit the cast, setting, or story notes directly.

## Start on your Mac

1. Open the [Story Studio repository](https://github.com/alxdofficial/sillylanternclone). Clone it with Git, or download and unzip **Code → Download ZIP**. Keep the app folder somewhere you can find again.
2. Double-click **Start Story Studio.command**. The launcher installs the locked npm dependencies and, if it needs Node.js, downloads a version for your Mac from nodejs.org and verifies its checksum. If macOS blocks the launcher, open Terminal in the app folder and run `zsh 'Start Story Studio.command'`.
3. Leave the launcher window open while writing. It opens [Story Studio](http://127.0.0.1:4317/) in your browser. Press Control-C in Terminal to stop the server after saving your work.

Setup needs internet access for the first download. Story Studio runs on Node.js 20 or later with npm and uses the MCP SDK, Zod, and fflate. You can also run `npm ci` followed by `npm start` if Node.js and npm are already installed. Manual writing works without a provider account. MCP needs a local MCP client with its own sign-in. OpenRouter needs an OpenRouter API key.

You can ask your local agent to set it up for you.

> Clone https://github.com/alxdofficial/sillylanternclone on this Mac and follow README.md and MCP.md. Start Story Studio, register its MCP server in my local agent client, and start a signed-in writer session that watches Story Studio and writes each turn I queue. If you need me to sign in, approve the Story Studio tools, or open a fresh session to finish, tell me exactly what to do.

Set up MCP and start the watcher in a local **Codex or Claude desktop session**. The CLI is optional. After registration, start a fresh local session and say “Watch Story Studio and write each turn I queue.” Keep it open while you write. Claude Code CLI users can also double-click **Start Claude Writer.command** to open a dedicated watcher. [Desktop and CLI setup](MCP.md#register-on-your-mac)

## Try The Late Ferry

New libraries open on **The Late Ferry**, a late-night harbor mystery with six characters and six turns. Find it later under **Stories → The Late Ferry · Demo**. Changes to the demo stay in memory. Reload the page to put everything back, including the cast, transcript, and any queued writing request. Your own stories save normally and are the ones included in backups.

1. Open **Character & lore**. Read the world setting and click through the cast. Click the line between Sam and Tomas or Noor and Mae to inspect the saved radio reports.
2. Back in the transcript, use **Next** and **Previous** to compare the two takes of the final scene. **View graph changes** on turn 4 shows the saved radio reports. It also takes you to the pending suggestion on turn 6.
3. Open **Prompt** to see the beacon and radio lore in context. Try writing a line in **Manual**, or ask **MCP** or **OpenRouter** to continue with Noor checking the beacon. Follow the relevant connection instructions below to use a model.
4. For a story you want to keep or export, choose **Stories → New story**.

The demo began as a blank story in the browser. The cast and setting were entered by hand, and Cydonia wrote the three scenes and alternate through OpenRouter. DeepSeek supplied scene times and graph proposals. [See the verification notes](TESTING.md#the-late-ferry-starter).

## Story mode

1. Open **Stories → New story**. Choose **Set up manually** to enter a title, premise, world, writing notes, and cast. Or choose **Brainstorm with a model**, choose OpenRouter or MCP, and chat through your ideas. Click **Prepare setup draft** when you are ready. Review or revise the editable fields, then click **Create story**. You can change the setup later under **Character & lore**.
2. In **Story**, describe what happens next or paste the start of a scene. Directions can be up to **8,000 words**. For example, “Have Noor investigate the beacon from the pier, in close third person.” Set a one-off style in the composer or a standing preference in **Character & lore → Writing → Writing notes**. By default the narrator matches established prose or uses third-person past tense for a new story. **Prompt** previews the writing context for the selected route.
3. Choose who writes the turn.

   - **MCP** gives the turn to your signed-in Codex, Claude Code, or other local MCP client. Click **Queue turn**. The agent writes and saves the narration, then records the scene's continuity. The status above the composer shows where the request stands. If you have no watcher running, ask your agent to handle the queued turn. [MCP setup](MCP.md)
   - **OpenRouter** uses the model you select as the artist. In **Connection**, enter your API key, select a model, and save. You can change the artist beside **Write with**. DeepSeek V4.1 Flash handles the separate continuity pass. The picker shows estimated chapter costs based on 2,000 input and 5,000 output tokens. Continuity calls are billed separately. [Model notes and prices](MODELS.md)
   - **Manual** saves what you write without a model call. Use **Add reply** to enter the co-writer’s side yourself.

The artist writes the scene as prose. The continuity pass reads the new scene, consults the cast or timeline when needed, and records the in-story time and durable, non-explicit facts. Open **View graph changes** on the reply to see what was recorded.

Select a turn in **Turns** to jump directly to it. On a narrow screen, open **Turns** beside the story title. **Latest** jumps back to the end. The list uses one short preview per direction and reply pair, with standalone and unanswered turns listed separately.

Use the copy icon beside any reply to copy the visible take to your clipboard.

Use **Edit** on an author direction to bring it back into the composer. **Save & rewrite** in OpenRouter or **Save & queue rewrite** in MCP uses the revised direction and the earlier story to replace the paired reply in place. Later turns and accepted graph changes stay where they are. **Edit** on narration saves your revised text directly. Manual mode saves edits without a model call. Deleting an author direction also deletes its paired reply. If a reply already has multiple takes, use **Previous** and **Next** to choose which one appears in the story and future prompts.

The provider and model are remembered per story and composer mode in the current tab, including through rewind and turn deletion. The OpenRouter key stays in memory and must be entered again after a reload.

To use an OpenRouter artist outside the built-in list, choose **Story → Connection → Add model by ID…**. Enter the exact `author/model` ID and save. It appears as **User-added** in Story mode and setup chat. To remove it, select it in **Connection** and click **Remove user-added model**. The saved list lives in this browser.

Open **⋯** on a turn to explore a different path. **Branch from here** creates a separate story through that turn, including the selected take, the cast and world notes recorded then, and earlier relationship events. You can branch from the demo to keep writing a regular saved story. **Rewind to here** removes later turns and their events from the current story. Deleting a story or a turn, rewinding, removing a character or relationship event, and replacing your library all ask for confirmation. For older turns without a saved cast or world version, Story Studio uses the current notes.

## Agent mode

Switch to **Agent** for a request like “Add the old ferry terminal to the setting” or “Give Noor a nickname.” The agent goes straight to the story-state tools and edits the information you requested. Use **Story** when you want new prose. Agent can add or revise cast profiles, world information, writing notes, and continuity. It leaves the manuscript and chapters intact.

Choose **MCP** and click **Queue edit**, or choose a supported **OpenRouter** model and click **Apply edits**. The result appears above the composer. Pending MCP edits can be canceled before they save. The agent can inspect the relevant story state and use eligible context to resolve references in your request. [MCP tools](MCP.md#edit-story-metadata)

## Brainstorm a new story

Under **Stories → New story → Brainstorm with a model**, choose **OpenRouter** or **MCP agent** beside **Chat with**. OpenRouter uses the selected model for chat. If you choose a model from the Agent presets, it also prepares the draft. For other models, the wizard shows that DeepSeek V4.1 Flash prepares the draft. Both steps use OpenRouter credits. For MCP, queue the first request, click **Copy instructions for your agent**, and paste them into a connected agent chat.

Use the chat to discuss the cast, setting, or premise. Paste references into **Additional context**. The **20,000-word** budget covers your chat messages and additional context together. Click **Prepare setup draft** when ready. The model proposes editable story fields for review. **Create story** saves the project after you have checked those fields.

## Read and export the book

Open **Book view** to read the story as a manuscript. It includes replies, including prose you enter through **Add reply**, and uses the selected take for every reply. Author directions stay in **Write**.

The first reply starts Chapter 1. To start another chapter at a later reply, open its **⋯** menu in **Write** and choose **Start new chapter here**. Use **Remove chapter break** in the same menu to join it to the preceding chapter. Chapter numbers update automatically.

In **Book view**, use **Go to chapter** to jump between chapters. On a wide window, choose **Two pages** to read facing pages with **Previous** and **Next**. Choose **Export Markdown**, select the first and last chapters to include, and click **Download .md**. The file uses the story’s chapter numbers and is generated locally in the browser. Use **Export history ZIP** separately to make a restorable library backup.

## Import an existing story

1. Choose **Stories → New story → Import an existing story**, or **Import a manuscript** in the setup chat. Paste the manuscript or choose a plain-text or Markdown file. The manuscript has a separate limit of **100,000 words and 2 MB**.
2. Story Studio turns standalone chapter, turn and scene headings into native breaks. It also recognizes common Markdown scene dividers. Long passages are split locally at nearby paragraph or word boundaries. Existing chapter breaks take priority. For an unmarked story, review the suggested breaks or adjust them later from each turn’s **⋯** menu.
3. Choose **OpenRouter** or **MCP agent**. Paste notes, other reference material, or writing preferences in **Additional context**. Your chat messages and additional context share a **20,000-word** budget. The setup agent gets that material and up to 16 manuscript excerpts you can preview. It proposes cast, setting, and continuity fields for your review. The manuscript supplies the imported prose. For a completely local import, choose **Review without AI**.
4. Review the draft and choose **Create story**. All original prose goes into a new story and appears in **Write** and **Book view**. The source headings are kept in Write and the library backup. Imported prose starts outside general model context unless you explicitly approve the full manuscript as non-explicit.

## Character & lore

The **Story timeline** on the left groups setup, dated scenes, and relationship events by their in-story date and time. Entries at the same minute share a timestamp. Entries within a day show the time in 24-hour format. A direction and its immediate prose reply share one entry at the reply's time when available. Select that entry to read both parts and inspect graph changes. Either text can be collapsed. Standalone prose and unanswered directions have their own entries. Select a moment to inspect its events and highlight their connections on the graph. Older and manually written turns without a date appear under **Undated turns**. To date one, open **⋯ → Time and context** on the turn in the transcript. On a narrow screen, choose **Show timeline** above the graph.

Hover over a character or line for a preview in the right pane. Click or tap it to keep its details open and edit.

- **+ Character** creates a profile. Click a node to edit its name, aliases, description, and optional personality, scenario, and sample dialogue. The profile also supports importing basic details from a JSON character card. Removing a supporting character removes their relationship events when you save. Their existing dialogue stays in the transcript.
- **+ Relationship** lets you select two characters in the order of the event. Write one sentence describing what happened and choose its **In-story date and time**. Several events between the same two characters share a graph line. Its count shows how many are saved. Click the line to edit or delete individual events. **Undo last deletion** is available in the inspector before you save.
- **World** holds the setting, start date and time, short continuity facts under **Story memory**, and optional keyword lore. Enter one rule per line, such as `harbor, dock | The tide cuts off the old footpath.` Use `* | lore` for a rule that is always active. **Writing** holds prose directions, style notes, and the title.

Relationship events have an in-story timestamp to the minute, for example `1998-10-24 18:30`, as well as a source turn. All setup events share the **Story start** time. MCP and OpenRouter can infer the scene and event times from the story. Story Studio uses estimates when needed. Set the start in **World** and correct event times in the graph if the story has a specific date, time jump, or flashback.

The continuity pass can update characters, world details, relationships, and story memory. With OpenRouter, automatic application requires both the direction and reply to be labeled non-explicit. Updates from sensitive or unverified turns and older pending proposals stay in **Review updates**. Choose **Keep** on useful non-explicit facts and **Save changes**, or use **Dismiss**. **View graph changes** shows updates attached to a particular turn. The library records versions of the cast, world setting, and story memory by turn.

## Context and sensitive scenes

The composer’s **Context** indicator shows an estimated input-token total and the selected model’s published window when available. Open it for the breakdown, the app’s history budget, and in Story mode the exact assembled prompt. Agent shows its initial context before any tool lookups. In the setup wizard, the estimate covers chat, additional context, and previewed manuscript excerpts, alongside the separate word limit. MCP clients control their own model window. For a user-added model, the window is unknown until independently verified.

The narrator prompt includes the cast, setting, applicable lore, and recent eligible prose. It limits recent prose to an estimated 16,000 tokens, with a smaller allowance on models with shorter budgets. Older prose stays in the transcript. The prompt uses the remaining budget for relationship events. When the full timeline exceeds that budget, Story Studio favors events involving characters mentioned in the current scene, then newer events, and presents the selected events chronologically. Saved story-memory facts also carry forward.

For a sensitive scene, choose **Story → OpenRouter → Cydonia 24B v4.1** and check **Sensitive scene** before sending. Story Studio marks that direction explicit and allows Cydonia to see eligible sensitive history for that request. DeepSeek V4.1 Flash sees the new direction and draft for classification and continuity. General models and MCP receive eligible prose plus approved, non-explicit graph facts. Use the checkbox before sending because automatic classification happens after the artist receives your direction. [OpenRouter context and tools](MODELS.md#what-story-studio-sends-and-expects)

Labels are model judgments and can be wrong. If classification fails, Story Studio keeps the prose and treats the unverified text as withheld from general model context. If the artist hits its output limit, the partial draft stays in the transcript and receives a cutoff warning. Changes from sensitive or unverified scenes need review before entering shared story context. Review manually added, imported, and edited passages too.

To continue with a general model after a sensitive scene:

1. Check the badges on both the writer turn and the reply. Use **⋯ → Time and context** to correct a label. Select **Exclude this turn’s text from all AI prompts** to withhold the text from every route, including Cydonia.
2. Keep any needed continuity in a short, non-explicit relationship event or **World → Story memory**. Check nearby turns and notes for copies of the sensitive prose.
3. Clear **Sensitive scene**, select your writing route, check **Prompt**, and send the next direction. Start a fresh native agent session if the previous session already saw the original text.

The saved library and exports include the original passages. Story Studio filters its own prompts and MCP tool results. Use a dedicated writing session and keep it within those tools. A general-purpose agent may still have file, shell, or browser access that can reach the original text. The optional Claude Writer starts Claude Code with its built-in tools disabled. Keep character cards, world notes, story memory, and relationship events non-explicit because they can enter model context separately from the transcript. [MCP permissions and context](MCP.md#keep-the-agent-to-what-story-studio-shows-it)

## Back up and move your library

The default library folder is `~/Library/Application Support/Story Studio/` and its main file is `library.json`. Quit Story Studio and copy the whole folder to migrate to another Mac. Or use **Stories → Export history ZIP** to download `library.json` and readable story transcripts. To restore an export, unzip it and select `library.json` with **Import library**. Import replaces the current library after confirmation. If a newer save from another tab causes a conflict, export your local work before reloading.

The app binds to your Mac’s loopback address and stores the library locally. When you use a model, the assembled context goes to its service through your selected route. The OpenRouter key is held in the browser page's memory, passed through the local server for requests, and cleared on reload. Story exports exclude the key.

## Troubleshoot startup and writing

Open **Finder → Go → Go to Folder** and enter `~/Library/Logs/Story Studio`. The launcher also prints the folder in Terminal. Logs are local, one JSON entry per line with a UTC timestamp. Each file rotates at about 1 MiB and keeps one previous copy ending in `.1`.

| File | What to look for |
| --- | --- |
| `setup.log` | The runtime download, dependency install, server readiness, and launcher failures with their stage and exit code. |
| `server.log` | Startup, saves, exports, and both OpenRouter passes with routing, usage, and classification diagnostics. |
| `mcp.log` | Watcher activity, tool outcomes, and context counts for each handoff, including what was omitted by reason. |

For example, this shows the latest server events as they arrive.

```sh
tail -n 30 -F "$HOME/Library/Logs/Story Studio/server.log"
```

For an error with a **Log ID**, match it to `requestId` in `server.log`. The `prose` field shows the artist call. `toolCalls` records each continuity, Agent, or setup-draft round and the tool names it called. Provider records include model, HTTP status, timing, output cap, and finish reason, plus host, token usage, and cost when OpenRouter reports them. `metadataCode` reports continuity failures, and `inputSensitivity` and `replySensitivity` record the two classification labels.

`mapUpdateRejections` shows why graph proposals failed validation and which fields were affected. The continuity editor can correct or omit the entries during its tool loop. The log leaves out the proposed text and names.

For an MCP handoff, look for `context_prepared` in `mcp.log`. It reports the queued turn number, how many history turns were included, and how many were omitted for the prompt budget or for each context rule. `recentPolicyOmissions` lists the last 24 turns omitted by the context rules and the reason for each. The same hashed `storyRef` appears in both logs so you can trace a story without putting its title in the logs. If the app never starts, check `setup.log` and the launcher Terminal. If the browser page opens but its controls fail, check the browser's developer console as well.

Story Studio logs omit story text, directions, prompts, provider replies, and API keys. To redirect logs, set `STORY_STUDIO_LOG_DIR` in the server and MCP launcher environments. If you set only `STORY_STUDIO_DATA`, logs go in its `logs` subfolder.

## Project reference

- [MCP.md](MCP.md) covers registration, the native agent handoff, and the tool contract.
- [RESEARCH.md](RESEARCH.md) records the pinned SillyTavern sources, the UI and prompts studied, and the features implemented independently.
- [TESTING.md](TESTING.md) records browser and provider checks. Run `npm test` for automated regression tests.

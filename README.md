# Story Studio

Story Studio is a local fiction-writing workspace for writing one turn at a time. Build a cast and its relationships, keep track of continuity, and choose who writes the next turn. The three writing modes are **MCP**, **OpenRouter**, and **Manual**.

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

## Write a scene

1. Open **Stories → New story**. Choose **Set up manually** to enter a title, premise, world, writing notes, and cast. Or choose **Brainstorm with a model**, choose OpenRouter or MCP, and chat through your ideas. Click **Prepare setup draft** when you are ready. Review or revise the editable fields, then click **Create story**. You can change the setup later under **Character & lore**.
2. Write what happens next, paste the start of a scene, or give a direction in the composer. The narrator continues the story using whichever characters the scene needs. Set a one-off style in the composer or a standing preference in **Character & lore → Writing → Writing notes**. With no style direction, the narrator matches established prose or uses third-person past tense for a new story. **Prompt** shows the writing instructions and context for the selected route. Earlier author directions are history. The current direction controls the next reply.
3. Choose a writing mode.

   - **MCP** gives the next reply to your signed-in Codex, Claude Code, or other local MCP client. Follow [MCP setup](MCP.md) once, then tell the agent “Watch Story Studio and write each turn I queue.” Each time you click **Queue turn**, the watching agent writes and saves the reply, and it appears in the page within a few seconds. Without a watching agent, ask the agent to write the queued reply. The line above the composer, and a placeholder turn in the story, show whether a queued turn is waiting for an agent, has been seen by a watching agent, or is being written. If the agent will not write a turn, for example an explicit scene, it hands the turn back and its reason appears above the composer.
   - **OpenRouter** sends the current scene to the selected model. Open **Connection**, enter your API key, select a model, and save. You can change the model beside **Write with** in the composer. The model list shows USD rates per million input and output tokens and estimated chapter cost at 2,000 input plus 5,000 output tokens. See [model notes and prices](MODELS.md).
   - **Manual** saves what you write without a model call. Use **Add reply** to enter the co-writer’s side yourself.

Select a turn in **Turns** to jump directly to it. On a narrow screen, open **Turns** beside the story title. **Latest** jumps back to the end. The list uses one short preview per direction and reply pair, with standalone and unanswered turns listed separately.

Use the copy icon beside any reply to copy the visible take to your clipboard.

Use **Edit** on an author direction to bring it back into the composer. **Save & rewrite** in OpenRouter or **Save & queue rewrite** in MCP uses the revised direction and the earlier story to replace the paired reply in place. Later turns and accepted graph changes stay where they are. **Edit** on narration saves your revised text directly. Manual mode saves edits without a model call. Deleting an author direction also deletes its paired reply. If a reply already has multiple takes, use **Previous** and **Next** to choose which one appears in the story and future prompts.

**Write with** and the OpenRouter model are remembered per story in the current tab, including through rewind and turn deletion. The OpenRouter key stays in memory and must be entered again after a reload.

For model-assisted setup, choose **OpenRouter** or **MCP agent** beside **Chat with**. OpenRouter brainstorming and draft extraction use your OpenRouter credits. For MCP, queue the first request, click **Copy instructions for your agent**, and paste them into a connected agent chat. The discussion stays in the setup window, and only the fields you approve are saved with the story. After creation, you can use any of the three writing modes.

Open **⋯** on a turn to explore a different path. **Branch from here** creates a separate story through that turn, including the selected take, the cast and world notes recorded then, and earlier relationship events. You can branch from the demo to keep writing a regular saved story. **Rewind to here** removes later turns and their events from the current story. Deleting a story or a turn, rewinding, removing a character or relationship event, and replacing your library all ask for confirmation. For older turns without a saved cast or world version, Story Studio uses the current notes.

## Read and export the book

Open **Book view** to read the story as a manuscript. It includes replies, including prose you enter through **Add reply**, and uses the selected take for every reply. Author directions stay in **Write**.

The first reply starts Chapter 1. To start another chapter at a later reply, open its **⋯** menu in **Write** and choose **Start new chapter here**. Use **Remove chapter break** in the same menu to join it to the preceding chapter. Chapter numbers update automatically.

In **Book view**, use **Go to chapter** to jump between chapters. On a wide window, choose **Two pages** to read facing pages with **Previous** and **Next**. Choose **Export Markdown**, select the first and last chapters to include, and click **Download .md**. The file uses the story’s chapter numbers and is generated locally in the browser. Use **Export history ZIP** separately to make a restorable library backup.

## Import an existing story

1. Choose **Stories → New story → Import an existing story**, or **Import a manuscript** in the setup chat. A long paste into the chat opens the import form with the text filled in. The limit is **100,000 words and 2 MB**. You can also choose a plain-text or Markdown file.
2. Story Studio turns standalone chapter, turn and scene headings into native breaks. It also recognizes common Markdown scene dividers. Long passages are split locally at nearby paragraph or word boundaries. Existing chapter breaks take priority. For an unmarked story, review the suggested breaks or adjust them later from each turn’s **⋯** menu.
3. Choose a setup model, then chat or click **Prepare setup draft**. The draft includes editable cast, setting and continuity notes. A model sees the chat and up to 16 short excerpts from across the story. Preview those excerpts before sending. MCP receives manuscript excerpts only if you mark them reviewed and non-explicit. For a completely local import, choose **Review without AI**.
4. Review the draft and choose **Create story**. All original prose goes into a new story and appears in **Write** and **Book view**. The source headings are kept in Write and the library backup. Imported prose starts outside future MCP writing context unless you explicitly approve the full manuscript as non-explicit.

## Character & lore

The **Story timeline** on the left groups setup, dated scenes, and relationship events by their in-story date and time. Entries at the same minute share a timestamp. Entries within a day show the time in 24-hour format. A direction and its immediate prose reply share one entry at the reply's time when available. Select that entry to read both parts and inspect graph changes. Either text can be collapsed. Standalone prose and unanswered directions have their own entries. Select a moment to inspect its events and highlight their connections on the graph. Older and manually written turns without a date appear under **Undated turns**. To date one, open **⋯ → Time and context** on the turn in the transcript. On a narrow screen, choose **Show timeline** above the graph.

Hover over a character or line for a preview in the right pane. Click or tap it to keep its details open and edit.

- **+ Character** creates a profile. Click a node to edit its name, aliases, description, and optional personality, scenario, and sample dialogue. The profile also supports importing basic details from a JSON character card. Removing a supporting character removes their relationship events when you save. Their existing dialogue stays in the transcript.
- **+ Relationship** lets you select two characters in the order of the event. Write one sentence describing what happened and choose its **In-story date and time**. Several events between the same two characters share a graph line. Its count shows how many are saved. Click the line to edit or delete individual events. **Undo last deletion** is available in the inspector before you save.
- **World** holds the setting, start date and time, short continuity facts under **Story memory**, and optional keyword lore. Enter one rule per line, such as `harbor, dock | The tide cuts off the old footpath.` Use `* | lore` for a rule that is always active. **Writing** holds prose directions, style notes, and the title.

Relationship events have an in-story timestamp to the minute, for example `1998-10-24 18:30`, as well as a source turn. All setup events share the **Story start** time. MCP and OpenRouter can infer the scene and event times from the story. Story Studio uses estimates when needed. Set the start in **World** and correct event times in the graph if the story has a specific date, time jump, or flashback.

MCP and OpenRouter can update characters, world details, relationships, and story memory as they write. Valid updates from ordinary turns are applied on save. In OpenRouter mode, automatic application requires both the direction and reply to be labeled non-explicit. Updates from sensitive or unverified turns and older pending proposals stay in **Review updates**. Choose **Keep** on useful non-explicit facts and **Save changes**, or use **Dismiss**. **View graph changes** shows updates attached to a particular turn. The library records versions of the cast, world setting, and story memory by turn.

## Context and sensitive scenes

The shared prompt builder includes the selected character, other cast, setting, applicable lore, and recent eligible prose. It limits recent prose to an estimated 16,000 tokens, with a smaller allowance on models with known shorter windows. Older prose stays in the transcript. The prompt uses the remaining budget for the saved relationship timeline. It includes every event when they fit. For larger timelines, it prioritizes events involving characters named in recent turns or the current direction, then newer events, and presents the selected events chronologically. Facts you keep in story memory also carry forward.

The selected OpenRouter model writes the prose. A separate DeepSeek V4.1 Flash call analyzes the draft and labels your input and the draft independently. Turns marked **Explicit** or **Unverified** are omitted from future MCP prompts. They remain available to OpenRouter and in your transcript. Labels are model judgments and can be wrong. Missing labels appear on the affected turns as **Unverified · outside MCP**. If the reply reaches its output limit, the app keeps and classifies the partial draft and warns you about the cutoff. If analysis fails, the app keeps the draft and leaves the labels unverified. Story Studio checks map suggestions against the cast and warns if it skips invalid entries. An MCP agent that hands back an explicit request can label your turn **Explicit** so it stays out of MCP prompts. Existing, manually added, and edited passages need your review. [OpenRouter output format](MODELS.md#what-story-studio-sends-and-expects).

To move a story back to MCP after an explicit scene:

1. Check the badges on both the writer turn and the reply. Use **⋯ → Time and context → MCP context → Omit as explicit or unverified** to correct a label when needed. Select **Exclude this turn’s text from all AI prompts** if you want to omit that turn from all model routes, including OpenRouter.
2. Keep any needed continuity in a short, non-explicit relationship event or **World → Story memory**. Check nearby turns and notes for copies of the sensitive prose.
3. Switch to **MCP**, check **Prompt**, then queue the next scene. Start a fresh native agent session if the previous session already saw the original text.

The saved library and exports include the original passages. MCP agents are told never to read them, the local app or the open page directly, because explicit text in an agent's context can trip its provider's safety limits. The Claude Writer enforces this by giving Claude no file, shell or web tools. See [what the agent can see](MCP.md#keep-the-agent-to-what-story-studio-shows-it). Character cards, world notes, story memory and relationship events are eligible for MCP context, so keep them non-explicit. Model and provider policies apply to generation. See [verified test results](TESTING.md) for what was exercised with a simulated provider and what was tried in a live agent session.

## Back up and move your library

The default library folder is `~/Library/Application Support/Story Studio/` and its main file is `library.json`. Quit Story Studio and copy the whole folder to migrate to another Mac. Or use **Stories → Export history ZIP** to download `library.json` and readable story transcripts. To restore an export, unzip it and select `library.json` with **Import library**. Import replaces the current library after confirmation. If a newer save from another tab causes a conflict, export your local work before reloading.

The app binds to your Mac’s loopback address and stores the library locally. When you use a model, the assembled context goes to its service through your selected route. The OpenRouter key is held in the browser page's memory, passed through the local server for requests, and cleared on reload. Story exports exclude the key.

## Troubleshoot startup and writing

Open **Finder → Go → Go to Folder** and enter `~/Library/Logs/Story Studio`. The launcher also prints the folder in Terminal. Logs are local, one JSON entry per line with a UTC timestamp. Each file rotates at about 1 MiB and keeps one previous copy ending in `.1`.

| File | What to look for |
| --- | --- |
| `setup.log` | The runtime download, dependency install, server readiness, and launcher failures with their stage and exit code. |
| `server.log` | Startup, saves, exports, and both OpenRouter passes with routing, usage, and classification diagnostics. |
| `mcp.log` | Watcher activity, tool outcomes, the context sent for each handoff, and counts of omitted turns by reason. |

For example, this shows the latest server events as they arrive.

```sh
tail -n 30 -F "$HOME/Library/Logs/Story Studio/server.log"
```

For a writing error with a **Log ID**, match it to `requestId` in `server.log`. In the completed request, the `prose` and `metadata` fields show each pass's model, HTTP status, timing, output cap, and finish reason. They include the host and token usage when OpenRouter reports them. `metadataCode` reports analysis failures. `inputSensitivity` and `replySensitivity` record the two classification labels.

`mapUpdateRejections` shows why graph proposals were skipped, with the zero-based position in the model's proposal list and any affected fields. The log leaves out the proposed text and names.

For an MCP handoff, look for `context_prepared` in `mcp.log`. It reports the queued turn number, how many history turns were included, and how many were omitted for the prompt budget or for each context rule. `recentPolicyOmissions` lists the last 24 turns omitted by the context rules and the reason for each. The same hashed `storyRef` appears in both logs so you can trace a story without putting its title in the logs. If the app never starts, check `setup.log` and the launcher Terminal. If the browser page opens but its controls fail, check the browser's developer console as well.

Story Studio logs omit story text, directions, prompts, provider replies, and API keys. To redirect logs, set `STORY_STUDIO_LOG_DIR` in the server and MCP launcher environments. If you set only `STORY_STUDIO_DATA`, logs go in its `logs` subfolder.

## Project reference

- [MCP.md](MCP.md) covers registration, the native agent handoff, and the tool contract.
- [RESEARCH.md](RESEARCH.md) records the pinned SillyTavern sources, the UI and prompts studied, and the features implemented independently.
- [TESTING.md](TESTING.md) records browser and provider checks. Run `npm test` for automated regression tests.

# Story Studio

Story Studio is a local fiction-writing workspace with a manuscript, cast, and relationship timeline. Write and edit in the browser with Claude API, OpenAI API, or OpenRouter. **Book view** and **Graph** show the saved story. Optional MCP tools give external agents access to the same library.

## Start on your Mac

1. Open the [Story Studio repository](https://github.com/alxdofficial/sillylanternclone). Clone it with Git, or download and unzip **Code → Download ZIP**. Keep the app folder somewhere you can find again.
2. Double-click **Start Story Studio.command**. The launcher installs the locked npm dependencies and, if it needs Node.js, downloads a version for your Mac from nodejs.org and verifies its checksum. If macOS blocks the launcher, open Terminal in the app folder and run `zsh 'Start Story Studio.command'`.
3. Leave the launcher window open while writing. It opens [Story Studio](http://127.0.0.1:4317/) in your browser. Press Control-C in Terminal to stop the server after saving your work.

Setup needs internet access for the first download. Story Studio runs on Node.js 20 or later with npm and uses the MCP SDK, Zod, and fflate. You can also run `npm ci` followed by `npm start` if Node.js and npm are already installed. Manual writing works without a provider account.

You can ask your local agent to set it up for you.

> Clone https://github.com/alxdofficial/sillylanternclone on this Mac, follow README.md and OPERATIONS.md, and open Story Studio. Tell me briefly what you’re setting up.

[Start, stop, update, and restart](OPERATIONS.md) · [Optional MCP connection](MCP.md)

## Try The Late Ferry

New libraries open on **The Late Ferry**, a four-chapter harbor mystery with five cast members and seven scenes. An altered log keeps the last ferry at the dock with a medical courier waiting to cross. Find it under **Menu → Open demo**. Changes to the demo stay in memory and reset when you reload.

1. Open **Book view** for the four chapters and the illustration in Chapter 1. Try **Dark** (charcoal), **Paper**, or **Sepia**. **Write** shows each chapter divider, the original directions, and an Agent exchange that added a standing writing note.
2. Open **Scene board** to see each scene’s POV, summary, and revision status. In **Time Machine**, the two most recent saved versions show the closing paragraph before and after an edit. **Compare scene drafts** also offers a named checkpoint of that scene.
3. In **Write → Writing tools**, use **Pacing** to find dialogue runs, **Themes** to trace how the crew preserves evidence, and **Setups & payoffs** to compare an open thread with the signed correction. **Continuity** flags a question about the number of horn calls. **Artwork** shows four visual references and a three-panel comic awaiting approval.
4. In **Graph**, select the line between Mae and Noor to see how their relationship changes as they compare records. **⋯ → View graph changes** on a prose turn shows the updates from that scene.
5. In **Write**, preview a **Story Flow** choice for a coda. **Use direction** fills an empty composer. To continue in a story you can keep, use **⋯ → Branch from here** on a prose turn.

Sonnet 5.5 generated the story through the direct Claude API. FLUX rendered the demo artwork through OpenRouter. The demo’s saved versions, writing reviews, and artwork open without a provider key. [See the verification notes](TESTING.md#the-late-ferry-starter).

## Progress the story

1. Open the hamburger menu, click the **Settings** gear, add one or more API keys, and click **Save settings**. Keys are saved on this machine and shared by every story. The model menus group choices by enabled provider. Select **Remove saved key** for a provider in Settings to disable it. The composer links to **Settings** when you focus it without a key. [Claude keys](https://platform.claude.com/settings/keys) · [OpenAI keys](https://platform.openai.com/api-keys) · [OpenRouter keys](https://openrouter.ai/settings/keys)
2. In **Write**, choose **Prose** and select a **Prose artist** and **Continuity agent** independently. The writer menu estimates cost for a chapter of 2,000 input and 5,000 output tokens. Each pass goes to its selected provider and is metered separately. If you claimed subscription API credits, use a key from the linked organization and choose its direct API group. Click the context ring to inspect the current context. Set standing style preferences in **Graph → Writing**. Use **Sensitive scene** with an NSFW-friendly writer when appropriate. [Model notes and prices](MODELS.md) · [Claude credit terms](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers) · [OpenAI credit terms](https://help.openai.com/en/articles/20001626-api-credits-benefit-for-eligible-chatgpt-subscriptions)
3. Click **Send**. The selected writer writes the prose. The selected continuity agent classifies the scene and proposes non-explicit continuity updates. **⋯ → View graph changes** shows the updates for that turn. Proposals needing approval are in **Graph → Review updates**.

Use **Chapters** and **Writing tools** to open or close the side panes. Drag the dividers, use arrow keys on a focused divider, or choose a preset in **Workspace layout**. The composer and Story Flow fold independently. In narrow or short windows, tap **Mode and models** for the composer’s full settings. The **Expand editor** icon sits in the lower-right corner of the composer, manual prose, and long setup or story fields. **Done** or Escape returns to the draft. Use the original **Save** or **Send** action to submit it.

Write shows author inputs alongside the prose. To show them in Graph, check **Show author directions in Graph** in **Settings** and click **Save settings**. Use the chapter outline to jump to a scene or the down arrow to return to the most recent turn. Turn actions follow the top of the current turn as you scroll. You can edit any prose turn and the latest author direction. For a direction with a paired reply, **Send** saves the edit and regenerates just that reply when an API artist is configured. **Save without rewriting** keeps the existing reply.

In **Write**, choose **Manual prose** in the composer to write or paste without a model. Set **AI context** to **Explicit**, **Unverified**, or **Verified non-explicit**, then click **Save prose**. General AI context includes prose you verify as non-explicit. You can review a saved turn in **Write → ⋯ → Time and context**. The same menu has branching and rewind.

To add your own OpenRouter model, choose **Manage custom models…** in the **Prose artist** menu and enter its `author/model` ID. User-added models appear in the writer picker and setup chat. Use the same menu to remove them.

## Write at an earlier scene

In **Write**, click a divider between turns to move the writing cursor. The highlighted divider and triangle show where the composer is aimed. Drag the triangle to snap to another divider. The **+** opens **Move cursor** and **Add chapter divider**. A new chapter divider appears at the selected boundary immediately. Select **Manual prose** in the composer to write or paste prose directly at the cursor, or use **Prose** or **Agent** for AI-assisted work. **Return to end** resumes normal continuation.

**Prose** inserts a new scene before the cursor. Its graph suggestions wait for review. **Agent** can discuss the selected area, update story state, or propose manuscript edits for approval. Targeted exchanges appear next to the marked scene. The model receives the whole-book story graph and up to two scene excerpts on each side of the cursor. Existing privacy labels still apply, and the Agent can read more eligible prose with its tools. Studio keeps stable story context ahead of the changing cursor and request to help providers reuse cached input.

## Story Flow

In **Write**, click **Suggest directions** next to **Get AI recommendations** to ask your selected continuity agent for three next beats. Open a suggestion for its full direction and any consequence the agent provided. Click **Use direction** to fill an empty composer, or choose **Insert at cursor** or **Replace draft** when it already contains text. Collapse **Story Flow** from its own header. Saved choices remain available when you reopen it. Sending a direction while an in-app offer is active asks for fresh suggestions after the scene. Each suggestion request uses the selected provider.

## Review a draft

Open **Writing tools** from **Write**. The reading pane shows only prose while the tools are open. Closing them brings back the conversations, Story Flow, and your composer draft. At desktop widths the prose stays beside the tool. In a narrow window, follow a citation or use **View in manuscript**, then use **Back to [tool]** to return to its results. Review tools start at **Whole book**. Use the scope picker to focus on one chapter or scene.

- **In this scene** shows the selected scene’s time, cast mentioned in the prose, world setting, and writing notes.
- **Pacing** opens to **Scene overview**, with a chart of scene lengths and estimated dialogue followed by review notes. **Text highlights** starts with detail density on. It compares each paragraph with the previous six, gives extra weight to names and numbers, and shades paragraphs that stand out in the selected scope. Turn on **Repeated phrases** to underline nearby repeats. **More highlight types** adds sentences of 36 words or longer, runs of at least three sentences with the same first two words, and stretches of four or more quote-only paragraphs. **Include subtler matches** lowers these thresholds. Use the previous and next arrows or Left and Right keys on the controls. Click the counter to return to the current match. On a phone, tap **View in manuscript** to see the arrows beside the text. The overlays run locally, with no API cost.
- **Themes** shows pinned themes and recurring phrases. Select prose and click **Pin as theme**, or search for exact wording. **Suggest themes with AI** discovers possible themes. **Find related with AI** searches for indirect echoes of your query.
- **Setups & payoffs** groups tracked threads by status. Select prose and click **Track as setup**. When the payoff lands, choose **Link payoff**, select the passage, and click **Link as payoff**. AI suggestions appear below tracked threads.
- **Continuity** reports local graph and date checks separately from prose coverage and the number of claim pairs reviewed. **Compare passages with AI** looks for inconsistencies and cites the passages. Choose a scope containing two or more eligible scenes or open **Compare another story or add canon notes** to include a comparison. Mark findings intentional or dismiss them. **Graph → Check continuity** opens this same tool.

**Background review** is on by default for existing and new stories when opened with a configured review model. It reads eligible prose in bounded batches, then checks related evidence across chapters, so long manuscripts can be reviewed without fitting in a single request. Local results appear immediately. The progress bar shows the current stage. A time estimate appears after two completed batches in that stage. Findings resume from saved checkpoints while Studio runs. Open the review status in Writing tools to see its model, coverage, and budget, or to pause or resume. The daily estimate allows up to $1 per story at Studio’s published model rates. Actual provider usage appears in the context panel. The demo ships with example findings and makes no background provider calls.

Manual AI reviews remain available for an ad hoc query, comparison story, or canon notes. They use the general continuity agent selected in Write, or the selected Agent model in **Agent** mode. Large manual requests can be scoped to a chapter or scene. Findings link back to their evidence. Pins and tracked threads are saved with your story. A citation whose original passage can no longer be found is marked **Passage changed**.

**Pacing observations** describe shifts in rhythm, tension, or focus and link to the passage behind each observation. Saved review annotations include theme pins, tracked setups and payoffs, and decisions to mark a continuity finding intentional or dismiss it. They travel with the story in the library backup. To guide future prose and continuity runs, put standing instructions in **Graph → Writing**. To correct a fact, edit the relevant prose, graph event, character, or World setting.

## Agent

In **Write**, choose **Agent** to brainstorm, discuss the draft, or ask questions. Your message and the Agent’s reply appear as separate turns in Write and stay out of the manuscript. The Agent is instructed to leave story details alone during discussion. An explicit request such as “Add a lighthouse to the setting” can update world details, cast profiles, writing notes, or dated plot and relationship events. Ask the Agent to revise, insert, move, or remove prose, edit scene details, or change chapter breaks and order. These requests open **Review Agent changes**, where you can inspect the proposal and apply or discard it. Revisions become alternate takes, and Time Machine records the saved changes. Mixed manuscript and story-state changes apply together. If a scene changes before approval, ask the Agent for a fresh proposal. Prose withheld from AI context stays unavailable to the Agent. Exchanges flagged as unsafe stay out of future AI history.

## Brainstorm a new story

Under **Menu → New story**, choose **Set up manually** or **Brainstorm with a model**. The selected model reads the conversation, additional context, and any manuscript. If they exceed the model’s input budget, **Prepare setup draft** reads them in sections and combines structured notes for review. Choose **Prepare setup draft** to get the world, cast and relationships, review them, then click **Create story**.

## Read and export the book

Open **Book view** to read the manuscript. It includes manually saved prose and the selected take for each model reply. Author directions are available in **Write**.

The first scene starts Chapter 1. In **Write**, hover over a line between turns to reveal the plus button. On a phone, tap the plus on the line. Choose **Move cursor** to target the next scene, or **Add chapter divider** to start a chapter there. The plus at the end starts a chapter with the next scene you save. **Remove divider** joins a chapter to the preceding one or cancels an upcoming chapter. You can also start a chapter at an existing scene from **Scene board → Edit details**.

In **Book view**, use **Go to chapter** to jump between chapters. On a wide window, choose **Two pages** to read facing pages with **Previous** and **Next**. Choose **Export**, select the chapter range, and choose **Markdown**, **Word (.docx)**, or **AO3 HTML**. Word and AO3 exports preserve inline emphasis and recognized scene breaks. **Copy for AO3** copies formatted prose for the Rich Text editor, with an HTML download when clipboard access is unavailable. Use **Export history ZIP** separately to make a restorable library backup.

## Arrange scenes and compare drafts

In **Scene board**, drag a card, use its arrows, or pick a chapter and position with **Move**. Open **Edit details** to set its POV, summary, or revision status. **Story time** sorts by the dates in the manuscript. Book view, exports, and writing reviews follow **Reading order**. Use **Undo** and **Redo** for scene moves, chapter boundaries and details saved in this tab. Dragging leaves the prose and graph intact. **Review transitions** lets your configured agent read the moved scene and its new neighbors and suggest a small change. Preview the diff, then choose **Apply as new take** if you want the edit.

In **Write**, open a prose turn’s **⋯ → Compare drafts** to save a named checkpoint or compare two takes, checkpoints, or scenes from another branch. With **Current prose** on the left, you can restore one paragraph, or restore the right draft as a new take. Restored prose keeps the previous take and is held from general AI context until you review its content. Check the existing graph changes and use **Mark continuity reviewed** in the turn menu when they fit the restored prose.

**Time Machine** records saved story changes automatically, including agent replies, prose and graph edits, scene moves, and chapter changes. Unsaved drafts do not create snapshots. Select two saved versions to see additions, removals, and story-state changes. **Restore this version** puts the selected version back in Write as a new saved version. Older and newer versions remain available. An existing story’s history starts from the first version recorded after the upgrade.

## Create artwork

In **Write → Writing tools → Artwork**, use **Mood board** to generate references for cast members, locations, and objects. For an illustration or three-panel comic, select eligible prose and choose **Create scene art**, or use a short scene from the tool’s picker. A request can use up to 1,200 words and 6,000 characters. The configured editor or continuity model plans the image. Studio uses FLUX 3 Image Klein through OpenRouter to render it and any missing central references. A scene request can render up to three references before the final artwork.

Generated artwork stays in the tool until you approve it. Drag it onto a prose scene or use **Approve and insert** to place it with the scene. **Request changes** uses your directions and the source to generate a separate draft. It keeps the original and its placement available. The bundled example cards are read-only. Placed artwork appears in Write and Book view. **Source changed** marks images whose passage, source facts, or references are out of date. The history ZIP includes the original images, placements and Time Machine versions. See [the backup and restore instructions](OPERATIONS.md#data-and-settings).

## Import an existing story

1. Choose **Menu → New story → Import an existing story**, or **Import a manuscript** in the setup chat. Paste the manuscript or choose a plain-text or Markdown file. The library has a 16 MB transfer limit.
2. Story Studio turns standalone chapter, turn and scene headings into native breaks. It also recognizes common Markdown scene dividers. Long passages are split locally at nearby paragraph or word boundaries. Existing chapter breaks take priority. For an unmarked story, review the suggested breaks or adjust them later in **Write** or **Scene board**.
3. To prepare an AI setup draft, add notes or references in **Additional context**. Setup reviews your complete chat, reference notes, and manuscript. When it needs multiple requests, every source section is sent to the selected draft model for review. The preview shows a sample for your own inspection. It proposes cast, setting, and continuity fields for your review. The manuscript supplies the imported prose. For a completely local import, choose **Review without AI**.
4. Review the draft and choose **Create story**. All original prose goes into a new story and appears in **Write** and **Book view**. The source headings are kept in Write and the library backup. Imported prose starts outside general model context until you review it as non-explicit. Eligible imported prose becomes early story turns. Setup chat and reference notes are also saved locally, with a separate review option to include them as early agent history.

## Character & lore in Graph

The **Story timeline** on the left groups setup, dated scenes, and relationship events by their in-story date and time. Entries at the same minute share a timestamp. Entries within a day show the time in 24-hour format. A direction and its immediate prose reply share one entry at the reply's time when available. Select that entry to read both parts and inspect graph changes. Either text can be collapsed. Standalone prose and unanswered directions have their own entries. Select a moment to inspect its events and highlight their connections on the graph. Older and manually written turns without a date appear under **Undated turns**. To date one, open **⋯ → Time and context** on the turn in the transcript. On a narrow screen, choose **Show timeline** above the graph.

Hover over a character or line for a preview in the right pane. Click or tap it to keep its details open and edit.

If you leave Graph or switch stories with unsaved graph changes, choose **Save changes**, **Discard changes**, or **Keep editing**.

- **+ Character** creates a profile. Every character uses the same profile and editing controls. Click a node to edit its name, aliases, and description. Include personality, background, and sample dialogue within the description. You can also import a JSON character card. Removing a character removes their relationship events when you save. Their existing dialogue stays in the transcript.
- **+ Relationship** lets you select two characters in the order of the event. Write one sentence describing what happened and choose its **In-story date and time**. Several events between the same two characters share a graph line. Its count shows how many are saved. Click the line to edit or delete individual events. **Undo last deletion** is available in the inspector before you save.
- **World** holds the setting, start date and time, and optional keyword lore. Enter one rule per line, such as `harbor, dock | The tide cuts off the old footpath.` Use `* | lore` for a rule that is always active. **Writing** holds the title, opening premise, and one **Writing notes** field for author guidance, style, jargon, and writing tips. Cast, graph, and writing fields share the request’s context budget. There is no cast count or field-by-field word quota.

Plot and relationship events have an in-story timestamp to the minute, for example `1998-10-24 18:30`, as well as a source turn. Setup relationships share the **Story start** time. Plot events without a date use the associated turn or setup time. The continuity agent can infer the scene and event times from the story. Story Studio uses estimates when needed. Set the start in **World** and correct event times in the graph if the story has a specific date, time jump, or flashback.

The continuity pass can update characters, world details, relationships, and plot events. In the API workflow, automatic application requires both the direction and reply to be labeled non-explicit. Updates from sensitive or unverified turns and older pending proposals stay in **Review updates**. Choose **Keep** on useful non-explicit facts and **Save changes**, or use **Dismiss**. **⋯ → View graph changes** shows updates attached to a particular turn. The library records versions of the cast, world setting, and writing notes by turn. Plot events appear in the graph timeline and keep their source turn.

Older libraries may contain separate Author’s notes, Post-history instructions, and Story memory. Story Studio folds the Author’s note into Writing notes, folds legacy profile fields into character descriptions, and ignores the other two retired fields.

## Context and sensitive scenes

The context ring in the lower left of the composer estimates how much of the model’s window the input fills. Click it for color-coded usage, the current direction, and reserved output. Built-in writers share a 112,000-token input budget with up to 16,000 for the latest eligible story and 8,000 reserved for output. When space runs out, the writer keeps current story state and trims older prose first. If the state and direction alone are too large, Studio asks you to shorten either. API agents use the selected model’s window and remove older exchanges from the prompt in large batches. The manuscript is preserved. In **Prose**, use **Pass** in the panel to see the selected writer or continuity model and its own budget.

**API spend** in the context panel shows seven days of calls made in this Studio, grouped by model and provider in local calendar time. OpenRouter amounts come from its API. Direct Claude and OpenAI amounts use token and cache rates and are estimates before credits. Spend is recorded after this feature is enabled and excludes calls made outside Studio.

The narrator prompt includes the cast, setting, applicable lore, and recent eligible prose. It limits recent prose to an estimated 16,000 tokens, with a smaller allowance on models with shorter budgets. Older prose stays in the transcript. The prompt uses the remaining budget for relationship events. When the full timeline exceeds that budget, Story Studio favors events involving characters mentioned in the current scene, then newer events, and presents the selected events chronologically. Saved plot events also carry forward through the graph.

Selecting an **NSFW-friendly** prose artist turns on **Sensitive scene** by default and switches to the restricted continuity list. A checked scene marks the direction explicit and allows the writer to see eligible sensitive history. Clear the checkbox to leave that history out and let the agent classify the direction normally. The restricted continuity agent still classifies the new direction and draft. General models and MCP receive eligible prose plus approved, non-explicit graph facts. When the continuity agent detects explicit content, the checkbox turns on for the next draft. [Model context and tools](MODELS.md#what-story-studio-sends-and-expects)

Labels are model judgments and can be wrong. If classification fails, Story Studio keeps the prose and treats the unverified text as withheld from general model context. If the artist hits its output limit, the partial draft stays in the transcript and receives a cutoff warning. Changes from sensitive or unverified scenes need review before entering shared story context. Review manually added, imported, and edited passages too.

To continue with a general model after a sensitive scene:

1. Check the badges on both the writer turn and the reply. **Context censored** means general AI prompts skip that text while approved continuity can still carry forward. After revising prose with **Edit**, you can check **I’ve verified this text is non-explicit** before saving. You can also review a label from **⋯ → Time and context**. Select **Exclude this turn’s text from all AI prompts** to withhold the text from every route, including Cydonia.
2. Keep any needed continuity in a short, non-explicit relationship event or plot event in the graph. Check nearby turns and notes for copies of the sensitive prose.
3. Clear **Sensitive scene**, select your writing route, check the context ring, and send the next direction.

The saved library and exports include the original passages. Studio filters its model context and optional MCP tool results. Keep character cards, world notes, plot events, and relationship events non-explicit because they can enter model context separately from the transcript.

## Display names

On the **Display names** tab, put the original character or place name on the left and the name you want to see on the right. Use the exact capitalization from the story. Save the table, then return to **Write** or **Book view**. Replacements use the same typography as the surrounding prose. The table belongs to this story in this browser. Editors, copied and exported prose, graph data, and model context use the original names.

## Back up and move your library

The default library folder is `~/Library/Application Support/Story Studio/`. **Menu → Export history ZIP** includes `library.json`, readable transcripts, saved versions, and artwork. **Import library** replaces your library using the extracted `library.json` after confirmation. To restore versions and artwork as well, quit Studio and copy the backup files into the data directory. If another tab saves a conflicting change, export your local work before reloading. [Backup and restore details](OPERATIONS.md#data-and-settings)

The app binds to your Mac’s loopback address and stores the library locally. When you use a model, the assembled context goes to its service through your selected route. The local server keeps API keys in a file restricted to your OS user and sends them only to the selected provider. Story exports exclude the keys.

## Troubleshoot startup and writing

Open **Finder → Go → Go to Folder** and enter `~/Library/Logs/Story Studio`. The launcher also prints the folder in Terminal. Logs are local JSON Lines with UTC timestamps. Summary files rotate at about 1 MiB and trace files at about 16 MiB. Each keeps one previous copy ending in `.1`.

| File | What to look for |
| --- | --- |
| `setup.log` | The runtime download, dependency install, server readiness, and launcher failures with their stage and exit code. |
| `server.log` | Startup, saves, exports, and API calls with routing, usage, and classification diagnostics. |
| `mcp.log` | Native tool outcomes, and context counts for each handoff, including what was omitted by reason. |
| `openrouter-trace.log`, `anthropic-trace.log`, `openai-trace.log` | Full provider request and response payloads for every writing, continuity, Agent, and setup round. Find the browser request by `requestId`, then match a request and response by `exchangeId`. |
| `mcp-trace.log` | Full handled tool arguments, results, and errors, including story context returned to a client. Filter by `tool` and the connection's `sessionId`. |

For example, this shows the latest server events as they arrive.

```sh
tail -n 30 -F "$HOME/Library/Logs/Story Studio/server.log"
```

For an error with a **Log ID**, match it to `requestId` in `server.log`. The `prose` field shows the artist call. `toolCalls` records each continuity, Agent, or setup-draft round and the tool names it called. Provider records include model, HTTP status, timing, output cap, and finish reason, plus host, token usage, and cost when OpenRouter reports them. `metadataCode` reports continuity failures, and `inputSensitivity` and `replySensitivity` record the two classification labels.

`mapUpdateRejections` shows why graph proposals failed validation and which fields were affected. The continuity editor can correct or omit the entries during its tool loop. The log leaves out the proposed text and names.

For an MCP context read, look for `context_prepared` in `mcp.log`. It reports how many history turns were included, and how many were omitted for the prompt budget or for each context rule. `recentPolicyOmissions` lists the last 24 turns omitted by the context rules and the reason for each. The same hashed `storyRef` appears in both logs so you can trace a story without putting its title in the logs. If the app never starts, check `setup.log` and the launcher Terminal. If the browser page opens but its controls fail, check the browser's developer console as well.

Trace files include the prose and prompts that were actually sent or received, including explicit content. API keys are redacted and request headers are excluded. The trace files stay local and are separate from story exports. Keep them private. To redirect logs, set `STORY_STUDIO_LOG_DIR` in both the server and MCP launcher environments. If you set only `STORY_STUDIO_DATA`, logs go in its `logs` subfolder. [Trace queries and operations](OPERATIONS.md#find-a-handoff-in-the-traces)

## Project reference

- [MCP.md](MCP.md) covers optional access to the saved library.
- [RESEARCH.md](RESEARCH.md) records the pinned SillyTavern sources, the UI and prompts studied, and the features implemented independently.
- [ROADMAP.md](ROADMAP.md) collects proposed features, including scene rehearsal with character agents.
- [TESTING.md](TESTING.md) records browser and provider checks. Run `npm test` for automated regression tests.

## Local and hosted architecture

The local server runs the shared writing and editing harness. Provider adapters translate the same tool calls and results into Claude Messages, OpenAI Responses, or OpenRouter Chat Completions. The browser displays and audits the saved state. The optional MCP server exposes filtered, revision-checked library access to external clients. A hosted version could reuse the harness with account-scoped storage, server-managed credentials, and billing.

# Story Studio

Story Studio is a local fiction-writing workspace for writing one turn at a time. Build a cast and its relationships, keep track of continuity, and choose who writes the next turn. The three writing modes are **MCP**, **OpenRouter**, and **Manual**.

## Start on your Mac

1. Accept access to the [private repository](https://github.com/alxdofficial/sillylanternclone). Clone it with Git, or download and unzip **Code → Download ZIP**. Keep the app folder somewhere you can find again.
2. Double-click **Start Story Studio.command**. The launcher installs the locked npm dependencies and, if it needs Node.js, downloads a version for your Mac from nodejs.org and verifies its checksum. If macOS blocks the launcher, open Terminal in the app folder and run `zsh 'Start Story Studio.command'`.
3. Leave the launcher window open while writing. It opens [Story Studio](http://127.0.0.1:4317/) in your browser. Press Control-C in Terminal to stop the server after saving your work.

Setup needs internet access for the first download. Story Studio runs on Node.js 20 or later with npm and uses the MCP SDK, Zod, and fflate. You can also run `npm ci` followed by `npm start` if Node.js and npm are already installed. Manual writing works without a provider account. MCP needs a local MCP client with its own sign-in. OpenRouter needs an OpenRouter API key.

You can ask your local agent to set it up for you.

> Clone https://github.com/alxdofficial/sillylanternclone on this Mac. Read README.md and MCP.md, help me start Story Studio, register its MCP server in the local agent client I’m using, and allow its tools to run without asking each time.

With Claude Code, double-click **Start Claude Writer.command** whenever you want to write. It opens a Claude session that can use only Story Studio's tools and writes each turn you queue. With another agent, start a new session and say “Watch Story Studio and write each turn I queue.”

## Try The Late Ferry

New libraries open on **The Late Ferry**, a late-night harbor mystery with six characters and six turns. Find it later under **Stories → The Late Ferry · Demo**. Changes to the demo stay in memory. Reload the page to put everything back, including the cast, transcript, and any queued writing request. Your own stories save normally and are the ones included in backups.

1. Open **Character & lore**. Read the world setting and click through the cast. Select an event in the timeline or click the line between Tomas and Mae to compare their two radio calls across midnight.
2. Back in the transcript, use **Next** and **Previous** to compare Mae’s two takes. Open **Review map updates** to keep or dismiss the suggested connection between Mae and Sam.
3. Open **Prompt** to see the beacon and radio lore in context. Try writing a line in **Manual**, or ask **MCP** or **OpenRouter** to continue with Noor checking the beacon. Follow the relevant connection instructions below to use a model.
4. For a story you want to keep or export, choose **Stories → New story**.

## Write a scene

1. Open **Stories** and choose **New story**. Add your cast under **Character & lore → Cast** and add the setting under **World**. Choose the next co-writer with **Reply as**.
2. Write a scene beat, a line of dialogue, or instructions for the co-writer in the composer. **Prompt** shows the context assembled for the selected route.
3. Choose a writing mode.

   - **MCP** gives the next reply to your signed-in Codex, Claude Code, or other local MCP client. Follow [MCP setup](MCP.md) once, then tell the agent “Watch Story Studio and write each turn I queue.” Each time you click **Queue turn**, the watching agent writes and saves the reply, and it appears in the page within a few seconds. Without a watching agent, ask the agent to write the queued reply. The line above the composer, and a placeholder turn in the story, show whether a queued turn is waiting for an agent, has been seen by a watching agent, or is being written. If the agent will not write a turn, for example an explicit scene, it hands the turn back and its reason appears above the composer.
   - **OpenRouter** sends the current scene to the selected model. Open **Connection**, enter your API key, select a model, and save. You can change the model beside **Write with** in the composer. The model list shows USD rates per million input and output tokens and estimated chapter cost at 2,000 input plus 5,000 output tokens. See [model notes and prices](MODELS.md).
   - **Manual** saves what you write without a model call. Use **Add reply** to enter the co-writer’s side yourself.

Use **Edit** to revise a saved turn or **Another take** to generate an alternate reply on the latest eligible turn. Use **Previous** and **Next** to choose which take appears in the story and in future prompts.

Open **⋯** on a turn to explore a different path. **Branch from here** creates a separate story through that turn, including the selected take, the cast and world notes recorded then, and earlier relationship events. You can branch from the demo to keep writing a regular saved story. **Rewind to here** removes later turns and their events from the current story after confirmation. For older turns without a saved cast or world version, Story Studio uses the current notes.

## Character & lore

The **Story timeline** on the left groups setup, dated scenes, and relationship events by their in-story calendar date. Entries within a day show the time in 24-hour format. Select a moment to inspect its events and highlight their connections on the graph. Older and manually written turns without a date appear under **Undated turns**. To date one, use **Edit** on the turn in the transcript. On a narrow screen, choose **Show timeline** above the graph.

Hover over a character or line for a preview in the right pane. Click or tap it to keep its details open and edit.

- **+ Character** creates a profile. Click a node to edit its name, aliases, description, and optional personality, scenario, and sample dialogue. **I write this character** identifies the character you control. The profile also supports importing basic details from a JSON character card.
- **+ Relationship** lets you select two characters in the order of the event. Write one sentence describing what happened and choose its **In-story date and time**. Several events between the same two characters share a graph line. Its count shows how many are saved. Click the line to edit or delete individual events. **Undo last deletion** is available in the inspector before you save.
- **World** holds the setting, start date and time, short continuity facts under **Story memory**, and optional keyword lore. Enter one rule per line, such as `harbor, dock | The tide cuts off the old footpath.` Use `* | lore` for a rule that is always active. **Writing** holds prose directions, style notes, and the title.

Relationship events have an in-story timestamp to the minute, for example `1998-10-24 18:30`, as well as a source turn. All setup events share the **Story start** time. MCP and OpenRouter can infer the scene and event times from the story. Story Studio uses estimates when needed. Set the start in **World** and correct event times in the graph if the story has a specific date, time jump, or flashback.

Both MCP and OpenRouter can propose new characters, profile updates, world details, relationship events, and plot facts. Choose **Review updates**, use **Keep** on useful, non-explicit facts, then **Save changes**. Use **Dismiss** to drop a proposal. Kept updates join the story context. The library records versions of the cast, world setting, and story memory by turn.

## Context and sensitive scenes

The shared prompt builder includes the selected character, other cast, setting, applicable lore, and recent eligible prose. It limits recent prose to an estimated 16,000 tokens, with a smaller allowance on models with known shorter windows. Older prose stays in the transcript. Future prompts carry forward relevant relationship events and facts you saved in the graph and story memory.

When you send a new OpenRouter turn, Story Studio asks the selected model to label your input and its reply separately. Turns marked **Explicit** or **Unverified** are omitted from future MCP prompts. They remain available to OpenRouter and in your transcript. Labels are model judgments and can be wrong. Missing labels count as unverified. A reply that reaches the model's length limit shows a warning, because its labels, scene time and suggested updates may be cut off. An MCP agent that hands back an explicit request can label your turn **Explicit** so it stays out of MCP prompts. Existing, manually added, and edited passages need your review.

To move a story back to MCP after an explicit scene:

1. Check the badges on both the writer turn and the reply. Use **Edit → MCP context → Omit (explicit)** to correct a label when needed. Select **Keep this turn out of AI context** if you want to omit that turn from all model routes, including OpenRouter.
2. Keep any needed continuity in a short, non-explicit relationship event or **World → Story memory**. Check nearby turns and notes for copies of the sensitive prose.
3. Switch to **MCP**, check **Prompt**, then queue the next scene. Start a fresh native agent session if the previous session already saw the original text.

The saved library and exports include the original passages. MCP agents are told never to read them, the local app or the open page directly, because explicit text in an agent's context can trip its provider's safety limits. The Claude Writer enforces this by giving Claude no file, shell or web tools. See [what the agent can see](MCP.md#keep-the-agent-to-what-story-studio-shows-it). Character cards, world notes, story memory and relationship events always reach MCP agents, so keep them non-explicit. Model and provider policies apply to generation. See [verified test results](TESTING.md) for what was exercised with a simulated provider and what was tried in a live agent session.

## Back up and move your library

The default library folder is `~/Library/Application Support/Story Studio/` and its main file is `library.json`. Quit Story Studio and copy the whole folder to migrate to another Mac. Or use **Stories → Export history ZIP** to download `library.json` and readable story transcripts. To restore an export, unzip it and select `library.json` with **Import library**. Import replaces the current library after confirmation. If a newer save from another tab causes a conflict, export your local work before reloading.

The app binds to your Mac’s loopback address and stores the library locally. When you use a model, the assembled context goes to its service through your selected route. The OpenRouter key is held in the browser page's memory, passed through the local server for requests, and cleared on reload. Story exports exclude the key.

## Project reference

- [MCP.md](MCP.md) covers registration, the native agent handoff, and the tool contract.
- [RESEARCH.md](RESEARCH.md) records the pinned SillyTavern sources, the UI and prompts studied, and the features implemented independently.
- [TESTING.md](TESTING.md) records browser and provider checks. Run `npm test` for automated regression tests.

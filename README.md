# Story Studio

A local fiction-writing workspace with a cast graph, turn history, and three writing modes: MCP, OpenRouter, and Manual.

## Start on your Mac

1. Accept access to the [private repository](https://github.com/alxdofficial/sillylanternclone), then clone it or use **Code → Download ZIP**. Alex can also share the Mac distribution ZIP.
2. Double-click **Start Story Studio.command**. It installs dependencies and downloads and verifies Node.js if a suitable version is missing. If macOS blocks the unsigned launcher, inspect the files and run `zsh 'Start Story Studio.command'` in the app folder.
3. Open [Story Studio](http://127.0.0.1:4317/) and leave the launcher running. For development use `npm ci`, then `npm start`.

You can ask your local agent: “Clone the private Story Studio repository, read README.md and MCP.md, and help me start it and register its MCP server.”

## Write

- **MCP** uses your signed-in Codex or Claude Code session. Register Story Studio once using [MCP.md](MCP.md). In the browser, choose MCP and **Queue turn**. In your agent's session, ask it to write and save the queued reply using Story Studio. The browser picks up the saved reply. An idle MCP client does not start writing on its own.
- **OpenRouter** uses its own key and billing. Add the key under **Connection**, then use the model picker in the composer. Prices show estimated cost for a chapter and rates per million tokens. The app forgets the key on reload. See [MODELS.md](MODELS.md).
- **Manual** saves your own text without a model call. **Add reply** lets you enter the co-writer's side yourself.

Choose **Reply as** to set the next co-writer when the scene has multiple characters. **Another take** keeps the original turn and uses its original speaker. You can inspect the next model-facing context with **Prompt**.

## Character & lore

New stories open the cast graph. Use **+ Character** to give a character a name, aliases, and description. Click a node to edit its profile or import a JSON card. To draw a link, select the source character, click **Connect**, and select the other character. Describe the event or relationship in one sentence. Each link event is stamped with its story turn. Links created before writing show **Setup**. The same pair can have several events.

**Your persona** is the part you write. **World** holds setting, durable story memory, and keyword lore. **Writing** holds prose directions and style. Story memory and model-facing descriptions should use the non-explicit facts needed for continuity.

MCP agents can propose new characters, relationship events, and updates to profiles, the world setting, or story memory. Use **Review map updates → Keep → Save changes** to carry a proposal forward. Dismiss anything inaccurate, sensitive, or unnecessary. Profile and world updates append dated notes, preserving the author's text. The saved library stores version deltas for character profiles, world settings, and continuity by turn. The browser has no time-machine control yet.

## How context is picked

All model routes use the same strategy: recent included prose, character and world detail, and relevant relationship events and reviewed facts. The recent-prose cap is approximately 16,000 tokens, using a text-size estimate. Story Studio reduces the total for known smaller model windows and leaves room for the reply. Older prose remains in the transcript. The graph carries forward the facts that were captured and kept.

To keep a passage out of future prompts, use **Edit → Keep this turn out of AI context → Save turn**. Leave a short, non-explicit plot fact under **World → Story memory**, or add a non-explicit relationship event. Check **Prompt**, use a fresh native agent session if it already saw the original, and ask for the next non-explicit scene. Exclusion applies to that turn, so check any nearby turns or notes that quote it. The original stays in the library and exports.

## Back up and migrate

The library is under `~/Library/Application Support/Story Studio/`. Quit the app and copy the whole folder to move it to another Mac. **Stories → Export history ZIP** produces restorable `library.json` and readable transcripts. Unzip it and choose **Import library** to restore. Import replaces the current library after confirmation. If another tab saved first, export your unsaved copy before reloading.

The local server binds to loopback. Generation sends only the assembled context to the chosen route. MCP clients use their own sign-in and settings. See [TESTING.md](TESTING.md) and [RESEARCH.md](RESEARCH.md) for verified behavior and upstream comparison.

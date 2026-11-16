# Run and maintain Story Studio on a Mac

Start here if you are installing, updating, or troubleshooting Story Studio for its owner. For writing workflows see [README.md](README.md). For optional external tool registration see [MCP.md](MCP.md).

## Start and verify

1. Locate the existing Story Studio folder or clone [the repo](https://github.com/alxdofficial/sillylanternclone) if this is a fresh install. Run commands from that folder.
2. Open **Start Story Studio.command**. From Terminal, run `zsh 'Start Story Studio.command'`. It finds or installs Node, installs the locked dependencies, and opens the browser. With Node 20+ and npm already available, `npm ci` followed by `npm start` also works.
3. Open [Story Studio](http://127.0.0.1:4317/) and check that the writing screen loads. With the default port, `curl -fsS -o /dev/null http://127.0.0.1:4317/` checks server availability without printing library data.
4. Add provider keys in **Settings**. See [the provider and model guide](MODELS.md).

## Stop, update, and restart

1. Finish or cancel any current requests, wait for **Saved locally** in the browser.
2. Press Control-C in the Terminal running Studio. If MCP `open_studio` launched it in the background, run `lsof -nP -iTCP:4317 -sTCP:LISTEN` (substitute any custom port). Verify that the reported PID is this Studio's Node process using `ps -p PID -o command=` and `lsof -a -p PID -d cwd`. Use `kill -TERM PID` for that verified process. Substitute the actual PID in each command.
3. For a Git clone, check `git status --short`, then run `git pull --ff-only` from the existing checkout. Preserve any local changes and report divergence or merge conflicts. For a ZIP install, unpack a fresh copy. If the folder moves, update the MCP command path in the client.
4. Start Studio again with the launcher and reload the browser. The launcher reinstalls dependencies when the lockfile changes. If launching by hand, run `npm ci` before `npm start`.
5. If you use an external MCP client, reconnect it to reload the tool schemas. Remove any separately installed copy of the old Story Studio skill. Use a demo or an isolated library for a write check.

## Data and settings

| Item | Default location or lifetime |
| --- | --- |
| Source, bundled demo, and dependencies | The checkout. `node_modules` is recreated by the launcher or `npm ci`. |
| Saved stories | `~/Library/Application Support/Story Studio/library.json`. `STORY_STUDIO_DATA` overrides the directory. A legacy checkout can have `data/stories.json` as its first-load migration source. |
| Local logs | `~/Library/Logs/Story Studio/`. With custom `STORY_STUDIO_DATA`, logs go under its `logs/` subfolder unless `STORY_STUDIO_LOG_DIR` is set. |
| Launcher-managed Node runtime | `~/Library/Application Support/Story Studio Runtime/`, when the launcher installed Node. |
| Display names and custom model list | Browser storage for the current Studio address and port. Display names are per story. |
| Provider spend | Under the active data directory in `provider-spend/`. Daily records contain timestamps, provider, model, and cost. They are separate from story exports. |
| Provider API keys | `credentials/providers.json` in the Studio data directory. Shared across stories and sessions. Manage through Settings. |

Provider keys live in a folder restricted to the current OS user. Keep that folder out of shared backups. Story exports already exclude it. Keep your previous keys handy when upgrading from a release that kept keys in the browser tab. Enter them once in the new Settings screen to persist them.

Use **Stories → Export history ZIP** for a library backup. For a file-based migration, stop Studio and copy the library and any diagnostic or spend files you want to keep. To restore via the browser, unzip the export and use **Import library** with `library.json`. Import replaces the active library. Display preferences live in the browser and are separate from the library backup. Treat the library and exports as private writing.

## Isolated checks and troubleshooting

- For a test run, use a separate absolute `STORY_STUDIO_DATA` folder and an unused `PORT`. Pass those same values to the launcher and MCP server environment. Avoid the owner's stories, key, and browser sessions when testing changes. Run `npm test` for the automated suite.
- A port collision or launcher failure appears in `setup.log`. Server requests and provider outcomes go to `server.log`. Native requests and tool failures go to `mcp.log`. Match the browser’s **Log ID** to `requestId` in the server log. For a locally working page that fails on MCP, check the command path and port, and confirm the current agent chat has the tools and uses the direct reading and editing tools. See [log fields and what they mean](README.md#troubleshoot-startup-and-writing).

## Find a handoff in the traces

Provider and MCP trace files contain one JSON object per line. Start by filtering on the relevant request or tool and select the fields you need. A `requestId` identifies a browser generation or setup request. Within it, an `exchangeId` pairs one provider request with its response. For MCP, the trace entry's `sessionId` identifies the connection. Check `.log.1` if the current log has rotated.

```sh
cd "$HOME/Library/Logs/Story Studio"
jq -c --arg id 'BROWSER-LOG-ID' 'select(.requestId == $id)' *-trace.log
jq -c 'select(.tool == "submit_reply" or .tool == "edit_story_structure") | {time, sessionId, tool, story: .result.storyId}' mcp-trace.log
```

The full traces are for local debugging and can contain sensitive story text. Keep them private and preserve the separation between writing-agent tools and log access. The summaries provide request outcomes and omissions without quoting the prose.

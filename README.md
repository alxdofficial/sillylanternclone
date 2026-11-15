# Story Studio

A local writing desk inspired by SillyTavern. Keep a story's character, persona, world and writing notes beside the scene, choose a writing provider, and keep alternate takes on a reply.

## Install on a Mac

1. Download and unzip **Story Studio for Mac.zip**. Move the unzipped folder wherever you'd like to keep the app.
2. Double-click **Start Story Studio.command**. The first launch uses Node 20+ if available, or downloads official Node.js for Apple Silicon or Intel, verifies its checksum, and installs pinned dependencies. It needs internet access. If macOS blocks the unsigned launcher, review the files and open Terminal in the folder and run `zsh 'Start Story Studio.command'`.
3. Answer **y** if you want to sign in to Codex with your own ChatGPT account using the official sign-in flow. You can skip this and use OpenRouter or manual writing. Leave the terminal window open while you write. Press Control-C there to stop the server.

Run the same launcher for later sessions. The first-time setup uses the Node and npm public registries. Developers can instead run `npm ci` then `npm start`. The default URL is http://127.0.0.1:4317.

## Writing connections

- **Codex** uses the installed project's pinned official CLI. Choose **Connection → Codex CLI**. The default model is GPT-6 Astra, verified with the account on the development Mac. If your account offers a different model, set `STORY_STUDIO_MODEL` before launching. Check `npx --no-install codex login status` to confirm ChatGPT sign-in. API-key authentication has separate billing. Subscription limits apply.
- **Claude** works through a manual handoff. Write what you want to accomplish, click **Copy prompt**, paste it into your signed-in Claude session and bring the answer back using **Add reply**. This works for outlining and drafting. The app has no automatic Claude integration.
- **OpenRouter** accepts a specific model ID and your own API key in **Connection**. Connection settings clear when the tab closes or reloads. Prompts leave the device on generation and the app requests providers with data collection denied. Billing and acceptable use depend on the route. See [MODELS.md](MODELS.md) for models to try.

On the latest co-writer reply, **Another take** stores an alternate and **Previous / Next** selects which one the current scene follows. Under **Character & lore**, you can import the supported fields of a SillyTavern JSON card. **Name aliases** creates an editable lookup table and replaces names locally in pasted drafts. It does not perform reverse substitution or remove other identifying information.

## Back up or move to another Mac

Your full library is stored in **~/Library/Application Support/Story Studio/library.json**. The folder is created on the first save. Open it in Finder using **Go → Go to Folder**. Quit the studio and copy the entire **Story Studio** folder to the same location on the other Mac. Install the app and sign in separately there. Provider credentials are outside this folder.

**Export history ZIP** creates an archive with `library.json` (every story, turn, alternate take and note currently in the library) and a readable text transcript per story. To restore, unzip it and choose **Import library** with the included `library.json`. Import replaces the open library after confirmation. Deleted content and external account conversation history are outside the export. The alias tool's draft and name table are temporary and stay in its page.

## Architecture

The local server binds to loopback and uses a deterministic story prompt with bounded recent context. It holds the writing library separately from inference. Story content is sent to the chosen provider on generation. Codex runs in a read-only sandbox with ephemeral sessions. The sandbox can still read files, and prompt instructions are not a security boundary. This app is intended for one local user and one writing tab. `PORT` and `STORY_STUDIO_DATA` can override the port and storage location.

See [RESEARCH.md](RESEARCH.md) for the upstream source review, compatibility limits, subscription integration, and MCP tradeoffs.

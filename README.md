# Story Studio

A private writing desk inspired by SillyTavern. Create stories with character and world notes, write a scene with a co-writer, and keep alternatives to a reply. It runs locally on a Mac; generation sends the selected story context to the provider you choose.

## Install on your Mac

1. Alex must give your GitHub account access to the private repository. Once you have access, sign in to GitHub and clone [Story Studio](https://github.com/alxdofficial/sillylanternclone), or use its **Code → Download ZIP** button. For a clone, run:

   ```sh
   git clone https://github.com/alxdofficial/sillylanternclone.git "Story Studio"
   ```

   GitHub may ask you to authenticate. A download ZIP is a copy of the app at that revision, not a backup of your stories.
2. Open the folder and double-click **Start Story Studio.command**. If macOS blocks the unsigned launcher, inspect the downloaded files, open Terminal in that folder, and run `zsh 'Start Story Studio.command'`.
3. First launch needs internet. It installs pinned app dependencies and, if Node 20 or newer is unavailable, downloads an official Node.js runtime and checks its checksum. If asked, choose whether to sign in to Codex with **your own** ChatGPT account; you can skip this and write manually or use OpenRouter.
4. Your browser opens at [127.0.0.1:4317](http://127.0.0.1:4317). Leave the launcher window open while writing; press Control-C there to stop the server. For future sessions, use the same launcher.

If you're asking Claude Code, Codex, or another agent to set it up, paste this after accepting the repository invitation:

> Clone https://github.com/alxdofficial/sillylanternclone using my GitHub access. Read README.md and AGENTS.md, then walk me through launching Story Studio on my Mac. Leave provider sign-in and API-key entry to me. Keep any existing story library.

For development, install Node 20+, run `npm ci` then `npm start`. The server runs on this computer only. `PORT` and `STORY_STUDIO_DATA` can override the port and library folder.

## Start a story

Select **+** beside Your stories. In **Character & lore**, add the character's name, description, personality, scenario and example dialogue, plus your persona, world details, and notes on voice. You can edit these as the story develops. **Prompt** lets you inspect the assembled, role-labelled context before generating. The app includes bounded history, so older turns might not all be sent; check the preview for the current context.

In the composer, choose **Write with** for the current story:

- **Codex** uses the locally installed official Codex CLI and its existing sign-in. The launcher offers the official ChatGPT sign-in flow. A ChatGPT sign-in uses its applicable plan allowance and limits; Codex signed in with an API key has separate usage billing. Verify the active method with `npx --no-install codex login status`. Model access varies by account.
- **OpenRouter** uses your own OpenRouter account, API key and model ID. Open **Connection → OpenRouter** and choose a model. The dropdown shows a chapter estimate based on 2,000 input and 5,000 output tokens total, plus listed rates per million input and output tokens. The app generates a chapter across multiple turns, so extra context or rewrites can raise the total. Enter the key there in the app. The key and connection model stay in page memory and clear on reload or close. The route and unsent draft remain with their story in the browser tab until it closes. Paid models consume OpenRouter credits separately from a ChatGPT or Claude subscription. Some models are free but still require an OpenRouter key and have rate limits. Check current model prices and eligibility before use; see [MODELS.md](MODELS.md).
- **Manual / Claude** uses **Copy prompt** and **Add reply**. Paste the prompt into your own Claude session or another service, then paste the response back. Story Studio does not automatically call Claude.

Choose **Write with → OpenRouter** before sending the turn or using **Another take**. Switch back to **Codex** whenever you want. No automatic backend switch occurs. The next generation sends recent turns and applicable story settings to the selected route. For a scene that should receive different context, start a separate story and copy only the notes and draft you intend to send. Provider content rules and availability apply.

Write your next turn and choose **Send & write**, or use **Continue**. Edit turns to revise the scene; **Another take** makes an alternative to the most recent co-writer reply, and **Previous / Next** chooses the version the story follows. The selected version becomes part of the subsequent context.

### Keyword lore

In **Character & lore**, add optional rules one per line using `keywords | text`. Separate keywords with commas; use `* | text` for always-on information. For example:

```text
castle, palace | The castle stands above the sea.
* | Magic always has a cost.
```

This is a small subset of SillyTavern World Info, not full lorebook compatibility. Check **Prompt** to see what is included. The JSON character-card importer supports selected fields; it does not import all greetings, embedded lorebooks, artwork, scripts or extensions. Review imported text before saving.

## Back up or move your writing

The library lives at `~/Library/Application Support/Story Studio/library.json` on macOS, separate from the app folder. In Finder, use **Go → Go to Folder** to find it. To move your work, quit Story Studio and copy the whole **Story Studio** data folder to the same location on the other Mac. Install the app and sign in separately. Credentials are not part of the library.

**Export history ZIP** saves the complete current library as `library.json` plus readable story transcripts. To restore, unzip the archive and use **Import library** to select `library.json`. Import replaces the current library after confirmation, so export a backup first. Deleted content, unsent browser drafts, the alias workspace, and conversations held in external services are outside the library. If another tab saves first, this tab's save is blocked. Export the unsaved copy before reloading.

If you previously used an older local version that stored stories in the app's `data/stories.json`, the app reads that file when no library exists in the new location; save a change to write the library into the new location. Preserve the old file until you have checked the stories and exported a backup. A pre-existing library in the new location takes precedence.

## Privacy and limits

Story data is stored locally, but generation sends the assembled story context to the chosen provider. For OpenRouter, the app requests routing with data collection denied; eligible providers may be unavailable, and this setting is not a guarantee of local-only processing or universal zero retention. Check provider terms and OpenRouter privacy settings. Provider metadata, service-side retention or safety policies may still apply. Don't put secrets in stories.

**Aliases** runs locally in the browser. Enter source names one per line, click **Generate aliases**, then review or edit the generated names. Paste a draft, choose **Replace names**, then **Copy draft**. List nicknames separately if you want to replace them. Replacements match whole names with longer names first. The table and draft stay in the current browser tab until you clear the workspace or close the tab. Review places, histories, and any other identifying details before sharing. Automated reverse substitution is outside this workflow.

Codex runs in a read-only sandbox and ephemeral session; that does not prevent all reads of local files, and story instructions are not a security boundary. The server is for one trusted local user and one writing tab, not a public or shared deployment. See [TESTING.md](TESTING.md) for the live browser test on the development Mac. Jess will sign into her own accounts during setup.

See [RESEARCH.md](RESEARCH.md) for the upstream source review, compatibility gaps and MCP tradeoffs.

# Story Studio verification

For current setup and controls, use the [README](README.md) and [MCP guide](MCP.md). The archival walkthroughs at the end retain the interface and model behavior observed at the time.

## Shared watcher, starting relationships, and traces

On 16 November 2026, used the in-app browser with disposable libraries. One MCP SDK client connected over stdio and handled a brainstorm reply, a setup draft, a scene, continuity, and an Agent metadata edit. The browser showed ready and working status, saved two cast profiles and a starting relationship at 23:55, then displayed the continuity fact and Agent edit. The first walkthrough caught a save conflict between a new story's first continuity write and a queued edit. The retest initialized the new story with the same defaults as a saved story and finished with both changes present.

A browser run with a simulated OpenRouter provider staged the world, cast and setup edges, then classified a scene with a harmless marker as explicit. The raw provider trace retained the marker. The MCP prompt preview, actual MCP writing handoff and Agent state omitted the marked direction and reply while retaining the setup relationship. Display names appeared in italics in Write and Book view, survived reload, and left the prompt canonical. Verified the chapter-range Markdown and library ZIP downloaded by the browser.

Separate live OpenRouter requests through the current Story Studio server verified the expanded setup draft, Cydonia prose followed by DeepSeek continuity, and a DeepSeek Agent edit that left the manuscript intact. Live setup returned world information, two cast members, two starting relationship facts, and the intended opening minute. The total reported cost was $0.00165. These live probes used non-explicit fiction. The MCP walkthrough exercised the actual tool transport with scripted responses. It did not run a fresh Claude or Codex inference session.

## The Late Ferry starter

Regenerated from a blank story in the built-in browser on 16 November 2026. Live DeepSeek V4.1 Flash brainstormed the plot and staged the world, six cast profiles, four opening relationships, and the 23:40 start time. Reviewed and created the story, then used Agent mode to update Sam's profile. Live Cydonia 24B v4.1 wrote three scenes from three author directions. The current DeepSeek continuity tools classified all three pairs as non-explicit and applied updates on each scene, giving the demo eight dated relationship entries and four cast and world snapshots.

The first brainstorm request exhausted its 768-token budget on reasoning. The app now applies its existing reasoning settings to known Agent models during setup chat, and the live DeepSeek retry returned a visible reply. Lightly copyedited the scenes in the composer, approved the edited prose for shared context, and placed a chapter break at the third scene. Exported through the browser and packaged the saved story, excluding the original library ID and transient Agent status. The regeneration cost about half a cent including the initial retry.

## Harness and documentation audit

Reviewed the writing, continuity, direct-edit, setup, and watcher paths against the published OpenRouter and MCP tool contracts. Verified that context filtering is app-owned, reads are scoped, and writes are revision-checked. Regression tests cover an abandoned browser request canceling the local upstream fetch, a repeated final tool call being retried as one batch before any edits apply, and bounded metadata previews excluding unknown stored fields. These checks used fixtures and local stdio MCP.

## Story, Agent, and setup through the shared tools

Tested on 16 November 2026 in the in-app browser on isolated Story Studio instances. The personal library and its credentials were outside the test data.

- With simulated provider replies, sent two turns marked **Sensitive scene**. The second Cydonia request got the first held passage. The continuity editor received the new draft and filtered recent history. Reviewed and kept a non-explicit continuity fact. The next Sonnet request and the MCP handoff received that fact and omitted both original passages.
- Queued an MCP story turn in the browser and picked it up over stdio. Disconnected after the prose saved. A fresh MCP connection found the pending continuity job, looked up the cast, recorded the scene at 06:21, and saved one graph fact. The browser showed the prose and then its graph changes. A separate MCP Agent request changed writing notes without adding a transcript turn.
- Wrote a live, non-explicit scene with Cydonia on Parasail. DeepSeek used four scoped lookups across two rounds on StreamLake and River, followed by one `record_scene` call. The log recorded two non-explicit labels and three graph proposals. The artist output had a garbled phrase and an ambiguous ending. This run verifies the tool handoff and ordinary scene data, while the marked-turn privacy checks used synthetic text.
- Asked DeepSeek in Agent to add a detail to the world. The live call inspected the world on Cohere and committed one `edit_story_state` change on Wafer. The existing world notes and the transcript remained intact. In a separate live new-story wizard, DeepSeek brainstormed conversationally and then called `prepare_story_setup`, staging an editable draft. The story saved after clicking **Create story**.
- Opened the **Context** breakdown for Story on MCP, Agent on GPT-6.1 Terra, and the setup wizard on Cydonia. Verified that the indicators distinguished the MCP host window, Terra's published 1,050,000-token window, the DeepSeek draft model, and the extra context from a pasted manuscript's previewed excerpts.
- Confirmed that failure to complete a valid tool sequence leaves generated prose unverified. Regression tests cover invalid-argument recovery, stale or duplicate writes, conflicts between author edits and pending continuity, and withheld history after browser prompt projection. Logs capture tool names and provider telemetry without recording prompts, tool arguments, or prose.

## Historical walkthroughs

### Earlier Write, Agent, and model setup

Using an isolated browser and library, added an OpenRouter ID, confirmed its **User-added** label, reloaded, removed the ID, and reloaded again. The selector cleared the removed choice. Verified that Write keeps all 8,000 words, rejects 8,001 without changing the draft, and restores its provider selection after switching back from Agent.

Pasted long input into both **Brainstorm with a model** and **Import an existing story**. The wizard kept the pasted text where it was entered and enforced the 20,000-word combined budget. An MCP setup request carried 14,000 chat words and 6,000 reference words intact.

In Agent mode, a simulated OpenRouter reply added world information through the strict edit schema while the transcript remained intact. The app rejected a batch containing a deletion without applying its other changes. Native MCP protocol tests cover metadata reads, queued edits, invalid edits, and revision conflicts. No paid OpenRouter calls were made for these checks.

### Original walkthrough

Tested on the development Mac with an isolated library. The production library was not used.

1. Opened **Stories**, created **The Midnight Signal**, and entered Iona's character, Ren's persona name, scenario, examples, author's note, post-history instructions, and two lore rules.
2. Typed a direction involving a brass compass. **Prompt** showed the matching compass lore, omitted unrelated orchard lore, and replaced character/persona macros in the dialogue example.
3. Clicked **Send & write** using the signed-in Codex route. Iona's generated scene used the compass and ended on an actionable clue.
4. Opened **Connection**, selected Cydonia 24B via OpenRouter, and clicked **Another take**. The live completion arrived as the second alternative in the same turn. **Previous** restored the original and both takes survived navigation. The live request used a non-explicit mystery passage. It does not establish a model's behavior for explicit fiction.
5. Tried **Manual / Claude** using **Copy prompt**, **Save turn**, and **Add reply** with a test reply. This checked local handoff controls and made no Claude inference call.
6. In **Aliases**, generated a table for overlapping names, then replaced both in a sample draft. The unrelated word “Alexandria” stayed intact.
7. Downloaded **Export history ZIP** in the browser, unzipped it, and restored `library.json` through **Import library** on a fresh isolated instance. Compared restored data with the archive, including dialogue, alternate takes, selected version and lore settings. The archive contained no API credential.

Run `npm test` for deterministic prompt order, macro substitution, lore activation and history budget checks. Fresh installation on Jess's own Mac and accounts remains to be verified there.

Checked the OpenRouter model dropdown in the browser, including the listed price per token and the output-only 10,000-word estimate for Cydonia. Prices were verified independently against OpenRouter's public model catalog.

### Follow-up browser stress sweep, 15 November 2026

Five Luna reviewers completed isolated UI walkthroughs covering story creation and manual writing, narrow-screen layout, backup and restore, provider settings, and aliases. A sixth reviewer opened the app but did not finish the walkthrough. No tests in this sweep used a paid inference request.

The follow-up browser checks verified that:

- An outdated tab cannot overwrite a newer saved library. Its unsaved turns are still available in a ZIP export.
- A draft does not carry over to another story. The draft and route are restored when returning to the original story or reloading the tab.
- Prompt and Aliases remain reachable at a 320px viewport, and malformed custom model IDs produce an inline error.
- All six models appear in the dropdown with chapter estimates. Cydonia displays $0.00310 per chapter and $0.30 input / $0.50 output per million tokens.
- Changes to the alias list invalidate the old result. Regenerated aliases and an applied draft survive navigation in the same tab.
- Invalid library JSON is rejected without replacing the current story. A 2.3 MB fixture of 110 turns with multi-byte text survived browser import, reload and ZIP export with every turn unchanged.
- With a simulated model response, a large story sends the selected route and at most 60 recent turns, displays the reply, and saves it. After reload the route remained selected and the API key field was empty.

### Cast and speaker checks

In an isolated browser library, added Iona alongside Mara, switched **Reply as**, and inspected **Prompt**. The preview included Iona's definitions and excluded Mara's. Simulated generation produced a turn labeled Iona. After selecting Mara, **Another take** still targeted Iona's card. Reload preserved the cast, attribution and selected speaker. Exported ZIP contained the cast and both takes. Checked that the speaker selector was visible at 320px. No inference request was billed for these checks.

### Graph, MCP and private-scene handoff

Verified the browser workflow at desktop and mobile sizes: add character profiles, draw multiple edges between the same pair, save turn-stamped events, and edit world and story memory. Saved graph versions preserve the prior profiles and world. A browser-queued MCP reply appeared automatically after an SDK client submitted it. Proposed updates stayed out of future prompts until reviewed and saved.

Used a synthetic private marker and a non-explicit aftermath. The marker remained in the transcript and was absent from Prompt preview, the browser generation payload, and the MCP context. The aftermath and reviewed graph facts remained. A live signed-in Codex run discovered the MCP tools, read the queued context, wrote a one-sentence scene referencing the brass key, and saved it as the next turn. The queue cleared. This did not send an explicit passage to either service. Claude Code was signed out, so no live Claude generation was tested.

### Automatic OpenRouter labels

Tested browser → server → simulated OpenRouter → browser → MCP stdio. The simulated provider labeled both the writer turn and reply explicit, then omitted the label on a second response. Both explicit turns and both unverified turns were displayed in the transcript and omitted from MCP preview and the real stdio tool context. OpenRouter still received the previous included scene for continuation. Labels persisted on reload. This verifies the app's routing and parsing, not a live model's classification accuracy.

### Live OpenRouter route retest

On 16 November 2026, sent three matched fictional-adult directions per preset through Story Studio’s live OpenRouter route. DeepSeek labeled three of three Cydonia and MythoMax replies explicit, two of three Magnum replies, and one of three UnslopNemo replies. The preset fixtures supplied no story date, so metadata flagged the time field while returning valid labels. Dated custom fixtures returned complete metadata. Two matched scenes per custom route yielded explicit labels twice for Weaver and Lunaris, and once each for Dolphin Mistral 24B, Skyfall, and ReMM SLERP.

Tested the exact metadata model, `deepseek/deepseek-v4.1-flash`, as a plain-prose writer in three dated fixtures. The Baidu and River hosts returned prose classified explicit. The Cohere response ended with `stop` and contained no prose. We recorded host, status and labels without retaining the drafts.

### Story timeline and responsive review

In Chromium, opened the graph from a synthetic ferry story and verified that a saved persona appeared as an ordinary cast member. Hovering over a character or edge opened a preview without changing the canvas width. The browser test set a shared setup time, added multiple events to one relationship line, edited an event across midnight, deleted it, and undid the deletion. Selecting a timeline entry opened that exact in-story moment. Saving and reloading preserved the timestamps.

In Chromium at desktop and phone widths, a direction and immediate reply appeared as one entry. Its inspector showed both texts, a distinct timestamp when the direction differed from the reply, and the reply's saved graph changes and pending proposals. Keyboard selection and independent text collapse worked. Standalone prose and an unanswered direction each had their own entry, and the underlying turn IDs stayed intact.

The responsive audit covered Chromium at 320–2560 pixels wide and WebKit at five desktop, tablet, and phone sizes. Tested manual writing and editing, Story drawer keyboard navigation, the inline model picker, Connection, and the Prompt preview. Touch emulation used a 100-story library with long titles, multilingual names, and unbroken prose. No physical phone was used.

A simulated OpenRouter response added explicit labels and an inferred date to a browser-written scene. The browser preserved the flagged prose locally and allowed a non-explicit timed graph proposal to be reviewed. A real stdio MCP client then read the queued continuation, confirmed the flagged prose was absent and the approved event was present, and saved a follow-up with its own date. This test exercised the app handoff without a live model or paid request.

### Earlier starter generation

Regenerated the bundled story from a blank story in an isolated Chromium session. Entered six character profiles, the world setting, and keyword lore through **Character & lore**. Submitted three directions and **Another take** using live OpenRouter calls to Cydonia and DeepSeek. All four writing and analysis passes finished normally. Kept the generated graph updates from turns 2 and 4 and left the last proposal pending for the demo. DeepSeek incorrectly marked the three ordinary directions explicit in this run, so they were corrected with **Edit**. A live retest of the revised classification prompt labeled all three directions and replies non-explicit and classified an explicit direction independently from its non-explicit reply.

Exported the story in the browser and used its saved data as the fixture. The bundled story retains all six turns, the alternate, generated event times, two saved relationships, one pending proposal, and three graph versions. The MCP integration test checks that demo edits stay out of the saved library and that resets clear them.

Opened the rebuilt starter in a separate Chromium session. **View graph changes** showed the two saved relationship events on turn 4 and the scoped review action on turn 6. Continued in the UI with the revised two-pass flow. DeepSeek labeled the direction and reply non-explicit, and the five graph changes from that turn were visible as saved without clicking **Keep**. This temporary turn was outside the bundled fixture.

### Earlier demo replay, branching, and rewind

Replayed the demo from turn 4 in a disposable library. This Codex session requested each scene's context and submitted the drafts, inferred timestamps, and graph suggestions through the live Story Studio MCP server using a stdio SDK client. Approved turn 5's two relationship events and its continuity fact in the browser before drafting turn 6. Queued an alternate in the browser, saved it through MCP, and switched back to the main take. The packaged demo's six turns, relationship events, and graph history were compared with the resulting library. Standalone Codex CLI inference was unavailable during this run because the account rejected the tested model IDs.

The branch and rewind browser test used the three-dot menu at desktop and phone widths. Branched from demo turn 3, confirmed the branch omitted the later radio call and story memory, and added an independent fourth turn. Canceled a rewind first, then accepted and confirmed the branch preserved only two turns after reload. The original demo still had six turns. Also verified Escape returns focus to the menu button and that rewind is disabled at the latest turn.

### Automatic agent pickup and the agent contract, 15 November 2026

Checked on the development Mac with an isolated library on port 4417. Jess's library was not used.

- A live Codex agent (signed in with ChatGPT, run with only the Story Studio MCP server and a read-only sandbox) was told only “Watch Story Studio and write each turn I queue.” It picked up a turn queued in the browser, wrote Lina's reply with an in-story time and saved it. The agent ran no shell commands.
- A direction asking for graphic sexual detail was queued next. The same agent called `decline_turn`, labeled the writer turn explicit and gave a reason. Without a reload, the page showed the **Explicit · outside MCP** badge and the reason above the composer. The queue cleared, so the watch loop did not pick the turn up again.
- Nine idle 50-second checks re-sent about 659,000 input tokens to the model, most of them cached. Claude Code clients now wait 300 seconds per check by default.
- `Start Claude Writer.command` was checked in print mode: Claude Code started with no built-in tools, only the `story-studio` server, and the watch prompt. The session itself was not run, because the command-line Claude Code on this Mac was not signed in. Run it once on Jess's Mac after signing in.
- `npm test` covers the watch tool, stale and removed-speaker queues, declining, checked map updates (including a new character linked in the same reply), refusing prose after a `story-graph` block, the shared queue and reply layout used by the preview, writer-turn dating, long notes keeping their newest kept facts, take-specific map updates, and the browser's three-way merge after an agent save.
- The OpenRouter length warning was checked only through code paths and unit tests. No paid OpenRouter request was made.

### Queue and agent status in the page, 15 November 2026

Checked on an isolated library on port 4418 with a scripted MCP client that identifies as Claude Code. Jess's library was not used.

- With no agent connected, a queued turn showed a **Waiting for an agent** placeholder and “Turn queued, but no agent is watching…” above the composer.
- When the agent picked the turn up, both changed within two seconds to **Writing** with a pulsing marker and “Claude picked up your turn just now and is writing Lina Park’s reply.” When the reply was saved, it replaced the placeholder and the line changed to “Claude is watching.”
- A turn queued while the agent was watching showed “Claude is watching and will pick it up in a moment.” When the agent then disconnected, the line fell back to “no agent is watching” and the turn stayed queued.
- The status line wraps cleanly at 375 px. The OpenRouter **Writing** placeholder was checked by code review only, since no OpenRouter request was made.
- `npm test` checks that the MCP server reports watching, writing, watching again after saving, and nothing after disconnecting, and that the status endpoint rejects malformed reports and other origins.

### Share-ready sweep

Reviewed both the queued-agent and presence changes. Replayed The Late Ferry from its authored fourth turn. The browser queued Ellis, a real stdio MCP SDK client returned the request and its dated writer turn, and this Codex session sent the prose, inferred time, and three structured map updates. Kept those updates in the browser and verified the next MCP prompt inherited the accepted story memory. Submitted Mae's reply and a browser-queued alternate through the same tools. The shipped turns, times, relationship events, and graph history match the replay.

In Chromium at desktop and phone widths, exercised red confirmation dialogs for stories, turns, character removal, relationship events, rewind, and library import. Verified cancel and Escape, the safe initial focus, event undo, and persistence of confirmed actions. In two tabs, verified that an older tab could no longer write back a reset demo. The clean installer copy installed dependencies, served the new six-turn demo, and requested the browser URL. The Claude Writer flags and shell syntax were checked. Live Claude generation still requires sign-in.

The browser sent a queued turn to a simulated OpenRouter upstream after clearing the MCP request. Verified the assembled prompt, exact cast validation, preserved valid updates, and omission of flagged prose from MCP preview. Verified that a length-limited response stayed unverified even when its footer said safe. The OpenRouter catalog prices in the picker matched the published listings. This sweep made no paid provider call and did not verify live explicit-content generation.

### Narrator-only writing

On a 390 px browser viewport, opened The Late Ferry, added a standing style in Writing notes, and queued a continuation with a one-off tense instruction. Confirmed the composer had no character reply picker, the prompt contained the style and cast, and the watched MCP request identified Narrator. Submitted a reply through real stdio MCP and verified it appeared as Narrator. A simulated OpenRouter request received the same narrator and style context and saved its reply as Narrator. No live provider model was used in this check.

### Deployment diagnostics

A clean launcher copy recorded dependency installation and server readiness. An invalid port and an occupied port produced startup failure entries. Rotation moved a 1 MiB file to `.1` and wrote the next entry to a fresh log. The server test verifies a simulated OpenRouter 401 can be matched to its HTTP request ID without logging request text, the key, custom model text, or the provider response. The MCP integration test verifies a save conflict is logged without recording the reply or draft.

### Transcript labels

Checked the demo at desktop and phone widths. Story prose appeared without a Narrator heading, author inputs used **You**, and the queued placeholder showed only its status. The timeline used turn numbers for narration and an input label for author turns. Sam Bell remained visible in the cast graph.

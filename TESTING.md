# Browser walkthrough, 15 November 2026

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

## Follow-up browser stress sweep, 15 November 2026

Five Luna reviewers completed isolated UI walkthroughs covering story creation and manual writing, narrow-screen layout, backup and restore, provider settings, and aliases. A sixth reviewer opened the app but did not finish the walkthrough. No tests in this sweep used a paid inference request.

The follow-up browser checks verified that:

- An outdated tab cannot overwrite a newer saved library. Its unsaved turns are still available in a ZIP export.
- A draft does not carry over to another story. The draft and route are restored when returning to the original story or reloading the tab.
- Prompt and Aliases remain reachable at a 320px viewport, and malformed custom model IDs produce an inline error.
- All six models appear in the dropdown with chapter estimates. Cydonia displays $0.00310 per chapter and $0.30 input / $0.50 output per million tokens.
- Changes to the alias list invalidate the old result. Regenerated aliases and an applied draft survive navigation in the same tab.
- Invalid library JSON is rejected without replacing the current story. A 2.3 MB fixture of 110 turns with multi-byte text survived browser import, reload and ZIP export with every turn unchanged.
- With a simulated model response, a large story sends the selected route and at most 60 recent turns, displays the reply, and saves it. After reload the route remained selected and the API key field was empty.

## Cast and speaker checks

In an isolated browser library, added Iona alongside Mara, switched **Reply as**, and inspected **Prompt**. The preview included Iona's definitions and excluded Mara's. Simulated generation produced a turn labeled Iona. After selecting Mara, **Another take** still targeted Iona's card. Reload preserved the cast, attribution and selected speaker. Exported ZIP contained the cast and both takes. Checked that the speaker selector was visible at 320px. No inference request was billed for these checks.

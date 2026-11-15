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

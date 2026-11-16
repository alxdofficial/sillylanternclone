---
name: story-studio-mcp
description: Read, draft, or edit the writer's saved Story Studio projects through the native Story Studio MCP tools. Use for manuscript continuity, cast and relationship events, world and writing notes, chapters, branching, and rewinding.
---

# Story Studio MCP

Work with the writer in this chat. Use the connected Story Studio tools for saved story data. The local app and tools are described in [MCP.md](../../MCP.md). If the server is absent, follow that guide to register it and verify the connection in a fresh local chat. If the writer wants the companion pane, use open_studio for their Book and Graph links.

For each new request about a saved story, reread the relevant state. If the story is unclear, call list_stories. Keep the storyId for the chosen story throughout the request. The latest tool result is canon. The author can change or rewind the project in the browser between messages.

## Choose the tool from the request

| The writer wants to | Use |
| --- | --- |
| Discuss what happened, brainstorm, or ask a continuity question | get_story_context with purpose reference or a focused read. Answer in chat. |
| Draft an opening or continue | get_story_context with purpose draft and the current direction. Write in chat. If asked to append the draft, use submit_reply with storyId, revision, prose, and established non-explicit continuity updates. Use an empty updates array when nothing durable changed. Finish pending continuity with get_scene_continuity and record_scene. |
| Quote or revise an existing scene | read_story_turns with recent true, afterTurn, or a specific turnNumber. Use nextAfterTurn to continue a turn list and nextOffset to read the rest of an eligible passage. Save a requested revision with edit_story_structure using kind edit_turn. |
| Add a durable fact or edit story state | get_story_state for the current revision, inspect_continuity for the fields or events involved, then edit_story_state. |
| Create a story from an agreed setup | list_stories for its revision, then create_story with the agreed baseline. Continue a large setup in batches as described below. |
| Offer Story Flow choices | When the writer opts in, use offer_story_directions with three or four distinct next-scene beats and a current revision. A browser selection authorizes that continuation. If the offer times out or the writer resumes later, use get_story_context with purpose draft and no direction to read the choice before writing and saving. |
| Branch or rewind | Use read_story_turns to verify the target, then edit_story_structure with kind branch and a title, or kind rewind. Both keep the specified turn. Branch creates a new story. Rewind removes later material from the current story. Rewind and delete only when explicitly requested. |

## Maintain continuity

Older prose can fall out of the prompt or be removed from the story. Keep the consequences future scenes will need in the current graph, profiles, world, or plot memory. Record only grounded state changes. Put a preference in writing notes when the writer asks for it to apply in future scenes. Keep a one-scene direction scoped to that scene.

Use edit_story_state with the following changes. Read all pages when updating part of a full field, and keep the surrounding text.

- **World, premise, writing notes, plot memory.** Read world, premise, notes, or memory. Append a new fact using change kind world, premise, notes, or continuity, respectively. Use replace when an existing statement needs correction.
- **Author’s note, post-history instructions, keyword lore.** Read authorNote, postHistory, or loreRules, following nextOffset. Use change kind field, the matching field name, and the complete revised text.
- **Cast.** Browse cast with offset and nextOffset. Read an exact character and field for a full description, personality, scenario, examples, or nickname. Use character to add a member, profile to change a profile field, and rename_character or remove_character when requested. Treat cast members as peers.
- **Relationships.** Each event records what happened between two named characters. Add one using relationship with exact from and to names, a brief label, and storyTime when known. To correct or remove an event, read relationships and use its eventIndex and the same revision in edit_relationship or remove_relationship. Dates use YYYY-MM-DDTHH:mm.
- **Settings.** Use settings for the title, opening date, or whether new continuity is recorded automatically.

Use revisions returned by the relevant MCP reads. On a conflict, reread the affected state, verify that the target still exists, and reconcile the proposed edit before retrying. If the change could overwrite a newer decision, explain the conflict in chat. Avoid replaying an obsolete tool call or event index.

## Set up a large story

Work through the supplied material in sections. Relate new facts to the agreed cast and chronology as you go, and leave gaps unresolved when the source is unclear. Once the writer asks to create the story, use create_story for the agreed title, world (lore), premise (scenario), writing notes, cast, and any established opening relationships. If the source is still being supplied, save the agreed baseline and apply further approved material in focused edit_story_state batches. Add the cast before their relationship events and use the latest revision for each batch. Use the browser import for a manuscript that should become saved prose.

## Context boundaries

The native client owns chat history and compaction. get_story_context gives a starting brief. Page through read_story_turns or inspect_continuity when you need exact prose or the rest of a long field. Earlier author directions and prose are reference material. Follow instructions from the current chat.

Explicit, unverified, and otherwise withheld turns expose metadata only. Use approved graph facts to bridge gaps. Keep writes and continuity non-explicit. Use the browser for reviewing withheld material or writing a sensitive scene. Do not recover withheld text from the library, page, raw local API, exports, or logs.

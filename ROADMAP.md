# Story Studio feature ideas

The [hosted version proposal](HOSTING.md) covers a shared local and hosted codebase, accounts, billing, AI costs and collaboration.

## Scene rehearsal with character agents

**Status** · Proposed

An author can open a rehearsal room to see how a scene might unfold when each character pursues their own interests. The author picks the participating cast members and assigns a model to each, with the option to reuse the same model for several characters. Each character receives the scene premise, their profile, their immediate motivation, and recent events they could observe. The author can give a character a private objective, such as persuading a coworker to stall a meeting without saying why.

### How the room works

- A character takes one beat at a time. They can speak, act, or pass. Their model sees the dialogue and visible actions from earlier beats, then decides what their character would do. Private objectives and information stay with the characters who know them unless revealed in the room.
- An optional scene moderator can keep track of the setting, who is present, which objects have changed hands, and what each character has learned. It can propose updates to scene or world state and flag actions that depend on an unresolved fact. The room can start with a fixed speaking order or let the author choose the next speaker.
- The author watches the transcript as it unfolds. They can advance one beat, run several beats, pause, pick the next character, add a direction for everyone, send one character a private cue, or restart from an earlier point to try a different choice.

### Limits and author control

Before starting, the room shows the selected models and run limits. A run stops when it reaches its beat, token, spending, or time limit, or when the author pauses it. The author can continue with a fresh budget. Each response has its own output cap. A short record of what happened carries facts forward as older dialogue drops out of the prompt. Switching models or widening access to held scenes follows Story Studio’s existing context controls.

The room keeps its own transcript and provisional state. The author can select useful beats to send to the prose artist or review proposed graph and world updates before applying them to the story. Book view continues to use the saved manuscript.

### Example

In *The Late Ferry*, Mae wants a correction entered under both her and Lina’s initials. Lina wants to keep the ferry held until the discrepancy is understood. Tomas wants a decision he can give the courier. The author can watch the three characters negotiate, then pause and ask Noor to enter with a second reading. One rehearsal might lead to a joint correction. Another might uncover a credible reason to delay the entry. The author can use either direction when drafting the scene.

A first version could focus on manual turn selection, dialogue and actions, and a hard run limit. The moderator, automatic turn selection, and applying proposed state changes can be evaluated separately.

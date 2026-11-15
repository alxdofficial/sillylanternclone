import { starterStoryId } from '../public/library.js';

// This story was authored and exported through Story Studio. See TESTING.md.
const starter = {
  "title": "The Late Ferry",
  "character": "Lina, 39, dispatches the night ferry and knows the regulars by their orders at the tea urn. A fall ended her years on deck, but she still keeps an old pair of deck gloves behind the ticket glass. Tonight she must keep passengers informed while someone checks a beacon flashing the wrong signal.",
  "persona": "",
  "lore": "Bellwether, October 1998. The last ferry carries night workers from a low terminal across a cold channel to Alder Island. The radio at the ticket window reaches the ferry, the workshop and the weather desk. The shore beacon must show a steady single flash before the skipper can sail. Behind the staff door, the dock gate has a motor and a manual key, but the key will bind unless the motor circuit is isolated. Dispatch keeps a clothbound incident book; the weather desk keeps duplicate observations. There are no smartphones. A rain squall is ending as the night begins.\nTurn 2: The dispatch board in Bellwether terminal fails at 23:40, forcing staff to rely on radio and manual procedures to hold the ferry.\nTurn 4: The dock gate motor breaker is located at the north panel, third from the left. Isolating the motor before using the manual key prevents the key from binding.\nTurn 4: The eastern shore beacon is showing an inconsistent flash pattern: two flashes, then dark, which violates the steady single flash required for ferry departure.",
  "notes": "A quiet harbor mystery told in close third person, past tense. Keep dialogue natural and the physical details specific. Let the crew establish facts through ordinary work rather than explaining the mystery in advance.",
  "storyStartAt": "1998-10-24T23:40",
  "storyStartSource": "author",
  "messages": [
    {
      "role": "user",
      "content": "Open at 23:40. When the departure board dies, Lina asks Sam to check the gate, and asks Mae to relay Tomas’s radio messages to the people in the waiting room. Write a short opening scene in about 150 words. Hold the ferry at the dock.",
      "contentSensitivity": "reviewed-safe",
      "turnNumber": 1,
      "storyTime": "1998-10-24T23:40"
    },
    {
      "role": "assistant",
      "content": "The dispatch board flickered and died at 23:40. Lina Park tapped her pencil against the red dispatch drawer. \"Sam, leave the window. Check the gate relay. Take a light.\"\n\nSam nodded, their pencil clicking against the counter as they rounded the corner. The waiting room filled with the murmur of damp shoulders and stolen newspapers.\n\n\"Mae,\" Lina said, watching the lights cross the harbor. \"Tell Tomas we're holding. Also tell people... tell them weather's holding too. We need five minutes.\"\n\nFrom the ferry's bridge, Tomas keyed his radio. \"Bellwether Control, we are ready on board. Request considerable delay and passage permission.\"\n\nLina replied, but kept her eyes on the empty departure board. \"Understood, Tomas. One can't leave without dispatch.\"\n\nMae unsnapped her radio from her bag and walked toward the waiting room, her boots quiet on the damp concrete. \"Is everyone comfortable?\" Each person looked up from their reading or drowsing. \"We might be a few minutes late.\"\n\nOutside, rain beat against the windows as Lina's pencil tapped, the dispatch book remained closed, and everyone waited for light or word.",
      "speakerId": "story-studio:narrator",
      "speakerName": "Narrator",
      "contentSensitivity": "safe",
      "storyTime": "1998-10-24T23:40",
      "turnNumber": 2
    },
    {
      "role": "user",
      "content": "At 23:53, follow Sam to the staff door. Show Sam asking Ellis over channel three which breaker to open, Ellis warning them that the key will bind with the motor energized, and Sam reporting the reopened gate to Tomas. Noor then radios Mae that the east beacon is flashing twice. Keep the ferry moored, about 170 words.",
      "contentSensitivity": "reviewed-safe",
      "turnNumber": 3,
      "storyTime": "1998-10-24T23:53"
    },
    {
      "role": "assistant",
      "content": "Sam found the red dispatch drawer unlocked, the manual key smooth and cold. At the staff door, they keyed their radio. \"Harbor Works, this is terminal. Where's the breaker for the dock gate motor?\"\n\nEllis's voice crackled with static. \"North panel, third from the left. And whatever you do, pull the breaker before you touch that key. Motor half-energized'll seize the lock faster than you can say fog bank.\"\n\nSam pulled the breaker. \"Copy. Got it.\" The heavy key turned smoothly now, the motor silent in the rain.\n\nMae leaned into the doorway. \"Radio says we have to hold.\"\n\nSam nodded, finishing with the lock. \"Tell Tomas the gate's open again.\" They returned to the radio. \"Skipper, this is Dispatch. The gate's operational. But we might have a problem with the beacon.\"\n\nTomas's voice came clear. \"Say again about the beacon.\"\n\n\"Noor's reporting an inconsistent flash pattern. Two flashes, then dark.\"\n\nThe tower Ruger boomed. \"Pardon, Dispatch. We're holding until we verify that beacon. Harbor regulations, practically letter of the law.\"\n\nNo one moved from the dock.",
      "speakerId": "story-studio:narrator",
      "speakerName": "Narrator",
      "contentSensitivity": "safe",
      "storyTime": "1998-10-24T23:53",
      "turnNumber": 4
    },
    {
      "role": "user",
      "content": "At 00:07 on October 25, write Mae comparing the dispatch log with the beacon report Noor reads over the radio. Let them discover that the page in the dispatch book was removed after the earlier fault. Give Lina a concrete decision about how to inform the passengers. Keep this to about 170 words and leave the ferry moored.",
      "contentSensitivity": "reviewed-safe",
      "turnNumber": 5,
      "storyTime": "1998-10-25T00:07"
    },
    {
      "role": "assistant",
      "content": "Mae slipped behind the ticket window, her eyes darting between the dispatch log and the radio where Noor's voice crackled again. \"Two flashes, clear as anything. Then dark. Again and again.\"\n\nMae flipped open the bound dispatch book. Her fingers traced the entries - missing the previous month's page. Sam was right the fuse had gone, but there was more than that.\n\n\"There's a page missing from August.\" Mae pointed. \"Right where someone had the gate reopened.\"\n\nLina came over, her expression hardening. \"What isn't in the book stays out in the open. Mae, ask everyone to listen up. Three minutes to explain what we know, then I want everyone off that ferry until we sort this properly. Weather's clear enough from this broadcast loop. No one needs to be taking risks tonight because we're missing something that's already marked in Noor's ledger.\"\n\nThe passengers looked up from their wet shoulders, sensing the change in tone. Mae took a breath and walked toward the waiting room. \"Could I have your attention, please?\"",
      "speakerId": "story-studio:narrator",
      "speakerName": "Narrator",
      "contentSensitivity": "safe",
      "storyTime": "1998-10-25T00:07",
      "turnNumber": 6,
      "alternatives": [
        "Mae slipped behind the ticket window, her eyes darting between the dispatch log and the radio where Noor's voice crackled again. \"Two flashes, clear as anything. Then dark. Again and again.\"\n\nMae flipped open the bound dispatch book. Her fingers traced the entries - missing the previous month's page. Sam was right the fuse had gone, but there was more than that.\n\n\"There's a page missing from August.\" Mae pointed. \"Right where someone had the gate reopened.\"\n\nLina came over, her expression hardening. \"What isn't in the book stays out in the open. Mae, ask everyone to listen up. Three minutes to explain what we know, then I want everyone off that ferry until we sort this properly. Weather's clear enough from this broadcast loop. No one needs to be taking risks tonight because we're missing something that's already marked in Noor's ledger.\"\n\nThe passengers looked up from their wet shoulders, sensing the change in tone. Mae took a breath and walked toward the waiting room. \"Could I have your attention, please?\"",
        "Mae watched the clock tick to 00:07 as she paged through the clothbound incident book, her fingers tracing the neat columns. \"Lina, the dispatch log shows the gate fault at 23:40, but—the page after that was removed.\"\n\nIn the small office, Lina's head snapped up. \"Are you certain?\"\n\nMae nodded. \"I've seen the emergency logs a hundred times. Page 257 is missing entirely. Noor's reporting the beacon fault at 23:53.\" She radioed up to the weather desk. \"Noor, can you confirm our observation timestamp?\" She listened intently. \"Understood. Thank you.\"\n\nLina closed the book with a soft thud. \"Preserve the radio log, Mae. Keep a new handwritten record beside it.\"\n\nLina walked through to the waiting room. \"Attention, everyone. There's been an unusual overnight equipment failure. For safety, we're holding until the situation is resolved. We don't have an estimated time yet, but there'll be refreshments available shortly. Please remain in the waiting area.\" She returned to dispatch, pulled out the radio, and called the ferry."
      ],
      "alternativeSensitivities": [
        "safe",
        "safe"
      ],
      "selectedAlternative": 0,
      "graphSuggestions": [
        {
          "kind": "world",
          "note": "The clothbound dispatch book is missing a page from August, exactly where a prior gate reopening was recorded."
        }
      ]
    }
  ],
  "graphHistory": [
    {
      "turn": 0,
      "cast": [
        {
          "id": "primary",
          "name": "Lina Park",
          "nickname": "Lin, Dispatch",
          "description": "Lina, 39, dispatches the night ferry and knows the regulars by their orders at the tea urn. A fall ended her years on deck, but she still keeps an old pair of deck gloves behind the ticket glass. Tonight she must keep passengers informed while someone checks a beacon flashing the wrong signal.",
          "personality": "Dry, practical and careful about promising a departure.",
          "scenario": "She runs dispatch and coordinates the shore crew.",
          "examples": "“Give me the part you saw with your own eyes.”"
        },
        {
          "id": "6b0236e9-239b-45d7-a718-f675fbac304f",
          "name": "Tomas Reyes",
          "nickname": "Tom, Skipper",
          "description": "Tomas, 41, captains the last ferry. He grew up mending nets and can tell a change in the tide from the slap of water under the pier. He was late to act on a warning two winters ago, so he reads every radio clearance back verbatim. He keeps a spare wool hat in the wheelhouse for anyone who arrives wet.",
          "personality": "Methodical, stubborn under pressure, generous in quiet ways.",
          "scenario": "He has passengers waiting and needs a verified signal before sailing.",
          "examples": "“Say it again so I can read it back.”"
        },
        {
          "id": "b3b30ed5-3615-4aca-b9e6-ae2ab531a763",
          "name": "Mae Chen",
          "nickname": "Mae from the bakery",
          "description": "Mae, 35, takes the final crossing home after closing the bakery. She brings unsold buns in folded paper and knows who comes off the island for night shifts. Seventeen years after volunteering at the lifeboat station, she still waits for a break in radio chatter before pressing the talk button.",
          "personality": "Observant and dry, with an unshowy knack for calming a room.",
          "scenario": "She is waiting to travel and can relay messages from the ticket window.",
          "examples": "“Tell me what they can do while they wait.”"
        },
        {
          "id": "370a9bff-f910-4b1f-b2ab-057f7c7b7385",
          "name": "Sam Bell",
          "nickname": "Sam at the desk",
          "description": "Sam, 30, works the ticket window while studying electrical maintenance. They learned to follow wiring diagrams from a parent who repaired jukeboxes. A flashlight, a blunt pencil and a folded resignation letter live in the same shirt pocket. They know the ferry terminal better than the officials who sign its maintenance forms.",
          "personality": "Curious and practical, inclined to volunteer for work beyond their title.",
          "scenario": "They can trace the gate wiring and compare the dispatch entries.",
          "examples": "“I can tell you which fuse went.”"
        },
        {
          "id": "4daceab0-3b86-4021-a10c-d6e606fe81d2",
          "name": "Noor Ahmad",
          "nickname": "Weather desk",
          "description": "Noor, 27, keeps overnight weather watch above East Pier. They have been logging a double flash and are tired of having their maintenance reports classed as a fog effect. The original readings are in a pencil ledger, with a duplicate page made before every call to Harbor Works.",
          "personality": "Precise, patient with people and impatient with vague findings.",
          "scenario": "They can verify the beacon from shore and check the original readings.",
          "examples": "“Two short flashes, then dark. I counted four cycles.”"
        },
        {
          "id": "f2206e3c-59fc-4218-8a30-f09f3495e6a6",
          "name": "Ellis Gray",
          "nickname": "Harbor Works",
          "description": "Ellis, 58, looks after the dock gate and the old beacon relay. The original circuit drawings are in a tobacco tin in his workshop. Years ago he installed a temporary relay and was embarrassed when the replacement order went missing. He fixes other people’s tools while waiting for a kettle to boil.",
          "personality": "Reserved and generous with tools. Direct about anything dangerous.",
          "scenario": "He knows which breaker isolates the dock gate and which report describes the old relay.",
          "examples": "“Let’s see which circuit someone actually touched.”"
        }
      ],
      "lore": "Bellwether, October 1998. The last ferry carries night workers from a low terminal across a cold channel to Alder Island. The radio at the ticket window reaches the ferry, the workshop and the weather desk. The shore beacon must show a steady single flash before the skipper can sail. Behind the staff door, the dock gate has a motor and a manual key, but the key will bind unless the motor circuit is isolated. Dispatch keeps a clothbound incident book; the weather desk keeps duplicate observations. There are no smartphones. A rain squall is ending as the night begins.",
      "continuity": ""
    },
    {
      "turn": 2,
      "lore": "Bellwether, October 1998. The last ferry carries night workers from a low terminal across a cold channel to Alder Island. The radio at the ticket window reaches the ferry, the workshop and the weather desk. The shore beacon must show a steady single flash before the skipper can sail. Behind the staff door, the dock gate has a motor and a manual key, but the key will bind unless the motor circuit is isolated. Dispatch keeps a clothbound incident book; the weather desk keeps duplicate observations. There are no smartphones. A rain squall is ending as the night begins.\nTurn 2: The dispatch board in Bellwether terminal fails at 23:40, forcing staff to rely on radio and manual procedures to hold the ferry."
    },
    {
      "turn": 4,
      "lore": "Bellwether, October 1998. The last ferry carries night workers from a low terminal across a cold channel to Alder Island. The radio at the ticket window reaches the ferry, the workshop and the weather desk. The shore beacon must show a steady single flash before the skipper can sail. Behind the staff door, the dock gate has a motor and a manual key, but the key will bind unless the motor circuit is isolated. Dispatch keeps a clothbound incident book; the weather desk keeps duplicate observations. There are no smartphones. A rain squall is ending as the night begins.\nTurn 2: The dispatch board in Bellwether terminal fails at 23:40, forcing staff to rely on radio and manual procedures to hold the ferry.\nTurn 4: The dock gate motor breaker is located at the north panel, third from the left. Isolating the motor before using the manual key prevents the key from binding.\nTurn 4: The eastern shore beacon is showing an inconsistent flash pattern: two flashes, then dark, which violates the steady single flash required for ferry departure."
    }
  ],
  "characterName": "Lina Park",
  "characterNickname": "Lin, Dispatch",
  "personality": "Dry, practical and careful about promising a departure.",
  "scenario": "She runs dispatch and coordinates the shore crew.",
  "examples": "“Give me the part you saw with your own eyes.”",
  "authorNote": "",
  "postHistory": "",
  "loreRules": "beacon, east pier | Two flashes followed by darkness indicate a relay fault; Noor keeps a duplicate record at the weather desk.\nradio, channel three | The terminal, ferry and weather desk share channel three.\nkey, gate | The manual key is in the red dispatch drawer. Isolate the gate motor before using it.",
  "continuity": "",
  "cast": [
    {
      "id": "6b0236e9-239b-45d7-a718-f675fbac304f",
      "name": "Tomas Reyes",
      "nickname": "Tom, Skipper",
      "description": "Tomas, 41, captains the last ferry. He grew up mending nets and can tell a change in the tide from the slap of water under the pier. He was late to act on a warning two winters ago, so he reads every radio clearance back verbatim. He keeps a spare wool hat in the wheelhouse for anyone who arrives wet.",
      "personality": "Methodical, stubborn under pressure, generous in quiet ways.",
      "scenario": "He has passengers waiting and needs a verified signal before sailing.",
      "examples": "“Say it again so I can read it back.”"
    },
    {
      "id": "b3b30ed5-3615-4aca-b9e6-ae2ab531a763",
      "name": "Mae Chen",
      "nickname": "Mae from the bakery",
      "description": "Mae, 35, takes the final crossing home after closing the bakery. She brings unsold buns in folded paper and knows who comes off the island for night shifts. Seventeen years after volunteering at the lifeboat station, she still waits for a break in radio chatter before pressing the talk button.",
      "personality": "Observant and dry, with an unshowy knack for calming a room.",
      "scenario": "She is waiting to travel and can relay messages from the ticket window.",
      "examples": "“Tell me what they can do while they wait.”"
    },
    {
      "id": "370a9bff-f910-4b1f-b2ab-057f7c7b7385",
      "name": "Sam Bell",
      "nickname": "Sam at the desk",
      "description": "Sam, 30, works the ticket window while studying electrical maintenance. They learned to follow wiring diagrams from a parent who repaired jukeboxes. A flashlight, a blunt pencil and a folded resignation letter live in the same shirt pocket. They know the ferry terminal better than the officials who sign its maintenance forms.",
      "personality": "Curious and practical, inclined to volunteer for work beyond their title.",
      "scenario": "They can trace the gate wiring and compare the dispatch entries.",
      "examples": "“I can tell you which fuse went.”"
    },
    {
      "id": "4daceab0-3b86-4021-a10c-d6e606fe81d2",
      "name": "Noor Ahmad",
      "nickname": "Weather desk",
      "description": "Noor, 27, keeps overnight weather watch above East Pier. They have been logging a double flash and are tired of having their maintenance reports classed as a fog effect. The original readings are in a pencil ledger, with a duplicate page made before every call to Harbor Works.",
      "personality": "Precise, patient with people and impatient with vague findings.",
      "scenario": "They can verify the beacon from shore and check the original readings.",
      "examples": "“Two short flashes, then dark. I counted four cycles.”"
    },
    {
      "id": "f2206e3c-59fc-4218-8a30-f09f3495e6a6",
      "name": "Ellis Gray",
      "nickname": "Harbor Works",
      "description": "Ellis, 58, looks after the dock gate and the old beacon relay. The original circuit drawings are in a tobacco tin in his workshop. Years ago he installed a temporary relay and was embarrassed when the replacement order went missing. He fixes other people’s tools while waiting for a kettle to boil.",
      "personality": "Reserved and generous with tools. Direct about anything dangerous.",
      "scenario": "He knows which breaker isolates the dock gate and which report describes the old relay.",
      "examples": "“Let’s see which circuit someone actually touched.”"
    }
  ],
  "relationships": [
    {
      "from": "370a9bff-f910-4b1f-b2ab-057f7c7b7385",
      "to": "6b0236e9-239b-45d7-a718-f675fbac304f",
      "label": "reported the dock gate reopened",
      "turn": 4,
      "storyTime": "1998-10-24T23:53"
    },
    {
      "from": "4daceab0-3b86-4021-a10c-d6e606fe81d2",
      "to": "b3b30ed5-3615-4aca-b9e6-ae2ab531a763",
      "label": "reported an inconsistent east beacon flash pattern",
      "turn": 4,
      "storyTime": "1998-10-24T23:53"
    }
  ],
  "graphUpdates": true,
  "nextTurn": 7
};

export function createStarterStory() {
  return {id:starterStoryId,...structuredClone(starter)};
}

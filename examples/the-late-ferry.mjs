import { starterStoryId } from '../public/library.js';

// Authored and exported through Story Studio. See TESTING.md.
const starter = {
  "title": "The Late Ferry",
  "lore": "Bellwether is a small working harbor with a late ferry crossing to Alder Island. The terminal is a modest, practical building where passengers wait on benches after the last squall has moved through. The harbor runs on paper: clothbound incident books kept at dispatch, duplicate weather readings preserved in grease pencil, radio traffic, and payphones. The east beacon is supposed to flash once at regular intervals to mark the channel; tonight it flashes twice and goes dark. A rain squall has just passed, and the cause of the beacon fault is still unknown. Departure is tightly controlled: the skipper needs clearance from dispatch, and no ferry leaves the dock without it. The night is quiet, wet, and ordinary in every way except for the details that do not line up.\nTurn 4: The gate motor is fed from the north panel; the breaker for it is third from the left, and the gate can be cranked open by hand once the motor is isolated.\nTurn 6: At 00:07 the weather desk's duplicate record put the beacon irregularity at 23:41, lasting eighteen seconds; station pressure 1012 mb, wind southwest at eight knots.",
  "notes": "Keep close third person, past tense, grounded technical detail, and quiet suspense. The opening clue should stay small: a beacon fault, a gap in the paper log, nothing solved on the first night. The ferry must remain moored for now. Treat harbor work as procedural and specific — clearance, radio checks, signboards, gate circuits, weather duplicates. Do not name or hint at a culprit. Avoid explicit content.",
  "relationships": [
    {
      "from": "primary",
      "to": "c9c204e5-f2c4-44e0-b1aa-34b0636b7adc",
      "label": "Lina coordinates departure clearance with Tomas, and he will not move the ferry without her go-ahead.",
      "turn": 0,
      "storyTime": "1998-10-24T23:40"
    },
    {
      "from": "primary",
      "to": "cc3407eb-83e6-4f96-a36b-ee08bccfd517",
      "label": "Lina supervises Mae on the night shift and relies on her to keep the terminal calm.",
      "turn": 0,
      "storyTime": "1998-10-24T23:40"
    },
    {
      "from": "1b92d34f-1884-4031-ac36-7577103bb86c",
      "to": "c87bf87c-691c-492c-aaf7-adc8adf164e6",
      "label": "Ellis mentors Sam in electrical maintenance and trained him to read the gate circuit.",
      "turn": 0,
      "storyTime": "1998-10-24T23:40"
    },
    {
      "from": "cc3407eb-83e6-4f96-a36b-ee08bccfd517",
      "to": "2ce7d2c7-5995-4b5b-9438-8abaa654245e",
      "label": "Mae and Noor exchange observations when the harbor turns foul, comparing what each of them has noticed.",
      "turn": 0,
      "storyTime": "1998-10-24T23:40"
    },
    {
      "from": "primary",
      "to": "c87bf87c-691c-492c-aaf7-adc8adf164e6",
      "label": "Lina sent Sam to check the gate circuit, trusting them with the fault rather than just the ticket window.",
      "turn": 2,
      "storyTime": "1998-10-24T23:41"
    },
    {
      "from": "primary",
      "to": "cc3407eb-83e6-4f96-a36b-ee08bccfd517",
      "label": "Lina assigned Mae to keep waiting passengers informed during the delay.",
      "turn": 2,
      "storyTime": "1998-10-24T23:41"
    },
    {
      "from": "c9c204e5-f2c4-44e0-b1aa-34b0636b7adc",
      "to": "primary",
      "label": "Tomas radioed from the still-moored ferry asking about the schedule and is holding for Lina's clearance.",
      "turn": 2,
      "storyTime": "1998-10-24T23:41"
    },
    {
      "from": "1b92d34f-1884-4031-ac36-7577103bb86c",
      "to": "c87bf87c-691c-492c-aaf7-adc8adf164e6",
      "label": "Ellis talked Sam through the north panel breaker over the radio, relying on the training he had given them.",
      "turn": 4,
      "storyTime": "1998-10-24T23:53"
    }
  ],
  "storyStartAt": "1998-10-24T23:40",
  "storyStartSource": "author",
  "cast": [
    {
      "id": "primary",
      "name": "Lina Park",
      "nickname": "",
      "description": "A former deckhand now dispatching the night ferry. She has to explain the delay to waiting passengers and to the skipper, and she feels the weight of every clearance she grants. She works from the dispatch desk, tracks the radio, and keeps the incident book within reach. Her stake is her authority on the night watch and the harbor's trust in her judgment.",
      "personality": "",
      "scenario": "It is 23:40 on 1998-10-24. The ferry is tied up at Bellwether and the passengers are waiting in the terminal. Dispatch expects the east beacon to flash once at regular intervals, but it flashes twice and goes dark. Lina Park must explain the delay while the harbor's paper trail — the clothbound incident book and the duplicated weather readings — begins to show a gap. Noor Haddad's duplicate entries and the missing incident-book page connect through the timing knot: the beacon's logged failure window is narrow, while the missing page covers a wider stretch. The ferry stays moored while the cast discovers the missing page through their ordinary jobs. The cause remains unknown and no culprit is identified.",
      "examples": ""
    },
    {
      "id": "c87bf87c-691c-492c-aaf7-adc8adf164e6",
      "name": "Sam Bell",
      "nickname": "",
      "description": "Works the ticket window and studies electrical maintenance on their own time. They carry a pencil and a torch and want to be taken seriously as a technician rather than a ticket clerk. They notice hardware details others miss and are eager to prove the training Ellis gave them was worth giving.",
      "personality": "",
      "scenario": "",
      "examples": ""
    },
    {
      "id": "c9c204e5-f2c4-44e0-b1aa-34b0636b7adc",
      "name": "Tomas Reyes",
      "nickname": "",
      "description": "The ferry skipper, cautious since a close call in fog. He will not move the ferry without Lina's clearance and prefers to wait out uncertain conditions. He is steady with passengers but quietly watches the channel and the beacon.",
      "personality": "",
      "scenario": "",
      "examples": ""
    },
    {
      "id": "cc3407eb-83e6-4f96-a36b-ee08bccfd517",
      "name": "Mae Chen",
      "nickname": "",
      "description": "A junior clerk with spare signboards at hand. She can reassure passengers and keep the terminal calm while the ferry is delayed, and she is learning how the harbor's paperwork actually moves through the night. Her stake is being trusted with more responsibility.\nTurn 6: Checking the incident book to draft the passenger announcement, she noticed the struck-through entries and pressed pen marks, and now wants to find who owns the heavy pressing pen.",
      "personality": "",
      "scenario": "",
      "examples": ""
    },
    {
      "id": "2ce7d2c7-5995-4b5b-9438-8abaa654245e",
      "name": "Noor Haddad",
      "nickname": "",
      "description": "Keeps the weather station and makes duplicate entries in grease pencil. She logs readings with care and treats the duplicates as a safeguard, not a formality. Her observations are precise and she notices when a record does not match what she remembers writing.\nTurn 6: Read the weather desk's duplicate record over the radio, giving the exact beacon irregularity time and duration.",
      "personality": "",
      "scenario": "",
      "examples": ""
    },
    {
      "id": "1b92d34f-1884-4031-ac36-7577103bb86c",
      "name": "Ellis Ward",
      "nickname": "",
      "description": "The blunt harbor electrician who trained Sam to read the gate circuit. He is practical, impatient with unclear thinking, and respected for knowing the harbor's wiring better than anyone. He speaks plainly and expects others to keep up.",
      "personality": "",
      "scenario": "",
      "examples": ""
    }
  ],
  "authorNote": "",
  "postHistory": "",
  "loreRules": "",
  "continuity": "Turn 2: At 23:41 the departure board in the terminal flickered and died, and the east beacon flashed twice then went dark.\nTurn 4: Sam isolated the gate motor's breaker, opened the gate with the manual key, and radioed Tomas that the gate is clear; the ferry remains moored pending Lina's clearance and a working east beacon.\nTurn 4: Noor reported the east beacon's two-flash pattern over the radio, and Mae relayed it to the waiting passengers.\nTurn 6: The dispatch incident book has a clean gap between 23:30 and 23:45: several lines neatly struck through with a felt pen, exactly where a beacon fault entry should have been. The page is not torn, just crossed out.\nTurn 6: Lina told the waiting passengers only what she could verify: the east beacon had a brief glitch, the ferry departs once the beacon is confirmed working, and the payphones are available for calls home. The ferry remains firmly moored.",
  "messages": [
    {
      "role": "user",
      "content": "Open at 23:40 on October 24 in close third person from Lina. When the departure board dies, have her send Sam to check the gate and ask Mae to keep the passengers informed. Tomas calls from the still-moored ferry, ready to leave as soon as she clears him. Let Lina look up and see the east beacon flash twice. About 170 words.",
      "contentSensitivity": "safe",
      "turnNumber": 1,
      "storyTime": "1998-10-24T23:41"
    },
    {
      "role": "assistant",
      "content": "Lina Park watched the clock on her desk tick past 23:40, her fingers steady on the radio microphone. The dispatch office was quiet except for the hum of the radio and the scribble of paperwork. From her elevated desk, she could see the dark water of the harbor through the rain-streaked window and the regular flash of the east beacon marking the channel—until at 23:41, it flashed twice. Then went dark.\n\nThe departure board on the wall flickered and died.\n\nShe cursed under her breath, reaching for the phone. \"Sam, can you check the gate circuit? The board's gone dark.\" Sam Bell, working the ticket counter, nodded and disappeared moments later with a pencil and torch from their pocket. Lina punched the intercom. \"Mae, keep passengers informed. We've got a minor system issue.\" Mae Chen, junior clerk and resident calm, gave a thumbs-up from the terminal before addressing the waiting passengers.\n\nHer radio crackled. Tomas Reyes, the ferry skipper. \"Dispatch, are we still on schedule?\"\n\n\"Not yet, Skipper.\" Lina found herself talking to the dead microphone while her eyes remained fixed on the harbor where one weak afterimage lingered where the beacon had gone out.",
      "speakerId": "story-studio:narrator",
      "speakerName": "Narrator",
      "contentSensitivity": "reviewed-safe",
      "storyTime": "1998-10-24T23:41",
      "turnNumber": 2,
      "appliedGraphUpdates": [
        {
          "kind": "fact",
          "note": "At 23:41 the departure board in the terminal flickered and died, and the east beacon flashed twice then went dark."
        },
        {
          "kind": "relationship",
          "from": "Lina Park",
          "to": "Sam Bell",
          "label": "Lina sent Sam to check the gate circuit, trusting them with the fault rather than just the ticket window.",
          "storyTime": "1998-10-24T23:41"
        },
        {
          "kind": "relationship",
          "from": "Lina Park",
          "to": "Mae Chen",
          "label": "Lina assigned Mae to keep waiting passengers informed during the delay.",
          "storyTime": "1998-10-24T23:41"
        },
        {
          "kind": "relationship",
          "from": "Tomas Reyes",
          "to": "Lina Park",
          "label": "Tomas radioed from the still-moored ferry asking about the schedule and is holding for Lina's clearance.",
          "storyTime": "1998-10-24T23:41"
        }
      ]
    },
    {
      "role": "user",
      "content": "At 23:53, follow Sam to the service door. The gate’s motor is still energized and the manual key won’t turn safely. Ellis explains over the radio that the breaker is third from the left in the north panel. Sam isolates the motor, uses the key and tells Tomas the gate is clear. Noor radios Mae the exact two-flash pattern. The reopened gate does not clear the ferry to sail. About 175 words.",
      "contentSensitivity": "safe",
      "turnNumber": 3,
      "storyTime": "1998-10-24T23:53"
    },
    {
      "role": "assistant",
      "content": "At 23:53, Sam Bell pushed through the service door, a sweep of rain already soaking their jacket. The gate motor hummed, energized, a dangerous situation that explained why the manual key refused to turn in its lock.\n\nSam pulled the pencil and torch from their pocket, turning the beam on the panel. Without hesitation, they spoke into their radio. \"Um, Ellis? Can anyone hear me?\"\n\nA moment later, Ellis Ward's voice crackled through. \"What now, kid?\"\n\n\"The gate motor's live. Key won't turn.\"\n\n\"Third breaker from the left in the north panel,\" Ellis snapped. \"You gonna stand there all night?\"\n\nSam found the correct breaker and flicked it off. The motor fell silent, and this time, the key turned smoothly in the lock. They manually cranked the gate wide open, then keyed the radio to inform Tomas. \"The gate's clear, Skipper.\"\n\nFrom inside, Noor Haddad's voice came through to Mae. \"Two flashes, then dark again. Did anybody else see that?\"\n\nMae nodded, conveying the message to waiting passengers, but the information did nothing to change Lina's stance on the ferry's departure. The ferry still wasn't going anywhere without her official clearance, for which the east beacon needed to be working correctly.",
      "speakerId": "story-studio:narrator",
      "speakerName": "Narrator",
      "contentSensitivity": "reviewed-safe",
      "storyTime": "1998-10-24T23:53",
      "turnNumber": 4,
      "appliedGraphUpdates": [
        {
          "kind": "world",
          "note": "The gate motor is fed from the north panel; the breaker for it is third from the left, and the gate can be cranked open by hand once the motor is isolated."
        },
        {
          "kind": "fact",
          "note": "Sam isolated the gate motor's breaker, opened the gate with the manual key, and radioed Tomas that the gate is clear; the ferry remains moored pending Lina's clearance and a working east beacon."
        },
        {
          "kind": "fact",
          "note": "Noor reported the east beacon's two-flash pattern over the radio, and Mae relayed it to the waiting passengers."
        },
        {
          "kind": "relationship",
          "from": "Ellis Ward",
          "to": "Sam Bell",
          "label": "Ellis talked Sam through the north panel breaker over the radio, relying on the training he had given them.",
          "storyTime": "1998-10-24T23:53"
        }
      ]
    },
    {
      "role": "user",
      "content": "At 00:07 on October 25, follow Mae as Noor reads the weather desk’s duplicate record over the radio. Mae finds a clean gap in the dispatch incident book exactly where a similar beacon fault should have been logged. The gate is open, but the ferry is still firmly moored. Lina decides to tell the passengers what she can verify and offer them a way to call home. End on one concrete clue that someone could investigate next. Keep the culprit and cause unresolved. About 185 words.",
      "contentSensitivity": "safe",
      "turnNumber": 5,
      "storyTime": "1998-10-25T00:07"
    },
    {
      "role": "assistant",
      "content": "At 00:07, Mae Chen listened as Noor Haddad read the weather desk's duplicate record over the radio. The station pressure was 1012 mb, the wind southwest at eight knots—routine until Noor's voice tightened.\n\n\"...the time of this beacon irregularity,\" Noor said over the radio, \"was 23:41, lasting exactly eighteen seconds before normal operation resumed.\"\n\nMae's eyes flicked to the dispatch incident book lying open on Lina's desk. She had been checking its entries to compose the passenger announcement, but now her breath caught. Between 23:30 and 23:45, several lines had been neatly struck through with a felt pen, leaving a clean gap where the beacon fault should have been logged. Her fingers found the edge of the page. The lines had been struck hard enough to leave a ridge in the paper.\n\nThe radio hissed again, this time from the ferry. \"Still holding, Dispatch,\" Tomas said, his voice steady but with an edge of impatience.\n\nLina stood, waiting for the room to quiet. \"We believe the east beacon experienced a brief glitch earlier. The ferry will depart as soon as we confirm it's working properly,\" she announced. \"There are payphones over there if anyone needs to make a call.\"\n\nMae slipped a finger between the pages. The ink had dried, but the impression carried through to the sheet underneath. A note or initials might still be legible there.",
      "speakerId": "story-studio:narrator",
      "speakerName": "Narrator",
      "contentSensitivity": "reviewed-safe",
      "storyTime": "1998-10-25T00:07",
      "turnNumber": 6,
      "appliedGraphUpdates": [
        {
          "kind": "world",
          "note": "At 00:07 the weather desk's duplicate record put the beacon irregularity at 23:41, lasting eighteen seconds; station pressure 1012 mb, wind southwest at eight knots."
        },
        {
          "kind": "fact",
          "note": "The dispatch incident book has a clean gap between 23:30 and 23:45: several lines neatly struck through with a felt pen, exactly where a beacon fault entry should have been. The page is not torn, just crossed out."
        },
        {
          "kind": "fact",
          "note": "Lina told the waiting passengers only what she could verify: the east beacon had a brief glitch, the ferry departs once the beacon is confirmed working, and the payphones are available for calls home. The ferry remains firmly moored."
        },
        {
          "kind": "profile",
          "name": "Mae Chen",
          "note": "Checking the incident book to draft the passenger announcement, she noticed the struck-through entries and pressed pen marks, and now wants to find who owns the heavy pressing pen."
        },
        {
          "kind": "profile",
          "name": "Noor Haddad",
          "note": "Read the weather desk's duplicate record over the radio, giving the exact beacon irregularity time and duration."
        }
      ],
      "startsChapter": true
    }
  ],
  "graphHistory": [
    {
      "turn": 0,
      "cast": [
        {
          "id": "primary",
          "name": "Lina Park",
          "nickname": "",
          "description": "A former deckhand now dispatching the night ferry. She has to explain the delay to waiting passengers and to the skipper, and she feels the weight of every clearance she grants. She works from the dispatch desk, tracks the radio, and keeps the incident book within reach. Her stake is her authority on the night watch and the harbor's trust in her judgment.",
          "personality": "",
          "scenario": "It is 23:40 on 1998-10-24. The ferry is tied up at Bellwether and the passengers are waiting in the terminal. Dispatch expects the east beacon to flash once at regular intervals, but it flashes twice and goes dark. Lina Park must explain the delay while the harbor's paper trail — the clothbound incident book and the duplicated weather readings — begins to show a gap. Noor Haddad's duplicate entries and the missing incident-book page connect through the timing knot: the beacon's logged failure window is narrow, while the missing page covers a wider stretch. The ferry stays moored while the cast discovers the missing page through their ordinary jobs. The cause remains unknown and no culprit is identified.",
          "examples": ""
        },
        {
          "id": "c87bf87c-691c-492c-aaf7-adc8adf164e6",
          "name": "Sam Bell",
          "nickname": "",
          "description": "Works the ticket window and studies electrical maintenance on their own time. They carry a pencil and a torch and want to be taken seriously as a technician rather than a ticket clerk. They notice hardware details others miss and are eager to prove the training Ellis gave them was worth giving.",
          "personality": "",
          "scenario": "",
          "examples": ""
        },
        {
          "id": "c9c204e5-f2c4-44e0-b1aa-34b0636b7adc",
          "name": "Tomas Reyes",
          "nickname": "",
          "description": "The ferry skipper, cautious since a close call in fog. He will not move the ferry without Lina's clearance and prefers to wait out uncertain conditions. He is steady with passengers but quietly watches the channel and the beacon.",
          "personality": "",
          "scenario": "",
          "examples": ""
        },
        {
          "id": "cc3407eb-83e6-4f96-a36b-ee08bccfd517",
          "name": "Mae Chen",
          "nickname": "",
          "description": "A junior clerk with spare signboards at hand. She can reassure passengers and keep the terminal calm while the ferry is delayed, and she is learning how the harbor's paperwork actually moves through the night. Her stake is being trusted with more responsibility.",
          "personality": "",
          "scenario": "",
          "examples": ""
        },
        {
          "id": "2ce7d2c7-5995-4b5b-9438-8abaa654245e",
          "name": "Noor Haddad",
          "nickname": "",
          "description": "Keeps the weather station and makes duplicate entries in grease pencil. She logs readings with care and treats the duplicates as a safeguard, not a formality. Her observations are precise and she notices when a record does not match what she remembers writing.",
          "personality": "",
          "scenario": "",
          "examples": ""
        },
        {
          "id": "1b92d34f-1884-4031-ac36-7577103bb86c",
          "name": "Ellis Ward",
          "nickname": "",
          "description": "The blunt harbor electrician who trained Sam to read the gate circuit. He is practical, impatient with unclear thinking, and respected for knowing the harbor's wiring better than anyone. He speaks plainly and expects others to keep up.",
          "personality": "",
          "scenario": "",
          "examples": ""
        }
      ],
      "lore": "Bellwether is a small working harbor with a late ferry crossing to Alder Island. The terminal is a modest, practical building where passengers wait on benches after the last squall has moved through. The harbor runs on paper: clothbound incident books kept at dispatch, duplicate weather readings preserved in grease pencil, radio traffic, and payphones. The east beacon is supposed to flash once at regular intervals to mark the channel; tonight it flashes twice and goes dark. A rain squall has just passed, and the cause of the beacon fault is still unknown. Departure is tightly controlled: the skipper needs clearance from dispatch, and no ferry leaves the dock without it. The night is quiet, wet, and ordinary in every way except for the details that do not line up.",
      "continuity": ""
    },
    {
      "turn": 2,
      "continuity": "Turn 2: At 23:41 the departure board in the terminal flickered and died, and the east beacon flashed twice then went dark."
    },
    {
      "turn": 4,
      "lore": "Bellwether is a small working harbor with a late ferry crossing to Alder Island. The terminal is a modest, practical building where passengers wait on benches after the last squall has moved through. The harbor runs on paper: clothbound incident books kept at dispatch, duplicate weather readings preserved in grease pencil, radio traffic, and payphones. The east beacon is supposed to flash once at regular intervals to mark the channel; tonight it flashes twice and goes dark. A rain squall has just passed, and the cause of the beacon fault is still unknown. Departure is tightly controlled: the skipper needs clearance from dispatch, and no ferry leaves the dock without it. The night is quiet, wet, and ordinary in every way except for the details that do not line up.\nTurn 4: The gate motor is fed from the north panel; the breaker for it is third from the left, and the gate can be cranked open by hand once the motor is isolated.",
      "continuity": "Turn 2: At 23:41 the departure board in the terminal flickered and died, and the east beacon flashed twice then went dark.\nTurn 4: Sam isolated the gate motor's breaker, opened the gate with the manual key, and radioed Tomas that the gate is clear; the ferry remains moored pending Lina's clearance and a working east beacon.\nTurn 4: Noor reported the east beacon's two-flash pattern over the radio, and Mae relayed it to the waiting passengers."
    },
    {
      "turn": 6,
      "cast": [
        {
          "id": "primary",
          "name": "Lina Park",
          "nickname": "",
          "description": "A former deckhand now dispatching the night ferry. She has to explain the delay to waiting passengers and to the skipper, and she feels the weight of every clearance she grants. She works from the dispatch desk, tracks the radio, and keeps the incident book within reach. Her stake is her authority on the night watch and the harbor's trust in her judgment.",
          "personality": "",
          "scenario": "It is 23:40 on 1998-10-24. The ferry is tied up at Bellwether and the passengers are waiting in the terminal. Dispatch expects the east beacon to flash once at regular intervals, but it flashes twice and goes dark. Lina Park must explain the delay while the harbor's paper trail — the clothbound incident book and the duplicated weather readings — begins to show a gap. Noor Haddad's duplicate entries and the missing incident-book page connect through the timing knot: the beacon's logged failure window is narrow, while the missing page covers a wider stretch. The ferry stays moored while the cast discovers the missing page through their ordinary jobs. The cause remains unknown and no culprit is identified.",
          "examples": ""
        },
        {
          "id": "c87bf87c-691c-492c-aaf7-adc8adf164e6",
          "name": "Sam Bell",
          "nickname": "",
          "description": "Works the ticket window and studies electrical maintenance on their own time. They carry a pencil and a torch and want to be taken seriously as a technician rather than a ticket clerk. They notice hardware details others miss and are eager to prove the training Ellis gave them was worth giving.",
          "personality": "",
          "scenario": "",
          "examples": ""
        },
        {
          "id": "c9c204e5-f2c4-44e0-b1aa-34b0636b7adc",
          "name": "Tomas Reyes",
          "nickname": "",
          "description": "The ferry skipper, cautious since a close call in fog. He will not move the ferry without Lina's clearance and prefers to wait out uncertain conditions. He is steady with passengers but quietly watches the channel and the beacon.",
          "personality": "",
          "scenario": "",
          "examples": ""
        },
        {
          "id": "cc3407eb-83e6-4f96-a36b-ee08bccfd517",
          "name": "Mae Chen",
          "nickname": "",
          "description": "A junior clerk with spare signboards at hand. She can reassure passengers and keep the terminal calm while the ferry is delayed, and she is learning how the harbor's paperwork actually moves through the night. Her stake is being trusted with more responsibility.\nTurn 6: Checking the incident book to draft the passenger announcement, she noticed the struck-through entries and pressed pen marks, and now wants to find who owns the heavy pressing pen.",
          "personality": "",
          "scenario": "",
          "examples": ""
        },
        {
          "id": "2ce7d2c7-5995-4b5b-9438-8abaa654245e",
          "name": "Noor Haddad",
          "nickname": "",
          "description": "Keeps the weather station and makes duplicate entries in grease pencil. She logs readings with care and treats the duplicates as a safeguard, not a formality. Her observations are precise and she notices when a record does not match what she remembers writing.\nTurn 6: Read the weather desk's duplicate record over the radio, giving the exact beacon irregularity time and duration.",
          "personality": "",
          "scenario": "",
          "examples": ""
        },
        {
          "id": "1b92d34f-1884-4031-ac36-7577103bb86c",
          "name": "Ellis Ward",
          "nickname": "",
          "description": "The blunt harbor electrician who trained Sam to read the gate circuit. He is practical, impatient with unclear thinking, and respected for knowing the harbor's wiring better than anyone. He speaks plainly and expects others to keep up.",
          "personality": "",
          "scenario": "",
          "examples": ""
        }
      ],
      "lore": "Bellwether is a small working harbor with a late ferry crossing to Alder Island. The terminal is a modest, practical building where passengers wait on benches after the last squall has moved through. The harbor runs on paper: clothbound incident books kept at dispatch, duplicate weather readings preserved in grease pencil, radio traffic, and payphones. The east beacon is supposed to flash once at regular intervals to mark the channel; tonight it flashes twice and goes dark. A rain squall has just passed, and the cause of the beacon fault is still unknown. Departure is tightly controlled: the skipper needs clearance from dispatch, and no ferry leaves the dock without it. The night is quiet, wet, and ordinary in every way except for the details that do not line up.\nTurn 4: The gate motor is fed from the north panel; the breaker for it is third from the left, and the gate can be cranked open by hand once the motor is isolated.\nTurn 6: At 00:07 the weather desk's duplicate record put the beacon irregularity at 23:41, lasting eighteen seconds; station pressure 1012 mb, wind southwest at eight knots.",
      "continuity": "Turn 2: At 23:41 the departure board in the terminal flickered and died, and the east beacon flashed twice then went dark.\nTurn 4: Sam isolated the gate motor's breaker, opened the gate with the manual key, and radioed Tomas that the gate is clear; the ferry remains moored pending Lina's clearance and a working east beacon.\nTurn 4: Noor reported the east beacon's two-flash pattern over the radio, and Mae relayed it to the waiting passengers.\nTurn 6: The dispatch incident book has a clean gap between 23:30 and 23:45: several lines neatly struck through with a felt pen, exactly where a beacon fault entry should have been. The page is not torn, just crossed out.\nTurn 6: Lina told the waiting passengers only what she could verify: the east beacon had a brief glitch, the ferry departs once the beacon is confirmed working, and the payphones are available for calls home. The ferry remains firmly moored."
    }
  ],
  "nextTurn": 7,
  "premise": "It is 23:40 on 1998-10-24. The ferry is tied up at Bellwether and the passengers are waiting in the terminal. Dispatch expects the east beacon to flash once at regular intervals, but it flashes twice and goes dark. Lina Park must explain the delay while the harbor's paper trail — the clothbound incident book and the duplicated weather readings — begins to show a gap. Noor Haddad's duplicate entries and the missing incident-book page connect through the timing knot: the beacon's logged failure window is narrow, while the missing page covers a wider stretch. The ferry stays moored while the cast discovers the missing page through their ordinary jobs. The cause remains unknown and no culprit is identified."
};

export function createStarterStory() {
  return {id:starterStoryId,...structuredClone(starter)};
}

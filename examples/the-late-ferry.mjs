import { starterStoryId } from '../public/library.js';
import { reference, reviewFindingId, sceneIndex } from '../public/revision.js';

// Authored and exported through Story Studio with Claude Sonnet 5.5. See TESTING.md.
const starter = {
  "title": "The Late Ferry",
  "lore": "Bellwether is a small working harbor town whose last ferry crossing of the night is run by a handful of coworkers. The story takes place over 24-25 October 1998, before mobile phones and digital records are routine there. The port's record-keeping is on paper.\n\nPhysical port: a ferry dock and quay on the water, with a dispatch office whose window looks out over the harbor. An east beacon at the harbor's edge gives signals visible from the office. A log cabinet holds the paper logs and is opened with a brass key that has a filed tooth. A tide-board on the quay shows posted water levels. Logs are kept in duplicate. The carbon copy is pale blue.\n\nDeparture decisions rest on the accuracy of the written record: when the ferry leaves, when it is held, and why. The last crossing of the night also carries the overnight medical courier. A safe departure and an honest account of any delay both matter to the people downstream who rely on that record.",
  "notes": "Genre and form: short standalone harbor mystery, humane and quiet, with low-key stakes and room for choices.\nPoint of view: close third person, one viewpoint character per scene. Rotate viewpoint between scenes among the five characters. Lina Park has the first scene. No character is designated the lead.\nTheme: loyalty to coworkers versus responsibility to people who depend on an accurate record. Show it through choices and actions. Do not state it outright.\nTone: no villains presumed. Treat every character as a competent adult with plausible reasons for what they do and what they leave unsaid. Do not settle blame early.\nPhysical objects: the brass key with a filed tooth, the pale blue carbon duplicate, and the tide-board each have a practical purpose. Show them in use. The narrator should not explain them as symbols.\nDetails: use plausible harbor and ferry-dispatch terms, such as hold, cast off, log, dispatch, and tide. Explain them only through context.\nStanding constraints: keep content non-explicit. Leave the altered log and the key's use unresolved until the story reveals them. Do not add outside facts to the setup that are only plot ideas.\n\nCall signs and evidence: On the radio, use job call signs such as \"Dispatch\" and \"Ferry.\" In person, use names. Keep every scene to one point of view and let physical evidence carry the mystery.",
  "plotEvents": [
    {
      "note": "The east beacon flashed twice instead of once. Lina found the 23:15 tide entry (2.1 m, in Mae's hand) had a pressed impression of 3.1 on the sheet beneath. She left the sheet undisturbed and set the page aside flat.",
      "turn": 2,
      "storyTime": "1998-10-24T23:40"
    },
    {
      "note": "Lina held the last ferry at the dock at 23:42, citing the signal and the tide figure in question. The medical courier was informed and is waiting with the cooler.",
      "turn": 2,
      "storyTime": "1998-10-24T23:42"
    },
    {
      "note": "Sam found the brass key with the filed tooth in the tide-board's clip, wrapped in a loose square of pale blue carbon paper. He did not unfold it and carried it to the dispatch office. Who left it, and why, is unknown.",
      "turn": 4,
      "storyTime": "1998-10-24T23:52"
    },
    {
      "note": "Mae took the key and the carbon paper, noting the key opens the cabinet where the official log is kept. She closed her hand around them without reading the carbon.",
      "turn": 4,
      "storyTime": "1998-10-24T23:56"
    },
    {
      "note": "Mae opened the log cabinet with the filed-tooth key and found the official log in its usual place, a pale blue duplicate behind each page, nothing else disturbed. The carbon for 23:15 reads 3.1, matching the groove under the official sheet.",
      "turn": 6,
      "storyTime": "1998-10-25T00:04"
    },
    {
      "note": "Noor's own notebook records 3.1 at 23:15, timed and initialed. With the carbon and the pressed impression, she and Mae agree the official 2.1 entry was changed after it was first written. Who changed it and why remains unknown.",
      "turn": 6,
      "storyTime": "1998-10-25T00:08"
    },
    {
      "note": "Mae held her pen over the margin to enter a correction under her initials but has not written it. Writing it would put her name on the first admission; waiting keeps the ferry tied.",
      "turn": 6,
      "storyTime": "1998-10-25T00:10"
    },
    {
      "note": "Lina and Mae wrote a dated correction on a separate sheet: the 23:15 entry reads 2.1 m, but the carbon, impression and Noor's notebook read 3.1 m. The original was left as written; cause of change not established. The carbon and groove page were clipped behind it.",
      "turn": 8,
      "storyTime": "1998-10-25T00:24"
    },
    {
      "note": "Lina phoned Tomas to give the medical courier a choice: wait aboard the held ferry or come up to the dispatch office by the stove, keeping the cooler in their own hands either way.",
      "turn": 8,
      "storyTime": "1998-10-25T00:26"
    },
    {
      "note": "A single horn sounded from the dark channel past the east beacon and went unanswered. Its source is unknown.",
      "turn": 8,
      "storyTime": "1998-10-25T00:27"
    },
    {
      "note": "Noor read the tide gauge at 00:34 at 3.0 m and logged it as a separate current reading, distinct from her 23:15 entry. The east beacon was dark, and a second long, lower horn sounded from the channel with no answer. Source of the horn and the dark beacon unknown.",
      "turn": 10,
      "storyTime": "1998-10-25T00:34"
    },
    {
      "note": "Noor decided to report the gauge figure and the second horn to Dispatch and to recommend the ferry stay tied.",
      "turn": 10,
      "storyTime": "1998-10-25T00:36"
    }
  ],
  "relationships": [
    {
      "from": "70f12c0a-2b06-4216-828b-78be82cce503",
      "to": "a33f6223-f67e-4037-b857-c63ab04d3ca4",
      "label": "Lina trusts Tomas's judgment and relies on him when she holds a departure.",
      "turn": 0,
      "storyTime": "1998-10-24T23:40"
    },
    {
      "from": "55ea8329-a89c-4a8e-899b-a2218d346fd4",
      "to": "70f12c0a-2b06-4216-828b-78be82cce503",
      "label": "Mae works for Lina and does not always agree with her.",
      "turn": 0,
      "storyTime": "1998-10-24T23:40"
    },
    {
      "from": "d294e66e-3c2c-4302-863a-a55186dab2d8",
      "to": "55ea8329-a89c-4a8e-899b-a2218d346fd4",
      "label": "Noor cross-checks her duplicate logs against Mae's.",
      "turn": 0,
      "storyTime": "1998-10-24T23:40"
    },
    {
      "from": "55ea8329-a89c-4a8e-899b-a2218d346fd4",
      "to": "d294e66e-3c2c-4302-863a-a55186dab2d8",
      "label": "Mae cross-checks her duplicate logs against Noor's.",
      "turn": 0,
      "storyTime": "1998-10-24T23:40"
    },
    {
      "from": "7178d412-0bc8-4ec3-8ebc-508f19aae05d",
      "to": "a33f6223-f67e-4037-b857-c63ab04d3ca4",
      "label": "Sam works under Tomas on the ferry crew.",
      "turn": 0,
      "storyTime": "1998-10-24T23:40"
    },
    {
      "from": "a33f6223-f67e-4037-b857-c63ab04d3ca4",
      "to": "70f12c0a-2b06-4216-828b-78be82cce503",
      "label": "Tomas accepted Lina's hold on the ferry and formally acknowledged it by phone at 23:42, with the courier informed.",
      "turn": 2,
      "storyTime": "1998-10-24T23:42"
    },
    {
      "from": "a33f6223-f67e-4037-b857-c63ab04d3ca4",
      "to": "7178d412-0bc8-4ec3-8ebc-508f19aae05d",
      "label": "Tomas sent Sam to read the tide-board and told him the ferry stays tied until Dispatch says otherwise; Sam answered 'Aye, Skipper.'",
      "turn": 4,
      "storyTime": "1998-10-24T23:52"
    },
    {
      "from": "7178d412-0bc8-4ec3-8ebc-508f19aae05d",
      "to": "55ea8329-a89c-4a8e-899b-a2218d346fd4",
      "label": "Sam handed Mae the key and carbon paper with a brief account of finding them in the tide-board clip, saying he did not put them there.",
      "turn": 4,
      "storyTime": "1998-10-24T23:56"
    },
    {
      "from": "d294e66e-3c2c-4302-863a-a55186dab2d8",
      "to": "55ea8329-a89c-4a8e-899b-a2218d346fd4",
      "label": "Noor brought her independent tide notebook to Mae, and they compared it against the log and carbon together to confirm the 23:15 figure.",
      "turn": 6,
      "storyTime": "1998-10-25T00:08"
    },
    {
      "from": "70f12c0a-2b06-4216-828b-78be82cce503",
      "to": "55ea8329-a89c-4a8e-899b-a2218d346fd4",
      "label": "Lina and Mae disagreed quietly over whose initials a correction should carry, then agreed to write a separate correction together, both initialing it, with the original entry left unaltered.",
      "turn": 8,
      "storyTime": "1998-10-25T00:24"
    }
  ],
  "storyStartAt": "1998-10-24T23:40",
  "storyStartSource": "author",
  "setupHistory": {
    "context": "",
    "reviewed": true,
    "messages": [
      {
        "role": "user",
        "content": "Starting fresh. Let’s build The Late Ferry, a short standalone harbor mystery set at Bellwether on 24–25 October 1998. Start at 23:40. Five adult coworkers, no lead-character designation: dispatcher Lina Park, clerk Mae Chen, deckhand Sam Bell, weather observer Noor Haddad, and skipper Tomas Reyes. It begins with a double flash from the east beacon, an altered paper log, and a ferry held at the dock. Use a brass key with a filed tooth, a pale blue carbon duplicate, and a tide-board as physical objects with different purposes, not symbols that the narrator explains. An arc about loyalty to coworkers versus responsibility to people who depend on an accurate record. I want a humane, close-third mystery with quiet stakes, space for choices, and no villains presumed. Suggest two concrete opening approaches and what each would make the first chapter about. Keep your answer brief."
      },
      {
        "role": "assistant",
        "content": "Here are two ways in, both starting at 23:40.\n\n**1. The log first (quiet, private).** Chapter one stays close to Lina in the dispatch office. The beacon's double flash pulls her to the window, and when she turns back she notices the log entry doesn't match what she remembers. The pale blue carbon duplicate, tucked where it shouldn't be, shows the original wording. She's the one who holds the ferry, so the chapter is about a small, immediate choice: hold the boat on a hunch, or let it go and keep the peace. Her colleagues appear only as voices on the radio and footsteps outside. The loyalty question starts as a private discomfort before anyone else knows there's a problem.\n\n**2. The dock first (social, tense).** Chapter one opens on the quay, with the ferry already held and the crew drifting in one by one. Tomas won't cast off, Sam is coiling line he doesn't need to coil, and Noor arrives with the tide-board reading that doesn't fit the log. Each person has a plausible reason to be there and a reason not to explain it. The chapter is about the room: who says what, who stays quiet, and how the brass key with the filed tooth, which opens the log cabinet and isn't supposed to have been used tonight, changes the mood when someone sets it down. The record becomes a shared problem before it becomes anyone's secret.\n\nThe first keeps the mystery intimate and puts the ethical weight on one person early. The second spreads the weight across all five and makes the group dynamic the engine.\n\nTwo questions to help me narrow it:\n- Do you want one fixed close-third viewpoint for chapter one, or a rotation across the five from the start?\n- Who or what depends on the record being accurate? A passenger on that ferry, a cargo, or something further downstream, like an inquiry or a later crossing?"
      },
      {
        "role": "user",
        "content": "Use the log-first opening, with one close viewpoint per scene and rotation between scenes. Lina goes first. The last crossing also carries the overnight medical courier; safe departure and an honest delay both matter. Save exactly those five people with names, believable aliases if useful, concise descriptions, and 4–5 directional relationships, especially Lina trusting Tomas with a hold, Mae working for Lina without always agreeing, Noor and Mae cross-checking duplicate logs, and Sam working under Tomas. Establish the physical port and standing writing notes. Leave the altered log and key unresolved, and keep facts that are only future plot suggestions out of the starting graph. Date the opening at 1998-10-24T23:40. Please use these choices for the setup draft."
      }
    ]
  },
  "cast": [
    {
      "id": "70f12c0a-2b06-4216-828b-78be82cce503",
      "name": "Lina Park",
      "nickname": "",
      "description": "Adult dispatcher at the Bellwether ferry office. She is careful, observant, and responsible for deciding when the ferry is held or released. She goes by Lina and is called \"Dispatch\" on the radio. Her viewpoint opens the story."
    },
    {
      "id": "55ea8329-a89c-4a8e-899b-a2218d346fd4",
      "name": "Mae Chen",
      "nickname": "",
      "description": "Adult clerk who handles paperwork and logs under Lina. She is precise and practical, and she sometimes disagrees with Lina. She is called Mae and sometimes \"Chen\" at the office."
    },
    {
      "id": "7178d412-0bc8-4ec3-8ebc-508f19aae05d",
      "name": "Sam Bell",
      "nickname": "",
      "description": "Adult deckhand on the ferry. He is hands-on, steady, and wary of speaking out of turn. He works under the skipper and is called Sam, or \"Sammy\" by older dock hands."
    },
    {
      "id": "d294e66e-3c2c-4302-863a-a55186dab2d8",
      "name": "Noor Haddad",
      "nickname": "",
      "description": "Adult weather observer who records conditions and tide readings for the port. She is methodical and independent, and she checks her figures against the paperwork. She is called Noor, or \"the Observer\" around the dock."
    },
    {
      "id": "a33f6223-f67e-4037-b857-c63ab04d3ca4",
      "name": "Tomas Reyes",
      "nickname": "",
      "description": "Adult skipper of the ferry. He is experienced, measured, and respected for his judgment at the helm. He is called Tomas, or \"Skipper\" by the crew."
    }
  ],
  "premise": "It is 23:40 on 24 October 1998 at Bellwether. The east beacon gives a double flash, and the last ferry of the night is being held at the dock. In the dispatch office, Lina Park finds that an entry in the paper log has been altered. The brass key with the filed tooth and the cause of the alteration are both unresolved. The overnight medical courier is due to cross on this ferry. The first scene stays close to Lina as she weighs how to handle the hold and what she owes her coworkers and the people who depend on an accurate record.",
  "loreRules": "",
  "messages": [
    {
      "role": "user",
      "content": "At 23:40 on October 24, open in Lina’s close third person. Show the east beacon give two flashes instead of one. She compares the harbor log to the impression from a figure that someone had pressed hard into the sheet underneath. When Tomas calls about the overnight medical courier, make Lina put the hold in writing and ask him to acknowledge it. End after his response. Plant the paper impression as something Mae could later use. Keep the brass key and blue carbon out of this scene. Roughly 180–220 words, sparse dialogue.",
      "contentSensitivity": "safe",
      "turnNumber": 1,
      "storyTime": "1998-10-24T23:42"
    },
    {
      "role": "assistant",
      "content": "The east beacon gave two flashes where the hour called for one. Lina Park watched the window until the dark settled back over the harbor, then looked down at the log.\n\nThe 23:15 tide entry read 2.1 meters, in Mae's upright hand. She tilted the page toward the desk lamp. Pressed hard into the sheet beneath, where a pen had once leaned all its weight, was a ghost of a figure: 3.1. Someone had written the number, then written over it.\n\nLina did not rub at it. She slid the page free of the cabinet's clip, laid it flat under the blotter's edge, and left the underlying sheet exactly as it was. Anyone who looked later would see what she saw.\n\nThe telephone rang.\n\n\"Dispatch.\"\n\n\"Tomas. I've got the courier on my ramp with the cooler. Are we going or not?\"\n\n\"Not yet. The beacon's showing double and the tide figure doesn't sit right. I'm holding you at the dock.\"\n\nA pause, only engine idle and wind on the line.\n\n\"I'm writing it now,\" she said. \"Held, 23:42, signal and tide in question, courier aboard and informed. I need you to acknowledge.\"\n\n\"Understood, Dispatch,\" Tomas said. \"Held at 23:42. Courier informed. Acknowledged.\"",
      "speakerId": "story-studio:narrator",
      "speakerName": "Narrator",
      "contentSensitivity": "safe",
      "storyTime": "1998-10-24T23:42",
      "turnNumber": 2,
      "appliedGraphUpdates": [
        {
          "kind": "plot",
          "note": "The east beacon flashed twice instead of once. Lina found the 23:15 tide entry (2.1 m, in Mae's hand) had a pressed impression of 3.1 on the sheet beneath. She left the sheet undisturbed and set the page aside flat.",
          "storyTime": "1998-10-24T23:40"
        },
        {
          "kind": "plot",
          "note": "Lina held the last ferry at the dock at 23:42, citing the signal and the tide figure in question. The medical courier was informed and is waiting with the cooler.",
          "storyTime": "1998-10-24T23:42"
        },
        {
          "kind": "relationship",
          "from": "Tomas Reyes",
          "to": "Lina Park",
          "label": "Tomas accepted Lina's hold on the ferry and formally acknowledged it by phone at 23:42, with the courier informed.",
          "storyTime": "1998-10-24T23:42"
        }
      ]
    },
    {
      "role": "user",
      "content": "At 23:52, follow Sam on the quay. Tomas sends him to read the tide-board and says the ferry stays tied. Let Sam discover that someone slipped the brass key with the filed tooth into the tide-board’s clip, wrapped in a loose square of pale blue carbon paper. Sam hands it to Mae with a brief account of where he found it. Let Mae note that the cabinet normally holds the official log and leave the bit of carbon unread. Keep both the source of the key and reason for the beacon signal open. Around 160–200 words.",
      "contentSensitivity": "safe",
      "turnNumber": 3,
      "storyTime": "1998-10-24T23:56"
    },
    {
      "role": "assistant",
      "content": "Tomas leaned out of the wheelhouse door. \"Sammy, read the tide-board for me. The ferry stays tied until Dispatch says otherwise.\"\n\n\"Aye, Skipper.\"\n\nSam walked the quay with his collar up, the planks slick under his boots. The board hung on its post at the foot of the ramp, the posted level chalked above the waterline marks. He raised his lantern and read the number twice, then reached for the clip to check the time of the last posting.\n\nSomething was already in it. A small brass key, its middle tooth filed down, wrapped in a loose square of pale blue carbon paper.\n\nHe did not unfold the paper. He lifted it out by the edges, the way he'd lift a line off a cleat that wasn't his, and carried it up the quay to the dispatch office.\n\nMae Chen met him at the door. He held it out on his palm.\n\n\"Tide-board clip,\" he said. \"Just now. Wasn't me who put it there.\"\n\nMae looked at the key a moment. \"The cabinet's where the official log lives,\" she said quietly. \"This opens it.\"\n\nShe took the bundle, carbon and all, and closed her hand around it without turning back the paper.",
      "speakerId": "story-studio:narrator",
      "speakerName": "Narrator",
      "contentSensitivity": "safe",
      "storyTime": "1998-10-24T23:56",
      "turnNumber": 4,
      "appliedGraphUpdates": [
        {
          "kind": "plot",
          "note": "Sam found the brass key with the filed tooth in the tide-board's clip, wrapped in a loose square of pale blue carbon paper. He did not unfold it and carried it to the dispatch office. Who left it, and why, is unknown.",
          "storyTime": "1998-10-24T23:52"
        },
        {
          "kind": "relationship",
          "from": "Tomas Reyes",
          "to": "Sam Bell",
          "label": "Tomas sent Sam to read the tide-board and told him the ferry stays tied until Dispatch says otherwise; Sam answered 'Aye, Skipper.'",
          "storyTime": "1998-10-24T23:52"
        },
        {
          "kind": "relationship",
          "from": "Sam Bell",
          "to": "Mae Chen",
          "label": "Sam handed Mae the key and carbon paper with a brief account of finding them in the tide-board clip, saying he did not put them there.",
          "storyTime": "1998-10-24T23:56"
        },
        {
          "kind": "plot",
          "note": "Mae took the key and the carbon paper, noting the key opens the cabinet where the official log is kept. She closed her hand around them without reading the carbon.",
          "storyTime": "1998-10-24T23:56"
        }
      ]
    },
    {
      "role": "user",
      "content": "At 00:04 on October 25, change viewpoint to Mae. Have her use the filed-tooth key to open the log cabinet; show what the key actually unlocks. Let Noor arrive with her own independent tide notebook. Together they turn the blue carbon under the desk lamp and use the indentation Lina noticed to establish that the official 23:15 entry was altered. Keep who made the change and why unknown. End with Mae deciding whether to enter a correction under her own name, without having her write it yet. Quiet, plain prose; around 200 words.",
      "contentSensitivity": "safe",
      "turnNumber": 5,
      "storyTime": "1998-10-25T00:04"
    },
    {
      "role": "assistant",
      "content": "The key turned stiffly, the filed tooth catching once before the lock gave. Mae Chen lifted the cabinet door and found the official log where it always lived, its spine cracked soft, a pale blue duplicate sheet interleaved behind each page. Nothing else in the cabinet had been moved.\n\nNoor Haddad came in out of the wind, rain on her sleeves, a battered notebook under her arm. \"Lina said you'd want my readings.\"\n\n\"I do.\"\n\nLina's flattened page lay under the blotter, as she'd left it. Mae set it beside the log and unfolded the carbon at last. Under the desk lamp, the figure on it read 3.1, the stroke of the three deep and clean.\n\n\"Pressed through,\" Noor said, tilting the sheet beneath. The same number sat in the paper as a faint groove. \"Same pen, same weight. That's where it started.\"\n\nShe opened her notebook. Her own line for 23:15 read 3.1, timed and initialed.\n\nMae looked at the 2.1 in the official log. The two was nearly hers, upright and closed at the base. She could not have said she hadn't written it.\n\n\"It was changed after,\" Noor said. It was not quite a question.\n\n\"After,\" Mae agreed. \"Not by whom.\"\n\nShe uncapped her pen and held it over the margin, where a correction would go under her initials. If she wrote it, her name sat on the first admission. If she waited, the ferry stayed tied.\n\nShe did not write yet.",
      "speakerId": "story-studio:narrator",
      "speakerName": "Narrator",
      "contentSensitivity": "safe",
      "storyTime": "1998-10-25T00:04",
      "turnNumber": 6,
      "appliedGraphUpdates": [
        {
          "kind": "plot",
          "note": "Mae opened the log cabinet with the filed-tooth key and found the official log in its usual place, a pale blue duplicate behind each page, nothing else disturbed. The carbon for 23:15 reads 3.1, matching the groove under the official sheet.",
          "storyTime": "1998-10-25T00:04"
        },
        {
          "kind": "plot",
          "note": "Noor's own notebook records 3.1 at 23:15, timed and initialed. With the carbon and the pressed impression, she and Mae agree the official 2.1 entry was changed after it was first written. Who changed it and why remains unknown.",
          "storyTime": "1998-10-25T00:08"
        },
        {
          "kind": "relationship",
          "from": "Noor Haddad",
          "to": "Mae Chen",
          "label": "Noor brought her independent tide notebook to Mae, and they compared it against the log and carbon together to confirm the 23:15 figure.",
          "storyTime": "1998-10-25T00:08"
        },
        {
          "kind": "plot",
          "note": "Mae held her pen over the margin to enter a correction under her initials but has not written it. Writing it would put her name on the first admission; waiting keeps the ferry tied.",
          "storyTime": "1998-10-25T00:10"
        }
      ],
      "startsChapter": true
    },
    {
      "role": "user",
      "content": "Switch to Lina at 00:20. Mae brings her the key, the blue carbon, and the matching groove, and says she hasn't yet written a correction. Lina has to decide whether the correction goes under Mae's initials or under her own, as the dispatcher who held the boat. Let them disagree quietly, and don't name who altered the entry. Let them date and initial a separate correction together, preserving both the false entry and the original evidence. Give the courier a practical choice to protect rather than leave the delay abstract. End with an unresolved sight or sound from the harbor. About 180–230 words.",
      "contentSensitivity": "safe",
      "turnNumber": 7,
      "storyTime": "1998-10-25T00:24"
    },
    {
      "role": "assistant",
      "content": "Mae set the key on the desk, then the blue carbon, then the flattened page with its groove. \"I haven't written anything,\" she said. \"It would go under my initials. It's my hand on the entry.\"\n\nLina looked at the 2.1. \"Is it?\"\n\n\"I can't swear it isn't.\"\n\n\"Then you can't swear it is, either.\" Lina drew a clean sheet from the drawer. \"The hold is mine. I made it on that figure. The correction goes under mine.\"\n\n\"That puts your name on my mistake.\"\n\n\"It puts it on the record of why the boat's tied.\" Lina kept her voice low. \"If we don't know who changed it, neither of us signs as though we do.\"\n\nMae was quiet, then nodded once, not happily. \"Both, then. Separate sheet. Nothing struck out.\"\n\nThey wrote it together: *25 Oct 1998, 00:24. Entry for 23:15 reads 2.1 m. Carbon, pressed impression and Observer's notebook read 3.1 m. Original entry left as written. Cause of change not established.* Mae initialed, then Lina. They clipped the carbon and the groove page behind it.\n\nLina lifted the phone. \"Tomas, the courier can wait aboard or come up here by the stove. Either way the cooler stays in their hands. Tell them to choose.\"\n\nThrough the window, past the east beacon, a single horn sounded from the dark channel. Nothing answered it.",
      "speakerId": "story-studio:narrator",
      "speakerName": "Narrator",
      "contentSensitivity": "safe",
      "storyTime": "1998-10-25T00:24",
      "turnNumber": 8,
      "appliedGraphUpdates": [
        {
          "kind": "relationship",
          "from": "Lina Park",
          "to": "Mae Chen",
          "label": "Lina and Mae disagreed quietly over whose initials a correction should carry, then agreed to write a separate correction together, both initialing it, with the original entry left unaltered.",
          "storyTime": "1998-10-25T00:24"
        },
        {
          "kind": "plot",
          "note": "Lina and Mae wrote a dated correction on a separate sheet: the 23:15 entry reads 2.1 m, but the carbon, impression and Noor's notebook read 3.1 m. The original was left as written; cause of change not established. The carbon and groove page were clipped behind it.",
          "storyTime": "1998-10-25T00:24"
        },
        {
          "kind": "plot",
          "note": "Lina phoned Tomas to give the medical courier a choice: wait aboard the held ferry or come up to the dispatch office by the stove, keeping the cooler in their own hands either way.",
          "storyTime": "1998-10-25T00:26"
        },
        {
          "kind": "plot",
          "note": "A single horn sounded from the dark channel past the east beacon and went unanswered. Its source is unknown.",
          "storyTime": "1998-10-25T00:27"
        }
      ]
    },
    {
      "role": "user",
      "content": "Start Chapter 3 at about 00:30. In 150–180 words, use Noor’s close third-person point of view as she takes her notebook and a hand lantern to the tide gauge. Give the unanswered horn a concrete second occurrence but leave its source, the changed log entry, and the dark beacon unresolved. Let Noor write down that the current water matches her reading closely while keeping that observation distinct from the 23:15 reading. Show what she decides to tell Dispatch. The ferry stays moored. End on her decision. Return only story prose.",
      "contentSensitivity": "safe",
      "turnNumber": 9,
      "storyTime": "1998-10-25T00:34"
    },
    {
      "role": "assistant",
      "content": "Noor Haddad took her notebook and the hand lantern down the quay to the tide gauge, a staff bolted to the piling with its marks worn pale by salt. The rain had thinned to a mist. She held the lantern close and read the waterline against the staff.\n\n3.0 meters, a hair under.\n\nShe wrote it on a fresh line: *00:34. Gauge reads 3.0 m. Current reading.* Above it, her 23:15 entry stood untouched. The two figures agreed closely, but one did not prove the other. An hour of tide had passed between them, and she kept them on separate lines.\n\nAcross the water, the east beacon sat dark. She waited for its flash and counted to sixty. Nothing came.\n\nThe horn sounded again, one long note from the channel, lower than before. No answering horn came, and no light.\n\nShe closed the notebook on her pencil. Lina would want the figure, and she would have it. She would also tell her the horn had come twice, and that the gauge said only what the water was doing now. The ferry should stay where it was.\n\nShe turned the lantern toward the office and walked back.",
      "speakerId": "story-studio:narrator",
      "contentSensitivity": "safe",
      "storyTime": "1998-10-25T00:34",
      "startsChapter": true,
      "turnNumber": 10,
      "appliedGraphUpdates": [
        {
          "kind": "plot",
          "note": "Noor read the tide gauge at 00:34 at 3.0 m and logged it as a separate current reading, distinct from her 23:15 entry. The east beacon was dark, and a second long, lower horn sounded from the channel with no answer. Source of the horn and the dark beacon unknown.",
          "storyTime": "1998-10-25T00:34"
        },
        {
          "kind": "plot",
          "note": "Noor decided to report the gauge figure and the second horn to Dispatch and to recommend the ferry stay tied.",
          "storyTime": "1998-10-25T00:36"
        }
      ]
    }
  ],
  "graphHistory": [
    {
      "turn": 0,
      "lore": "Bellwether is a small working harbor town whose last ferry crossing of the night is run by a handful of coworkers. The story takes place over 24-25 October 1998, before mobile phones and digital records are routine there. The port's record-keeping is on paper.\n\nPhysical port: a ferry dock and quay on the water, with a dispatch office whose window looks out over the harbor. An east beacon at the harbor's edge gives signals visible from the office. A log cabinet holds the paper logs and is opened with a brass key that has a filed tooth. A tide-board on the quay shows posted water levels. Logs are kept in duplicate. The carbon copy is pale blue.\n\nDeparture decisions rest on the accuracy of the written record: when the ferry leaves, when it is held, and why. The last crossing of the night also carries the overnight medical courier. A safe departure and an honest account of any delay both matter to the people downstream who rely on that record.",
      "notes": "Genre and form: short standalone harbor mystery, humane and quiet, with low-key stakes and room for choices.\nPoint of view: close third person, one viewpoint character per scene. Rotate viewpoint between scenes among the five characters. Lina Park has the first scene. No character is designated the lead.\nTheme: loyalty to coworkers versus responsibility to people who depend on an accurate record. Show it through choices and actions. Do not state it outright.\nTone: no villains presumed. Treat every character as a competent adult with plausible reasons for what they do and what they leave unsaid. Do not settle blame early.\nPhysical objects: the brass key with a filed tooth, the pale blue carbon duplicate, and the tide-board each have a practical purpose. Show them in use. The narrator should not explain them as symbols.\nDetails: use plausible harbor and ferry-dispatch terms, such as hold, cast off, log, dispatch, and tide. Explain them only through context.\nStanding constraints: keep content non-explicit. Leave the altered log and the key's use unresolved until the story reveals them. Do not add outside facts to the setup that are only plot ideas.",
      "cast": [
        {
          "id": "70f12c0a-2b06-4216-828b-78be82cce503",
          "name": "Lina Park",
          "nickname": "",
          "description": "Adult dispatcher at the Bellwether ferry office. She is careful, observant, and responsible for deciding when the ferry is held or released. She goes by Lina and is called \"Dispatch\" on the radio. Her viewpoint opens the story."
        },
        {
          "id": "55ea8329-a89c-4a8e-899b-a2218d346fd4",
          "name": "Mae Chen",
          "nickname": "",
          "description": "Adult clerk who handles paperwork and logs under Lina. She is precise and practical, and she sometimes disagrees with Lina. She is called Mae and sometimes \"Chen\" at the office."
        },
        {
          "id": "7178d412-0bc8-4ec3-8ebc-508f19aae05d",
          "name": "Sam Bell",
          "nickname": "",
          "description": "Adult deckhand on the ferry. He is hands-on, steady, and wary of speaking out of turn. He works under the skipper and is called Sam, or \"Sammy\" by older dock hands."
        },
        {
          "id": "d294e66e-3c2c-4302-863a-a55186dab2d8",
          "name": "Noor Haddad",
          "nickname": "",
          "description": "Adult weather observer who records conditions and tide readings for the port. She is methodical and independent, and she checks her figures against the paperwork. She is called Noor, or \"the Observer\" around the dock."
        },
        {
          "id": "a33f6223-f67e-4037-b857-c63ab04d3ca4",
          "name": "Tomas Reyes",
          "nickname": "",
          "description": "Adult skipper of the ferry. He is experienced, measured, and respected for his judgment at the helm. He is called Tomas, or \"Skipper\" by the crew."
        }
      ]
    },
    {
      "turn": 4,
      "notes": "Genre and form: short standalone harbor mystery, humane and quiet, with low-key stakes and room for choices.\nPoint of view: close third person, one viewpoint character per scene. Rotate viewpoint between scenes among the five characters. Lina Park has the first scene. No character is designated the lead.\nTheme: loyalty to coworkers versus responsibility to people who depend on an accurate record. Show it through choices and actions. Do not state it outright.\nTone: no villains presumed. Treat every character as a competent adult with plausible reasons for what they do and what they leave unsaid. Do not settle blame early.\nPhysical objects: the brass key with a filed tooth, the pale blue carbon duplicate, and the tide-board each have a practical purpose. Show them in use. The narrator should not explain them as symbols.\nDetails: use plausible harbor and ferry-dispatch terms, such as hold, cast off, log, dispatch, and tide. Explain them only through context.\nStanding constraints: keep content non-explicit. Leave the altered log and the key's use unresolved until the story reveals them. Do not add outside facts to the setup that are only plot ideas.\n\nCall signs and evidence: On the radio, use job call signs such as \"Dispatch\" and \"Ferry.\" In person, use names. Keep every scene to one point of view and let physical evidence carry the mystery."
    }
  ],
  "nextTurn": 11,
  "agentHistory": [
    {
      "afterTurn": 4,
      "request": "Add a concise standing Writing note: On the radio, use job call signs such as “Dispatch” and “Ferry.” In person, use names. Keep every scene to one point of view and let physical evidence carry the mystery. Keep the existing notes and the manuscript, cast, timeline and relationships as they are.",
      "message": "Added the standing writing note on radio call signs, in-person names, single-POV scenes, and physical evidence. All existing notes, cast, timeline, and relationships are unchanged.",
      "count": 1,
      "changes": "[{\"kind\":\"notes\",\"action\":\"append\",\"text\":\"Call signs and evidence: On the radio, use job call signs such as \\\"Dispatch\\\" and \\\"Ferry.\\\" In person, use names. Keep every scene to one point of view and let physical evidence carry the mystery.\"}]"
    }
  ],
  "storyFlow": {
    "source": "anthropic",
    "afterTurn": 10,
    "options": [
      {
        "title": "Tomas aboard with the courier",
        "direction": "Switch to Tomas at about 00:40, on the held ferry. The courier has answered Lina's choice, and the horn has sounded twice. Show him managing the cooler, the crew, and the waiting, then deciding what he will tell Dispatch about readiness to sail. Leave the horn's source open.",
        "consequence": "Gives Tomas his first viewpoint and makes the courier's delay concrete."
      },
      {
        "title": "Lina weighs Noor's report",
        "direction": "Switch to Lina at about 00:42. Noor comes in from the quay with the 00:34 gauge figure, the second horn, and the dark beacon. Show Lina deciding what is enough to keep the ferry held, release it, or set conditions. Have her enter the decision in the log. Name no one as responsible for the altered entry.",
        "consequence": "Advances the hold-versus-release decision using the evidence already gathered."
      },
      {
        "title": "Sam is asked what he saw",
        "direction": "Switch to Sam at about 00:40 on the quay. Tomas, or Mae, asks quietly whether he saw anyone near the tide-board before he found the key. Show Sam deciding how much to say, and what he does with his hands while he decides. Keep the key's source unresolved.",
        "consequence": "Tests loyalty to coworkers against the accurate record through Sam's choice of words."
      }
    ]
  },
  "revisionNotes": [
    {
      "id": "review-7u-1w32yo4",
      "kind": "theme",
      "title": "Preserving traces: the record kept legible, not overwritten",
      "refs": [
        {
          "storyId": "story-studio-starter-demo",
          "turn": 2,
          "fingerprint": "vg-1wqke98",
          "start": 595,
          "end": 642
        },
        {
          "storyId": "story-studio-starter-demo",
          "turn": 8,
          "fingerprint": "yk-suiuck",
          "start": 833,
          "end": 897
        }
      ]
    },
    {
      "id": "review-7l-71vsm",
      "kind": "theme",
      "title": "Handling what isn't yours: restraint with the key",
      "refs": [
        {
          "storyId": "story-studio-starter-demo",
          "turn": 4,
          "fingerprint": "ty-3tv54u",
          "start": 572,
          "end": 600
        }
      ]
    },
    {
      "id": "review-7p-68krxq",
      "kind": "thread",
      "title": "Mae's unwritten correction and the initials dispute",
      "refs": [
        {
          "storyId": "story-studio-starter-demo",
          "turn": 6,
          "fingerprint": "117-101onab",
          "start": 1224,
          "end": 1277
        },
        {
          "storyId": "story-studio-starter-demo",
          "turn": 8,
          "fingerprint": "yk-suiuck",
          "start": 645,
          "end": 694
        }
      ]
    },
    {
      "id": "review-3z-krnhz",
      "kind": "thread",
      "title": "Double beacon flash unexplained",
      "refs": [
        {
          "storyId": "story-studio-starter-demo",
          "turn": 2,
          "fingerprint": "vg-1wqke98",
          "start": 0,
          "end": 63
        }
      ]
    },
    {
      "id": "90a6b50d-f347-4148-8cd6-93c517bf7246",
      "kind": "thread",
      "title": "The filed-tooth key opens the log cabinet",
      "refs": [
        {
          "storyId": "story-studio-starter-demo",
          "turn": 4,
          "fingerprint": "ty-3tv54u",
          "start": 470,
          "end": 570
        },
        {
          "storyId": "story-studio-starter-demo",
          "turn": 6,
          "fingerprint": "117-101onab",
          "start": 0,
          "end": 75
        }
      ]
    }
  ]
};

export function createStarterStory() {
  return {id:starterStoryId,...structuredClone(starter)};
}

// Review examples are derived from this edition of the demo and have exact source anchors.
const reviewExamples = {
  pacing:[
    ['The scene switches from inspection to a decision', 'Three short phone exchanges break the slower examination of the log and turn the unknown tide figure into a decision to hold the ferry.',
      [2,"I'm holding you at the dock."]],
    ['The scene ends on a deliberate delay', 'The search through the records narrows to one choice, then stops on a short sentence. It gives the next scene a concrete decision to resolve.',
      [6,'She did not write yet.']],
    ['A signed decision, then a short open question', 'The jointly signed correction resolves the scene’s main decision. The single unanswered horn turns attention back to what the harbor is doing.',
      [8,'Nothing answered it.']],
    ['The second horn interrupts a quiet measurement', 'Noor takes time to record exactly what she knows. The next horn gives that quiet work urgency and moves the scene to a decision she can report.',
      [10,'The horn sounded again, one long note from the channel, lower than before.']]
  ],
  themes:[
    ['Preserving what the next person needs to see', 'Lina first protects a physical trace for someone else to inspect. Later she and Mae preserve the original beside a signed correction so others can distinguish observation from judgment.',
      [2,'Anyone who looked later would see what she saw.'],[8,'Original entry left as written. Cause of change not established.']],
    ['The burden of putting a name on the record', 'Mae treats signing as a personal admission. Sharing the correction changes the signature into a statement of what the two coworkers can actually establish.',
      [6,'If she wrote it, her name sat on the first admission.'],[8,'Mae initialed, then Lina.']],
    ['Evidence can agree without settling the question', 'Noor’s earlier log is a second record of 23:15. When the gauge is similar later that night, she records the new measurement separately so it cannot be mistaken for another record of the earlier tide.',
      [6,'Her own line for 23:15 read 3.1, timed and initialed.'],[10,'The two figures agreed closely, but one did not prove the other.']]
  ],
  threads:[
    ['Will Mae sign the correction?', 'Mae reaches for the pen and stops. She follows through with Lina, on a separate sheet the two can stand behind.',
      [6,'She did not write yet.'],[8,'Mae initialed, then Lina.']],
    ['Who left the key at the tide-board?', 'Sam discovers a key prepared for someone to find. The cabinet opens later, while the person who left the key is still unidentified.',
      [4,'Wasn\'t me who put it there.']],
    ['What is making the horn calls?', 'The horn repeats with a lower note. Noor has enough to report it and still hasn’t found the source.',
      [10,'The horn sounded again, one long note from the channel, lower than before.']]
  ],
  continuity:[]
};

export function starterReview(project) {
  const base = new Map(sceneIndex(createStarterStory()).map(scene=>[scene.turn,scene]));
  const live = new Map(sceneIndex(project).map(scene=>[scene.turn,scene]));
  const withEvidence = ([title,detail,...sources])=>{
    const refs = sources.map(([turn,quote])=>{
      const scene = live.get(turn);
      if (!scene?.eligible || scene.fingerprint !== base.get(turn)?.fingerprint) return;
      const start = scene.text.indexOf(quote);
      if (start >= 0 && scene.text.lastIndexOf(quote) === start) return reference(scene,start,start + quote.length);
    });
    if (refs.every(Boolean)) return {id:reviewFindingId(title,refs),title,detail,refs};
  };
  const findings = Object.fromEntries(Object.entries(reviewExamples).map(([kind,entries])=>[kind,entries.map(withEvidence).filter(Boolean)]));
  const continuityExample = withEvidence(['Two tide readings can both be accurate',
    'Noor records 3.1 m at 23:15 and 3.0 m at 00:34. The timestamps explain the difference.',
    [6,'Her own line for 23:15 read 3.1, timed and initialed.'],[10,'00:34. Gauge reads 3.0 m. Current reading.']]);
  return {state:'demo',findings,continuityExample};
}

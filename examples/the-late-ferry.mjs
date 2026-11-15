import { captureGraphVersion } from '../public/graph-history.js';
import { starterStoryId } from '../public/library.js';

const storyStartAt = '1998-10-24T23:40';


const cast = [
  {
    id:'tomas', name:'Tomas Reyes', nickname:'Tom, Skipper',
    description:'Tomas, 41, captains the last ferry out of Bellwether. He grew up mending nets beside his grandmother and still tries to repair an object before asking who broke it. He can read the harbor by the sound of water under the pier. Two winters ago he missed a warning and spent a night towing a stranded boat home. Since then he repeats every safety instruction once, exactly as he gave it. He keeps a spool of red cord in his coat and shares the warm side of a wheelhouse without acknowledging it.',
    personality:'Patient in bad weather, stubborn when hurried. He gives people specific jobs to keep them steady.',
    scenario:'He needs a safe crossing and a way to explain the delay without promising a departure.',
    examples:'{{char}}: “First we light the latch. Then we find out which part actually needs convincing.”'
  },
  {
    id:'mae', name:'Mae Chen', nickname:'Mae from the bakery',
    description:'Mae, 35, runs the bakery opposite the ferry terminal and takes the last boat home most nights. She wraps unsold bread in yesterday’s local paper and remembers which passengers prefer the heel. As a teenager she volunteered at the lifeboat station and never forgot radio etiquette. She has heard three versions of the East Pier closure and trusts only the one she can put a date on. She is on friendly terms with Lina, though she bristles when Lina calls help a favor.',
    personality:'Warm, observant and dry. She can quiet a room by lowering her voice instead of raising it.',
    scenario:'She holds the spare radio at the ticket window and relays clear instructions to the waiting passengers.',
    examples:'{{char}}: “Late is a thing they can handle. Tell me what they need to do while they wait.”'
  },
  {
    id:'sam', name:'Sam Bell', nickname:'Sam at the desk',
    description:'Sam, 30, works the late ticket window while finishing a certification in electrical maintenance. They grew up on the hill above the terminal and learned to diagnose appliances by watching a parent repair jukeboxes. Sam has broad knowledge of the building and little authority over the harbor. Their shirt pocket holds a stub pencil, a small flashlight, and an unfinished resignation letter. Sam wants the night to end quietly, but they will volunteer when everyone else assumes a problem belongs to somebody else.',
    personality:'Curious, practical and a little too quick to take on extra work. Sam is the writer’s character.',
    scenario:'They can check ticket records, examine the failed departure board, or tell Lina what the power outage revealed.',
    examples:'{{char}}: “I can tell you which fuse went. You’re going to have to tell me why someone taped it in place.”'
  },
  {
    id:'noor', name:'Noor Ahmad', nickname:'Weather desk',
    description:'Noor, 27, keeps the overnight weather watch in a cinderblock office above East Pier. They moved to Bellwether for a six-month assignment and stayed after discovering that the local fishermen wanted the forecast before they wanted to know where Noor came from. They log wind shifts in pencil because ink froze on their first winter shift. Noor is familiar with the flaw in the east beacon and has been waiting three weeks for a written maintenance response.',
    personality:'Precise, kind and impatient with vague warnings. They put a measured observation before a prediction.',
    scenario:'They can verify the beacon’s flash pattern from shore and cross-check it against their weather log.',
    examples:'{{char}}: “Two white flashes, then dark. I’ve watched it repeat four times. That part I can tell you.”'
  },
  {
    id:'ellis', name:'Ellis Gray', nickname:'Ellis from Harbor Works',
    description:'Ellis, 58, maintains harbor equipment from a narrow workshop behind the terminal. He wears yellow rain trousers over whatever he had on at supper. He cares about the difference between a cheap repair and a dangerous shortcut, but he once wired in a temporary relay that was never replaced. He keeps maintenance slips in a battered tobacco tin and marks jobs he expects to revisit with a diagonal pencil line. His reserve hides embarrassment more often than indifference.',
    personality:'Slow to volunteer an explanation, generous with his tools. He becomes very direct when a job is genuinely unsafe.',
    scenario:'He can inspect the gate or trace the beacon relay, but his copy of the maintenance log has a page missing.',
    examples:'{{char}}: “I’ll tell you how they wired it. How they were meant to wire it is a different conversation.”'
  }
];

const ellisReply = "Ellis had the wiring diagram under his mug. He slid it free with one finger. “The lights can stay on. The gate itself is on the second breaker from the right. Switch that off before you try the key.” He waited for the click on the other end of the line, then drew a box around the breaker on his copy.\n\nA few minutes later the radio on his workbench came alive. “Bellwether terminal, this is Tomas. Gate’s open, Mae. Hold the passengers.” There was a pause long enough for Ellis to hear the gutter dripping outside. “The east beacon just flashed twice. Ask Noor what they can see from shore.”";
const lastTake = "Mae tucked the radio under her arm and carried the station book to the lamp at the ticket window. Three minutes after Tomas’s call, she found the place where the twenty-fourth should have been. A narrow strip of paper, with half a pencil line on it, still clung to the stitching.\n\nShe turned the book so Sam could see. “Noor keeps a duplicate above East Pier. Shall I call the weather desk?” She set the radio within reach and waited for channel three to clear.";
const alternative = "The log book opened too easily to the twenty-fifth. Mae ran her finger down the inside of the binding and felt a rough edge where the previous leaf had been cut. She laid the book beside Sam’s flashlight and tilted it toward the beam.\n\n“Noor will have the other copy,” she said. “I can ask them over the radio.” Mae nudged her bag of rolls away from the speaker and waited for the voice on channel three to finish.";

export function createStarterStory() {
  const story = {
    id:starterStoryId,
    title:'The Late Ferry',
    characterName:'Lina Park',
    characterNickname:'Dispatch, Lin',
    character:'Lina, 39, dispatches the night ferry from Bellwether terminal. She started out on deck and moved behind the ticket glass after a winter fall left one wrist easy to tire. She knows who is waiting for a ride, who can be asked to help and who needs to be told explicitly that they can sit down. She puts spare pencils in the drawer facing the same direction. When a crisis drags on, she cracks dry jokes to see who is still paying attention. She has worked with Tomas long enough to recognize his pauses over the radio.',
    personality:'Quick-witted, steady and careful with promises. She explains enough to let someone make their own decision.',
    scenario:'A dead departure board, a jammed dock gate and an unreliable beacon threaten the last crossing.',
    examples:'{{char}}: “One thing at a time, {{user}}. Start with the thing you saw, then tell me what you think it means.”',
    persona:'',
    cast:structuredClone(cast),
    storyWriterId:'sam',
    speakerId:'primary',
    storyStartAt,
    storyStartSource:'author',
    graphUpdates:true,
    lore:'Bellwether is a small harbor town in October 1998. Its last ferry takes shift workers and island residents across a narrow channel to Alder Island. The terminal has a low waiting room, an old electric departure board, a ticket window, and a staff door down to the dock gate. When the channel fills with fog, the captain verifies the shore beacons and waits for clearance before moving. The terminal, workshop and weather desk can reach one another on handheld radios. A mechanical key opens the gate from shore if the current is off. The weather desk keeps a duplicate paper log of beacon faults; dispatch records defects by hand in a clothbound station book. There are no smartphones. The present story starts late Saturday night as the weather turns.',
    notes:'Write a low-key harbor mystery in close third person. Use grounded dialogue and material details such as wet coats, the relay click and the sound of harbor water. Let new clues come from people solving ordinary problems. Leave Sam’s decisions and dialogue to the writer unless asked to narrate them.',
    authorNote:'Keep a seat in the waiting room for the reader. Make the next decision small and legible.',
    loreRules:'beacon, east pier | The east beacon should flash once every six seconds. Two close flashes signal a relay fault, and only the weather desk has a duplicate incident log.\nradio, channel | The terminal, skipper and weather desk share channel three. Give a clear callsign and wait for the other person to finish.\nmechanical key, gate latch | The backup key is in the red dispatch drawer. Isolate the gate circuit before using it.',
    continuity:'',
    relationships:[
      {from:'primary',to:'tomas',label:'Lina dispatches the ferry and trusts Tomas to make the final safety call.',turn:0,storyTime:storyStartAt},
      {from:'mae',to:'primary',label:'Mae usually brings Lina bread left over from the evening bake.',turn:0,storyTime:storyStartAt},
      {from:'ellis',to:'sam',label:'Ellis taught Sam where the terminal keeps its electrical diagrams.',turn:0,storyTime:storyStartAt},
      {from:'noor',to:'ellis',label:'Noor files beacon fault reports with Ellis at Harbor Works.',turn:0,storyTime:storyStartAt},
      {from:'tomas',to:'mae',label:'Tomas hands Mae the spare radio and asks her to relay dock updates.',turn:3,storyTime:'1998-10-24T23:55'},
      {from:"ellis",to:"sam",label:"Ellis tells Sam to isolate the gate circuit before using the mechanical key.",turn:5,storyTime:"1998-10-25T00:02"},
      {from:"tomas",to:"mae",label:"Tomas radios Mae that the gate is open and asks her to hold passengers while they check the beacon.",turn:5,storyTime:"1998-10-25T00:06"}
    ],
    messages:[
      {role:'assistant',speakerId:'primary',speakerName:'Lina Park',turnNumber:1,storyTime:storyStartAt,
        content:'At eleven-forty, the departure board went blank. Lina climbed down from the chair without plugging it back in. “Still one crossing,” she told the waiting room. “I’ll tell you when I know whether it’s ours.” Tomas came in from the dock with rain dripping from his cuffs. Mae set her paper bag of bread on the ticket counter and moved aside so he could speak.'},
      {role:'user',turnNumber:2,storyTime:'1998-10-24T23:49',
        content:'Sam set a flashlight beside the ticket till. “The waiting-room lights are on a different circuit. Did the dock lose power too?”'},
      {role:'assistant',speakerId:'tomas',speakerName:'Tomas Reyes',turnNumber:3,storyTime:'1998-10-24T23:55',
        content:'“Dock lights are on. The gate latch won’t move.” Tomas took the spare radio off its charging stand and set it beside Mae’s bread. “Could you relay updates to the waiting room? Channel three. Tell them we’ll speak again in ten minutes.” He checked that his own radio was on the same channel and nodded toward Lina’s flashlight. “First we light the latch.”'},
      {role:'user',turnNumber:4,storyTime:'1998-10-25T00:01',
        content:'The rain eased just after midnight. Sam fetched the mechanical key from the red dispatch drawer and called Ellis at the workshop. “Are we safe to use the manual lock with the dock lights on?”'},
      {role:'assistant',speakerId:'ellis',speakerName:'Ellis Gray',turnNumber:5,storyTime:'1998-10-25T00:06',
        content:ellisReply},
      {role:'assistant',speakerId:'mae',speakerName:'Mae Chen',turnNumber:6,storyTime:'1998-10-25T00:09',
        content:lastTake,alternatives:[lastTake,alternative],selectedAlternative:0,
        graphSuggestions:[{kind:"relationship",from:"Mae Chen",to:"Sam Bell",label:"Mae shows Sam the missing log page and offers to ask Noor for the duplicate.",storyTime:"1998-10-25T00:09"}]}
    ],
    nextTurn:7
  };
  captureGraphVersion(story,0);
  story.continuity = "Turn 5: The mechanical key opened the dock gate after its circuit was isolated. The crossing is on hold while the crew verifies the beacon's double flash.";
  captureGraphVersion(story,5);
  return story;
}

import { reference, reviewFindingId, sceneIndex } from '../public/revision.js';

const reviewExamples = {
  pacing:[
    ['The scene switches from inspection to a decision', 'Three short phone exchanges break the slower examination of the log and turn the unknown tide figure into a decision to hold the ferry.',
      [2,"I'm holding you at the dock."]],
    ['The scene ends on a deliberate delay', 'The search through the records narrows to one choice, then stops on a short sentence. It gives the next scene a concrete decision to resolve.',
      [6,'She did not write yet.']],
    ['A signed decision, then a short open question', 'The jointly signed correction resolves the scene’s main decision. The single unanswered horn turns attention back to what the harbor is doing.',
      [8,'Nothing answered it.']],
    ['The second horn interrupts a quiet measurement', 'Noor takes time to record exactly what she knows. The next horn gives that quiet work urgency and moves the scene to a decision she can report.',
      [10,'The horn sounded again, one long note from the channel, lower than before.']],
    ['The radio check gives way to a harder question', 'The short radio turns establish why the tender is waiting. The courier’s request slows the scene enough to let Tomas weigh what he can tell the hospital.',
      [12,'Tomas could have said soon. It would have been easy, and kind for about a minute.']],
    ['A clear order turns waiting into movement', 'Two independent reports and a formal clearance build to Sam casting off. The change to physical action gives the long wait a definite end.',
      [14,'Sam cast off the stern line and coiled it. The deck shivered as the engines took hold.']]
  ],
  themes:[
    ['Preserving what the next person needs to see', 'Lina first protects a physical trace for someone else to inspect. Later she and Mae preserve the original beside a signed correction so others can distinguish observation from judgment.',
      [2,'Anyone who looked later would see what she saw.'],[8,'Original entry left as written. Cause of change not established.']],
    ['The burden of putting a name on the record', 'Mae treats signing as a personal admission. Sharing the correction changes the signature into a statement of what the two coworkers can actually establish.',
      [6,'If she wrote it, her name sat on the first admission.'],[8,'Mae initialed, then Lina.']],
    ['Evidence can agree without settling the question', 'Noor’s earlier log is a second record of 23:15. When the gauge is similar later that night, she records the new measurement separately so it cannot be mistaken for another record of the earlier tide.',
      [6,'Her own line for 23:15 read 3.1, timed and initialed.'],[10,'The two figures agreed closely, but one did not prove the other.']],
    ['A report others can act on', 'Lina gives the hold a time and reason for Tomas to acknowledge. When the courier asks about crossing, Tomas gives them a dated update they can relay to the hospital.',
      [2,'Held, 23:42, signal and tide in question, courier aboard and informed.'],[12,"Tell them it's true as of 00:43"]]
  ],
  threads:[
    ['Will Mae sign the correction?', 'Mae reaches for the pen and stops. She follows through with Lina, on a separate sheet the two can stand behind.',
      [6,'She did not write yet.'],[8,'Mae initialed, then Lina.']],
    ['Who left the key at the tide-board?', 'Sam discovers a key prepared for someone to find. The cabinet opens later, while the person who left the key is still unidentified.',
      [4,"Wasn't me who put it there."]],
    ['What is making the horn calls?', 'The horn repeats with a lower note. Noor has enough to report it and still hasn’t found the source.',
      [10,'The horn sounded again, one long note from the channel, lower than before.']],
    ['Will Dispatch release the held ferry?', 'Lina orders the ferry to stay tied. Once two observers verify the beacon is working again, she gives the crew a departure time to log.',
      [2,"The beacon's showing double and the tide figure doesn't sit right. I'm holding you at the dock."],
      [14,"Ferry, you're cleared. Depart 01:07. Log it as such."]]
  ],
  continuity:[
    ['Check the number of horn calls', 'Noor has counted two calls when she heads back to the office. Tomas hears another before his 00:43 update, where he also says the horn has sounded twice. Check whether he is reporting all calls since the hold or only the ones he knows about.',
      [10,'She would also tell her the horn had come twice, and that the gauge said only what the water was doing now.'],
      [12,'A horn has sounded twice from the channel, and nobody knows whose.']]
  ]
};

const continuityExample = ['Two tide readings can both be accurate',
  'Noor records 3.1 m at 23:15 and 3.0 m at 00:34. The timestamps explain the difference.',
  [6,'Her own line for 23:15 read 3.1, timed and initialed.'],[10,'00:34. Gauge reads 3.0 m. Current reading.']];

export function buildStarterReview(project,edition) {
  // These editorial observations only apply to the unedited, eligible source scenes.
  const originals = new Map(sceneIndex(edition).map(scene=>[scene.turn,scene.text]));
  const live = new Map(sceneIndex(project).map(scene=>[scene.turn,scene]));
  const withEvidence = ([title,detail,...sources])=>{
    const refs = sources.map(([turn,quote])=>{
      const scene = live.get(turn);
      if (!scene?.eligible || scene.text !== originals.get(turn)) return;
      const start = scene.text.indexOf(quote);
      if (start >= 0 && scene.text.lastIndexOf(quote) === start) return reference(scene,start,start + quote.length);
    });
    if (refs.every(Boolean)) return {id:reviewFindingId(title,refs),title,detail,refs};
  };
  const findings = Object.fromEntries(Object.entries(reviewExamples).map(([kind,entries])=>[kind,entries.map(withEvidence).filter(Boolean)]));
  return {state:'demo',findings,continuityExample:withEvidence(continuityExample)};
}

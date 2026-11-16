export function isWritingRefusal(text) {
  // Some hosts report a conversational refusal as an ordinary completion.
  // Match explicit assistant phrasing at the start so dialogue can use it.
  const sceneRefusal = /^this (?:isn['’]t|is not) appropriate for our collaborative storytelling environment\b/i;
  const decline = /^(?:i['’]m sorry[, .]+(?:but\s+)?)?i (?:can['’]t|cannot|won['’]t) (?:help (?:with|write|create|generate)|write|create|generate|provide|continue)\s+(?:(?:that|this) request|(?:sexually |graphic(?:ally)? )?explicit (?:content|material|scenes?))\b/i;
  return sceneRefusal.test(text) || decline.test(text);
}

export function stripWritingPreamble(prose) {
  const breakAt = prose.search(/\r?\n[ \t]*\r?\n/);
  const end = breakAt < 0 ? prose.length : breakAt;
  const opening = prose.slice(0,end);
  const aside = /(^|[.!?][ \t]+)I(?:['’]ve| have) been (?:instructed|asked) to write (?:(?:approximately|about|around) )?\d[\d,]* words\b[^.!?\r\n]*(?:[.!?](?=[ \t]|$)|$)/i.exec(opening);
  if (!aside) return prose;
  const before = opening.slice(0,aside.index + aside[1].length);
  if ((before.match(/"/g) || []).length % 2 || before.lastIndexOf('“') > before.lastIndexOf('”')) return prose;
  const after = opening.slice(aside.index + aside[0].length);
  const cleanOpening = [before.trim(),after.trim()].filter(Boolean).join(' ');
  return (cleanOpening + prose.slice(end)).trim();
}

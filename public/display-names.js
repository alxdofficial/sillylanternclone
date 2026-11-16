const nameCharacter = '[\\p{L}\\p{M}\\p{N}\\p{Pc}]';

export function createDisplayNameMatcher(entries) {
  const names = new Map(entries);
  if (!names.size) return null;
  const alternatives = [...names.keys()].sort((left,right) => right.length - left.length)
    .map(name => name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
  const pattern = new RegExp(`(?<!${nameCharacter})(?:${alternatives.join('|')})(?!${nameCharacter})`,'gu');
  return text => {
    const segments = [];
    let start = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > start) segments.push({text:text.slice(start,match.index)});
      segments.push({text:names.get(match[0]),displayName:true});
      start = match.index + match[0].length;
    }
    if (start < text.length) segments.push({text:text.slice(start)});
    return segments;
  };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDisplayNameMatcher } from '../public/display-names.js';

test('display names match exact whole names once and prefer longer names', () => {
  const match = createDisplayNameMatcher([['Rhea','Jess'],['Felix','Rhea'],['Rhea Voss','June'],['Åsa','Ada'],['A. Park','Anna']]);
  assert.equal(match('Rhea Voss, Rhea’s note to Felix, Åsa and A. Park. RHEA, rhea, Rheanna, Rhea2, Åsa_jr.'),
    'June, Jess’s note to Rhea, Ada and Anna. RHEA, rhea, Rheanna, Rhea2, Åsa_jr.');
  assert.equal(createDisplayNameMatcher([]),null);
});

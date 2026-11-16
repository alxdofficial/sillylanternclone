import assert from 'node:assert/strict';
import test from 'node:test';
import { createDisplayNameMatcher } from '../public/display-names.js';

test('display names match exact whole names once and prefer longer names', () => {
  const match = createDisplayNameMatcher([['Rhea','Jess'],['Felix','Rhea'],['Rhea Voss','June'],['Åsa','Ada'],['A. Park','Anna']]);
  assert.deepEqual(match('Rhea Voss, Rhea’s note to Felix, Åsa and A. Park. RHEA, rhea, Rheanna, Rhea2, Åsa_jr.'),[
    {text:'June',displayName:true},
    {text:', '},
    {text:'Jess',displayName:true},
    {text:'’s note to '},
    {text:'Rhea',displayName:true},
    {text:', '},
    {text:'Ada',displayName:true},
    {text:' and '},
    {text:'Anna',displayName:true},
    {text:'. RHEA, rhea, Rheanna, Rhea2, Åsa_jr.'}
  ]);
  assert.equal(createDisplayNameMatcher([]),null);
});

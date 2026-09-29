import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOfflineQuery } from './geminiService.js';

test('resolveOfflineQuery can map Crocin to the local medicine database without Groq', async () => {
  const result = await resolveOfflineQuery('Crocin');
  assert.ok(result && result.saltComposition, 'expected a local salt match');
  assert.match(result.saltComposition.toLowerCase(), /paracetamol|acetaminophen|crocin/);
});

test('resolveOfflineQuery can map Dolo 650 to Paracetamol 650mg without Groq', async () => {
  const result = await resolveOfflineQuery('Dolo 650');
  assert.ok(result && result.saltComposition, 'expected a local Dolo salt match');
  assert.match(result.saltComposition.toLowerCase(), /paracetamol|acetaminophen/);
  assert.match(result.saltComposition.toLowerCase(), /650mg|650 mg/);
});

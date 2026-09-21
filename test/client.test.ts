import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveApiKey, apiKeyFilePath } from '../src/client.js';

const home = '/home/someone';

test('resolveApiKey prefers the environment variable', () => {
  const key = resolveApiKey({
    env: { TYPESAFE_API_KEY: 'from-env' },
    home,
    readFile: () => 'from-file\n',
  });
  assert.equal(key, 'from-env');
});

test('resolveApiKey falls back to ~/.config/typesafe/api_key, trimmed', () => {
  let asked: string | undefined;
  const key = resolveApiKey({
    env: {},
    home,
    readFile: (p: string) => {
      asked = p;
      return '  from-file \n';
    },
  });
  assert.equal(key, 'from-file');
  assert.equal(asked, apiKeyFilePath(home));
  assert.equal(apiKeyFilePath(home), '/home/someone/.config/typesafe/api_key');
});

test('resolveApiKey ignores a whitespace-only env value', () => {
  const key = resolveApiKey({ env: { TYPESAFE_API_KEY: '   ' }, home, readFile: () => 'from-file' });
  assert.equal(key, 'from-file');
});

test('resolveApiKey returns undefined when neither source has a key', () => {
  const key = resolveApiKey({ env: {}, home, readFile: () => undefined });
  assert.equal(key, undefined);
});

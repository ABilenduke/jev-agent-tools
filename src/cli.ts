#!/usr/bin/env node
import { createJudge } from './client.js';
import { runCli } from './cli-core.js';

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

runCli(process.argv.slice(2), {
  stdin: readStdin,
  judge: () => createJudge(),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
}).then((code) => process.exit(code));

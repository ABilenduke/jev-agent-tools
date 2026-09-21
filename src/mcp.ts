#!/usr/bin/env node
/**
 * MCP server exposing Jev to Claude: `jev_rank` for bulk ranking, `jev_ask` for raw
 * System One requests. Stdio transport; the API key comes from the environment or the
 * key file (see client.ts).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { EntryType, Questions } from '@typesafe-ai/sdk';
import { createJudge, MissingApiKeyError } from './client.js';
import type { Judge } from './judge.js';
import { rank } from './rank.js';
import { askInput, rankInput } from './schemas.js';

let judge: Judge | undefined;
function getJudge(): Judge {
  judge ??= createJudge();
  return judge;
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

const server = new McpServer({ name: 'jev', version: '0.1.0' });

server.registerTool(
  'jev_rank',
  {
    title: 'Rank candidates with Jev',
    description:
      'Rank many candidates against one query using Jev, a fast calibrated judgment model. Returns exists (probability any candidate satisfies the query), verdict (present|partial|absent), and ranked ids with probabilities, best first. Use instead of reading every item when there are more than ~20. Not for arithmetic, dates or counting.',
    inputSchema: rankInput.shape,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (input) => {
    try {
      const parsed = rankInput.parse(input);
      const result = await rank(getJudge(), {
        query: parsed.query,
        candidates: parsed.candidates,
        mode: parsed.mode,
        ...(parsed.top === undefined ? {} : { top: parsed.top }),
      });
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: { ...result } };
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  'jev_ask',
  {
    title: 'Ask Jev typed questions',
    description:
      'Raw TypeSafe System One request: one state plus named questions of type noul (yes/no probability), choice (distribution over named options) or score (weighted position on 2-10 ordered levels). Independent questions run in parallel in one call. Returns answers keyed by question name with probabilities. Send minimal state.',
    inputSchema: askInput.shape,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (input) => {
    try {
      const parsed = askInput.parse(input);
      const result = await getJudge()({ state: parsed.state as EntryType, questions: parsed.questions as Questions });
      const payload = { model: result.model, answers: result.answers, usage: result.usage };
      return { content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload };
    } catch (error) {
      return errorResult(error);
    }
  },
);

async function main(): Promise<void> {
  try {
    getJudge();
  } catch (error) {
    if (error instanceof MissingApiKeyError) process.stderr.write(`${error.message}\n`);
  }
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  process.stderr.write(`jev mcp server failed: ${String(error)}\n`);
  process.exit(1);
});

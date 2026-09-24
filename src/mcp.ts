#!/usr/bin/env node
/**
 * MCP server exposing Jev to agents without a shell: `jev_rank` for bulk ranking, `jev_check` for
 * yes/no conditions, `jev_classify` for labelling, `jev_ask` for raw System One requests. Stdio transport; the API key comes from the environment or the
 * key file (see client.ts).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { EntryType, Questions } from '@typesafe-ai/sdk';
import { check } from './check.js';
import { classify } from './classify.js';
import { createJudge, MissingApiKeyError } from './client.js';
import type { Judge } from './judge.js';
import { lintRequest } from './lint.js';
import { rank } from './rank.js';
import { askInput, checkInput, classifyInput, rankInput } from './schemas.js';
import { VERSION } from './version.js';

let judge: Judge | undefined;
function getJudge(): Judge {
  judge ??= createJudge();
  return judge;
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

const server = new McpServer({ name: 'jev', version: VERSION });

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
  'jev_check',
  {
    title: 'Check yes/no conditions with Jev',
    description:
      'Check several conditions against one subject in one request. Write each condition as a plain sentence ("adds a public export"); the question wording is fixed. Returns per condition a probability and a verdict: true, false or unsure. Not for arithmetic, dates or counting.',
    inputSchema: checkInput.shape,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (input) => {
    try {
      const parsed = checkInput.parse(input);
      const result = await check(getJudge(), { subject: parsed.subject as EntryType, conditions: parsed.conditions });
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: { ...result } };
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  'jev_classify',
  {
    title: 'Label items with Jev',
    description:
      'Label each candidate with one of a few named options, one isolated request per item. A "none" option is added unless given. Returns per item the label and its probability, plus counts per label.',
    inputSchema: classifyInput.shape,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (input) => {
    try {
      const parsed = classifyInput.parse(input);
      const result = await classify(getJudge(), {
        options: parsed.options,
        items: parsed.candidates,
        ...(parsed.query === undefined ? {} : { query: parsed.query }),
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
      'Raw TypeSafe System One request: one state plus named questions of type noul (yes/no probability), choice (distribution over named options) or score (weighted position on 2-10 ordered levels). Independent questions run in parallel in one call. Returns answers keyed by question name with probabilities, and warnings about likely mistakes in the request. Prefer jev_check or jev_classify when they fit. Send minimal state.',
    inputSchema: askInput.shape,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (input) => {
    try {
      const parsed = askInput.parse(input);
      const warnings = lintRequest(parsed.state, parsed.questions);
      const result = await getJudge()({ state: parsed.state as EntryType, questions: parsed.questions as Questions });
      const payload = { model: result.model, answers: result.answers, usage: result.usage, ...(warnings.length > 0 ? { warnings } : {}) };
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

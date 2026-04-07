/**
 * Query the knowledge base using index-guided retrieval (no RAG).
 */

import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { KNOWLEDGE_DIR, QA_DIR, ROOT_DIR, nowIso } from "./config.js";
import { runAgentPrompt } from "./agent.js";
import { loadState, readAllWikiContent, saveState } from "./utils.js";

type Args = { question?: string; fileBack: boolean };

function parseArgs(argv: string[]): Args {
  const fileBack = argv.includes("--file-back");
  const positional = argv.slice(2).filter((a, i, arr) => a !== "--file-back" && arr[i - 1] !== "--file-back");
  return { question: positional[0], fileBack };
}

async function runQuery(question: string, fileBack: boolean): Promise<{ answer: string; cost: number }> {
  const wikiContent = readAllWikiContent();
  const tools = ["Read", "Glob", "Grep"];
  if (fileBack) tools.push("Write", "Edit");

  let fileBackInstructions = "";
  if (fileBack) {
    const timestamp = nowIso();
    fileBackInstructions = `

## File Back Instructions

After answering, do the following:
1. Create a Q&A article at ${QA_DIR}/ with the filename being a slugified version
   of the question (e.g., knowledge/qa/how-to-handle-auth-redirects.md)
2. Use the Q&A article format from the schema (frontmatter with title, question,
   consulted articles, filed date)
3. Update ${resolve(KNOWLEDGE_DIR, "index.md")} with a new row for this Q&A article
4. Append to ${resolve(KNOWLEDGE_DIR, "log.md")}:
   ## [${timestamp}] query (filed) | question summary
   - Question: ${question}
   - Consulted: [[list of articles read]]
   - Filed to: [[qa/article-name]]
`;
  }

  const prompt = `You are a knowledge base query engine. Answer the user's question by
consulting the knowledge base below.

## How to Answer

1. Read the INDEX section first - it lists every article with a one-line summary
2. Identify 3-10 articles that are relevant to the question
3. Read those articles carefully (they're included below)
4. Synthesize a clear, thorough answer
5. Cite your sources using [[wikilinks]] (e.g., [[concepts/supabase-auth]])
6. If the knowledge base doesn't contain relevant information, say so honestly

## Knowledge Base

${wikiContent}

## Question

${question}
${fileBackInstructions}`;

  try {
    const result = await runAgentPrompt(prompt, {
      cwd: ROOT_DIR,
      allowedTools: tools.map((name) => name.toLowerCase()),
      maxTurns: 15,
    });
    const answer = result.assistantText || result.resultText || "(No answer returned)";
    return { answer, cost: result.totalCostUsd };
  } catch (error) {
    return { answer: `Error querying knowledge base: ${String(error)}`, cost: 0 };
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv);
  if (!args.question) {
    console.log("Usage: npx tsx scripts/query.ts \"<question>\" [--file-back]");
    return 1;
  }

  console.log(`Question: ${args.question}`);
  console.log(`File back: ${args.fileBack ? "yes" : "no"}`);
  console.log("-".repeat(60));

  const { answer, cost } = await runQuery(args.question, args.fileBack);
  console.log(answer);

  const state = loadState();
  state.query_count += 1;
  state.total_cost += cost;
  saveState(state);

  if (args.fileBack) {
    console.log(`\n${"-".repeat(60)}`);
    const qaCount = existsSync(QA_DIR)
      ? readdirSync(QA_DIR).filter((f) => f.endsWith(".md")).length
      : 0;
    console.log(`Answer filed to knowledge/qa/ (${qaCount} Q&A articles total)`);
  }

  return 0;
}

main().then((code) => process.exit(code));

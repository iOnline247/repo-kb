/**
 * Compile daily conversation logs into structured knowledge articles.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AGENTS_FILE, CONCEPTS_DIR, CONNECTIONS_DIR, DAILY_DIR, KNOWLEDGE_DIR, ROOT_DIR, nowIso } from "./config.js";
import { runAgentPrompt } from "./agent.js";
import { fileHash, filename, listRawFiles, listWikiArticles, loadState, readWikiIndex, relativeToKnowledge, saveState } from "./utils.js";

type Args = {
  all: boolean;
  file?: string;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  return {
    all: argv.includes("--all"),
    dryRun: argv.includes("--dry-run"),
    file: argv.find((arg, index) => index > 1 && argv[index - 1] === "--file"),
  };
}

async function compileDailyLog(logPath: string, state: ReturnType<typeof loadState>): Promise<number> {
  const logContent = readFileSync(logPath, "utf-8");
  const schema = readFileSync(AGENTS_FILE, "utf-8");
  const wikiIndex = readWikiIndex();

  const existing: Record<string, string> = {};
  for (const articlePath of listWikiArticles()) {
    existing[relativeToKnowledge(articlePath)] = readFileSync(articlePath, "utf-8");
  }

  const existingArticlesContext = Object.entries(existing)
    .map(([relPath, content]) => `### ${relPath}\n\`\`\`markdown\n${content}\n\`\`\``)
    .join("\n\n");

  const timestamp = nowIso();

  const prompt = `You are a knowledge compiler. Your job is to read a daily conversation log
and extract knowledge into structured wiki articles.

## Schema (AGENTS.md)

${schema}

## Current Wiki Index

${wikiIndex}

## Existing Wiki Articles

${existingArticlesContext || "(No existing articles yet)"}

## Daily Log to Compile

**File:** ${filename(logPath)}

${logContent}

## Your Task

Read the daily log above and compile it into wiki articles following the schema exactly.

### Rules:

1. **Extract key concepts** - Identify 3-7 distinct concepts worth their own article
2. **Create concept articles** in \`knowledge/concepts/\` - One .md file per concept
   - Use the exact article format from AGENTS.md (YAML frontmatter + sections)
   - Include \`sources:\` in frontmatter pointing to the daily log file
   - Use \`[[concepts/slug]]\` wikilinks to link to related concepts
   - Write in encyclopedia style - neutral, comprehensive
3. **Create connection articles** in \`knowledge/connections/\` if this log reveals non-obvious
   relationships between 2+ existing concepts
4. **Update existing articles** if this log adds new information to concepts already in the wiki
   - Read the existing article, add the new information, add the source to frontmatter
5. **Update knowledge/index.md** - Add new entries to the table
   - Each entry: \`| [[path/slug]] | One-line summary | source-file | ${timestamp.slice(0, 10)} |\`
6. **Append to knowledge/log.md** - Add a timestamped entry:
   \`\`\`
   ## [${timestamp}] compile | ${filename(logPath)}
   - Source: daily/${filename(logPath)}
   - Articles created: [[concepts/x]], [[concepts/y]]
   - Articles updated: [[concepts/z]] (if any)
   \`\`\`

### File paths:
- Write concept articles to: ${CONCEPTS_DIR}
- Write connection articles to: ${CONNECTIONS_DIR}
- Update index at: ${resolve(KNOWLEDGE_DIR, "index.md")}
- Append log at: ${resolve(KNOWLEDGE_DIR, "log.md")}

### Quality standards:
- Every article must have complete YAML frontmatter
- Every article must link to at least 2 other articles via [[wikilinks]]
- Key Points section should have 3-5 bullet points
- Details section should have 2+ paragraphs
- Related Concepts section should have 2+ entries
- Sources section should cite the daily log with specific claims extracted`;

  try {
    const { totalCostUsd } = await runAgentPrompt(prompt, {
      cwd: ROOT_DIR,
      allowedTools: ["read", "write", "edit", "glob", "grep"],
      maxTurns: 30,
    });
    console.log(`  Cost: $${totalCostUsd.toFixed(4)}`);

    const rel = filename(logPath);
    state.ingested[rel] = {
      hash: fileHash(logPath),
      compiled_at: nowIso(),
      cost_usd: totalCostUsd,
    };
    state.total_cost += totalCostUsd;
    saveState(state);
    return totalCostUsd;
  } catch (error) {
    console.log(`  Error: ${String(error)}`);
    return 0;
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv);
  const state = loadState();

  let toCompile: string[] = [];
  if (args.file) {
    const maybeDaily = resolve(DAILY_DIR, filename(args.file));
    const target = existsSync(maybeDaily) ? maybeDaily : resolve(ROOT_DIR, args.file);
    if (!existsSync(target)) {
      console.log(`Error: ${args.file} not found`);
      return 1;
    }
    toCompile = [target];
  } else {
    const allLogs = listRawFiles();
    if (args.all) {
      toCompile = allLogs;
    } else {
      toCompile = allLogs.filter((logPath) => {
        const rel = filename(logPath);
        const prev = state.ingested[rel];
        return !prev || prev.hash !== fileHash(logPath);
      });
    }
  }

  if (toCompile.length === 0) {
    console.log("Nothing to compile - all daily logs are up to date.");
    return 0;
  }

  console.log(`${args.dryRun ? "[DRY RUN] " : ""}Files to compile (${toCompile.length}):`);
  for (const file of toCompile) console.log(`  - ${filename(file)}`);
  if (args.dryRun) return 0;

  let totalCost = 0;
  for (let i = 0; i < toCompile.length; i += 1) {
    const logPath = toCompile[i];
    console.log(`\n[${i + 1}/${toCompile.length}] Compiling ${filename(logPath)}...`);
    totalCost += await compileDailyLog(logPath, state);
    console.log("  Done.");
  }

  console.log(`\nCompilation complete. Total cost: $${totalCost.toFixed(2)}`);
  console.log(`Knowledge base: ${listWikiArticles().length} articles`);
  return 0;
}

main().then((code) => process.exit(code));

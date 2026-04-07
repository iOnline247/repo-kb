/**
 * Memory flush agent - extracts important knowledge from conversation context.
 *
 * Usage:
 *   npx tsx scripts/flush.ts <context_file.md> <session_id>
 */

process.env.COPILOT_INVOKED_BY = "memory_flush";

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

import { DAILY_DIR, ROOT_DIR, SCRIPTS_DIR } from "./config.js";
import { runAgentPrompt } from "./agent.js";

type FlushState = {
  session_id?: string;
  timestamp?: number;
};

const STATE_FILE = resolve(SCRIPTS_DIR, "last-flush.json");
const LOG_FILE = resolve(SCRIPTS_DIR, "flush.log");
const COMPILE_AFTER_HOUR = 18;

function log(message: string, level: "INFO" | "ERROR" = "INFO"): void {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  appendFileSync(LOG_FILE, `${ts} ${level} ${message}\n`, "utf-8");
}

function loadFlushState(): FlushState {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as FlushState;
  } catch {
    return {};
  }
}

function saveFlushState(state: FlushState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state), "utf-8");
}

function formatDateLocal(date: Date): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatTimeLocal(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function appendToDailyLog(content: string, section = "Session"): void {
  const now = new Date();
  const logPath = resolve(DAILY_DIR, `${formatDateLocal(now)}.md`);

  if (!existsSync(logPath)) {
    mkdirSync(DAILY_DIR, { recursive: true });
    writeFileSync(logPath, `# Daily Log: ${formatDateLocal(now)}\n\n## Sessions\n\n## Memory Maintenance\n\n`, "utf-8");
  }

  const entry = `### ${section} (${formatTimeLocal(now)})\n\n${content}\n\n`;
  appendFileSync(logPath, entry, "utf-8");
}

async function runFlush(context: string): Promise<string> {
  const prompt = `Review the conversation context below and respond with a concise summary
of important items that should be preserved in the daily log.
Do NOT use any tools - just return plain text.

Format your response as a structured daily log entry with these sections:

**Context:** [One line about what the user was working on]

**Key Exchanges:**
- [Important Q&A or discussions]

**Decisions Made:**
- [Any decisions with rationale]

**Lessons Learned:**
- [Gotchas, patterns, or insights discovered]

**Action Items:**
- [Follow-ups or TODOs mentioned]

Skip anything that is:
- Routine tool calls or file reads
- Content that's trivial or obvious
- Trivial back-and-forth or clarification exchanges

Only include sections that have actual content. If nothing is worth saving,
respond with exactly: FLUSH_OK

## Conversation Context

${context}`;

  try {
    const { assistantText, resultText } = await runAgentPrompt(prompt, {
      cwd: ROOT_DIR,
      allowedTools: [],
      maxTurns: 2,
    });
    return (assistantText || resultText).trim();
  } catch (error) {
    log(`Agent SDK error: ${String(error)}`, "ERROR");
    return `FLUSH_ERROR: ${String(error)}`;
  }
}

function maybeTriggerCompilation(): void {
  const now = new Date();
  if (now.getHours() < COMPILE_AFTER_HOUR) return;

  const todayLog = `${formatDateLocal(now)}.md`;
  const compileStateFile = resolve(SCRIPTS_DIR, "state.json");

  if (existsSync(compileStateFile)) {
    try {
      const compileState = JSON.parse(readFileSync(compileStateFile, "utf-8")) as {
        ingested?: Record<string, { hash?: string }>;
      };
      const ingested = compileState.ingested ?? {};
      if (todayLog in ingested) {
        const logPath = resolve(DAILY_DIR, todayLog);
        if (existsSync(logPath)) {
          const currentHash = createHash("sha256").update(readFileSync(logPath)).digest("hex").slice(0, 16);
          if (ingested[todayLog]?.hash === currentHash) return;
        }
      }
    } catch {
      // Ignore state parse errors and continue.
    }
  }

  const compileScript = resolve(SCRIPTS_DIR, "compile.ts");
  if (!existsSync(compileScript)) return;

  log(`End-of-day compilation triggered (after ${COMPILE_AFTER_HOUR}:00)`);

  try {
    const fd = openSync(resolve(SCRIPTS_DIR, "compile.log"), "a");
    const child = spawn("npx", ["--no-install", "tsx", compileScript], {
      cwd: ROOT_DIR,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", fd, fd],
    });
    child.unref();
  } catch (error) {
    log(`Failed to spawn compile.ts: ${String(error)}`, "ERROR");
  }
}

async function main(): Promise<number> {
  if (process.argv.length < 4) {
    log(`Usage: ${process.argv[1]} <context_file.md> <session_id>`, "ERROR");
    return 1;
  }

  const contextFile = process.argv[2];
  const sessionId = process.argv[3];
  log(`flush.ts started for session ${sessionId}, context: ${contextFile}`);

  if (!existsSync(contextFile)) {
    log(`Context file not found: ${contextFile}`, "ERROR");
    return 0;
  }

  const state = loadFlushState();
  if (state.session_id === sessionId && Date.now() / 1000 - (state.timestamp ?? 0) < 60) {
    log(`Skipping duplicate flush for session ${sessionId}`);
    try {
      unlinkSync(contextFile);
    } catch {
      // Ignore.
    }
    return 0;
  }

  const context = readFileSync(contextFile, "utf-8").trim();
  if (!context) {
    log("Context file is empty, skipping");
    try {
      unlinkSync(contextFile);
    } catch {
      // Ignore.
    }
    return 0;
  }

  log(`Flushing session ${sessionId}: ${context.length} chars`);
  const response = await runFlush(context);

  if (response.includes("FLUSH_OK")) {
    log("Result: FLUSH_OK");
    appendToDailyLog("FLUSH_OK - Nothing worth saving from this session", "Memory Flush");
  } else if (response.includes("FLUSH_ERROR")) {
    log(`Result: ${response}`, "ERROR");
    appendToDailyLog(response, "Memory Flush");
  } else {
    log(`Result: saved to daily log (${response.length} chars)`);
    appendToDailyLog(response, "Session");
  }

  saveFlushState({ session_id: sessionId, timestamp: Date.now() / 1000 });

  try {
    unlinkSync(contextFile);
  } catch {
    // Ignore.
  }

  maybeTriggerCompilation();
  log(`Flush complete for session ${sessionId}`);
  return 0;
}

main().then((code) => process.exit(code));

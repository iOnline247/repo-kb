/**
 * SessionEnd hook - captures conversation transcript for memory extraction.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { extractConversationContext, resolveHookInvocation, safeSessionId } from "./transcript.js";

if (process.env.COPILOT_INVOKED_BY) {
  process.exit(0);
}

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const SCRIPTS_DIR = resolve(ROOT, "scripts");
const STATE_DIR = SCRIPTS_DIR;
const LOG_PATH = resolve(SCRIPTS_DIR, "flush.log");

const MAX_TURNS = 30;
const MAX_CONTEXT_CHARS = 15_000;
const MIN_TURNS_TO_FLUSH = 1;

function log(message: string): void {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  appendFileSync(LOG_PATH, `${ts} INFO [hook] ${message}\n`, "utf-8");
}

function main(): void {
  const rawInput = readFileSync(0, "utf-8");

  let invocation: ReturnType<typeof resolveHookInvocation>;
  try {
    invocation = resolveHookInvocation(rawInput);
  } catch (error) {
    log(`Failed to parse stdin: ${String(error)}`);
    return;
  }

  const { sessionId, source, transcriptPath } = invocation;

  log(`SessionEnd fired: session=${sessionId} source=${source}`);

  if (!transcriptPath) {
    log("SKIP: no transcript path");
    return;
  }
  if (!existsSync(transcriptPath)) {
    log(`SKIP: transcript missing: ${transcriptPath}`);
    return;
  }

  let extracted: { context: string; turnCount: number };
  try {
    extracted = extractConversationContext(transcriptPath, MAX_TURNS, MAX_CONTEXT_CHARS);
  } catch (error) {
    log(`Context extraction failed: ${String(error)}`);
    return;
  }

  if (!extracted.context.trim()) {
    log("SKIP: empty context");
    return;
  }
  if (extracted.turnCount < MIN_TURNS_TO_FLUSH) {
    log(`SKIP: only ${extracted.turnCount} turns (min ${MIN_TURNS_TO_FLUSH})`);
    return;
  }

  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const contextFile = resolve(
    STATE_DIR,
    `session-flush-${safeSessionId(sessionId)}-${timestamp}.md`,
  );
  writeFileSync(contextFile, extracted.context, "utf-8");

  const cmd = [
    "npx",
    "--no-install",
    "tsx",
    resolve(SCRIPTS_DIR, "flush.ts"),
    contextFile,
    sessionId,
  ];

  try {
    const child = spawn(cmd[0], cmd.slice(1), {
      cwd: ROOT,
      stdio: "ignore",
      detached: false,
      windowsHide: true,
    });
    child.unref();
    log(
      `Spawned flush.ts for session ${sessionId} (${extracted.turnCount} turns, ${extracted.context.length} chars)`,
    );
  } catch (error) {
    log(`Failed to spawn flush.ts: ${String(error)}`);
  }
}

main();

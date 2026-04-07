/**
 * SessionEnd hook - captures conversation transcript for memory extraction.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

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

function parseHookInput(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const fixed = raw.replace(/(?<!\\)\\(?!["\\])/g, "\\\\");
    return JSON.parse(fixed) as Record<string, unknown>;
  }
}

function normalizeContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }
    if (
      block &&
      typeof block === "object" &&
      "type" in block &&
      "text" in block &&
      (block as { type: unknown }).type === "text" &&
      typeof (block as { text: unknown }).text === "string"
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.join("\n");
}

function extractConversationContext(transcriptPath: string): { context: string; turnCount: number } {
  const turns: string[] = [];
  const lines = readFileSync(transcriptPath, "utf-8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    const msg =
      entry.message && typeof entry.message === "object"
        ? (entry.message as Record<string, unknown>)
        : entry;

    const role = msg.role;
    if (role !== "user" && role !== "assistant") continue;

    const content = normalizeContent(msg.content);
    if (!content.trim()) continue;

    const label = role === "user" ? "User" : "Assistant";
    turns.push(`**${label}:** ${content.trim()}\n`);
  }

  const recent = turns.slice(-MAX_TURNS);
  let context = recent.join("\n");

  if (context.length > MAX_CONTEXT_CHARS) {
    context = context.slice(-MAX_CONTEXT_CHARS);
    const boundary = context.indexOf("\n**");
    if (boundary > 0) context = context.slice(boundary + 1);
  }

  return { context, turnCount: recent.length };
}

function safeSessionId(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function main(): void {
  const rawInput = readFileSync(0, "utf-8");

  let hookInput: Record<string, unknown>;
  try {
    hookInput = parseHookInput(rawInput);
  } catch (error) {
    log(`Failed to parse stdin: ${String(error)}`);
    return;
  }

  const sessionId = typeof hookInput.session_id === "string" ? hookInput.session_id : "unknown";
  const source = typeof hookInput.source === "string" ? hookInput.source : "unknown";
  const transcriptPath =
    typeof hookInput.transcript_path === "string" ? hookInput.transcript_path : "";

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
    extracted = extractConversationContext(transcriptPath);
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

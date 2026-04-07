/**
 * SessionStart hook - injects knowledge base context into every conversation.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const KNOWLEDGE_DIR = resolve(ROOT, "knowledge");
const DAILY_DIR = resolve(ROOT, "daily");
const INDEX_FILE = resolve(KNOWLEDGE_DIR, "index.md");

const MAX_CONTEXT_CHARS = 20_000;
const MAX_LOG_LINES = 30;

function nowLocal(): Date {
  return new Date();
}

function readRecentLog(): string {
  const today = nowLocal();

  for (let offset = 0; offset < 2; offset += 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - offset);
    const dateStr = d.toISOString().slice(0, 10);
    const logPath = resolve(DAILY_DIR, `${dateStr}.md`);

    if (!existsSync(logPath)) continue;
    const lines = readFileSync(logPath, "utf-8").split(/\r?\n/);
    const recent = lines.length > MAX_LOG_LINES ? lines.slice(-MAX_LOG_LINES) : lines;
    return recent.join("\n");
  }

  return "(no recent daily log)";
}

function buildContext(): string {
  const parts: string[] = [];
  const today = nowLocal();

  parts.push(
    `## Today\n${today.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "2-digit",
      year: "numeric",
    })}`,
  );

  if (existsSync(INDEX_FILE)) {
    const indexContent = readFileSync(INDEX_FILE, "utf-8");
    parts.push(`## Knowledge Base Index\n\n${indexContent}`);
  } else {
    parts.push("## Knowledge Base Index\n\n(empty - no articles compiled yet)");
  }

  parts.push(`## Recent Daily Log\n\n${readRecentLog()}`);

  let context = parts.join("\n\n---\n\n");
  if (context.length > MAX_CONTEXT_CHARS) {
    context = `${context.slice(0, MAX_CONTEXT_CHARS)}\n\n...(truncated)`;
  }
  return context;
}

const output = {
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: buildContext(),
  },
};

process.stdout.write(`${JSON.stringify(output)}\n`);

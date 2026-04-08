import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

export type HookInvocation = {
  sessionId: string;
  source: string;
  transcriptPath: string;
};

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function parseHookInput(raw: string): JsonRecord {
  try {
    return JSON.parse(raw) as JsonRecord;
  } catch {
    const fixed = raw.replace(/(?<!\\)\\(?!["\\])/g, "\\\\");
    return JSON.parse(fixed) as JsonRecord;
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

function getRoleAndContent(entry: JsonRecord): { role: "user" | "assistant"; content: string } | null {
  const legacyMessage =
    entry.message && typeof entry.message === "object" ? (entry.message as JsonRecord) : entry;
  const legacyRole = getString(legacyMessage.role);

  if (legacyRole === "user" || legacyRole === "assistant") {
    const legacyContent = normalizeContent(legacyMessage.content).trim();
    if (!legacyContent) return null;
    return { role: legacyRole, content: legacyContent };
  }

  const eventType = getString(entry.type);
  if (eventType !== "user.message" && eventType !== "assistant.message") return null;

  const data = entry.data && typeof entry.data === "object" ? (entry.data as JsonRecord) : {};
  const content = normalizeContent(data.content).trim();
  if (content) {
    return {
      role: eventType === "user.message" ? "user" : "assistant",
      content,
    };
  }

  if (eventType === "user.message") {
    const transformedContent = normalizeContent(data.transformedContent).trim();
    if (transformedContent) {
      return { role: "user", content: transformedContent };
    }
  }

  return null;
}

function deriveTranscriptPath(sessionId: string): string {
  if (!sessionId || sessionId === "unknown") return "";

  const candidate = resolve(homedir(), ".copilot", "session-state", sessionId, "events.jsonl");
  return existsSync(candidate) ? candidate : "";
}

export function resolveHookInvocation(raw: string): HookInvocation {
  const hookInput = parseHookInput(raw);

  const sessionId = getString(hookInput.session_id) ?? getString(hookInput.sessionId) ?? "unknown";
  const source =
    getString(hookInput.source) ??
    getString(hookInput.reason) ??
    getString(hookInput.hookEventName) ??
    "unknown";
  const transcriptPath =
    getString(hookInput.transcript_path) ??
    getString(hookInput.transcriptPath) ??
    deriveTranscriptPath(sessionId);

  return { sessionId, source, transcriptPath };
}

export function extractConversationContext(
  transcriptPath: string,
  maxTurns: number,
  maxContextChars: number,
): { context: string; turnCount: number } {
  const turns: string[] = [];
  const lines = readFileSync(transcriptPath, "utf-8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let entry: JsonRecord;
    try {
      entry = JSON.parse(trimmed) as JsonRecord;
    } catch {
      continue;
    }

    const message = getRoleAndContent(entry);
    if (!message) continue;

    const label = message.role === "user" ? "User" : "Assistant";
    turns.push(`**${label}:** ${message.content}\n`);
  }

  const recent = turns.slice(-maxTurns);
  let context = recent.join("\n");

  if (context.length > maxContextChars) {
    context = context.slice(-maxContextChars);
    const boundary = context.indexOf("\n**");
    if (boundary > 0) context = context.slice(boundary + 1);
  }

  return { context, turnCount: recent.length };
}

export function safeSessionId(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_");
}

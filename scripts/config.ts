import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const ROOT_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
export const DAILY_DIR = resolve(ROOT_DIR, "daily");
export const KNOWLEDGE_DIR = resolve(ROOT_DIR, "knowledge");
export const CONCEPTS_DIR = resolve(KNOWLEDGE_DIR, "concepts");
export const CONNECTIONS_DIR = resolve(KNOWLEDGE_DIR, "connections");
export const QA_DIR = resolve(KNOWLEDGE_DIR, "qa");
export const REPORTS_DIR = resolve(ROOT_DIR, "reports");
export const SCRIPTS_DIR = resolve(ROOT_DIR, "scripts");
export const HOOKS_DIR = resolve(ROOT_DIR, "hooks");
export const AGENTS_FILE = resolve(ROOT_DIR, "AGENTS.md");

export const INDEX_FILE = resolve(KNOWLEDGE_DIR, "index.md");
export const LOG_FILE = resolve(KNOWLEDGE_DIR, "log.md");
export const STATE_FILE = resolve(SCRIPTS_DIR, "state.json");

export const TIMEZONE = "America/Chicago";

export function nowIso(): string {
  const d = new Date();
  const tzOffset = -d.getTimezoneOffset();
  const sign = tzOffset >= 0 ? "+" : "-";
  const abs = Math.abs(tzOffset);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  const mon = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hour = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const sec = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mon}-${day}T${hour}:${min}:${sec}${sign}${hh}:${mm}`;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

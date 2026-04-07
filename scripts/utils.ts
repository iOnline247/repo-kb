import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";

import {
  CONCEPTS_DIR,
  CONNECTIONS_DIR,
  DAILY_DIR,
  INDEX_FILE,
  KNOWLEDGE_DIR,
  QA_DIR,
  STATE_FILE,
} from "./config.js";

export type CompilerState = {
  ingested: Record<
    string,
    {
      hash: string;
      compiled_at: string;
      cost_usd: number;
    }
  >;
  query_count: number;
  last_lint: string | null;
  total_cost: number;
};

const DEFAULT_STATE: CompilerState = {
  ingested: {},
  query_count: 0,
  last_lint: null,
  total_cost: 0,
};

export function loadState(): CompilerState {
  if (!existsSync(STATE_FILE)) return { ...DEFAULT_STATE };
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf-8")) as Partial<CompilerState>;
    return {
      ingested: parsed.ingested ?? {},
      query_count: parsed.query_count ?? 0,
      last_lint: parsed.last_lint ?? null,
      total_cost: parsed.total_cost ?? 0,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveState(state: CompilerState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

export function fileHash(path: string): string {
  const data = readFileSync(path);
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function extractWikilinks(content: string): string[] {
  return [...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
}

export function wikiArticleExists(link: string): boolean {
  return existsSync(resolve(KNOWLEDGE_DIR, `${link}.md`));
}

export function readWikiIndex(): string {
  if (existsSync(INDEX_FILE)) return readFileSync(INDEX_FILE, "utf-8");
  return "# Knowledge Base Index\n\n| Article | Summary | Compiled From | Updated |\n|---------|---------|---------------|---------|";
}

function listMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => resolve(dir, name));
}

export function readAllWikiContent(): string {
  const parts = [`## INDEX\n\n${readWikiIndex()}`];
  for (const subdir of [CONCEPTS_DIR, CONNECTIONS_DIR, QA_DIR]) {
    for (const mdFile of listMarkdownFiles(subdir)) {
      const rel = relative(KNOWLEDGE_DIR, mdFile).replaceAll("\\", "/");
      const content = readFileSync(mdFile, "utf-8");
      parts.push(`## ${rel}\n\n${content}`);
    }
  }
  return parts.join("\n\n---\n\n");
}

export function listWikiArticles(): string[] {
  return [CONCEPTS_DIR, CONNECTIONS_DIR, QA_DIR].flatMap((d) => listMarkdownFiles(d));
}

export function listRawFiles(): string[] {
  return listMarkdownFiles(DAILY_DIR);
}

export function countInboundLinks(target: string, excludeFile?: string): number {
  let count = 0;
  for (const article of listWikiArticles()) {
    if (excludeFile && resolve(article) === resolve(excludeFile)) continue;
    const content = readFileSync(article, "utf-8");
    if (content.includes(`[[${target}]]`)) count += 1;
  }
  return count;
}

export function getArticleWordCount(path: string): number {
  let content = readFileSync(path, "utf-8");
  if (content.startsWith("---")) {
    const end = content.indexOf("---", 3);
    if (end !== -1) content = content.slice(end + 3);
  }
  return content.trim() ? content.trim().split(/\s+/).length : 0;
}

export function buildIndexEntry(relPath: string, summary: string, sources: string, updated: string): string {
  const link = relPath.replace(/\.md$/, "");
  return `| [[${link}]] | ${summary} | ${sources} | ${updated} |`;
}

export function relativeToKnowledge(path: string): string {
  return relative(KNOWLEDGE_DIR, path).replaceAll("\\", "/");
}

export function filename(path: string): string {
  return basename(path);
}

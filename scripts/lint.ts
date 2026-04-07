/**
 * Lint the knowledge base for structural and semantic health.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { KNOWLEDGE_DIR, REPORTS_DIR, ROOT_DIR, nowIso, todayIso } from "./config.js";
import { runAgentPrompt } from "./agent.js";
import {
  countInboundLinks,
  extractWikilinks,
  fileHash,
  filename,
  getArticleWordCount,
  listRawFiles,
  listWikiArticles,
  loadState,
  readAllWikiContent,
  relativeToKnowledge,
  saveState,
  wikiArticleExists,
} from "./utils.js";

type Issue = {
  severity: "error" | "warning" | "suggestion";
  check: string;
  file: string;
  detail: string;
  auto_fixable?: boolean;
};

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function checkBrokenLinks(): Issue[] {
  const issues: Issue[] = [];
  for (const article of listWikiArticles()) {
    const content = readFileSync(article, "utf-8");
    const rel = relativeToKnowledge(article);
    for (const link of extractWikilinks(content)) {
      if (link.startsWith("daily/")) continue;
      if (!wikiArticleExists(link)) {
        issues.push({
          severity: "error",
          check: "broken_link",
          file: rel,
          detail: `Broken link: [[${link}]] - target does not exist`,
        });
      }
    }
  }
  return issues;
}

function checkOrphanPages(): Issue[] {
  const issues: Issue[] = [];
  for (const article of listWikiArticles()) {
    const rel = relativeToKnowledge(article);
    const target = rel.replace(/\.md$/, "").replaceAll("\\", "/");
    if (countInboundLinks(target) === 0) {
      issues.push({
        severity: "warning",
        check: "orphan_page",
        file: rel,
        detail: `Orphan page: no other articles link to [[${target}]]`,
      });
    }
  }
  return issues;
}

function checkOrphanSources(): Issue[] {
  const issues: Issue[] = [];
  const state = loadState();
  for (const logPath of listRawFiles()) {
    if (!(filename(logPath) in state.ingested)) {
      issues.push({
        severity: "warning",
        check: "orphan_source",
        file: `daily/${filename(logPath)}`,
        detail: `Uncompiled daily log: ${filename(logPath)} has not been ingested`,
      });
    }
  }
  return issues;
}

function checkStaleArticles(): Issue[] {
  const issues: Issue[] = [];
  const state = loadState();
  for (const logPath of listRawFiles()) {
    const rel = filename(logPath);
    const info = state.ingested[rel];
    if (info && info.hash !== fileHash(logPath)) {
      issues.push({
        severity: "warning",
        check: "stale_article",
        file: `daily/${rel}`,
        detail: `Stale: ${rel} has changed since last compilation`,
      });
    }
  }
  return issues;
}

function checkMissingBacklinks(): Issue[] {
  const issues: Issue[] = [];
  for (const article of listWikiArticles()) {
    const content = readFileSync(article, "utf-8");
    const rel = relativeToKnowledge(article);
    const sourceLink = rel.replace(/\.md$/, "").replaceAll("\\", "/");
    for (const link of extractWikilinks(content)) {
      if (link.startsWith("daily/")) continue;
      const targetPath = resolve(KNOWLEDGE_DIR, `${link}.md`);
      try {
        const targetContent = readFileSync(targetPath, "utf-8");
        if (!targetContent.includes(`[[${sourceLink}]]`)) {
          issues.push({
            severity: "suggestion",
            check: "missing_backlink",
            file: rel,
            detail: `[[${sourceLink}]] links to [[${link}]] but not vice versa`,
            auto_fixable: true,
          });
        }
      } catch {
        // Ignore missing targets; broken-link check already handles this.
      }
    }
  }
  return issues;
}

function checkSparseArticles(): Issue[] {
  const issues: Issue[] = [];
  for (const article of listWikiArticles()) {
    const wordCount = getArticleWordCount(article);
    if (wordCount < 200) {
      issues.push({
        severity: "suggestion",
        check: "sparse_article",
        file: relativeToKnowledge(article),
        detail: `Sparse article: ${wordCount} words (minimum recommended: 200)`,
      });
    }
  }
  return issues;
}

async function checkContradictions(): Promise<Issue[]> {
  const wikiContent = readAllWikiContent();
  const prompt = `Review this knowledge base for contradictions, inconsistencies, or
conflicting claims across articles.

## Knowledge Base

${wikiContent}

## Instructions

Look for:
- Direct contradictions (article A says X, article B says not-X)
- Inconsistent recommendations (different articles recommend conflicting approaches)
- Outdated information that conflicts with newer entries

For each issue found, output EXACTLY one line in this format:
CONTRADICTION: [file1] vs [file2] - description of the conflict
INCONSISTENCY: [file] - description of the inconsistency

If no issues found, output exactly: NO_ISSUES

Do NOT output anything else - no preamble, no explanation, just the formatted lines.`;

  try {
    const { assistantText, resultText } = await runAgentPrompt(prompt, {
      cwd: ROOT_DIR,
      allowedTools: [],
      maxTurns: 2,
    });
    const response = (assistantText || resultText).trim();
    if (!response || response.includes("NO_ISSUES")) return [];
    return response
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("CONTRADICTION:") || line.startsWith("INCONSISTENCY:"))
      .map((line) => ({
        severity: "warning" as const,
        check: "contradiction",
        file: "(cross-article)",
        detail: line,
      }));
  } catch (error) {
    return [
      {
        severity: "error",
        check: "contradiction",
        file: "(system)",
        detail: `LLM check failed: ${String(error)}`,
      },
    ];
  }
}

function generateReport(allIssues: Issue[]): string {
  const errors = allIssues.filter((i) => i.severity === "error");
  const warnings = allIssues.filter((i) => i.severity === "warning");
  const suggestions = allIssues.filter((i) => i.severity === "suggestion");

  const lines: string[] = [
    `# Lint Report - ${todayIso()}`,
    "",
    `**Total issues:** ${allIssues.length}`,
    `- Errors: ${errors.length}`,
    `- Warnings: ${warnings.length}`,
    `- Suggestions: ${suggestions.length}`,
    "",
  ];

  for (const [title, issues, marker] of [
    ["Errors", errors, "x"],
    ["Warnings", warnings, "!"],
    ["Suggestions", suggestions, "?"],
  ] as const) {
    if (issues.length === 0) continue;
    lines.push(`## ${title}`, "");
    for (const issue of issues) {
      const fixable = issue.auto_fixable ? " (auto-fixable)" : "";
      lines.push(`- **[${marker}]** \`${issue.file}\` - ${issue.detail}${fixable}`);
    }
    lines.push("");
  }

  if (allIssues.length === 0) {
    lines.push("All checks passed. Knowledge base is healthy.", "");
  }

  return lines.join("\n");
}

async function main(): Promise<number> {
  const structuralOnly = hasFlag("--structural-only");
  console.log("Running knowledge base lint checks...");

  const checks: Array<[string, () => Issue[]]> = [
    ["Broken links", checkBrokenLinks],
    ["Orphan pages", checkOrphanPages],
    ["Orphan sources", checkOrphanSources],
    ["Stale articles", checkStaleArticles],
    ["Missing backlinks", checkMissingBacklinks],
    ["Sparse articles", checkSparseArticles],
  ];

  const allIssues: Issue[] = [];
  for (const [name, check] of checks) {
    console.log(`  Checking: ${name}...`);
    const issues = check();
    allIssues.push(...issues);
    console.log(`    Found ${issues.length} issue(s)`);
  }

  if (!structuralOnly) {
    console.log("  Checking: Contradictions (LLM)...");
    const issues = await checkContradictions();
    allIssues.push(...issues);
    console.log(`    Found ${issues.length} issue(s)`);
  } else {
    console.log("  Skipping: Contradictions (--structural-only)");
  }

  const report = generateReport(allIssues);
  mkdirSync(REPORTS_DIR, { recursive: true });
  const reportPath = resolve(REPORTS_DIR, `lint-${todayIso()}.md`);
  writeFileSync(reportPath, report, "utf-8");
  console.log(`\nReport saved to: ${reportPath}`);

  const state = loadState();
  state.last_lint = nowIso();
  saveState(state);

  const errors = allIssues.filter((i) => i.severity === "error").length;
  const warnings = allIssues.filter((i) => i.severity === "warning").length;
  const suggestions = allIssues.filter((i) => i.severity === "suggestion").length;
  console.log(`\nResults: ${errors} errors, ${warnings} warnings, ${suggestions} suggestions`);
  if (errors > 0) {
    console.log("\nErrors found - knowledge base needs attention!");
    return 1;
  }
  return 0;
}

main().then((code) => process.exit(code));

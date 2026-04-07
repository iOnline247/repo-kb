# LLM Personal Knowledge Base

**Your AI conversations compile themselves into a searchable knowledge base.**

Adapted from [Karpathy's LLM Knowledge Base](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) architecture, but instead of clipping web articles, the raw data is your own conversations with Copilot CLI. When a session ends (or auto-compacts mid-session), hooks capture the conversation transcript and spawn a background process that uses the [GitHub Copilot SDK](https://github.com/github/copilot-sdk) to extract the important stuff - decisions, lessons learned, patterns, gotchas - and appends it to a daily log. You then compile those daily logs into structured, cross-referenced knowledge articles organized by concept. Retrieval uses a simple index file instead of RAG - no vector database, no embeddings, just markdown.

The TypeScript runtime uses the GitHub Copilot SDK and your local Copilot authentication context.

## Quick Start

Tell your AI coding agent:

> "Clone <https://github.com/iOnline247/repo-kb> into this project. Set up the hooks so my conversations automatically get captured into daily logs, compiled into a knowledge base, and injected back into future sessions. Read the AGENTS.md for the full technical reference on how everything works."

The agent will:

1. Clone the repo and run `npm install` to install dependencies
2. Copy `.claude/settings.json` (Use this location if you use Claude and GHCP) into your project (or merge the hooks into your existing settings)
3. The hooks activate automatically next time you open GHCP

From there, your conversations start accumulating. After 6 PM local time, the next session flush automatically triggers compilation of that day's logs into knowledge articles. You can also run `npm run compile` manually at any time.

## How It Works

```text
Conversation -> SessionEnd/PreCompact hooks -> flush.ts extracts knowledge
    -> daily/YYYY-MM-DD.md -> compile.ts -> knowledge/concepts/, connections/, qa/
        -> SessionStart hook injects index into next session -> cycle repeats
```

- **Hooks** capture conversations automatically (session end + pre-compaction safety net)
- **flush.ts** calls the GitHub Copilot SDK to decide what's worth saving, and after 6 PM triggers end-of-day compilation automatically
- **compile.ts** turns daily logs into organized concept articles with cross-references (triggered automatically or run manually)
- **query.ts** answers questions using index-guided retrieval (no RAG needed at personal scale)
- **lint.ts** runs 7 health checks (broken links, orphans, contradictions, staleness)

## Key Commands

```bash
npm run compile                                     # compile new daily logs
npm run query -- "question"                         # ask the knowledge base
npm run query -- "question" --file-back             # ask + save answer back
npm run lint:kb                                     # run health checks
npm run lint:kb:structural                          # free structural checks only
```

## Why No RAG?

Karpathy's insight: at personal scale (50-500 articles), the LLM reading a structured `index.md` outperforms vector similarity. The LLM understands what you're really asking; cosine similarity just finds similar words. RAG becomes necessary at ~2,000+ articles when the index exceeds the context window.

## Technical Reference

See **[AGENTS.md](AGENTS.md)** for the complete technical reference: article formats, hook architecture, script internals, cross-platform details, costs, and customization options. AGENTS.md is designed to give an AI agent everything it needs to understand, modify, or rebuild the system.

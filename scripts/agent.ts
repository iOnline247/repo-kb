import { CopilotClient, approveAll, type SessionConfig } from "@github/copilot-sdk";

export type AgentRunOptions = {
  cwd: string;
  model?: string;
  allowedTools?: string[];
  maxTurns?: number;
  systemPrompt?: string | { type: string; preset?: string };
};

function toSessionConfig(promptOptions: AgentRunOptions): SessionConfig {
  const config: SessionConfig = {
    onPermissionRequest: approveAll,
    workingDirectory: promptOptions.cwd,
    model: promptOptions.model,
  };

  if (promptOptions.allowedTools && promptOptions.allowedTools.length === 0) {
    config.availableTools = [];
  }

  if (typeof promptOptions.systemPrompt === "string" && promptOptions.systemPrompt.trim()) {
    config.systemMessage = { mode: "append", content: promptOptions.systemPrompt };
  }

  return config;
}

export async function runAgentPrompt(
  prompt: string,
  options: AgentRunOptions,
): Promise<{ assistantText: string; resultText: string; totalCostUsd: number }> {
  const client = new CopilotClient({ cwd: options.cwd, useLoggedInUser: true });
  try {
    const session = await client.createSession(toSessionConfig(options));
    const response = await session.sendAndWait({ prompt }, 120_000);
    await session.disconnect();
    await client.stop();
    const content = response?.data.content ?? "";
    return { assistantText: content, resultText: content, totalCostUsd: 0 };
  } catch (error) {
    await client.stop();
    throw error;
  }
}

export interface AppConfig {
  provider: "echo" | "deepseek";
  deepseekApiKey?: string;
  deepseekModel: string;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const provider = env.CODING_AGENT_PROVIDER?.trim().toLowerCase() || "echo";
  if (provider !== "echo" && provider !== "deepseek") {
    throw new Error("CODING_AGENT_PROVIDER must be echo or deepseek");
  }

  return {
    provider,
    deepseekApiKey: env.DEEPSEEK_API_KEY,
    deepseekModel: env.DEEPSEEK_MODEL?.trim() || "deepseek-flash",
  };
}

import { readConfig } from "./config.js";
import { DeepSeekProvider } from "./providers/deepseek.js";
import { EchoProvider } from "./providers/echo.js";
import type { Provider } from "./provider.js";

export function createProvider(env: NodeJS.ProcessEnv = process.env): Provider {
  const config = readConfig(env);
  if (config.provider === "deepseek") {
    return new DeepSeekProvider({
      apiKey: config.deepseekApiKey ?? "",
      model: config.deepseekModel,
    });
  }
  return new EchoProvider();
}

import type { Provider } from "./provider.js";
import { EchoProvider } from "./providers/echo.js";

export function createProvider(): Provider {
  return new EchoProvider();
}

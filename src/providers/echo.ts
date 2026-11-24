import type { Provider, ProviderResponse } from "../provider.js";

export class EchoProvider implements Provider {
  async answer(question: string): Promise<ProviderResponse> {
    return { text: `Echo: ${question}` };
  }
}

import {
  ProviderError,
  type FetchLike,
  type Provider,
  type ProviderResponse,
} from "../provider.js";

const DEFAULT_ENDPOINT = "https://api.deepseek.com/chat/completions";
const DEFAULT_TIMEOUT_MS = 30_000;

interface DeepSeekOptions {
  apiKey: string;
  model: string;
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

interface DeepSeekResponse {
  id?: unknown;
  model?: unknown;
  choices?: Array<{ message?: { content?: unknown } }>;
}

export class DeepSeekProvider implements Provider {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: DeepSeekOptions) {
    if (!options.apiKey.trim()) {
      throw new ProviderError("missing_api_key", "DEEPSEEK_API_KEY is required");
    }
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async answer(question: string): Promise<ProviderResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          model: this.options.model,
          messages: [{ role: "user", content: question }],
          stream: false,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ProviderError("timeout", "DeepSeek request timed out");
      }
      throw new ProviderError("network_error", "DeepSeek request failed");
    } finally {
      clearTimeout(timeout);
    }

    const elapsedMs = Date.now() - startedAt;
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError("authentication_failed", `DeepSeek authentication failed (${response.status})`, response.status);
    }
    if (!response.ok) {
      throw new ProviderError("http_error", `DeepSeek returned HTTP ${response.status}`, response.status);
    }

    let payload: DeepSeekResponse;
    try {
      payload = (await response.json()) as DeepSeekResponse;
    } catch {
      throw new ProviderError("invalid_json", "DeepSeek returned invalid JSON", response.status);
    }

    const id = typeof payload.id === "string" ? payload.id : "";
    const model = typeof payload.model === "string" ? payload.model : "";
    const text = payload.choices?.[0]?.message?.content;
    if (!id || !model || typeof text !== "string" || !text.trim()) {
      throw new ProviderError("invalid_response", "DeepSeek response is missing required fields", response.status);
    }

    return {
      text,
      diagnostics: {
        method: "POST",
        url: this.endpoint,
        status: response.status,
        model,
        responseId: id,
        elapsedMs,
      },
    };
  }
}

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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCompletion(body: string) {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new ProviderError("invalid_json", "DeepSeek returned invalid JSON");
  }

  const invalid = () =>
    new ProviderError("invalid_response", "DeepSeek response is missing required fields");
  if (!isObject(payload)) throw invalid();

  const { id, model, choices } = payload;
  const choice: unknown = Array.isArray(choices) ? choices[0] : undefined;
  const message = isObject(choice) ? choice.message : undefined;
  const text = isObject(message) ? message.content : undefined;
  if (typeof id !== "string" || !id.trim() ||
      typeof model !== "string" || !model.trim() ||
      typeof text !== "string" || !text.trim()) {
    throw invalid();
  }

  const responseId = id.length <= 9
    ? "[redacted]"
    : `${id.slice(0, 8).replace(/[^\w-]/g, "_")}…`;
  return { text, model, responseId };
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

  async answer(question: string, signal?: AbortSignal): Promise<ProviderResponse> {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const cancel = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", cancel, { once: true });
    const startedAt = performance.now();
    const elapsedMs = () => Math.round(performance.now() - startedAt);
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let status: number | undefined;

    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        redirect: "manual",
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
      status = response.status;
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        if (status === 401 || status === 403) {
          throw new ProviderError("authentication_failed", `DeepSeek authentication failed (${status})`);
        }
        throw new ProviderError("http_error", `DeepSeek returned HTTP ${status}`);
      }

      const body = await response.text();
      const { text, model, responseId } = readCompletion(body);
      return {
        text,
        diagnostics: {
          method: "POST",
          url: this.endpoint,
          status,
          model,
          responseId,
          elapsedMs: elapsedMs(),
        },
      };
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof ProviderError) {
        throw new ProviderError(error.code, error.message, status, elapsedMs());
      }
      if (controller.signal.aborted) {
        throw new ProviderError("timeout", "DeepSeek request timed out", status, elapsedMs());
      }
      throw new ProviderError("network_error", "DeepSeek request failed", status, elapsedMs());
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
    }
  }
}

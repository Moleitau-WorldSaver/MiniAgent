export interface ProviderDiagnostics {
  method: string;
  url: string;
  status: number;
  model: string;
  responseId: string;
  elapsedMs: number;
}

export interface ProviderResponse {
  text: string;
  diagnostics?: ProviderDiagnostics;
}

export interface Provider {
  answer(question: string, signal: AbortSignal): Promise<ProviderResponse>;
}

export type FetchLike = typeof fetch;

export class ProviderError extends Error {
  constructor(
    public readonly code:
      | "missing_api_key"
      | "authentication_failed"
      | "http_error"
      | "timeout"
      | "network_error"
      | "invalid_json"
      | "invalid_response",
    message: string,
    public readonly status?: number,
    public readonly elapsedMs?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

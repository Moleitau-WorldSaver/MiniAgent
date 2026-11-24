export interface ProviderResponse {
  text: string;
}

export interface Provider {
  answer(question: string, signal: AbortSignal): Promise<ProviderResponse>;
}

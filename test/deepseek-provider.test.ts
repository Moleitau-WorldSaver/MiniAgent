import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { DeepSeekProvider } from "../src/providers/deepseek.js";
import { ProviderError } from "../src/provider.js";

async function withServer(handler: (body: string, headers: Record<string, string | string[] | undefined>) => { status: number; body: string; delayMs?: number }, run: (endpoint: string) => Promise<void>) {
  const server = createServer(async (request, response) => {
    let body = "";
    request.setEncoding("utf8");
    for await (const chunk of request) body += chunk;
    const result = handler(body, request.headers);
    if (result.delayMs) await new Promise((resolve) => setTimeout(resolve, result.delayMs));
    response.statusCode = result.status;
    response.setHeader("content-type", "application/json");
    response.end(result.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not start");
  try {
    await run(`http://127.0.0.1:${address.port}/chat/completions`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("DeepSeek provider sends the expected request and parses diagnostics", async () => {
  await withServer((body, headers) => {
    assert.equal(headers.authorization, "Bearer test-secret");
    assert.equal(headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(body), {
      model: "test-model",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    });
    return { status: 200, body: JSON.stringify({ id: "resp-1", model: "test-model", choices: [{ message: { content: "world" } }] }) };
  }, async (endpoint) => {
    const result = await new DeepSeekProvider({ apiKey: "test-secret", model: "test-model", endpoint }).answer("hello");
    assert.equal(result.text, "world");
    assert.deepEqual(result.diagnostics && { ...result.diagnostics, elapsedMs: 0 }, {
      method: "POST", url: endpoint, status: 200, model: "test-model", responseId: "resp-1", elapsedMs: 0,
    });
  });
});

test("DeepSeek provider maps authentication, HTTP, JSON, response and timeout failures", async (t) => {
  await t.test("authentication", async () => {
    await withServer(() => ({ status: 401, body: "{}" }), async (endpoint) => {
      await assert.rejects(() => new DeepSeekProvider({ apiKey: "secret", model: "m", endpoint }).answer("x"), (error: unknown) => error instanceof ProviderError && error.code === "authentication_failed" && !error.message.includes("secret"));
    });
  });
  await t.test("HTTP", async () => {
    await withServer(() => ({ status: 500, body: "{}" }), async (endpoint) => {
      await assert.rejects(() => new DeepSeekProvider({ apiKey: "secret", model: "m", endpoint }).answer("x"), (error: unknown) => error instanceof ProviderError && error.code === "http_error");
    });
  });
  await t.test("invalid JSON", async () => {
    await withServer(() => ({ status: 200, body: "not-json" }), async (endpoint) => {
      await assert.rejects(() => new DeepSeekProvider({ apiKey: "secret", model: "m", endpoint }).answer("x"), (error: unknown) => error instanceof ProviderError && error.code === "invalid_json");
    });
  });
  await t.test("invalid response", async () => {
    await withServer(() => ({ status: 200, body: JSON.stringify({ id: "missing-content", model: "m", choices: [] }) }), async (endpoint) => {
      await assert.rejects(() => new DeepSeekProvider({ apiKey: "secret", model: "m", endpoint }).answer("x"), (error: unknown) => error instanceof ProviderError && error.code === "invalid_response");
    });
  });
  await t.test("timeout", async () => {
    await withServer(() => ({ status: 200, body: JSON.stringify({}), delayMs: 50 }), async (endpoint) => {
      await assert.rejects(() => new DeepSeekProvider({ apiKey: "secret", model: "m", endpoint, timeoutMs: 1 }).answer("x"), (error: unknown) => error instanceof ProviderError && error.code === "timeout");
    });
  });
});

test("DeepSeek provider rejects a missing API key without making a request", () => {
  assert.throws(() => new DeepSeekProvider({ apiKey: "", model: "m" }), (error: unknown) => error instanceof ProviderError && error.code === "missing_api_key");
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DeepSeekProvider } from "../src/providers/deepseek.js";
import { ProviderError, type Provider } from "../src/provider.js";

interface FixtureResponse {
  status: number;
  body: string;
  delayMs?: number;
  bodyDelayMs?: number;
  disconnect?: boolean;
}

async function withServer(
  handler: (body: string, request: IncomingMessage) => FixtureResponse,
  run: (endpoint: string) => Promise<void>,
) {
  const server = createServer(async (request, response) => {
    let body = "";
    request.setEncoding("utf8");
    for await (const chunk of request) body += chunk;
    const result = handler(body, request);
    response.statusCode = result.status;
    response.setHeader("content-type", "application/json");
    if (result.bodyDelayMs) response.flushHeaders();
    if (result.disconnect) response.write(result.body);

    const delay = result.delayMs ?? result.bodyDelayMs ?? (result.disconnect ? 30 : 0);
    const finish = () => {
      if (result.disconnect) response.destroy();
      else response.end(result.body);
    };
    if (delay) {
      const timer = setTimeout(finish, delay);
      response.once("close", () => clearTimeout(timer));
    } else {
      finish();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not start");
  try {
    await run(`http://127.0.0.1:${address.port}/chat/completions`);
  } finally {
    const closed = new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    server.closeAllConnections();
    await closed;
  }
}

const fixtureKey = "fixture-key-do-not-output";

function completion(id: string, text: string): string {
  return JSON.stringify({ id, model: "test-model", choices: [{ message: { content: text } }] });
}

async function runDeepSeekCli(endpoint: string, input: string) {
  // Redirect only the provider's production URL in this child. The fixture still
  // receives a real request through native fetch, and tests cannot call the cloud.
  const redirect = `
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = (url, options) => {
      const target = new URL(url);
      if (target.origin !== "https://api.deepseek.com") throw new Error("Unexpected test origin");
      return nativeFetch(new URL(target.pathname + target.search, ${JSON.stringify(endpoint)}), options);
    };
  `;
  const entry = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const child = spawn(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(redirect)}`, entry], {
    env: {
      ...process.env,
      CODING_AGENT_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: fixtureKey,
      DEEPSEEK_MODEL: "test-model",
    },
    stdio: "pipe",
    timeout: 5000,
  });

  let output = "";
  let errors = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { output += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { errors += chunk; });
  child.stdin.end(input);
  const [code] = await once(child, "close");
  return { code, output, errors };
}

test("DeepSeek provider sends the expected request and parses diagnostics", async () => {
  await withServer((body, { headers }) => {
    assert.equal(headers.authorization, "Bearer test-secret");
    assert.equal(headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(body), {
      model: "test-model",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    });
    return { status: 200, body: completion("resp-1", "world") };
  }, async (endpoint) => {
    const result = await new DeepSeekProvider({ apiKey: "test-secret", model: "test-model", endpoint }).answer("hello");
    assert.equal(result.text, "world");
    assert.deepEqual(result.diagnostics && { ...result.diagnostics, elapsedMs: 0 }, {
      method: "POST", url: endpoint, status: 200, model: "test-model", responseId: "[redacted]", elapsedMs: 0,
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

test("DeepSeek times out while reading a delayed response body", async () => {
  let sentHeaders = false;
  await withServer(() => {
    sentHeaders = true;
    return { status: 200, body: completion("slow-body", "too late"), bodyDelayMs: 1000 };
  }, async (endpoint) => {
    const provider = new DeepSeekProvider({ apiKey: fixtureKey, model: "test-model", endpoint, timeoutMs: 300 });
    await assert.rejects(provider.answer("hello"), { code: "timeout" });
    assert.equal(sentHeaders, true);
  });
});

test("DeepSeek counts the response body wait in elapsed time", async () => {
  await withServer(() => ({ status: 200, body: completion("delayed-body", "world"), bodyDelayMs: 120 }), async (endpoint) => {
    const provider = new DeepSeekProvider({ apiKey: fixtureKey, model: "test-model", endpoint });
    const result = await provider.answer("hello");
    assert.ok(result.diagnostics && result.diagnostics.elapsedMs >= 110);
  });
});

test("DeepSeek classifies a response body disconnect as a network error", async () => {
  await withServer(() => ({ status: 200, body: "{", disconnect: true }), async (endpoint) => {
    const provider = new DeepSeekProvider({ apiKey: fixtureKey, model: "test-model", endpoint });
    await assert.rejects(provider.answer("hello"), { code: "network_error" });
  });
});

test("DeepSeek aborts an in-flight request using the CLI signal", async () => {
  let arrived!: () => void;
  const requested = new Promise<void>((resolve) => { arrived = resolve; });
  await withServer(() => {
    arrived();
    return { status: 200, body: completion("cancelled-body", "too late"), bodyDelayMs: 250 };
  }, async (endpoint) => {
    const controller = new AbortController();
    const provider: Provider = new DeepSeekProvider({ apiKey: fixtureKey, model: "test-model", endpoint });
    const result = provider.answer("hello", controller.signal);
    await requested;
    controller.abort();
    await assert.rejects(result, (error) => error === controller.signal.reason);
  });
});

test("DeepSeek maps malformed completion shapes to invalid_response", async () => {
  const invalidBodies = [
    "null",
    "[]",
    "{}",
    JSON.stringify({ id: 1, model: "m", choices: [{ message: { content: "x" } }] }),
    JSON.stringify({ id: "id", model: "m", choices: { 0: { message: { content: "x" } } } }),
    JSON.stringify({ id: "id", model: "m", choices: [{ message: { content: 7 } }] }),
  ];
  for (const body of invalidBodies) {
    await withServer(() => ({ status: 200, body }), async (endpoint) => {
      const provider = new DeepSeekProvider({ apiKey: fixtureKey, model: "test-model", endpoint });
      await assert.rejects(provider.answer("hello"), { code: "invalid_response" });
      const result = await runDeepSeekCli(endpoint, "hello\n");
      assert.equal(result.code, 1);
      assert.match(result.errors, /^Error \[invalid_response\]/);
    });
  }
});

test("DeepSeek CLI receives two ordered answers and prints only redacted diagnostics", async (t) => {
  for (const quit of ["Q", "q"]) {
    await t.test(quit, async () => {
      const requests: unknown[] = [];
      const ids = ["first-remote-id", "second-remote-id"];
      await withServer((body, request) => {
        requests.push({
          method: request.method,
          url: request.url,
          authorization: request.headers.authorization,
          body: JSON.parse(body),
        });
        const index = requests.length;
        return { status: 200, body: completion(ids[index - 1], `answer ${index}`) };
      }, async (endpoint) => {
        const result = await runDeepSeekCli(endpoint, `one\n\ntwo\n${quit}\nignored\n`);
        assert.equal(result.code, 0);
        assert.deepEqual(requests, ["one", "two"].map((content) => ({
          method: "POST",
          url: "/chat/completions",
          authorization: `Bearer ${fixtureKey}`,
          body: { model: "test-model", messages: [{ role: "user", content }], stream: false },
        })));
        assert.equal(result.output, "answer 1\n请输入问题，空行不会发送请求。\nanswer 2\n");
        assert.match(result.errors, /status=200 model=test-model response_id=first-re… elapsed_ms=\d+ answer_non_empty=true/);
        assert.match(result.errors, /status=200 model=test-model response_id=second-r… elapsed_ms=\d+ answer_non_empty=true/);
        const combined = result.output + result.errors;
        assert.ok(ids.every((id) => !combined.includes(id)));
        assert.ok(!combined.includes(fixtureKey));
        assert.doesNotMatch(combined, /Authorization|Bearer/i);
      });
    });
  }
});

test("DeepSeek CLI reports authentication failures without leaking the response or key", async () => {
  for (const status of [401, 403]) {
    await withServer(() => ({ status, body: fixtureKey }), async (endpoint) => {
      const result = await runDeepSeekCli(endpoint, "hello\n");
      assert.equal(result.code, 1);
      assert.equal(result.output, "");
      assert.equal(result.errors, `Error [authentication_failed]: DeepSeek authentication failed (${status})\n`);
    });
  }
});

test("DeepSeek provider rejects a missing API key without making a request", () => {
  assert.throws(() => new DeepSeekProvider({ apiKey: "", model: "m" }), (error: unknown) => error instanceof ProviderError && error.code === "missing_api_key");
});

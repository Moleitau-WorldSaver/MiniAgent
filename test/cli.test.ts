import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCli } from "../src/cli.js";
import type { Provider } from "../src/provider.js";

function streams() {
  const input = new PassThrough();
  let outputText = "";
  let errorText = "";
  const output = new Writable({ write(chunk, _encoding, callback) { outputText += chunk.toString(); callback(); } });
  const errorOutput = new Writable({ write(chunk, _encoding, callback) { errorText += chunk.toString(); callback(); } });
  return { input, output, errorOutput, read: () => ({ outputText, errorText }) };
}

test("CLI processes two questions in order and exits on Q", async () => {
  const calls: string[] = [];
  const provider: Provider = { answer: async (question) => { calls.push(question); return { text: `answer:${question}` }; } };
  const io = streams();
  const result = runCli(provider, io);
  io.input.write(" first \n\nsecond\nQ\n");
  io.input.end();

  assert.equal(await result, 0);
  assert.deepEqual(calls, ["first", "second"]);
  assert.match(io.read().outputText, /answer:first/);
  assert.match(io.read().outputText, /空行不会发送请求/);
  assert.match(io.read().outputText, /answer:second/);
});

test("CLI exits on lowercase q without calling provider", async () => {
  let calls = 0;
  const provider: Provider = { answer: async () => { calls += 1; return { text: "unexpected" }; } };
  const io = streams();
  const result = runCli(provider, io);
  io.input.end("q\n");

  assert.equal(await result, 0);
  assert.equal(calls, 0);
});

test("CLI reports provider failures and returns nonzero", async () => {
  const provider: Provider = { answer: async () => { throw new Error("hidden details"); } };
  const io = streams();
  const result = runCli(provider, io);
  io.input.end("question\n");

  assert.equal(await result, 1);
  assert.equal(io.read().errorText, "Error [provider_error]: provider request failed\n");
});

test("CLI finishes buffered questions on EOF", async () => {
  const io = streams();
  const result = runCli({ answer: async (question) => ({ text: question }) }, io);
  io.input.end("first\nsecond");

  assert.equal(await result, 0);
  assert.equal(io.read().outputText, "first\nsecond\n");
});

test("CLI rejects invalid startup configuration before requesting an answer", async (t) => {
  const fixtureKey = "fixture-key-for-startup-test";
  const entry = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const rejectFetch = `
    globalThis.fetch = async () => {
      process.stderr.write("Unexpected fetch\\n");
      throw new Error("Unexpected fetch");
    };
  `;
  const invalidProvider = "Error: CODING_AGENT_PROVIDER must be echo or deepseek\n";
  const cases = [
    { name: "credential entered as provider", provider: fixtureKey, key: fixtureKey, message: invalidProvider },
    { name: "multiline provider", provider: "invalid\nprovider", key: fixtureKey, message: invalidProvider },
    { name: "missing DeepSeek key", provider: "deepseek", key: "", message: "Error [missing_api_key]: DEEPSEEK_API_KEY is required\n" },
  ];

  for (const { name, provider, key, message } of cases) {
    await t.test(name, () => {
      const result = spawnSync(process.execPath, [
        "--import", `data:text/javascript,${encodeURIComponent(rejectFetch)}`, entry,
      ], {
        env: { ...process.env, CODING_AGENT_PROVIDER: provider, DEEPSEEK_API_KEY: key },
        input: "first\nQ\n",
        encoding: "utf8",
        timeout: 5000,
      });

      assert.ifError(result.error);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, message);
    });
  }
});

test("terminal Ctrl-C exits even while input is paused under backpressure", async (t) => {
  for (const outcome of ["idle", "answer", "error"]) {
    await t.test(outcome, async () => {
      const entry = new URL("../src/cli.js", import.meta.url).href;
      const program = `
        import { runCli } from ${JSON.stringify(entry)};
        const outcome = ${JSON.stringify(outcome)};
        const { stdin, stdout } = process;
        stdin.isTTY = stdout.isTTY = true;
        let raw = false;
        stdin.setRawMode = (enabled) => { raw = enabled; return stdin; };
        // Model console delivery over a portable pipe: raw mode puts the key
        // on the input stream, while cooked mode delivers a process signal.
        function interrupt() {
          if (raw) {
            if (!stdin.isPaused()) stdin.emit("data", Buffer.from([3]));
          } else process.emit("SIGINT");
        }
        let calls = 0;
        let aborted = false;
        if (outcome === "idle") setImmediate(interrupt);
        else stdin.once("pause", () => setImmediate(() => {
          if (!calls) throw new Error("expected a turn in flight");
          process.stderr.write("input paused\\n");
          interrupt();
        }));
        const code = await runCli({
          async answer(_question, signal) {
            calls += 1;
            await new Promise((resolve, reject) => {
              signal.addEventListener("abort", () => {
                aborted = true;
                if (outcome === "error") reject(new Error("late failure"));
                else resolve();
              }, { once: true });
            });
            return { text: "late answer" };
          },
        });
        process.stderr.write(JSON.stringify({ code, calls, aborted }) + "\\n");
        process.exitCode = code;
      `;
      const child = spawn(process.execPath, ["--input-type=module", "-e", program], {
        stdio: "pipe",
        timeout: 5000,
      });
      let output = "";
      let errors = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => { output += chunk; });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        errors += chunk;
        if (errors.includes('"aborted":')) child.stdin.destroy();
      });
      child.stdin.on("error", () => {}); // The child may close stdin while data is buffered.
      if (outcome !== "idle") child.stdin.write("first\r\n" + "queued\r\n".repeat(1100));
      const [code] = await once(child, "close");

      assert.equal(code, 0, errors);
      assert.match(errors, /已退出/);
      assert.doesNotMatch(output, /late answer/);
      assert.doesNotMatch(errors, /Error/);
      const inFlight = outcome !== "idle";
      if (inFlight) assert.match(errors, /input paused/);
      assert.match(errors, new RegExp(JSON.stringify({ code: 0, calls: inFlight ? 1 : 0, aborted: inFlight })));
    });
  }
});

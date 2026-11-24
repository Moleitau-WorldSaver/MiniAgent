import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { runCli } from "../src/cli.js";
import type { Provider } from "../src/provider.js";

function streams(terminal = false) {
  const input = Object.assign(new PassThrough(), {
    isTTY: terminal,
    setRawMode: (_enabled: boolean) => input,
  });
  let outputText = "";
  let errorText = "";
  const output = Object.assign(
    new Writable({ write(chunk, _encoding, callback) { outputText += chunk.toString(); callback(); } }),
    { isTTY: terminal },
  );
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

test("Ctrl-C exits while waiting for input", async () => {
  const io = streams(true);
  const result = runCli({ answer: async () => assert.fail("unexpected question") }, io);
  io.input.end("\x03");

  assert.equal(await result, 0);
  assert.match(io.read().errorText, /已退出/);
});

test("Ctrl-C cancels the active turn and suppresses queued turns and late output", async (t) => {
  for (const outcome of ["answer", "error"]) {
    await t.test(outcome, async () => {
      const io = streams(true);
      let signal: AbortSignal | undefined;
      let resolveAnswer!: (result: { text: string }) => void;
      let rejectAnswer!: (error: Error) => void;
      const inFlight = new Promise<{ text: string }>((resolve, reject) => {
        resolveAnswer = resolve;
        rejectAnswer = reject;
      });
      const calls: string[] = [];
      const result = runCli({
        answer: (question, turnSignal?: AbortSignal) => {
          calls.push(question);
          signal = turnSignal;
          return inFlight;
        },
      }, io);
      io.input.write("first\rsecond\r");
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(calls, ["first"]);
      io.input.end("\x03");
      if (outcome === "answer") resolveAnswer({ text: "late answer" });
      else rejectAnswer(new Error("late failure"));

      assert.equal(await result, 0);
      assert.equal(signal?.aborted, true);
      assert.deepEqual(calls, ["first"]);
      assert.doesNotMatch(io.read().outputText, /late answer/);
      assert.doesNotMatch(io.read().errorText, /Error/);
    });
  }
});

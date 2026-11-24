import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
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

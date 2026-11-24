import assert from "node:assert/strict";
import test from "node:test";
import { EchoProvider } from "../src/providers/echo.js";

test("echo provider returns a predictable answer", async () => {
  const result = await new EchoProvider().answer("hello");
  assert.deepEqual(result, { text: "Echo: hello" });
});

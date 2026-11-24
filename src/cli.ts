import { createInterface } from "node:readline";
import { stdin, stdout, stderr } from "node:process";
import { pathToFileURL } from "node:url";
import { createProvider } from "./provider-factory.js";
import type { Provider } from "./provider.js";

export interface CliStreams {
  input: NodeJS.ReadableStream & { isTTY?: boolean };
  output: NodeJS.WritableStream & { isTTY?: boolean };
  errorOutput: NodeJS.WritableStream;
}

export async function runCli(
  provider: Provider,
  streams: CliStreams = { input: stdin, output: stdout, errorOutput: stderr },
): Promise<number> {
  const readline = createInterface({
    input: streams.input,
    output: streams.output,
    terminal: Boolean(streams.input.isTTY && streams.output.isTTY),
    crlfDelay: Infinity,
  });
  const controller = new AbortController();
  const { signal } = controller;
  const interrupt = () => {
    if (signal.aborted) return;
    controller.abort();
    readline.close();
    streams.errorOutput.write("\n已退出。\n");
  };
  readline.on("SIGINT", interrupt);
  if (streams.input === stdin) process.on("SIGINT", interrupt);

  try {
    for await (const rawLine of readline) {
      if (signal.aborted) return 0;
      const line = rawLine.trim();
      if (line === "Q" || line === "q") return 0;
      if (!line) {
        streams.output.write("请输入问题，空行不会发送请求。\n");
        continue;
      }

      try {
        const result = await provider.answer(line, signal);
        if (signal.aborted) return 0;
        streams.output.write(`${result.text}\n`);
      } catch {
        if (signal.aborted) return 0;
        streams.errorOutput.write("Error [provider_error]: provider request failed\n");
        return 1;
      }
    }
    return 0;
  } finally {
    readline.close();
    readline.off("SIGINT", interrupt);
    if (streams.input === stdin) process.off("SIGINT", interrupt);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const exitCode = await runCli(createProvider());
    process.exitCode = exitCode;
  } catch (error) {
    if (error instanceof Error) {
      stderr.write(`Error: ${error.message}\n`);
    }
    process.exitCode = 1;
  }
}

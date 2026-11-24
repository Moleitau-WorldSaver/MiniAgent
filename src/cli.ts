import { createInterface } from "node:readline";
import { stdin, stdout, stderr } from "node:process";
import { pathToFileURL } from "node:url";
import { createProvider } from "./provider-factory.js";
import { ProviderError, type Provider } from "./provider.js";

export interface CliStreams {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  errorOutput: NodeJS.WritableStream;
}

function formatProviderError(error: ProviderError): string {
  const timing = error.elapsedMs === undefined
    ? ""
    : ` status=${error.status ?? "unavailable"} elapsed_ms=${error.elapsedMs}`;
  return `Error [${error.code}]: ${error.message}${timing}\n`;
}

export async function runCli(
  provider: Provider,
  streams: CliStreams = { input: stdin, output: stdout, errorOutput: stderr },
): Promise<number> {
  const readline = createInterface({
    input: streams.input,
    // Keep the console in cooked mode so Ctrl-C arrives as a process signal
    // even while the line iterator has paused stdin for backpressure.
    terminal: false,
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
        if (result.diagnostics) {
          const { method, url, status, model, responseId, elapsedMs } = result.diagnostics;
          streams.errorOutput.write(
            `[request] method=${method} url=${url} status=${status} model=${model} response_id=${responseId} elapsed_ms=${elapsedMs} answer_non_empty=true\n`,
          );
        }
      } catch (error) {
        if (signal.aborted) return 0;
        if (error instanceof ProviderError) {
          streams.errorOutput.write(formatProviderError(error));
        } else {
          streams.errorOutput.write("Error [provider_error]: provider request failed\n");
        }
        return 1;
      }
    }
    return 0;
  } finally {
    readline.close();
    if (streams.input === stdin) process.off("SIGINT", interrupt);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const exitCode = await runCli(createProvider());
    process.exitCode = exitCode;
  } catch (error) {
    if (error instanceof ProviderError) {
      stderr.write(formatProviderError(error));
    } else if (error instanceof Error) {
      stderr.write(`Error: ${error.message}\n`);
    }
    process.exitCode = 1;
  }
}

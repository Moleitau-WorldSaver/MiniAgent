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

export async function runCli(
  provider: Provider,
  streams: CliStreams = { input: stdin, output: stdout, errorOutput: stderr },
): Promise<number> {
  const readline = createInterface({
    input: streams.input,
    output: streams.output,
    terminal: streams.input === stdin && streams.output === stdout,
    crlfDelay: Infinity,
  });
  let interrupted = false;
  readline.on("SIGINT", () => {
    interrupted = true;
    readline.close();
    streams.errorOutput.write("\n已退出。\n");
  });

  try {
    for await (const rawLine of readline) {
      if (interrupted) return 0;
      const line = rawLine.trim();
      if (line === "Q" || line === "q") return 0;
      if (!line) {
        streams.output.write("请输入问题，空行不会发送请求。\n");
        continue;
      }

      try {
        const result = await provider.answer(line);
        streams.output.write(`${result.text}\n`);
        if (result.diagnostics) {
          const { method, url, status, model, responseId, elapsedMs } = result.diagnostics;
          streams.errorOutput.write(
            `[request] method=${method} url=${url} status=${status} model=${model} response_id=${responseId} elapsed_ms=${elapsedMs} answer_non_empty=true\n`,
          );
        }
      } catch (error) {
        if (error instanceof ProviderError) {
          streams.errorOutput.write(`Error [${error.code}]: ${error.message}\n`);
        } else {
          streams.errorOutput.write("Error [provider_error]: provider request failed\n");
        }
        return 1;
      }
    }
    return 0;
  } finally {
    readline.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const exitCode = await runCli(createProvider());
    process.exitCode = exitCode;
  } catch (error) {
    if (error instanceof ProviderError) {
      stderr.write(`Error [${error.code}]: ${error.message}\n`);
    } else if (error instanceof Error) {
      stderr.write(`Error: ${error.message}\n`);
    }
    process.exitCode = 1;
  }
}

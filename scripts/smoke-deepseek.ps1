$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($env:DEEPSEEK_API_KEY)) {
  throw "DEEPSEEK_API_KEY is required"
}

$previousProvider = $env:CODING_AGENT_PROVIDER
try {
  $env:CODING_AGENT_PROVIDER = "deepseek"
  $PSNativeCommandUseErrorActionPreference = $false
  "你是谁？请用一句中文回答", "二加二等于几？请简短回答", "Q" | npm.cmd run start
  $smokeExitCode = $LASTEXITCODE
} finally {
  $env:CODING_AGENT_PROVIDER = $previousProvider
}
exit $smokeExitCode

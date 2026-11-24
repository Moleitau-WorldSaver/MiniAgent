$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($env:DEEPSEEK_API_KEY)) {
  throw "DEEPSEEK_API_KEY is required"
}

if ([string]::IsNullOrWhiteSpace($env:DEEPSEEK_MODEL)) {
  $env:DEEPSEEK_MODEL = "deepseek-flash"
}
$env:CODING_AGENT_PROVIDER = "deepseek"

"你是谁？请用一句中文回答", "二加二等于几？请简短回答", "Q" | npm.cmd run start
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

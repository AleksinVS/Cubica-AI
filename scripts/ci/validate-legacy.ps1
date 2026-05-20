<# 
Cross-platform wrapper for the Node.js legacy/stub validator.

Stub means a temporary replacement or simplified implementation that must be
registered before merge.

Usage:
  pwsh scripts/ci/validate-legacy.ps1
#>

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$validator = Join-Path $repoRoot "scripts\ci\validate-legacy.js"

node $validator @args
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

<# 
Проверка реестра заглушек (stubs — временные подмены/упрощения) и журнала долга.

Цель скрипта:
- убедиться, что `docs/legacy/stubs-register.md` ссылается на существующие `LEGACY-*` из `docs/legacy/debt-log.csv`;
- убедиться, что для активных записей в CSV путь `stub_reference` существует в репозитории.

Запуск:
  pwsh scripts/ci/validate-legacy.ps1
#>

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
  Write-Error $Message
  exit 1
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path
$debtLogPath = Join-Path $repoRoot "docs\\legacy\\debt-log.csv"
$stubsRegisterPath = Join-Path $repoRoot "docs\\legacy\\stubs-register.md"

if (!(Test-Path $debtLogPath)) { Fail "Не найден файл: docs/legacy/debt-log.csv" }
if (!(Test-Path $stubsRegisterPath)) { Fail "Не найден файл: docs/legacy/stubs-register.md" }

$debtRows = Import-Csv $debtLogPath
if ($debtRows.Count -eq 0) { Fail "Пустой docs/legacy/debt-log.csv" }

$ids = $debtRows | ForEach-Object { $_.id } | Where-Object { $_ -and $_.Trim() -ne "" }
$duplicateIds = $ids | Group-Object | Where-Object { $_.Count -gt 1 } | Select-Object -ExpandProperty Name
if ($duplicateIds.Count -gt 0) {
  Fail ("Повторяющиеся id в debt-log.csv: " + ($duplicateIds -join ", "))
}

$stubsText = Get-Content $stubsRegisterPath -Raw
$stubIds = @()

foreach ($line in ($stubsText -split "`r?`n")) {
  if ($line -match "^\|\s*(LEGACY-\d+)\s*\|") {
    $stubIds += $Matches[1]
  }
}

$stubIds = $stubIds | Sort-Object -Unique

foreach ($stubId in $stubIds) {
  if (!($ids -contains $stubId)) {
    Fail "В stubs-register.md есть id '$stubId', но его нет в debt-log.csv"
  }
}

foreach ($row in $debtRows) {
  if ($row.status -ne "active") { continue }

  $ref = $row.stub_reference
  if (!$ref) {
    Fail "В debt-log.csv для '$($row.id)' не заполнен stub_reference"
  }

  $refPath = Join-Path $repoRoot ($ref -replace "/", "\\")
  if (!(Test-Path $refPath)) {
    Fail "В debt-log.csv для '$($row.id)' указан stub_reference '$ref', но путь не существует"
  }
}

Write-Host "validate-legacy: OK ($($debtRows.Count) записей, $($stubIds.Count) заглушек)"


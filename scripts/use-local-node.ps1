param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Command
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$nodeDir = Join-Path $repoRoot '.limcode\tmp\node-v22.22.2-win-x64'
$nodeExe = Join-Path $nodeDir 'node.exe'

if (-not (Test-Path $nodeExe)) {
  Write-Error "Local Node 22.22.2 was not found at $nodeExe"
  exit 1
}

$resolvedNodeDir = (Resolve-Path $nodeDir).Path
$currentPath = [Environment]::GetEnvironmentVariable('Path', 'Process')
$segments = @()

if ($currentPath) {
  $segments = $currentPath -split ';' | Where-Object { $_ -and $_.Trim() -ne '' }
}

$filteredSegments = $segments | Where-Object {
  $_.TrimEnd('\\') -ne $resolvedNodeDir.TrimEnd('\\')
}

$env:Path = (@($resolvedNodeDir) + @($filteredSegments)) -join ';'

Write-Host "Using local Node from $nodeExe"
node -v
node -p "process.versions.modules"

if ($Command.Count -gt 0) {
  & $Command[0] @($Command | Select-Object -Skip 1)
  exit $LASTEXITCODE
}

Write-Host ''
Write-Host 'This PowerShell session now prefers the repository local Node.'
Write-Host 'You can run:'
Write-Host '  pnpm dev'
Write-Host '  pnpm --filter @tavern/api dev'
Write-Host '  pnpm rebuild better-sqlite3'

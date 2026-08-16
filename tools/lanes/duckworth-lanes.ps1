[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Action = 'status',
  [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
  [string[]]$RemainingArguments
)

$ErrorActionPreference = 'Stop'
$command = if ($Action -eq 'start') { 'ensure' } else { $Action }
$cli = Join-Path $PSScriptRoot 'duckworth-profiles.mjs'

& node $cli $command @RemainingArguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

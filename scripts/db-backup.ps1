[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$OutputPath
)

Set-StrictMode -Version Latest
$resolvedPath = [System.IO.Path]::GetFullPath($OutputPath)
$parentPath = Split-Path -Parent $resolvedPath

if (-not (Test-Path -LiteralPath $parentPath -PathType Container)) {
  New-Item -ItemType Directory -Path $parentPath -Force | Out-Null
}
if (Test-Path -LiteralPath $resolvedPath) {
  throw 'El archivo de backup ya existe. Elige una ruta nueva para evitar sobrescritura.'
}

$dumpLines = @(& docker compose exec -T postgres pg_dump --format=plain --no-owner --no-privileges -U ocpool -d ocpool_dev 2>$null)
if ($LASTEXITCODE -ne 0) {
  throw 'pg_dump no pudo completar el backup local.'
}

$utf8 = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($resolvedPath, (($dumpLines -join [Environment]::NewLine) + [Environment]::NewLine), $utf8)
$hash = Get-FileHash -LiteralPath $resolvedPath -Algorithm SHA256
$checksumPath = "$resolvedPath.sha256"
Set-Content -LiteralPath $checksumPath -Value ("$($hash.Hash)  $([System.IO.Path]::GetFileName($resolvedPath))") -Encoding utf8NoBOM

[pscustomobject]@{
  status = 'PASS'
  backupPath = $resolvedPath
  checksumPath = $checksumPath
  sha256 = $hash.Hash
}

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$BackupPath,

  [Parameter(Mandatory = $true)]
  [ValidateSet('I_UNDERSTAND_LOCAL_DISPOSABLE_TARGET')]
  [string]$ConfirmLocalDisposable
)

Set-StrictMode -Version Latest
$targetDatabase = 'ocpool_restore_verify'
$resolvedPath = [System.IO.Path]::GetFullPath($BackupPath)
if (-not (Test-Path -LiteralPath $resolvedPath -PathType Leaf)) {
  throw 'El archivo de backup no existe.'
}

$checksumPath = "$resolvedPath.sha256"
if (Test-Path -LiteralPath $checksumPath -PathType Leaf) {
  $expectedChecksum = (Get-Content -LiteralPath $checksumPath -Raw).Trim().Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)[0].ToUpperInvariant()
  $actualChecksum = (Get-FileHash -LiteralPath $resolvedPath -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($expectedChecksum -ne $actualChecksum) {
    throw 'El checksum del backup no coincide.'
  }
}

$databaseSql = "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$targetDatabase' AND pid <> pg_backend_pid(); DROP DATABASE IF EXISTS $targetDatabase; CREATE DATABASE $targetDatabase;"
& docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U ocpool -d postgres -c $databaseSql 2>$null
if ($LASTEXITCODE -ne 0) {
  throw 'No se pudo preparar el destino local desechable.'
}

Get-Content -LiteralPath $resolvedPath -Raw | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U ocpool -d $targetDatabase
if ($LASTEXITCODE -ne 0) {
  throw 'La restauración en el destino local desechable falló.'
}

$verificationSql = "SELECT current_database() AS database_name, COUNT(*) AS public_tables FROM information_schema.tables WHERE table_schema = 'public';"
$verification = & docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U ocpool -d $targetDatabase -c $verificationSql 2>$null
if ($LASTEXITCODE -ne 0) {
  throw 'La verificación posterior a la restauración falló.'
}

[pscustomobject]@{
  status = 'PASS'
  targetDatabase = $targetDatabase
  backupPath = $resolvedPath
  verification = ($verification -join [Environment]::NewLine)
}

param(
  [string]$ExecutablePath = "F:\IzziAI\Izzi\Izzi AI.exe",
  [string]$SupabaseAnonKey = $env:IZZI_MARKETING_STAGING_SUPABASE_ANON_KEY,
  [string]$UserDataRoot = (Join-Path $env:LOCALAPPDATA "IzziAI-Customer-Marketing-Staging"),
  [switch]$ValidateOnly,
  [switch]$PassThru
)

$ErrorActionPreference = "Stop"
$StagingOrigin = "https://marketing-staging.izziapi.com"
$StagingSupabaseRef = "bogwhtnknhquxhktormu"

function Read-JwtClaims([string]$Token) {
  $parts = $Token.Split('.')
  if ($parts.Count -ne 3) { throw "Staging Supabase anon key must be a JWT." }
  $payload = $parts[1].Replace('-', '+').Replace('_', '/')
  while ($payload.Length % 4 -ne 0) { $payload += '=' }
  try {
    return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
  } catch {
    throw "Staging Supabase anon key payload is invalid."
  }
}

$ExecutablePath = [IO.Path]::GetFullPath($ExecutablePath)
$UserDataRoot = [IO.Path]::GetFullPath($UserDataRoot)
if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
  throw "Izzi AI executable was not found."
}
if ([IO.Path]::GetFileName($UserDataRoot) -ne "IzziAI-Customer-Marketing-Staging") {
  throw "Staging userData must end in IzziAI-Customer-Marketing-Staging."
}
if ([string]::IsNullOrWhiteSpace($SupabaseAnonKey)) {
  throw "Set IZZI_MARKETING_STAGING_SUPABASE_ANON_KEY to the staging public anon key."
}
$claims = Read-JwtClaims $SupabaseAnonKey
if ($claims.role -ne 'anon' -or $claims.ref -ne $StagingSupabaseRef) {
  throw "The supplied key is not the reviewed staging Supabase anon client."
}
if ($ValidateOnly) {
  [pscustomobject]@{
    ok = $true
    profile = 'customer-marketing-staging'
    apiHost = ([Uri]$StagingOrigin).Host
    supabaseRef = $StagingSupabaseRef
    userDataIsolated = $true
    updaterEnabled = $false
    googleOAuthEnabled = $false
  } | ConvertTo-Json -Compress
  return
}

$previous = @{}
$runtime = @{
  IZZI_DESKTOP_RUNTIME_PROFILE = 'customer-marketing-staging'
  OPENCLAW_API_URL = $StagingOrigin
  OPENCLAW_SUPABASE_URL = "https://$StagingSupabaseRef.supabase.co"
  OPENCLAW_SUPABASE_ANON_KEY = $SupabaseAnonKey
  STARIZZI_CUSTOMER_MARKETING_API_ENABLED = 'true'
  STARIZZI_CUSTOMER_MARKETING_API_URL = $StagingOrigin
}
try {
  foreach ($entry in $runtime.GetEnumerator()) {
    $previous[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, 'Process')
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
  }
  New-Item -ItemType Directory -Force -Path $UserDataRoot | Out-Null
  $process = Start-Process -FilePath $ExecutablePath `
    -ArgumentList @(
      '--izzi-runtime-profile=customer-marketing-staging',
      "--user-data-dir=$UserDataRoot"
    ) -PassThru
  if ($PassThru) { $process }
} finally {
  foreach ($entry in $runtime.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $previous[$entry.Key], 'Process')
  }
}

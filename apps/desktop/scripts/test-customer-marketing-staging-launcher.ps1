$ErrorActionPreference = "Stop"
$launcher = Join-Path $PSScriptRoot "start-customer-marketing-staging.ps1"
$source = Get-Content -LiteralPath $launcher -Raw
$checks = 0

function Assert-Match([string]$Pattern, [string]$Message) {
  if ($source -notmatch $Pattern) { throw $Message }
  $script:checks += 1
}

Assert-Match 'customer-marketing-staging' 'Missing named staging runtime profile.'
Assert-Match '--izzi-runtime-profile=customer-marketing-staging' 'Missing explicit staging profile argument.'
Assert-Match 'IzziAI-Customer-Marketing-Staging' 'Missing isolated userData contract.'
Assert-Match 'marketing-staging\.izziapi\.com' 'Missing reviewed staging origin.'
Assert-Match 'bogwhtnknhquxhktormu' 'Missing reviewed staging Supabase project.'
Assert-Match "role -ne 'anon'" 'Missing anon-role validation.'
Assert-Match 'Start-Process' 'Missing installed-app launch.'
Assert-Match 'SetEnvironmentVariable' 'Launcher must scope runtime values to the child process.'

if ($source -match 'service_role' -or $source -match 'SUPABASE_SERVICE_KEY') {
  throw 'Launcher must never accept or contain a service credential.'
}
$checks += 1

function New-TestJwt([string]$Role, [string]$Reference) {
  $header = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('{"alg":"HS256","typ":"JWT"}')).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  $payloadJson = @{ role = $Role; ref = $Reference } | ConvertTo-Json -Compress
  $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payloadJson)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  return "$header.$payload.contract-signature"
}

$isolatedRoot = Join-Path ([IO.Path]::GetTempPath()) 'IzziAI-Customer-Marketing-Staging'
$validated = & $launcher `
  -ExecutablePath (Get-Process -Id $PID).Path `
  -SupabaseAnonKey (New-TestJwt 'anon' 'bogwhtnknhquxhktormu') `
  -UserDataRoot $isolatedRoot `
  -ValidateOnly | ConvertFrom-Json
if (-not $validated.ok -or -not $validated.userDataIsolated -or $validated.updaterEnabled -or $validated.googleOAuthEnabled) {
  throw 'Positive launcher validation contract failed.'
}
$checks += 1

$wrongRoleRejected = $false
try {
  & $launcher -ExecutablePath (Get-Process -Id $PID).Path `
    -SupabaseAnonKey (New-TestJwt 'authenticated' 'bogwhtnknhquxhktormu') `
    -UserDataRoot $isolatedRoot -ValidateOnly | Out-Null
} catch { $wrongRoleRejected = $_.Exception.Message -match 'anon' }
if (-not $wrongRoleRejected) { throw 'Non-anon client was not rejected.' }
$checks += 1

$sharedProfileRejected = $false
try {
  & $launcher -ExecutablePath (Get-Process -Id $PID).Path `
    -SupabaseAnonKey (New-TestJwt 'anon' 'bogwhtnknhquxhktormu') `
    -UserDataRoot (Join-Path ([IO.Path]::GetTempPath()) '@openclaw') -ValidateOnly | Out-Null
} catch { $sharedProfileRejected = $_.Exception.Message -match 'userData' }
if (-not $sharedProfileRejected) { throw 'Shared production-like userData was not rejected.' }
$checks += 1

[pscustomobject]@{ ok = $true; checks = $checks } | ConvertTo-Json -Compress

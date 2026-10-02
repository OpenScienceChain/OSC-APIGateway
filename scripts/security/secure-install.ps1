param(
    [switch]$CI,
    [switch]$OfflineReviewed
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$scanner = Join-Path $PSScriptRoot "check_npm_supply_chain.py"
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    $python = Get-Command python3 -ErrorAction Stop
}

$scanArgs = @($scanner, "--repo", $repo)
if ($OfflineReviewed) {
    $scanArgs += "--offline-reviewed"
}

Push-Location $repo
try {
    & $python.Source @scanArgs --skip-installed
    if ($LASTEXITCODE -ne 0) { throw "Pre-install supply-chain scan failed" }

    npm ci --ignore-scripts --no-audit --fund=false
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

    npm audit signatures
    if ($LASTEXITCODE -ne 0) { throw "npm signature verification failed" }

    & $python.Source @scanArgs
    if ($LASTEXITCODE -ne 0) { throw "Installed manifest scan failed" }

    $approvedPackages = @("bcrypt")
    npm rebuild @approvedPackages --ignore-scripts=false
    if ($LASTEXITCODE -ne 0) { throw "Approved lifecycle rebuild failed" }

    & $python.Source @scanArgs
    if ($LASTEXITCODE -ne 0) { throw "Post-install supply-chain scan failed" }

    if (-not $CI) {
        npm run prepare --if-present
        if ($LASTEXITCODE -ne 0) { throw "Project prepare script failed" }
    }
}
finally {
    Pop-Location
}

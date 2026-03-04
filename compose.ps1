# WEAV AI - Docker Compose wrapper (Windows PowerShell)
# Usage: .\compose.ps1 up | down | build | test | migrate | logs | shell | help
# Run from project root.

param(
    [Parameter(Position = 0)]
    [string]$Command = "help"
)

$ProjectRoot = $PSScriptRoot
if (-not $ProjectRoot) { $ProjectRoot = Get-Location }
$InfraPath = Join-Path $ProjectRoot "infra"

function Show-Help {
    Write-Host "WEAV AI (Docker)" -ForegroundColor Cyan
    Write-Host "  .\compose.ps1 up      - Start infra (postgres, redis, api, worker, nginx)"
    Write-Host "  .\compose.ps1 down   - Stop infra"
    Write-Host "  .\compose.ps1 build  - Build images"
    Write-Host "  .\compose.ps1 test   - Run tests (inside Docker)"
    Write-Host "  .\compose.ps1 migrate - Run migrations"
    Write-Host "  .\compose.ps1 logs   - API logs"
    Write-Host "  .\compose.ps1 shell  - API container shell"
}

function Invoke-DockerCompose {
    param([string[]]$DockerArgs)
    Push-Location $InfraPath
    try {
        & docker compose @DockerArgs
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    finally {
        Pop-Location
    }
}

$cmd = $Command.ToLowerInvariant()
switch ($cmd) {
    "up"    { Invoke-DockerCompose -DockerArgs @("up", "-d") }
    "down"  { Invoke-DockerCompose -DockerArgs @("down") }
    "build" { Invoke-DockerCompose -DockerArgs @("build") }
    "test"  { Invoke-DockerCompose -DockerArgs @("run", "--rm", "--entrypoint", "python", "api", "manage.py", "test", "tests") }
    "migrate" { Invoke-DockerCompose -DockerArgs @("run", "--rm", "--entrypoint", "python", "api", "manage.py", "migrate") }
    "logs"  { Invoke-DockerCompose -DockerArgs @("logs", "-f", "api") }
    "shell" { Invoke-DockerCompose -DockerArgs @("run", "--rm", "--entrypoint", "sh", "api") }
    "help"  { Show-Help }
    default {
        Write-Host "Unknown command: $Command" -ForegroundColor Yellow
        Show-Help
        exit 1
    }
}

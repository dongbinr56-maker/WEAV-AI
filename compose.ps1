# WEAV AI - Docker Compose 래퍼 (Windows PowerShell)
# 사용: .\compose.ps1 up | down | build | test | migrate | logs | shell | help
# 프로젝트 루트에서 실행하세요.

param(
    [Parameter(Position = 0)]
    [string]$Command = "help"
)

$ProjectRoot = $PSScriptRoot
if (-not $ProjectRoot) { $ProjectRoot = Get-Location }
$InfraPath = Join-Path $ProjectRoot "infra"

function Show-Help {
    Write-Host "WEAV AI (Docker helper)" -ForegroundColor Cyan
    Write-Host "  .\compose.ps1 up      - start services (postgres, redis, api, worker, nginx)"
    Write-Host "  .\compose.ps1 down    - stop services"
    Write-Host "  .\compose.ps1 build   - build images"
    Write-Host "  .\compose.ps1 test    - run tests (inside Docker)"
    Write-Host "  .\compose.ps1 migrate - run migrations"
    Write-Host "  .\compose.ps1 logs    - tail api logs"
    Write-Host "  .\compose.ps1 shell   - open api container shell"
}

function Invoke-DockerCompose {
    param([string[]]$DockerArgs)
    Push-Location $InfraPath
    try {
        docker compose @DockerArgs
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    finally {
        Pop-Location
    }
}

$cmd = $Command.ToLowerInvariant()
switch ($cmd) {
    up       { Invoke-DockerCompose -DockerArgs @("up", "-d") }
    down     { Invoke-DockerCompose -DockerArgs @("down") }
    build    { Invoke-DockerCompose -DockerArgs @("build") }
    test     { Invoke-DockerCompose -DockerArgs @("run", "--rm", "--entrypoint", "python", "api", "manage.py", "test", "tests") }
    migrate  { Invoke-DockerCompose -DockerArgs @("run", "--rm", "--entrypoint", "python", "api", "manage.py", "migrate") }
    logs     { Invoke-DockerCompose -DockerArgs @("logs", "-f", "api") }
    shell    { Invoke-DockerCompose -DockerArgs @("run", "--rm", "--entrypoint", "sh", "api") }
    help     { Show-Help }
    default  { Show-Help; exit 1 }
}

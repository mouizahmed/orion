param(
    [Parameter(Position = 0)]
    [ValidateSet("start", "status", "stop")]
    [string]$Action = "start"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $repoRoot ".runtime-logs"
$statePath = Join-Path $runtimeDir "local-dev-processes.json"
$billingEnvPath = Join-Path $repoRoot "backend\cmd\api\.env.billing"

$stripeEvents = @(
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "customer.subscription.paused",
    "customer.subscription.resumed"
)

function Read-State {
    if (-not (Test-Path -LiteralPath $statePath)) {
        return $null
    }

    return Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
}

function Save-State([array]$Services) {
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    @{ services = $Services } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath
}

function Get-StateProcess($Service) {
    $process = Get-Process -Id $Service.processId -ErrorAction SilentlyContinue
    if ($null -eq $process) {
        return $null
    }

    $actualStart = $process.StartTime.ToUniversalTime()
    $savedStart = ([datetime]$Service.startTimeUtc).ToUniversalTime()
    if ([math]::Abs(($actualStart - $savedStart).TotalMilliseconds) -gt 1) {
        return $null
    }

    return $process
}

function Stop-ProcessTree([int]$ProcessId) {
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
    foreach ($child in $children) {
        Stop-ProcessTree -ProcessId $child.ProcessId
    }

    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Show-Status {
    $state = Read-State
    if ($null -eq $state) {
        Write-Host "Orion local development is not managed by this script."
        return
    }

    $rows = foreach ($service in @($state.services)) {
        $process = Get-StateProcess $service
        [pscustomobject]@{
            Service = $service.name
            Status = if ($null -eq $process) { "stopped" } else { "running" }
            PID = $service.processId
            Log = $service.logPath
        }
    }
    $rows | Format-Table -AutoSize
}

function Stop-LocalDev {
    $state = Read-State
    if ($null -eq $state) {
        Write-Host "Nothing to stop."
        return
    }

    $services = @($state.services)
    [array]::Reverse($services)
    foreach ($service in $services) {
        if ($null -ne (Get-StateProcess $service)) {
            Write-Host "Stopping $($service.name)..."
            Stop-ProcessTree -ProcessId $service.processId
        }
    }

    Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
    Write-Host "Orion local development stopped."
}

function Resolve-CommandPath([string[]]$Names) {
    foreach ($name in $Names) {
        $command = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -ne $command) {
            return $command.Source
        }
    }

    throw "Required command not found: $($Names -join ' or ')"
}

function ConvertTo-ArgumentString([string[]]$Arguments) {
    return ($Arguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }) -join " "
}

function Start-ManagedProcess(
    [string]$Name,
    [string]$WorkingDirectory,
    [string]$FilePath,
    [string[]]$Arguments
) {
    $stdoutPath = Join-Path $runtimeDir "$Name.out.log"
    $stderrPath = Join-Path $runtimeDir "$Name.err.log"
    $stdinPath = Join-Path $runtimeDir "local-dev.stdin"
    if (-not (Test-Path -LiteralPath $stdinPath)) {
        New-Item -ItemType File -Path $stdinPath | Out-Null
    }
    $process = Start-Process -FilePath $FilePath `
        -ArgumentList (ConvertTo-ArgumentString $Arguments) `
        -WorkingDirectory $WorkingDirectory `
        -WindowStyle Hidden `
        -RedirectStandardInput $stdinPath `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -PassThru

    return [pscustomobject]@{
        name = $Name
        processId = $process.Id
        startTimeUtc = $process.StartTime.ToUniversalTime().ToString("o")
        logPath = $stdoutPath
        errorLogPath = $stderrPath
    }
}

function Wait-ForHttp([string]$Url, [int]$ProcessId, [int]$TimeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($null -eq (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
            return $false
        }
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return $true
            }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    return $false
}

function Assert-PortFree([int]$Port) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $listener) {
        throw "Port $Port is already in use by PID $($listener.OwningProcess). Stop the existing process first."
    }
}

function Set-WebhookSecret([string]$Secret) {
    $lines = if (Test-Path -LiteralPath $billingEnvPath) {
        @(Get-Content -LiteralPath $billingEnvPath)
    } else {
        @()
    }

    $found = $false
    $updated = foreach ($line in $lines) {
        if ($line -match '^STRIPE_WEBHOOK_SECRET=') {
            $found = $true
            "STRIPE_WEBHOOK_SECRET=$Secret"
        } else {
            $line
        }
    }
    if (-not $found) {
        $updated = @($updated) + "STRIPE_WEBHOOK_SECRET=$Secret"
    }

    Set-Content -LiteralPath $billingEnvPath -Value $updated
}

function Start-LocalDev {
    $existingState = Read-State
    if ($null -ne $existingState) {
        $running = @($existingState.services) | Where-Object { $null -ne (Get-StateProcess $_) }
        if ($running.Count -gt 0) {
            Show-Status
            throw "Local development is already running. Use 'scripts\local-dev.ps1 stop' first."
        }
        Remove-Item -LiteralPath $statePath -Force
    }

    $goBootstrapPath = Resolve-CommandPath @("go.exe", "go")
    $npmPath = Resolve-CommandPath @("npm.cmd", "npm")
    $stripePath = Resolve-CommandPath @("stripe.cmd", "stripe.exe", "stripe")
    $nodePath = Resolve-CommandPath @("node.exe", "node")
    $goRoot = (& $goBootstrapPath env GOROOT).Trim()
    $goPath = Join-Path $goRoot "bin\go.exe"
    $npmCliPath = Join-Path (Split-Path $npmPath) "node_modules\npm\bin\npm-cli.js"
    $stripeShimPath = Join-Path (Split-Path $stripePath) "node_modules\@stripe\cli\bin\shim.js"
    foreach ($resolvedPath in @($goPath, $npmCliPath, $stripeShimPath)) {
        if (-not (Test-Path -LiteralPath $resolvedPath)) {
            throw "Required command runtime not found: $resolvedPath"
        }
    }
    foreach ($requiredPath in @(
        "backend\cmd\api\.env",
        "backend\cmd\api\.env.billing",
        "desktop\.env.local",
        "desktop\node_modules",
        "web\node_modules"
    )) {
        if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $requiredPath))) {
            throw "Missing required local path: $requiredPath"
        }
    }
    foreach ($port in @(8080, 3000, 5173)) {
        Assert-PortFree $port
    }

    $stripeIdentity = (& $nodePath $stripeShimPath whoami --format json | ConvertFrom-Json)
    if (-not $stripeIdentity.authenticated) {
        throw "Stripe CLI is not authenticated. Run 'stripe login' and try again."
    }

    $eventArguments = foreach ($eventName in $stripeEvents) { "--events"; $eventName }
    $secretOutput = & $nodePath $stripeShimPath listen --skip-update --print-secret @eventArguments 2>$null
    $secretMatch = [regex]::Match(($secretOutput -join "`n"), 'whsec_[A-Za-z0-9]+')
    if (-not $secretMatch.Success) {
        throw "Stripe CLI did not return a development webhook signing secret."
    }
    Set-WebhookSecret $secretMatch.Value

    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    $services = @()
    try {
        $previousApiHost = $env:API_HOST
        $env:API_HOST = "127.0.0.1"
        try {
            $backend = Start-ManagedProcess "backend" (Join-Path $repoRoot "backend") $goPath @("run", "./cmd/api/main.go")
        } finally {
            $env:API_HOST = $previousApiHost
        }
        $services += $backend
        Save-State $services
        if (-not (Wait-ForHttp "http://127.0.0.1:8080/api/health" $backend.processId 45)) {
            throw "Backend did not become healthy. See $($backend.errorLogPath) and $($backend.logPath)."
        }

        $web = Start-ManagedProcess "web" (Join-Path $repoRoot "web") $nodePath @($npmCliPath, "run", "dev")
        $services += $web
        Save-State $services
        if (-not (Wait-ForHttp "http://127.0.0.1:3000" $web.processId 45)) {
            throw "Web app did not become ready. See $($web.errorLogPath) and $($web.logPath)."
        }

        $desktop = Start-ManagedProcess "desktop" (Join-Path $repoRoot "desktop") $nodePath @($npmCliPath, "run", "dev")
        $services += $desktop
        Save-State $services
        if (-not (Wait-ForHttp "http://localhost:5173" $desktop.processId 45)) {
            throw "Desktop renderer did not become ready. See $($desktop.errorLogPath) and $($desktop.logPath)."
        }

        $stripeCommandArgs = @($stripeShimPath, "listen", "--skip-update", "--forward-to", "http://127.0.0.1:8080/webhooks/stripe") + $eventArguments
        $stripe = Start-ManagedProcess "stripe" $repoRoot $nodePath $stripeCommandArgs
        $services += $stripe
        Save-State $services
        Start-Sleep -Seconds 2
        if ($null -eq (Get-Process -Id $stripe.processId -ErrorAction SilentlyContinue)) {
            throw "Stripe listener exited during startup. See $($stripe.errorLogPath) and $($stripe.logPath)."
        }
    } catch {
        $cleanupServices = @($services)
        [array]::Reverse($cleanupServices)
        foreach ($service in $cleanupServices) {
            if ($null -ne (Get-StateProcess $service)) {
                Stop-ProcessTree -ProcessId $service.processId
            }
        }
        Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
        throw
    }

    Write-Host "Orion local development is ready."
    Write-Host "  API:     http://127.0.0.1:8080/api/health"
    Write-Host "  Web:     http://127.0.0.1:3000"
    Write-Host "  Desktop: http://localhost:5173 (Electron launched)"
    Write-Host "  Logs:    $runtimeDir"
    Write-Host "Run '.\scripts\local-dev.ps1 status' or '.\scripts\local-dev.ps1 stop'."
}

switch ($Action) {
    "start" { Start-LocalDev }
    "status" { Show-Status }
    "stop" { Stop-LocalDev }
}

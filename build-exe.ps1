$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root "dist"
$source = Join-Path $root "launcher\GpuStressLauncher.cs"

$cscCandidates = @(
    (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
    (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe")
)

$csc = $cscCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) {
    throw "C# compiler was not found under Windows .NET Framework folders."
}

New-Item -ItemType Directory -Force -Path $dist | Out-Null

$output = Join-Path $dist "GPUStressTest.exe"
$index = Join-Path $root "index.html"
$app = Join-Path $root "app.js"
$styles = Join-Path $root "styles.css"

& $csc `
    /nologo `
    /target:winexe `
    /optimize+ `
    /reference:System.Windows.Forms.dll `
    /reference:System.Drawing.dll `
    /out:$output `
    /resource:$index,index.html `
    /resource:$app,app.js `
    /resource:$styles,styles.css `
    $source

if ($LASTEXITCODE -ne 0) {
    throw "csc failed with exit code $LASTEXITCODE"
}

Write-Host "Built $output"

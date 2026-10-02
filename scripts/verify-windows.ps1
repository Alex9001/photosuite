$ErrorActionPreference = 'Stop'
$archives = @(Get-ChildItem dist -Filter '*.zip')
$installers = @(Get-ChildItem dist -Filter '*.exe')
if ($archives.Count -ne 1 -or $installers.Count -ne 1) { throw 'Expected one ZIP and installer' }
$destination = Join-Path $env:RUNNER_TEMP ('photosuite-smoke-' + [guid]::NewGuid())
Expand-Archive -LiteralPath $archives[0].FullName -DestinationPath $destination
$executable = Join-Path $destination 'PhotoSuite/photosuite.exe'
# Verify the PE machine field, not just its filename or .exe extension.
foreach ($path in @($executable, $installers[0].FullName)) {
    $stream = [IO.File]::OpenRead($path)
    $reader = [IO.BinaryReader]::new($stream)
    try {
        if ($reader.ReadUInt16() -ne 0x5A4D) { throw "Not an executable: $path" }
        $stream.Position = 0x3C
        $offset = $reader.ReadInt32()
        $stream.Position = $offset
        if ($reader.ReadUInt32() -ne 0x4550) { throw "Invalid PE header: $path" }
        $machine = $reader.ReadUInt16()
        if ($path -eq $executable -and $machine -ne 0x8664) { throw 'Portable app is not x64' }
        # NSIS bootstrappers can be x86 even when their installed payload is x64.
    } finally { $reader.Dispose() }
}
$process = Start-Process -FilePath $executable -PassThru
try {
    $visible = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Seconds 1
        $process.Refresh()
        if ($process.HasExited) { throw "Portable app exited early: $($process.ExitCode)" }
        if ($process.MainWindowHandle -ne 0) { $visible = $true; break }
    }
    if (-not $visible) { throw 'Portable app did not show a window within 30 seconds' }
} finally {
    if (-not $process.HasExited) { Stop-Process -Id $process.Id }
    Remove-Item -LiteralPath $destination -Recurse -Force
}

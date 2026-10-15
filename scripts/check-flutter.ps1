$ErrorActionPreference = 'Stop'
$workspaceDirectory = Split-Path -Parent $PSScriptRoot
$sdkDirectory = Join-Path $workspaceDirectory '.tools\flutter'
if (-not (Test-Path (Join-Path $sdkDirectory 'bin\flutter.bat'))) {
    throw 'Install the Flutter version specified in flutter_app/MIGRATION.md into .tools/flutter first.'
}

# Flutter's Windows shader compiler does not support non-ASCII paths. A temporary
# drive alias keeps the source in this checkout without copying or changing it.
$driveLetter = @('W', 'V', 'U', 'T', 'S') | Where-Object { -not (Test-Path ($_ + ':\')) } | Select-Object -First 1
if (-not $driveLetter) { throw 'No unused drive letter is available for Flutter validation.' }
$mappedDrive = $driveLetter + ':'
$savedLocation = Get-Location
$savedEnvironment = @{}
$existingCount = if ($env:GIT_CONFIG_COUNT) { [int]$env:GIT_CONFIG_COUNT } else { 0 }
$environmentPatch = @{
    'GIT_CONFIG_COUNT' = [string]($existingCount + 2)
    "GIT_CONFIG_KEY_$existingCount" = 'safe.directory'
    "GIT_CONFIG_VALUE_$existingCount" = $sdkDirectory.Replace('\', '/')
    "GIT_CONFIG_KEY_$($existingCount + 1)" = 'safe.directory'
    "GIT_CONFIG_VALUE_$($existingCount + 1)" = "$mappedDrive/.tools/flutter"
    'PUB_CACHE' = "$mappedDrive\.tools\pub-cache"
    'FLUTTER_ROOT' = "$mappedDrive\.tools\flutter"
}
try {
    & subst.exe $mappedDrive $workspaceDirectory
    if ($LASTEXITCODE -ne 0) { throw 'Could not create a temporary drive alias.' }
    foreach ($entry in $environmentPatch.GetEnumerator()) {
        $savedEnvironment[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, 'Process')
        [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
    }
    Set-Location "$mappedDrive\flutter_app"
    $dartCommand = "$mappedDrive\.tools\flutter\bin\cache\dart-sdk\bin\dart.exe"
    # Dart pub resolves packages without creating Windows plugin symlinks on
    # filesystems which do not support them. Native builds still require NTFS.
    & $dartCommand pub get --enforce-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'Dependency resolution failed.' }
    & $dartCommand format --output=none --set-exit-if-changed lib test
    if ($LASTEXITCODE -ne 0) { throw 'Dart formatting check failed.' }
    & $dartCommand analyze --fatal-infos
    if ($LASTEXITCODE -ne 0) { throw 'Dart analysis failed.' }
    & "$mappedDrive\.tools\flutter\bin\flutter.bat" test --no-pub
    if ($LASTEXITCODE -ne 0) { throw 'Flutter tests failed.' }
} finally {
    Set-Location $savedLocation
    # Keep editor package resolution usable after removing the temporary alias.
    $packageConfig = Join-Path $workspaceDirectory 'flutter_app\.dart_tool\package_config.json'
    if (Test-Path $packageConfig) {
        try {
            $workspaceUri = ([Uri]($workspaceDirectory + '\')).AbsoluteUri
            $contents = [IO.File]::ReadAllText($packageConfig).Replace("file:///$mappedDrive/", $workspaceUri)
            [IO.File]::WriteAllText($packageConfig, $contents, [Text.UTF8Encoding]::new($false))
        } catch { Write-Warning 'Could not normalize the generated editor package configuration.' }
    }
    foreach ($entry in $savedEnvironment.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
    }
    & subst.exe $mappedDrive /d
}

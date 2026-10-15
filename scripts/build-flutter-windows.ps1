param([ValidateSet('windows','android')][string]$Target = 'windows', [switch]$SplitPerAbi, [string]$StagingRoot = (Join-Path $env:TEMP 'anime-flutter-build'))
$ErrorActionPreference = 'Stop'
$workspaceDirectory = Split-Path $PSScriptRoot -Parent
$sdkDirectory = Join-Path $workspaceDirectory '.tools\flutter'
if (!(Test-Path (Join-Path $sdkDirectory 'bin\flutter.bat'))) { throw 'Install the pinned Flutter SDK into .tools/flutter first.' }
$hasher = [Security.Cryptography.SHA256]::Create()
try { $workspaceHash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($workspaceDirectory))).Replace('-', '').Substring(0, 12) } finally { $hasher.Dispose() }
$stagingParent = Join-Path ([IO.Path]::GetFullPath($StagingRoot)) $workspaceHash
New-Item -ItemType Directory -Force -Path (Join-Path $stagingParent 'project') | Out-Null
$availableDrives = @('W', 'V', 'U', 'T', 'S', 'R') | Where-Object { !(Test-Path ($_ + ':\')) } | Select-Object -First 2
if ($availableDrives.Count -ne 2) { throw 'Two unused drive letters are needed for native builds from this workspace.' }
$sourceDrive = $availableDrives[0] + ':'
$buildDrive = $availableDrives[1] + ':'
$originalLocation = Get-Location
$savedEnvironment = @{}
function Invoke-FlutterBuildCommand {
  param([string[]]$BuildArguments, [switch]$AllowFailure)
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $flutterCommand @BuildArguments; $nativeExitCode = $LASTEXITCODE }
  finally { $ErrorActionPreference = $oldPreference }
  if (!$AllowFailure -and $nativeExitCode -ne 0) { throw 'Flutter command failed; inspect the preceding build output.' }
}
$existingCount = if ($env:GIT_CONFIG_COUNT) { [int]$env:GIT_CONFIG_COUNT } else { 0 }
$patch = @{
  'FLUTTER_ROOT' = "$sourceDrive\.tools\flutter"
  'PUB_CACHE' = "$sourceDrive\.tools\pub-cache"
  'GIT_CONFIG_COUNT' = [string]($existingCount + 2)
  "GIT_CONFIG_KEY_$existingCount" = 'safe.directory'
  "GIT_CONFIG_VALUE_$existingCount" = $sdkDirectory.Replace('\', '/')
  "GIT_CONFIG_KEY_$($existingCount + 1)" = 'safe.directory'
  "GIT_CONFIG_VALUE_$($existingCount + 1)" = "$sourceDrive/.tools/flutter"
  'PATH' = (Join-Path $workspaceDirectory '.tools\nuget') + ';' + $env:PATH
}
if ($Target -eq 'android') {
  $patch['GRADLE_USER_HOME'] = Join-Path $stagingParent 'gradle-cache'
  $patch['ANIME_SIGNING_STORE'] = if ($env:ANIME_SIGNING_STORE) { $env:ANIME_SIGNING_STORE } else { Join-Path $workspaceDirectory 'android\app\keystore\upload.keystore' }
  $legacySigning = [IO.File]::ReadAllText((Join-Path $workspaceDirectory 'android\app\build.gradle'))
  foreach ($item in @(@('ANIME_STORE_PASSWORD','storePassword'), @('ANIME_KEY_ALIAS','keyAlias'), @('ANIME_KEY_PASSWORD','keyPassword'))) {
    $current = [Environment]::GetEnvironmentVariable($item[0], 'Process')
    if (!$current) { $current = [regex]::Match($legacySigning, '\b' + $item[1] + '\s+"([^"\r\n]+)"').Groups[1].Value }
    if (!$current) { throw ('Missing signing configuration: ' + $item[0]) }
    $patch[$item[0]] = $current
  }
}
try {
  & subst.exe $sourceDrive $workspaceDirectory
  if ($LASTEXITCODE -ne 0) { throw 'Could not create source alias.' }
  & subst.exe $buildDrive $stagingParent
  if ($LASTEXITCODE -ne 0) { throw 'Could not create build alias.' }
  foreach ($entry in $patch.GetEnumerator()) {
    $savedEnvironment[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, 'Process')
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
  }
  & robocopy.exe "$sourceDrive\flutter_app" "$buildDrive\project" /E /XD .dart_tool build .idea .gradle ephemeral /XF local.properties .flutter-plugins-dependencies *.log /NFL /NDL /NJH /NJS /NP
  if ($LASTEXITCODE -gt 7) { throw 'Could not stage Flutter sources.' }
  Set-Location "$buildDrive\project"
  $flutterCommand = "$sourceDrive\.tools\flutter\bin\flutter.bat"
  Invoke-FlutterBuildCommand -BuildArguments @('pub','get') -AllowFailure *> build-dependencies.log
  if (!(Test-Path .flutter-plugins-dependencies)) { throw 'Could not resolve Flutter plugins; inspect build-dependencies.log.' }
  $metadata = Get-Content .flutter-plugins-dependencies -Raw | ConvertFrom-Json
  $links = "$buildDrive\project\windows\flutter\ephemeral\.plugin_symlinks"
  New-Item -ItemType Directory -Force -Path $links | Out-Null
  foreach ($plugin in $metadata.plugins.windows) {
    $link = Join-Path $links $plugin.name
    if (!(Test-Path -LiteralPath $link)) { New-Item -ItemType Junction -Path $link -Target $plugin.path | Out-Null }
  }
  Invoke-FlutterBuildCommand -BuildArguments @('pub','get')
  # Regenerate cached absolute paths when the temporary drive letters change.
  $cacheFile = "$buildDrive\project\build\windows\x64\CMakeCache.txt"
  if (Test-Path -LiteralPath $cacheFile) { Remove-Item -LiteralPath $cacheFile }
  $version = (Get-Content "$workspaceDirectory\package.json" -Raw | ConvertFrom-Json).version
  if ($Target -eq 'android') {
    Add-Content -LiteralPath "$buildDrive\project\android\gradle.properties" -Value "`nkotlin.incremental=false`nkotlin.compiler.execution.strategy=in-process"
    $buildArguments = @('build','apk','--release','--no-pub','--target-platform=android-arm,android-arm64')
    if ($SplitPerAbi) { $buildArguments += '--split-per-abi' }
    Invoke-FlutterBuildCommand -BuildArguments $buildArguments
    $outputDirectory = Join-Path $workspaceDirectory "release\$version"
    New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
    $apkNames = if ($SplitPerAbi) { @('app-arm64-v8a-release.apk','app-armeabi-v7a-release.apk') } else { @('app-release.apk') }
    foreach ($apkName in $apkNames) { Copy-Item -LiteralPath "$buildDrive\project\build\app\outputs\flutter-apk\$apkName" -Destination (Join-Path $outputDirectory $apkName) -Force }
    return
  }
  Invoke-FlutterBuildCommand -BuildArguments @('build','windows','--release','--no-pub')
  $outputDirectory = Join-Path $workspaceDirectory "release\$version\windows"
  New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
  & robocopy.exe "$buildDrive\project\build\windows\x64\runner\Release" $outputDirectory /E /XF anime_flutter.exe /NFL /NDL /NJH /NJS /NP
  if ($LASTEXITCODE -gt 7) { throw 'Could not copy native bundle.' }
  & (Join-Path $workspaceDirectory 'scripts\copy-vc-runtime.ps1') -Destination $outputDirectory
  Compress-Archive -Path "$outputDirectory\*" -DestinationPath "$workspaceDirectory\release\$version\anime-$version-windows-x64.zip" -Force
} finally {
  if ($Target -eq 'android' -and (Test-Path "$buildDrive\project\android\gradlew.bat")) {
    Push-Location "$buildDrive\project\android"
    try { & .\gradlew.bat --stop } finally { Pop-Location }
  }
  Set-Location $originalLocation
  foreach ($entry in $savedEnvironment.GetEnumerator()) { [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process') }
  & subst.exe $buildDrive /d
  & subst.exe $sourceDrive /d
}

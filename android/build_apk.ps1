# Asa 鬧鐘 App 一鍵建置
# 會下載：JDK 17（Adoptium）、Android 命令列工具（Google）、Gradle 8.9，全部放在同一個資料夾，不會動到系統設定。
# 過程中 Android SDK 會請你閱讀並同意授權條款（輸入 y）。
# 因為 Android 建置工具不支援含中文的路徑，所以一律在 D:\asa-build（沒有 D 槽就用 C:\asa-build）裡建置。

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$base = if (Test-Path 'D:\') { 'D:\asa-build' } else { 'C:\asa-build' }
New-Item -ItemType Directory -Force $base | Out-Null
Write-Host "建置資料夾：$base" -ForegroundColor Cyan

function Get-Zip($name, $url, $dest) {
    if (Test-Path $dest) { Write-Host "✓ $name 已存在"; return }
    $zip = Join-Path $base "$name.zip"
    Write-Host "下載 $name …"
    Invoke-WebRequest -Uri $url -OutFile $zip
    $tmp = Join-Path $base "$name-tmp"
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Expand-Archive -Path $zip -DestinationPath $tmp
    # 壓縮檔裡通常只有一層資料夾，把它改名成目標
    $inner = Get-ChildItem $tmp | Select-Object -First 1
    Move-Item $inner.FullName $dest
    Remove-Item -Recurse -Force $tmp
    Remove-Item -Force $zip
}

# 1. JDK 17
$jdk = Join-Path $base 'jdk'
Get-Zip 'jdk' 'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse' $jdk
$env:JAVA_HOME = $jdk
$env:Path = "$jdk\bin;$env:Path"

# 2. Gradle
$gradle = Join-Path $base 'gradle'
Get-Zip 'gradle' 'https://services.gradle.org/distributions/gradle-8.9-bin.zip' $gradle

# 3. Android SDK 命令列工具
$sdk = Join-Path $base 'sdk'
$tools = Join-Path $sdk 'cmdline-tools\latest'
if (-not (Test-Path $tools)) {
    New-Item -ItemType Directory -Force (Join-Path $sdk 'cmdline-tools') | Out-Null
    Get-Zip 'cmdline-tools' 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip' $tools
}
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk

if (-not (Test-Path (Join-Path $sdk 'platforms\android-35'))) {
    Write-Host ''
    Write-Host '接下來要安裝 Android SDK。請閱讀授權條款，同意的話輸入 y 再按 Enter。' -ForegroundColor Yellow
    & "$tools\bin\sdkmanager.bat" "--sdk_root=$sdk" 'platform-tools' 'platforms;android-35' 'build-tools;35.0.0'
    if ($LASTEXITCODE -ne 0) { throw 'Android SDK 安裝失敗（或沒有同意授權）' }
}

# 4. 把專案複製到不含中文的路徑再建置
$src = Join-Path $base 'src'
robocopy $here $src /MIR /XD build .gradle /XF *.apk local.properties /NFL /NDL /NJH /NJS | Out-Null
"sdk.dir=$($sdk -replace '\\', '/')" | Out-File -Encoding ascii (Join-Path $src 'local.properties')
$env:GRADLE_USER_HOME = Join-Path $base 'gradle-home'

Write-Host '開始建置（第一次要下載相依套件，大約 3～10 分鐘）…' -ForegroundColor Cyan
Push-Location $src
try {
    & "$gradle\bin\gradle.bat" assembleDebug --no-daemon --console=plain
    if ($LASTEXITCODE -ne 0) { throw '建置失敗：請查看上面的錯誤訊息' }
} finally { Pop-Location }

$apk = Join-Path $src 'app\build\outputs\apk\debug\app-debug.apk'
$out = Join-Path $here 'AsaAlarm.apk'
Copy-Item $apk $out -Force
Write-Host ''
Write-Host "完成！APK 在：$out" -ForegroundColor Green
Write-Host '把這個檔案傳到手機安裝（第一次會要你允許「安裝未知來源的應用程式」）。'

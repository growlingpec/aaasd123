# Premier Agent — установщик Windows: сам проверяет и ставит Node.js, скачивает и запускает помощника.
# Код привязки уже вшит в этот файл.
$ErrorActionPreference = 'Stop'
$Server = '__PREMIER_SERVER__'
$Code = '__PREMIER_CODE__'
$NodeDir = Join-Path $env:ProgramFiles 'nodejs'

Write-Host ''
Write-Host '=== Premier Agent ===' -ForegroundColor Cyan
Write-Host ''

function Test-Node {
  $c = Get-Command node -ErrorAction SilentlyContinue
  if (-not $c) { return $false }
  try {
    $v = (& node -v 2>$null)
    if ("$v" -match '^v(\d+)') { return ([int]$Matches[1]) -ge 18 }
  } catch { }
  return $false
}

if ([Environment]::Is64BitOperatingSystem -eq $false) {
  Write-Host 'Нужна 64-битная Windows. Установите Node.js вручную с nodejs.org и запустите Premier-Agent.cmd ещё раз.' -ForegroundColor Red
  pause
  exit 1
}

if (Test-Node) {
  Write-Host 'Node.js найден: ' (node -v)
} else {
  Write-Host 'Node.js 18+ не найден. Устанавливаю автоматически (1-3 минуты).' -ForegroundColor Yellow
  Write-Host 'Windows попросит подтвердить установку (окно UAC) — нажмите «Да».'
  $installed = $false
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    Write-Host 'Установка через winget...'
    try { winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent } catch { Write-Host "winget: $($_.Exception.Message)" }
    if (Test-Path (Join-Path $NodeDir 'node.exe')) { $installed = $true }
  }
  if (-not $installed) {
    $Ver = '24.11.1'
    $Msi = "https://nodejs.org/dist/v$Ver/node-v$Ver-x64.msi"
    $MsiPath = Join-Path $env:TEMP "node-v$Ver-x64.msi"
    Write-Host "Скачиваю Node.js: $Msi"
    try {
      if (Get-Command curl.exe -ErrorAction SilentlyContinue) { curl.exe -fsSL $Msi -o $MsiPath }
      else { Invoke-WebRequest -Uri $Msi -OutFile $MsiPath -UseBasicParsing }
    } catch { Write-Host "Не удалось скачать Node.js: $($_.Exception.Message)" -ForegroundColor Red }
    if (Test-Path $MsiPath) {
      Write-Host 'Устанавливаю Node.js (тихо, может появиться окно UAC)...'
      $p = Start-Process msiexec.exe -ArgumentList "/i `"$MsiPath`" /qn /norestart" -Wait -PassThru
      if ($p.ExitCode -ne 0) { throw "Установка Node.js завершилась с кодом $($p.ExitCode)" }
      Remove-Item $MsiPath -Force -ErrorAction SilentlyContinue
      if (Test-Path (Join-Path $NodeDir 'node.exe')) { $installed = $true }
    }
  }
  if (-not $installed) {
    Write-Host 'Не удалось установить Node.js автоматически. Установите его вручную с nodejs.org (LTS) и запустите Premier-Agent.cmd ещё раз.' -ForegroundColor Red
    pause
    exit 1
  }
  $env:Path = "$NodeDir;$env:Path"
  if (-not (Test-Node)) {
    Write-Host 'Node.js установлен, но скрипт его не видит. Запустите Premier-Agent.cmd ещё раз.' -ForegroundColor Yellow
    pause
    exit 1
  }
  Write-Host 'Node.js установлен: ' (node -v)
}

$Agent = Join-Path $env:USERPROFILE 'premier-agent.js'
Write-Host "Скачиваю помощника: $Server/premier-agent.js"
try {
  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    curl.exe -fsSL "$Server/premier-agent.js" -o $Agent
    if ($LASTEXITCODE -ne 0) { throw "curl завершился с кодом $LASTEXITCODE" }
  } else {
    Invoke-WebRequest -Uri "$Server/premier-agent.js" -OutFile $Agent -UseBasicParsing
  }
} catch {
  Write-Host "Не удалось скачать помощника: $($_.Exception.Message)" -ForegroundColor Red
  pause
  exit 1
}

Write-Host ''
Write-Host 'Запускаю помощника. Останьтесь в этом окне: пока оно открыто, модель имеет доступ к компьютеру.' -ForegroundColor Green
Write-Host ''

if ($env:PREMIER_AGENT_DRYRUN) {
  Write-Host "[DRYRUN] Агент не запускается (PREMIER_AGENT_DRYRUN=1). Команда была бы: node $Agent $Code"
  exit 0
}

& node $Agent $Code
pause

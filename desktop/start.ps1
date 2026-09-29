# Графит — запуск: поднимает локальный движок (если нужно) и открывает приложение.
$ErrorActionPreference = 'Continue'

$desk = $PSScriptRoot
$root = Split-Path -Parent $desk
$exe = Join-Path $desk 'engine\ollama.exe'
$models = Join-Path $desk 'models'
$app = Join-Path $root 'index.html'
$base = 'http://127.0.0.1:11434'

if (-not (Test-Path $app)) {
  Write-Host 'Не найден index.html рядом с папкой desktop — запускайте из папки приложения.'
  exit 1
}

function Test-Ollama {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri ($base + '/api/version')
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

$running = Test-Ollama
if (-not $running) {
  if (-not (Test-Path $exe)) {
    Write-Host 'Движок ещё не установлен.'
    Write-Host 'Сначала запустите «Установить-Графит.cmd» (скачает движок внутрь папки приложения).'
    exit 1
  }
  Write-Host 'Запускаю локальный движок…'
  $env:OLLAMA_MODELS = $models
  $env:OLLAMA_ORIGINS = '*'
  $env:OLLAMA_HOST = '127.0.0.1:11434'
  Start-Process -FilePath $exe -ArgumentList 'serve' -WorkingDirectory $desk -WindowStyle Hidden
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Ollama) { break }
  }
  $running = Test-Ollama
}

if ($running) {
  Write-Host 'Движок работает. Открываю «Графит»…'
} else {
  Write-Host 'Движок не ответил за 60 секунд — запустите ещё раз или проверьте вручную.'
}

Start-Process $app
Write-Host ''
Write-Host 'Приложение открыто в браузере.'
Write-Host 'Движок работает в фоне; чтобы остановить — «Остановить-Графит.cmd».'

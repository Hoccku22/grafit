# Графит — установка локального движка Ollama как модуля приложения.
# Скачивает портативную сборку Ollama внутрь папки desktop\engine.
# Ничего не устанавливается в систему: ни реестра, ни Program Files, ни PATH.

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$desk = $PSScriptRoot
$engine = Join-Path $desk 'engine'
$models = Join-Path $desk 'models'
New-Item -ItemType Directory -Force -Path $engine, $models | Out-Null

$exe = Join-Path $engine 'ollama.exe'
if (Test-Path $exe) {
  Write-Host 'Движок уже установлен:'
  & $exe --version
  Write-Host 'Ничего делать не нужно.'
  exit 0
}

Write-Host '=== Графит: установка локального движка ==='
Write-Host 'Скачается портативная Ollama (~1.4 ГБ, один раз; нужно ~4 ГБ свободного места).'
Write-Host 'Она установится ВНУТРЬ этой папки (desktop\engine) — без следов в системе.'
Write-Host ''

$api = 'https://api.github.com/repos/ollama/ollama/releases/latest'
$rel = Invoke-RestMethod -Uri $api -UserAgent 'Grafit-Setup'
$asset = $rel.assets | Where-Object { $_.name -eq 'ollama-windows-amd64.zip' } | Select-Object -First 1
if (-not $asset) { throw 'Не найден дистрибутив ollama-windows-amd64.zip в последнем релизе.' }

$zip = Join-Path $desk '_ollama.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }

Write-Host ('Скачиваю: ' + $asset.browser_download_url)
$hasCurl = $null -ne (Get-Command curl.exe -ErrorAction SilentlyContinue)
if ($hasCurl) {
  & curl.exe -L --fail --show-error -o $zip $asset.browser_download_url
  if ($LASTEXITCODE -ne 0) { throw ('curl завершился с кодом ' + $LASTEXITCODE) }
} else {
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip
}
Write-Host ('Скачано: ' + [math]::Round((Get-Item $zip).Length / 1MB) + ' МБ')
Write-Host 'Распаковываю…'

$hasTar = $null -ne (Get-Command tar.exe -ErrorAction SilentlyContinue)
if ($hasTar) {
  & tar.exe -xf $zip -C $engine
  if ($LASTEXITCODE -ne 0) { Expand-Archive -Path $zip -DestinationPath $engine -Force }
} else {
  Expand-Archive -Path $zip -DestinationPath $engine -Force
}
Remove-Item $zip -Force

# На случай вложенной папки в архиве — выравниваем структуру
if (-not (Test-Path $exe)) {
  $found = Get-ChildItem $engine -Recurse -Filter 'ollama.exe' | Select-Object -First 1
  if ($found -and $found.DirectoryName -ne $engine) {
    Get-ChildItem -Path $found.DirectoryName | Move-Item -Destination $engine -Force
  }
}

Write-Host ''
if (Test-Path $exe) {
  Write-Host 'Готово! Движок установлен как модуль приложения:'
  & $exe --version
  Write-Host ''
  Write-Host 'Следующий шаг: запустите «Запустить-Графит.cmd» и скачайте модель в настройках ИИ.'
  Write-Host 'Для удаления движка просто удалите папку desktop\engine.'
} else {
  Write-Host 'Что-то пошло не так: ollama.exe не найден после распаковки.'
}

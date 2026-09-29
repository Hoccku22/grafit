# Графит — остановка локального движка приложения (только процессов из папки desktop\engine).
$desk = $PSScriptRoot
$enginePath = (Join-Path $desk 'engine')
$killed = 0
foreach ($name in @('ollama.exe', 'ollama_llama_server.exe', 'ollama app.exe')) {
  Get-CimInstance Win32_Process -Filter ("Name = '" + $name + "'") -ErrorAction SilentlyContinue | ForEach-Object {
    $p = $_.ExecutablePath
    if ($p -and $p.StartsWith($enginePath, [StringComparison]::OrdinalIgnoreCase)) {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      $killed++
    }
  }
}
if ($killed -gt 0) {
  Write-Host ('Остановлено процессов: ' + $killed + '. Движок выключен.')
} else {
  Write-Host 'Движок приложения не запущен (или запущен другой экземпляр Ollama — его не трогаем).'
}

$ErrorActionPreference = "Stop"
$installDirectory = Join-Path $env:LOCALAPPDATA "GameForge Flow"
$sourceDirectory = [IO.Path]::GetFullPath($PSScriptRoot)
if (-not (Get-Command py -ErrorAction SilentlyContinue) -and -not (Get-Command python -ErrorAction SilentlyContinue)) {
  throw "Python 3 nao foi encontrado. Instale o Python 3 e execute este instalador novamente."
}
New-Item -ItemType Directory -Force -Path $installDirectory | Out-Null
$files = @("app.js","index.html","manifest.webmanifest","README.md","server.py","team_server.py","mcp_server.py","mcp-config.example.json","service-worker.js","styles.css","START.bat","START_TUNNEL.bat","CONFIGURE_MCP.ps1")
foreach ($name in $files) { Copy-Item -LiteralPath (Join-Path $sourceDirectory $name) -Destination (Join-Path $installDirectory $name) -Force }
Copy-Item -LiteralPath (Join-Path $sourceDirectory "src") -Destination $installDirectory -Recurse -Force
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath("Desktop")) "GameForge Flow.lnk"))
$shortcut.TargetPath = (Join-Path $installDirectory "START.bat")
$shortcut.WorkingDirectory = $installDirectory
$shortcut.Description = "GameForge Flow"
$shortcut.Save()
Write-Host "GameForge Flow instalado em $installDirectory"
Write-Host "Um atalho foi criado na Area de Trabalho."

param(
  [Parameter(Mandatory=$true)][string]$RoomId,
  [string]$Output = (Join-Path $PSScriptRoot "mcp-config.generated.json")
)
$dataDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\GameForge_Flow_Data"))
$keyPath = Join-Path $dataDirectory "host-key.txt"
if (-not (Test-Path -LiteralPath $keyPath)) { throw "Inicie o GameForge Flow pelo START.bat antes de configurar o MCP." }
$python = (Get-Command py -ErrorAction SilentlyContinue)
$command = if ($python) { $python.Source } else { (Get-Command python -ErrorAction Stop).Source }
$arguments = if ($python) { @("-3", (Join-Path $PSScriptRoot "mcp_server.py")) } else { @((Join-Path $PSScriptRoot "mcp_server.py")) }
$configuration = @{
  mcpServers = @{
    "gameforge-flow" = @{
      command = $command
      args = $arguments
      env = @{
        GAMEFORGE_DATA_DIR = $dataDirectory
        GAMEFORGE_ROOM_ID = $RoomId
        GAMEFORGE_HOST_KEY = (Get-Content -LiteralPath $keyPath -Raw).Trim()
      }
    }
  }
}
$configuration | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Output -Encoding utf8
Write-Host "Configuracao MCP criada em: $Output"
Write-Warning "Esse arquivo contem a chave do host. Nao compartilhe nem envie para repositorios."

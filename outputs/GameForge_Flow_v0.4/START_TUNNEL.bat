@echo off
title GameForge Flow - Tunel HTTPS
where ngrok >nul 2>nul
if errorlevel 1 (
  echo ngrok nao foi encontrado neste computador.
  echo Instale o ngrok ou use Radmin VPN e compartilhe o endereco 26.x.x.x mostrado em Conexao.
  pause
  exit /b 1
)
echo Iniciando tunel HTTPS para o GameForge Flow...
echo Mantenha START.bat aberto em outra janela.
ngrok http 8765
pause

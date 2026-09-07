# GameForge Flow v0.9.0

Abra `START.bat` para iniciar o aplicativo em `http://localhost:8765`.

Para instalar um atalho na Área de Trabalho, execute `INSTALL.bat`. O aplicativo continua local-first e requer Python 3 no computador host.

Os Saves locais continuam no navegador. Ao hospedar um Save para a equipe, os dados ficam na pasta `GameForge_Flow_Data`, fora da pasta pública do aplicativo.

## Equipe e conexão

- Cada membro possui cargo, especialidades e permissões separadas para Visão, Produção, Execução, comentários, arquivos, equipe e configurações.
- A sessão compartilhada mostra presença e recebe atualizações em tempo quase real. Alterações concorrentes nunca sobrescrevem um rascunho silenciosamente.
- Para a mesma rede ou Radmin VPN, use o endereço detectado em **Conexão**. Para acesso externo, mantenha `START.bat` aberto e execute `START_TUNNEL.bat`; copie a URL HTTPS apresentada pelo ngrok para o convite.
- Não exponha diretamente a porta HTTP à internet. Links de convite e a chave do host são credenciais.

## Comentários e arquivos

Documentos de Visão, demandas e tarefas aceitam comentários e anexos. Em sessão compartilhada, anexos ficam no host (máximo de 6 MB). No modo local, ficam dentro do Save do navegador (máximo de 1,5 MB).

## MCP

O servidor `mcp_server.py` usa transporte stdio e oferece recursos de Save/documentos e ferramentas para equipe, demandas, tarefas e comentários.

1. Hospede ou retome um Save e copie o ID da sala mostrado em **Conexão**.
2. No PowerShell, execute `./CONFIGURE_MCP.ps1 -RoomId "ID_DA_SALA"`.
3. Copie o conteúdo de `mcp-config.generated.json` para a configuração MCP do cliente desejado e reinicie esse cliente.

O arquivo gerado contém a chave do host e não deve ser compartilhado ou versionado. Sem essa chave, o MCP inicia com escrita bloqueada.

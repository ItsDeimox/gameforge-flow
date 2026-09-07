# GameForge Flow — Prototype v0.3

## O que mudou
- **Setas de navegação entre stages** no topo da tela de trabalho:
  - Visão → Produção
  - Produção ↔ Visão / Execução
  - Execução ← Produção
- **Atalhos rápidos**:
  - `Alt + 1` = Visão
  - `Alt + 2` = Produção
  - `Alt + 3` = Execução
- **Save screen corrigida**:
  - lista de saves melhor centralizada;
  - linha `SELECT` confinada à área dos saves;
  - modal de novo save clicável;
  - Enter e duplo clique para abrir;
  - tecla `N` abre novo save.
- **Mais foco de “tela de jogo”**:
  - menos bordas e menos divisórias duras;
  - blocos com separação por forma, sombra e camadas;
  - transições mais suaves nas cartas.
- **Markdown Preview** continua ativo.

## Rodar
Windows:
1. Extraia o ZIP.
2. Execute `START.bat`.

Ou:
```bash
python server.py
```

Depois abra:
`http://localhost:8765`

## Observação
Esta versão ainda é um **protótipo navegável**, não a arquitetura final.
Ela serve principalmente para demonstrar:
- fluxo;
- UX;
- hierarquia;
- comportamento de navegação;
- sensação de app com cara de game.

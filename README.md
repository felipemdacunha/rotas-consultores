# Visitas em Campo — PWA de visitas comerciais

App instalável no celular para consultores registrarem visitas em campo,
com uso offline, e um painel para o gerente consultar e exportar em PDF.

## Arquivos

| Arquivo | O que faz |
|---|---|
| `index.html` | As três telas: login, consultor e gerente |
| `style.css` | Layout responsivo, tema claro e escuro |
| `app.js` | Registro das visitas, fila offline, filtros e geração do PDF |
| `sw.js` | Service Worker — faz o app abrir sem internet |
| `manifest.json` | Deixa o app instalável na tela inicial |
| `icon-192.png`, `icon-512.png` | Ícones do app |
| `apps-script.gs` | Back-end no Google Sheets (não vai para o repositório) |

## Como testar agora, sem configurar nada

Suba os arquivos e abra o link. Com `GOOGLE_SCRIPT_URL` vazia, o app roda
em **modo local**: tudo é salvo no navegador e o painel do gerente lê dali.
Serve para validar o fluxo antes de ligar a planilha.

A limitação é importante: em modo local, cada celular enxerga só as próprias
visitas. Para o gerente ver o time inteiro, é preciso conectar a planilha.

## Passo 1 — Publicar no GitHub Pages

1. Crie um repositório **público** (ex.: `rotas-consultores`).
2. Envie estes arquivos para a raiz: `index.html`, `style.css`, `app.js`,
   `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`.
   Não envie o `apps-script.gs` — ele vive dentro da planilha.
3. **Settings > Pages > Branch**: escolha `main`, pasta `/ (root)`, **Save**.
4. Em um ou dois minutos o link aparece: `https://SEU-USUARIO.github.io/rotas-consultores/`

Os caminhos do código são todos relativos (`./`), então funciona em subpasta
sem ajuste nenhum.

## Passo 2 — Conectar a planilha do Google

1. Crie uma planilha nova no Google Sheets.
2. **Extensões > Apps Script**, apague o conteúdo e cole o `apps-script.gs`.
3. **Implantar > Nova implantação > App da Web**:
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
4. Autorize (o aviso "app não verificado" é esperado: o app é seu — clique em
   *Avançado > Acessar projeto*).
5. Copie a URL gerada (termina em `/exec`).
6. No `app.js`, preencha a primeira linha de configuração:

   ```js
   const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfy.../exec';
   ```

7. Faça o commit. A aba `Visitas` nasce sozinha no primeiro envio.

## Passo 3 — Instalar no celular

- **Android/Chrome**: abra o link, menu ⋮ > *Instalar aplicativo*.
- **iPhone/Safari**: abra o link, botão Compartilhar > *Adicionar à Tela de Início*.

## Como funciona o modo offline

O consultor preenche e toca em registrar. O app tenta enviar na hora; se não
conseguir, a visita entra numa fila no `localStorage` e a barra no topo avisa
quantas estão esperando. Assim que a internet volta — ou a cada 30 segundos,
ou quando o app volta do segundo plano — a fila sobe sozinha. Nada se perde
se o celular for fechado no meio: a fila fica gravada no aparelho.

O `id` de cada visita evita duplicata: se o mesmo registro for reenviado, o
Apps Script identifica e ignora.

## Duas coisas que você precisa saber

**A URL do Apps Script é uma chave.** Publicada como "Qualquer pessoa", quem
tiver o endereço consegue gravar e ler visitas. Como o `app.js` fica num
repositório público, a URL fica visível para quem procurar. Para um protótipo
com poucos consultores, tudo bem. Antes de virar ferramenta oficial, vale
adicionar um token compartilhado no Apps Script, ou mover o back-end para um
serviço com autenticação de verdade.

**O GPS precisa de HTTPS.** O GitHub Pages já serve em HTTPS, então funciona.
Se você abrir o arquivo direto do disco (`file://`), o botão de localização e
o Service Worker não funcionam — teste sempre pelo link publicado, ou por um
servidor local (`python3 -m http.server`).

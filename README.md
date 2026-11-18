# Upload de Roteiros

Ferramenta web que extrai, **direto no navegador e sem n8n**, as informações dos arquivos de roteiro (DOCX, PDF, RTF, TXT):

- **arquivo**: nome do arquivo;
- **autor**: metadado de autor do documento (DOCX: `dc:creator`, ou "modificado por" se vazio; PDF: `Author`/XMP; RTF: `{\info{\author}}`);
- **texto**: texto completo, um parágrafo por linha;
- **artes**: todos os textos sublinhados, sem duplicatas, e `artes_quantidade`.

A extração roda no navegador de quem envia. O n8n recebe os **dados já extraídos junto com o arquivo original**, e não precisa mais abrir nem processar o documento: só cria os cards.

```
navegador: extractor.js  ──(arquivo + dados extraídos)──▶  webhook n8n  ──▶  Trello
           (texto, autor, artes)
```

Com `WEBHOOK_URL: null` em `app.js` o site só extrai e exporta, sem enviar nada.

## Visão geral

A tela nasce **compacta**, mostrando só a área de envio. Assim que o primeiro arquivo entra, a interface expande para mostrar a fila e as estatísticas. Cada arquivo concluído tem um botão **Ver resultado** (autor, artes, texto completo, copiar/baixar JSON). Em **Mais ações** é possível exportar todos os resultados em JSON ou as artes em CSV (uma linha por arte, separador `;`, abre direto no Excel).

## Regras de extração das artes

As mesmas regras valem para os três formatos (todos viram o mesmo modelo de parágrafos e trechos antes de montar as artes):

- **O que conta como sublinhado**
  - DOCX: `<w:u>` no trecho ou herdado do estilo de caractere/parágrafo;
  - RTF: `\ul` (e variações como `\uldb`, `\ulw`) até `\ulnone`/`\ul0`/`\plain`;
  - PDF: traços horizontais finos desenhados sob o texto (linha ou retângulo preenchido) e anotações de sublinhado feitas em leitores de PDF. Réguas e bordas de tabela que passam muito além do texto são ignoradas.
- **Separação**: cada `/` separa uma arte da outra (`HOJE/AMANHÃ` → `HOJE` e `AMANHÃ`); cada parágrafo também.
- **União**:
  - espaço, tab ou quebra de linha manual (Shift+Enter) entre dois sublinhados não separa;
  - arte terminada em `: - – , / & +` é unida à próxima arte sublinhada (`GC:` + `NOME` → `GC: NOME`), se não houver texto normal no meio;
  - no PDF, quebras automáticas de linha são emendadas (inclusive palavra cortada no meio); quebras feitas pelo autor separam.
- **Ignorados**: texto dentro de links, caminhos de rede (`\\servidor\pasta`, `C:\...`), URLs, `www.` e timecodes.
- **Palavra de parada**: tudo a partir de `DECUPAGEM` é descartado (texto e artes).

Os parâmetros ficam no topo do `extractor.js`, em `EXTRACTION_CONFIG`.

### Limitações conhecidas

- **PDF**: o pdf.js informa a posição de cada trecho, não de cada letra; a posição das letras é estimada e o sublinhado é decidido por **palavra inteira**. Sublinhado de só uma parte da palavra não é detectado com precisão. Uma quebra de linha manual (Shift+Enter) no PDF é indistinguível de um novo parágrafo, então separa as artes (no DOCX/RTF ela une).
- **PDF digitalizado** (imagem, sem texto) precisa de OCR; o arquivo é marcado com aviso.
- **TXT** não tem sublinhado nem autor: só o texto é extraído.
- Cabeçalho, rodapé e notas de rodapé não entram no texto.

## O que o n8n recebe

`POST` em `WEBHOOK_URL`, `multipart/form-data`, um arquivo por requisição:

| Campo | Conteúdo |
|---|---|
| `file` | Arquivo original (binário) |
| `request_id` | ID estável do arquivo na fila (o mesmo em todas as tentativas) |
| `arquivo` | Nome do arquivo |
| `autor` | Autor (vazio se não identificado) |
| `formato` | `docx`, `pdf`, `rtf` ou `txt` |
| `texto` | Texto completo, um parágrafo por linha |
| `artes` | **JSON**: array de strings |
| `artes_quantidade` | Número (como texto) |
| `interrompido_em` | `DECUPAGEM` se o texto foi cortado ali, senão vazio |
| `avisos` | **JSON**: array de strings |
| `dados` | **JSON** com todos os campos acima, num campo só |

No n8n (nó Webhook com método POST), os campos de texto ficam em `$json.body` e o arquivo fica nos dados binários (nas versões atuais, com o nome do campo: `file`). Como multipart só transporta texto, `artes` chega como string JSON:

```
{{ JSON.parse($json.body.artes) }}
```

ou, para pegar tudo de uma vez, um nó **Code**:

```js
return $input.all().map((item) => ({
  json: JSON.parse(item.json.body.dados),
  binary: item.binary
}));
```

Os nós de extração (Extract from File, XML e os Code de sublinhado) podem ser removidos do workflow.

**Resposta esperada** (igual à de antes): JSON `{ "success": true|false, "message": "..." }`, também aceito dentro de um array. Opcionalmente `card_url` (https), que vira um botão **Abrir card** na fila.

O healthcheck continua o mesmo: `GET HEALTHCHECK_URL` respondendo `{ "online": true }`.

## Estrutura de arquivos

```
index.html          Estrutura da página
styles.css          Estilos (tokens de cor, layout, animações, responsividade)
app.js              Interface: validação, fila, resultados, exportação
extractor.js        Extração de texto, autor e artes (DOCX, PDF, RTF, TXT)
vendor/pdfjs/       pdf.js 4.10.38 (Mozilla, Apache-2.0), carregado só quando há PDF
favicon.png         Ícone da aba
```

O DOCX é descompactado com `DecompressionStream`, nativo do navegador; o RTF é lido por um parser próprio. O pdf.js fica copiado no repositório para funcionar em redes que bloqueiam CDNs.

## Configuração

`app.js` → `CONFIG`:

| Campo | Descrição |
|---|---|
| `WEBHOOK_URL` | Webhook do n8n que recebe arquivo + dados. `null` = só local. |
| `FILE_FIELD_NAME` | Nome do campo do arquivo (padrão `file`; `null` = não envia o arquivo). |
| `REQUEST_ID_FIELD_NAME` | Campo com o ID estável por arquivo, para o n8n reconhecer reenvios. |
| `SEND_INTERVAL_MS` | Intervalo mínimo entre o início de cada envio (padrão 3 s). |
| `REQUEST_TIMEOUT_MS` | Tempo máximo de espera pela resposta do n8n. |
| `HEALTHCHECK_URL` | Endpoint do indicador "Workflow disponível". |
| `MAX_FILE_SIZE_BYTES` | Limite de tamanho por arquivo. |
| `ALLOWED_EXTENSIONS` | Extensões aceitas. |
| `MAX_ATTEMPTS` | Limite de tentativas de reprocessamento (`null` = ilimitado). |
| `EXPORT_FILE_NAME` | Nome base dos arquivos exportados. |

`extractor.js` → `EXTRACTION_CONFIG`: palavra de parada, regras de união, padrões ignorados, espessura dos traços de sublinhado em PDF.

## Como usar

1. Preencha `WEBHOOK_URL` e `HEALTHCHECK_URL` em `app.js`. O n8n precisa liberar CORS para a origem do site, como já era antes.
2. Publique os arquivos como site estático (Cloudflare Pages, sem build e com saída `/`) ou sirva localmente com `python3 -m http.server`.

Abrir o `index.html` direto do disco (`file://`) não funciona para PDF, porque o navegador bloqueia o carregamento de módulos nesse modo.

## Compatibilidade

Usa recursos modernos de CSS (Container Queries, `clamp()`, CSS Grid) e JavaScript (módulos, `DecompressionStream`, `<dialog>`). Recomendado Chrome/Edge 103+, Firefox 113+ ou Safari 16.4+.

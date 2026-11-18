# Upload de Roteiros

Ferramenta web que extrai, **direto no navegador e sem n8n**, as informações dos arquivos de roteiro (DOCX, PDF, RTF, TXT):

- **arquivo**: nome do arquivo;
- **autor**: metadado de autor do documento (DOCX: `dc:creator`, ou "modificado por" se vazio; PDF: `Author`/XMP; RTF: `{\info{\author}}`);
- **texto**: texto completo, um parágrafo por linha;
- **artes**: todos os textos sublinhados, sem duplicatas, e `artes_quantidade`.

Nenhum arquivo sai do computador do usuário: não há servidor nem webhook.

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
| `MAX_FILE_SIZE_BYTES` | Limite de tamanho por arquivo. |
| `ALLOWED_EXTENSIONS` | Extensões aceitas. |
| `MAX_ATTEMPTS` | Limite de tentativas de reprocessamento (`null` = ilimitado). |
| `EXPORT_FILE_NAME` | Nome base dos arquivos exportados. |

`extractor.js` → `EXTRACTION_CONFIG`: palavra de parada, regras de união, padrões ignorados, espessura dos traços de sublinhado em PDF.

## Como usar localmente

1. Sirva a pasta por um servidor HTTP simples (ex.: `python3 -m http.server`). Abrir o `index.html` direto do disco (`file://`) não funciona para PDF, porque o navegador bloqueia o carregamento de módulos nesse modo.
2. Abra no navegador e arraste os roteiros.

## Compatibilidade

Usa recursos modernos de CSS (Container Queries, `clamp()`, CSS Grid) e JavaScript (módulos, `DecompressionStream`, `<dialog>`). Recomendado Chrome/Edge 103+, Firefox 113+ ou Safari 16.4+.

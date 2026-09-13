# Upload de Roteiros

Ferramenta web para envio e acompanhamento do processamento de arquivos de roteiro (DOCX, PDF, TXT, RTF), integrada a um workflow n8n via webhook.

## Visão geral

A tela nasce **compacta**, mostrando só a área de envio (título, drop zone, formatos aceitos). Assim que o primeiro arquivo começa a ser enviado, a interface expande para revelar a fila de upload e as estatísticas ao lado. Quando a fila volta a ficar vazia, o card encolhe de volta ao estado inicial.

## Principais funcionalidades

- **Drag & drop ou seleção manual** de múltiplos arquivos, com validação de extensão (`.docx`, `.txt`, `.pdf`, `.rtf`) e de tamanho (25 MB por arquivo).
- **Fila de upload sequencial**, com intervalo configurável entre envios, para não sobrecarregar o workflow.
- **Pausar / retomar** o envio da fila a qualquer momento.
- **Reenvio individual ou em massa** de arquivos com erro.
- **Exclusão seletiva**: remover só os concluídos, só os com erro, ou limpar a fila inteira (mantendo o que está em processamento).
- **Verificação de saúde do workflow** (healthcheck) em segundo plano, com indicador "Workflow disponível / indisponível" na barra superior.
- **Gradiente de fundo interativo**, que acompanha a posição do cursor.
- Layout responsivo, com comportamento dedicado para mobile (sempre em tela cheia) e desktop (card compacto que expande sob demanda).

## Estrutura de arquivos

```
index.html    Estrutura da página
styles.css    Estilos (tokens de cor, layout, animações, responsividade)
app.js        Lógica: validação, fila, envio, healthcheck, UI
favicon.png   Ícone da aba (não incluído neste pacote)
```

## Configuração

Os parâmetros ficam no topo do `app.js`, no objeto `CONFIG`:

| Campo | Descrição |
|---|---|
| `WEBHOOK_URL` | Endpoint que recebe cada arquivo (multipart/form-data). |
| `HEALTHCHECK_URL` | Endpoint usado para checar se o workflow está disponível. |
| `FILE_FIELD_NAME` | Nome do campo do arquivo no multipart (padrão: `file`). |
| `REQUEST_ID_FIELD_NAME` | Campo enviado junto com um ID estável por arquivo, para o n8n identificar reenvios da mesma tentativa. |
| `SEND_INTERVAL_MS` | Intervalo entre o início de cada envio na fila. |
| `REQUEST_TIMEOUT_MS` | Tempo máximo de espera por uma resposta antes de marcar erro. |
| `MAX_FILE_SIZE_BYTES` | Limite de tamanho por arquivo. |
| `ALLOWED_EXTENSIONS` | Extensões aceitas. |
| `MAX_ATTEMPTS` | Limite de tentativas de reenvio (`null` = ilimitado). |
| `HEALTHCHECK_INTERVAL_MS` / `HEALTHCHECK_TIMEOUT_MS` | Frequência e timeout da checagem de saúde. |

## Como usar localmente

1. Ajuste `WEBHOOK_URL` e `HEALTHCHECK_URL` em `app.js` para os endpoints do seu ambiente n8n.
2. Sirva os três arquivos (`index.html`, `styles.css`, `app.js`) por um servidor HTTP simples (ex.: `python3 -m http.server`) — não é necessário build.
3. Abra no navegador. Não há dependências externas além do próprio navegador.

## Compatibilidade

Usa recursos modernos de CSS (Container Queries, `clamp()`, CSS Grid) e JavaScript (async/await, `fetch`). Recomendado Chrome, Edge, Firefox ou Safari em versões recentes (últimos ~2 anos).

## Acessibilidade

- Áreas de status usam `aria-live` para leitores de tela.
- Drop zone navegável por teclado (`tabindex`, `role="button"`).
- Textos alternativos e rótulos (`aria-label`) nos controles principais.

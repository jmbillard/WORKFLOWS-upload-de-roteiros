import {
  json,
  missingConfig,
  rejectForeignOrigin,
  trello
} from "../_lib/trello.js";

/*
 * POST /api/roteiros  (multipart/form-data)
 *   resultado   JSON gerado pelo extractor.js no navegador
 *   request_id  ID estável do arquivo na fila (evita card duplicado em reenvios)
 *   file        arquivo original (opcional), anexado ao card
 *
 * Cria um card na lista TRELLO_LIST_ID com:
 *   nome        nome do arquivo (sem extensão)
 *   descrição   autor, quantidade e lista de artes
 *   checklist   "Artes", um item por arte
 *   anexo       o arquivo original
 *
 * Resposta: { success, message, card_url? }
 */

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_ARTES = 300;
const MAX_ARTE_LENGTH = 1000;
const MAX_DESC_LENGTH = 16000; // limite do Trello: 16384
const REQUEST_ID_PATTERN = /^[\w-]{8,64}$/;

export async function onRequestPost({ request, env }) {
  const rejected = rejectForeignOrigin(request, env);
  if (rejected) return rejected;

  const missing = missingConfig(env);
  if (missing.length > 0) {
    return json(
      { success: false, message: `Worker sem configuração: ${missing.join(", ")}.` },
      500
    );
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return fail("Envie os dados como multipart/form-data.", 400);
  }

  let result;
  try {
    result = JSON.parse(form.get("resultado") || "");
  } catch {
    return fail('O campo "resultado" não contém um JSON válido.', 400);
  }

  const problem = validateResult(result);
  if (problem) return fail(problem, 400);

  const file = form.get("file");
  if (file && typeof file !== "string" && file.size > MAX_FILE_BYTES) {
    return fail("O arquivo excede 25 MB.", 413);
  }

  const requestId = String(form.get("request_id") || "");
  const marker = REQUEST_ID_PATTERN.test(requestId) ? `roteiro-id: ${requestId}` : null;

  /* Reenvio do mesmo arquivo: devolve o card já criado. */
  if (marker) {
    const existing = await findCardByMarker(env, marker).catch(() => null);
    if (existing) {
      return json({
        success: true,
        message: "Card já existia no Trello (reenvio).",
        card_url: existing.shortUrl
      });
    }
  }

  let card;
  try {
    card = await trello(env, "POST", "/cards", {
      body: {
        idList: env.TRELLO_LIST_ID,
        name: cardName(result.arquivo),
        desc: cardDescription(result, marker),
        pos: "bottom",
        ...(env.TRELLO_LABEL_IDS ? { idLabels: env.TRELLO_LABEL_IDS } : {})
      }
    });
  } catch (error) {
    return fail(`Não foi possível criar o card. ${error.message}`, 502);
  }

  /* Card criado: falhas daqui em diante não devem gerar card duplicado. */
  const warnings = [];

  if (result.artes.length > 0) {
    try {
      const checklist = await trello(env, "POST", "/checklists", {
        body: { idCard: card.id, name: "Artes" }
      });

      for (const arte of result.artes) {
        await trello(env, "POST", `/checklists/${checklist.id}/checkItems`, {
          body: { name: arte, pos: "bottom" }
        });
      }
    } catch (error) {
      warnings.push(`checklist incompleta (${error.message})`);
    }
  }

  if (file && typeof file !== "string" && file.size > 0) {
    try {
      const upload = new FormData();
      upload.append("file", file, result.arquivo);
      upload.append("name", result.arquivo);
      await trello(env, "POST", `/cards/${card.id}/attachments`, { body: upload });
    } catch (error) {
      warnings.push(`anexo não enviado (${error.message})`);
    }
  }

  return json({
    success: true,
    message: warnings.length
      ? `Card criado, mas com problemas: ${warnings.join("; ")}.`
      : "Card criado no Trello.",
    card_url: card.shortUrl
  });
}

function fail(message, status) {
  return json({ success: false, message }, status);
}

function validateResult(result) {
  if (!result || typeof result !== "object") return "Resultado ausente.";
  if (typeof result.arquivo !== "string" || !result.arquivo.trim()) {
    return 'Resultado sem "arquivo".';
  }
  if (!Array.isArray(result.artes) || result.artes.some((a) => typeof a !== "string")) {
    return 'Resultado com "artes" inválidas.';
  }
  if (result.artes.length > MAX_ARTES) {
    return `Mais de ${MAX_ARTES} artes: confira o sublinhado do documento.`;
  }
  if (result.artes.some((a) => a.length > MAX_ARTE_LENGTH)) {
    return `Há arte com mais de ${MAX_ARTE_LENGTH} caracteres: confira o sublinhado do documento.`;
  }
  return null;
}

function cardName(fileName) {
  return fileName.replace(/\.[^.]+$/, "").trim().slice(0, 500) || fileName;
}

function cardDescription(result, marker) {
  const lines = [
    `**Autor:** ${result.autor || "não identificado"}`,
    `**Arquivo:** ${result.arquivo}`,
    `**Artes:** ${result.artes.length}`,
    ""
  ];

  result.artes.forEach((arte, index) => {
    lines.push(`${index + 1}. ${arte}`);
  });

  let desc = lines.join("\n");
  const footer = marker ? `\n\n---\n${marker}` : "";

  if (desc.length + footer.length > MAX_DESC_LENGTH) {
    desc = desc.slice(0, MAX_DESC_LENGTH - footer.length - 20) + "\n…(lista cortada)";
  }

  return desc + footer;
}

async function findCardByMarker(env, marker) {
  const cards = await trello(env, "GET", `/lists/${env.TRELLO_LIST_ID}/cards`, {
    query: { fields: "desc,shortUrl" }
  });
  return cards.find((card) => card.desc && card.desc.includes(marker)) || null;
}

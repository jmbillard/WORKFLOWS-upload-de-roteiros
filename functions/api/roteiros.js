import { callN8n, json, n8nHeaders } from "../_lib/n8n.js";

/*
 * POST /api/roteiros → repassa o envio (arquivo + dados extraídos,
 * multipart/form-data) ao webhook do n8n (N8N_WEBHOOK_URL) sem
 * processar nada: o corpo é transmitido direto, então quase não usa CPU.
 * A resposta do n8n volta igual para o navegador.
 */
const MAX_BODY_BYTES = 30 * 1024 * 1024;

export async function onRequestPost({ request, env, data }) {
  if (!env.N8N_WEBHOOK_URL) {
    return json({ success: false, message: "N8N_WEBHOOK_URL não configurada no Pages." }, 500);
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.startsWith("multipart/form-data")) {
    return json({ success: false, message: "Envie os dados como multipart/form-data." }, 400);
  }

  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) {
    return json({ success: false, message: "Arquivo grande demais." }, 413);
  }

  const headers = n8nHeaders(env, data.userEmail);
  headers["Content-Type"] = contentType;
  if (length) headers["Content-Length"] = String(length);

  const call = await callN8n(env.N8N_WEBHOOK_URL, {
    method: "POST",
    headers,
    body: request.body
  });

  if (!call.ok) {
    return json({ success: false, message: call.message }, call.status);
  }

  const response = call.response;

  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") || "application/json",
      "cache-control": "no-store"
    }
  });
}

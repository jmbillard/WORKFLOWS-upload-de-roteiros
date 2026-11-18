import { callN8n, json, n8nHeaders } from "../_lib/n8n.js";

/*
 * GET /api/health → repassa ao healthcheck do n8n (N8N_HEALTHCHECK_URL),
 * que deve responder { "online": true }. Quando está offline, "message"
 * explica o motivo (aparece ao passar o mouse no indicador).
 */
export async function onRequestGet({ env, data }) {
  if (!env.N8N_HEALTHCHECK_URL) {
    return json({ online: false, message: "N8N_HEALTHCHECK_URL não configurada no Pages." }, 503);
  }

  const call = await callN8n(env.N8N_HEALTHCHECK_URL, {
    method: "GET",
    headers: n8nHeaders(env, data.userEmail),
    signal: AbortSignal.timeout(8000)
  });

  if (!call.ok) {
    return json({ online: false, message: call.message }, 503);
  }

  const response = call.response;
  const text = await response.text();
  let body = null;

  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }

  const result = Array.isArray(body) ? body[0] : body;

  if (!response.ok || !result || result.online !== true) {
    return json({
      online: false,
      message: response.ok
        ? 'O healthcheck do n8n não respondeu { "online": true }.'
        : `O healthcheck do n8n respondeu HTTP ${response.status}.`
    }, 503);
  }

  return json({ online: true, usuario: data.userEmail || null });
}

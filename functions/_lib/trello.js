/* =========================================================
   Utilitários compartilhados das Pages Functions.
   Arquivos em _lib não exportam handlers, então não viram rotas.
   ========================================================= */

const TRELLO_API = "https://api.trello.com/1";

export const REQUIRED_ENV = ["TRELLO_KEY", "TRELLO_TOKEN", "TRELLO_LIST_ID"];

export function missingConfig(env) {
  return REQUIRED_ENV.filter((name) => !env[name]);
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

/*
 * Aceita só chamadas da própria página (mesma origem) ou de origens
 * listadas em ALLOWED_ORIGINS (separadas por vírgula).
 * Não substitui autenticação: para restringir quem usa, coloque o
 * site atrás do Cloudflare Access.
 */
export function rejectForeignOrigin(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return null;

  const allowed = new Set(
    (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
  allowed.add(new URL(request.url).origin);

  return allowed.has(origin)
    ? null
    : json({ success: false, message: "Origem não autorizada." }, 403);
}

export class TrelloError extends Error {
  constructor(status, detail) {
    super(`Trello respondeu HTTP ${status}${detail ? `: ${detail}` : ""}`);
    this.status = status;
  }
}

/*
 * Chamada à API do Trello. A chave e o token vão no cabeçalho
 * Authorization (não na URL, para não aparecerem em logs).
 * `body`: objeto (enviado como JSON) ou FormData.
 */
export async function trello(env, method, path, { query, body } = {}) {
  const url = new URL(TRELLO_API + path);
  for (const [key, value] of Object.entries(query || {})) {
    url.searchParams.set(key, value);
  }

  const headers = {
    Accept: "application/json",
    Authorization:
      `OAuth oauth_consumer_key="${env.TRELLO_KEY}", ` +
      `oauth_token="${env.TRELLO_TOKEN}"`
  };

  let payload;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, { method, headers, body: payload });
  const text = await response.text();

  if (!response.ok) {
    throw new TrelloError(response.status, text.slice(0, 200).trim());
  }

  return text ? JSON.parse(text) : null;
}

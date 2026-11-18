/* =========================================================
   Utilitários das Pages Functions (ponte entre o site e o n8n).
   Arquivos em _lib não exportam handlers, então não viram rotas.
   ========================================================= */

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
 * Cabeçalhos enviados ao n8n:
 *   - service token do Access, se o n8n também estiver atrás do Access
 *     (N8N_ACCESS_CLIENT_ID / N8N_ACCESS_CLIENT_SECRET);
 *   - autenticação do próprio webhook do n8n, se usar "Header Auth"
 *     (N8N_AUTH_HEADER_NAME / N8N_AUTH_HEADER_VALUE);
 *   - e-mail de quem enviou, vindo do Access (x-enviado-por).
 */
export function n8nHeaders(env, userEmail) {
  const headers = { Accept: "application/json" };

  if (env.N8N_ACCESS_CLIENT_ID && env.N8N_ACCESS_CLIENT_SECRET) {
    headers["CF-Access-Client-Id"] = env.N8N_ACCESS_CLIENT_ID;
    headers["CF-Access-Client-Secret"] = env.N8N_ACCESS_CLIENT_SECRET;
  }

  if (env.N8N_AUTH_HEADER_NAME && env.N8N_AUTH_HEADER_VALUE) {
    headers[env.N8N_AUTH_HEADER_NAME] = env.N8N_AUTH_HEADER_VALUE;
  }

  if (userEmail) {
    headers["x-enviado-por"] = userEmail;
  }

  return headers;
}

/*
 * Chama o n8n sem seguir redirecionamentos: um 302 aqui quase sempre é
 * o Access mandando para a tela de login, e isso vira uma mensagem clara.
 */
export async function callN8n(url, init) {
  let response;

  try {
    response = await fetch(url, { ...init, redirect: "manual" });
  } catch (error) {
    return {
      ok: false,
      status: 502,
      message: `Não foi possível conectar ao n8n (${error.message}). ` +
        "Confira a URL e se o servidor/túnel está no ar."
    };
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location") || "";
    const isAccess = /cloudflareaccess\.com|cdn-cgi\/access/i.test(location);

    return {
      ok: false,
      status: 502,
      message: isAccess
        ? "O n8n está protegido pelo Cloudflare Access e recusou a função. " +
          "Crie um Service Token, adicione uma regra Service Auth na aplicação " +
          "do n8n e preencha N8N_ACCESS_CLIENT_ID e N8N_ACCESS_CLIENT_SECRET."
        : `O n8n redirecionou a chamada (HTTP ${response.status}). Confira a URL.`
    };
  }

  if (response.status === 401 || response.status === 403) {
    const isAccess = response.headers.has("cf-access-domain") ||
      /access/i.test(response.headers.get("www-authenticate") || "");

    return {
      ok: false,
      status: 502,
      response,
      message: isAccess
        ? "O Cloudflare Access recusou o service token. Confira o token e a regra Service Auth."
        : `O n8n recusou a autenticação (HTTP ${response.status}). Confira N8N_AUTH_HEADER_*.`
    };
  }

  return { ok: true, response };
}

/* ---------------------------------------------------------
   Validação do token do Cloudflare Access (opcional)

   Com ACCESS_TEAM_DOMAIN e ACCESS_AUD definidos, a função só aceita
   requisições que passaram pelo Access. Isso fecha brechas como
   a URL *.pages.dev ou um deploy de preview sem a política.
   --------------------------------------------------------- */

const CERTS_TTL_MS = 10 * 60 * 1000;
let certsCache = { url: "", keys: null, at: 0 };

function b64urlToBytes(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function decodeJsonPart(value) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(value)));
}

function teamOrigin(env) {
  const domain = env.ACCESS_TEAM_DOMAIN.trim().replace(/\/+$/, "");
  return domain.startsWith("http") ? domain : `https://${domain}`;
}

async function getAccessKeys(origin, forceRefresh) {
  const url = `${origin}/cdn-cgi/access/certs`;
  const fresh = Date.now() - certsCache.at < CERTS_TTL_MS;

  if (!forceRefresh && certsCache.url === url && certsCache.keys && fresh) {
    return certsCache.keys;
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`certs HTTP ${response.status}`);

  const { keys } = await response.json();
  certsCache = { url, keys, at: Date.now() };
  return keys;
}

/*
 * Retorna { ok: true, email } ou { ok: false, response }.
 * Sem ACCESS_TEAM_DOMAIN/ACCESS_AUD, confia no Access na frente
 * do site e só lê o e-mail do cabeçalho.
 */
export async function verifyAccess(request, env) {
  const headerEmail = request.headers.get("cf-access-authenticated-user-email") || "";

  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    return { ok: true, email: headerEmail };
  }

  const deny = (message) => ({
    ok: false,
    response: json({ success: false, online: false, message }, 403)
  });

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return deny("Acesso negado: a requisição não passou pelo Cloudflare Access.");

  try {
    const [rawHeader, rawPayload, rawSignature] = token.split(".");
    const header = decodeJsonPart(rawHeader);
    const payload = decodeJsonPart(rawPayload);
    const origin = teamOrigin(env);

    let keys = await getAccessKeys(origin, false);
    let jwk = keys.find((key) => key.kid === header.kid);

    if (!jwk) {
      keys = await getAccessKeys(origin, true); // chaves podem ter sido trocadas
      jwk = keys.find((key) => key.kid === header.kid);
    }
    if (!jwk) return deny("Acesso negado: chave do token desconhecida.");

    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(rawSignature),
      new TextEncoder().encode(`${rawHeader}.${rawPayload}`)
    );

    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const now = Math.floor(Date.now() / 1000);

    if (!valid) return deny("Acesso negado: assinatura do token inválida.");
    if (!audiences.includes(env.ACCESS_AUD)) return deny("Acesso negado: token de outra aplicação.");
    if (payload.exp && payload.exp < now) return deny("Sessão do Access expirada. Recarregue a página.");
    if (payload.iss && payload.iss !== origin) return deny("Acesso negado: emissor do token inválido.");

    return { ok: true, email: payload.email || headerEmail };
  } catch (error) {
    return deny(`Acesso negado: token inválido (${error.message}).`);
  }
}

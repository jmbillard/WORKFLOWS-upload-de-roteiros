import { json, verifyAccess } from "../_lib/n8n.js";

/* Vale para tudo em /api/*: valida o Access e confere a origem. */
export async function onRequest(context) {
  const { request, env, data } = context;

  const access = await verifyAccess(request, env);
  if (!access.ok) return access.response;
  data.userEmail = access.email;

  /* Bloqueia chamadas feitas por páginas de outros domínios. */
  const origin = request.headers.get("origin");
  if (request.method !== "GET" && origin && origin !== new URL(request.url).origin) {
    return json({ success: false, message: "Origem não autorizada." }, 403);
  }

  return context.next();
}

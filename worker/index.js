/* =========================================================
   Entrada do Worker (Workers + Static Assets).

   Os arquivos do site são servidos direto como assets; só /api/*
   chega aqui (ver "run_worker_first" no wrangler.jsonc). As rotas
   reaproveitam os mesmos handlers da pasta functions/.
   ========================================================= */

import { onRequest as middleware } from "../functions/api/_middleware.js";
import { onRequestGet as health } from "../functions/api/health.js";
import { onRequestPost as roteiros } from "../functions/api/roteiros.js";
import { json } from "../functions/_lib/n8n.js";

const ROUTES = {
  "/api/health": { GET: health },
  "/api/roteiros": { POST: roteiros }
};

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const route = ROUTES[pathname.replace(/\/+$/, "")];

    if (!route) {
      if (pathname.startsWith("/api/")) {
        return json({ success: false, message: "Rota não encontrada." }, 404);
      }
      return env.ASSETS.fetch(request);
    }

    const handler = route[request.method];
    if (!handler) {
      return json({ success: false, message: "Método não permitido." }, 405);
    }

    const context = { request, env, data: {}, waitUntil: (p) => ctx.waitUntil(p) };
    context.next = () => handler(context);

    return middleware(context);
  }
};

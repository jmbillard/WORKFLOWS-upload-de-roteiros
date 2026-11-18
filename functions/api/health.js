import { json, missingConfig, trello } from "../_lib/trello.js";

/*
 * GET /api/health
 * { "online": true } quando o worker está configurado e o Trello
 * aceita as credenciais e encontra a lista de destino.
 */
export async function onRequestGet({ env }) {
  const missing = missingConfig(env);

  if (missing.length > 0) {
    return json(
      { online: false, message: `Variáveis ausentes: ${missing.join(", ")}.` },
      503
    );
  }

  try {
    const list = await trello(env, "GET", `/lists/${env.TRELLO_LIST_ID}`, {
      query: { fields: "name,closed" }
    });

    if (list.closed) {
      return json({ online: false, message: "A lista do Trello está arquivada." }, 503);
    }

    return json({ online: true, lista: list.name });
  } catch (error) {
    return json({ online: false, message: error.message }, 503);
  }
}

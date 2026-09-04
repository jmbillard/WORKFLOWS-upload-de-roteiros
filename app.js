"use strict";

/* =========================================================
   Configuração
   ========================================================= */

const CONFIG = Object.freeze({
  /**
   * Substitua pela URL final que você já testou.
   */
  WEBHOOK_URL:
    "****",

  /**
   * Nome do campo multipart/form-data recebido pelo n8n.
   */
  FILE_FIELD_NAME: "file",

  /**
   * Identificador estável enviado com todas as tentativas
   * do mesmo arquivo. Defina como null para não enviar.
   */
  REQUEST_ID_FIELD_NAME: "request_id",

  SEND_INTERVAL_MS: 3000,
  REQUEST_TIMEOUT_MS: 120000,
  MAX_FILE_SIZE_BYTES: 25 * 1024 * 1024,
  ALLOWED_EXTENSIONS: ["docx", "txt", "pdf", "rtf"],

  /**
   * null permite tentativas ilimitadas.
   */
  MAX_ATTEMPTS: null,

  HEALTHCHECK_URL:
    "****",

  HEALTHCHECK_INTERVAL_MS: 30000,
  HEALTHCHECK_TIMEOUT_MS: 5000,
});

const STATUS = Object.freeze({
  WAITING: "waiting",
  PROCESSING: "processing",
  SUCCESS: "success",
  ERROR: "error"
});

const STATUS_LABEL = Object.freeze({
  [STATUS.WAITING]: "Aguardando",
  [STATUS.PROCESSING]: "Processando",
  [STATUS.SUCCESS]: "Concluído",
  [STATUS.ERROR]: "Erro"
});

const state = {
  items: [],
  isPaused: false,
  isRunnerActive: false,
  lastDispatchAt: 0,
  renderedItemIds: new Set(),

  healthCheckIntervalId: null,
  isHealthCheckRunning: false,

  previousCounts: {
    total: 0,
    waiting: 0,
    processing: 0,
    success: 0,
    error: 0
  }
};

/*
 * Estado do healthcheck.
 * Deve ser declarado antes da chamada initialize().
 */
let healthCheckIntervalId = null;
let isHealthCheckRunning = false;

/* =========================================================
   Elementos
   ========================================================= */

const elements = {
  dropZone: document.querySelector("#drop-zone"),
  dropZoneTitle: document.querySelector("#drop-zone-title"),
  dropZoneDescription: document.querySelector("#drop-zone-description"),
  fileInput: document.querySelector("#file-input"),
  selectFilesButton: document.querySelector("#select-files-button"),
  uploadLimit: document.querySelector("#upload-limit"),
  validationMessages: document.querySelector("#validation-messages"),

  fileList: document.querySelector("#file-list"),
  emptyState: document.querySelector("#empty-state"),
  queueStateMessage: document.querySelector("#queue-state-message"),

  pauseButton: document.querySelector("#pause-button"),
  retryAllButton: document.querySelector("#retry-all-button"),
  removeCompletedButton: document.querySelector(
    "#remove-completed-button"
  ),
  removeErrorsButton: document.querySelector("#remove-errors-button"),
  clearQueueButton: document.querySelector("#clear-queue-button"),
  generalActionsMenu: document.querySelector("#general-actions-menu"),

  progressDescription: document.querySelector("#progress-description"),
  progressPercentage: document.querySelector("#progress-percentage"),
  progressTrack: document.querySelector("#progress-track"),
  progressBar: document.querySelector("#progress-bar"),

  countTotal: document.querySelector("#count-total"),
  countWaiting: document.querySelector("#count-waiting"),
  countProcessing: document.querySelector("#count-processing"),
  countSuccess: document.querySelector("#count-success"),
  countError: document.querySelector("#count-error"),

  connectionStatus: document.querySelector("#connection-status"),
  connectionStatusLabel: document.querySelector(
    "#connection-status-label"
  ),
};

/* =========================================================
   Inicialização
   ========================================================= */

initialize();

function initialize() {
  updateUploadInformation();
  initializeVisualEffects();
  registerEvents();
  render();
  initializeHealthCheck();
}

function initializeVisualEffects() {
  initializeTypewriter();

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      document.body.classList.add("motion-ready");
    });
  });
}

function initializeTypewriter() {
  const title = document.querySelector(".hero h1");

  if (!title) {
    return;
  }

  if (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }

  const originalText = title.textContent.trim();

  if (!originalText || originalText.length > 80) {
    return;
  }

  title.setAttribute("aria-label", originalText);
  title.classList.add("typewriter-title");

  const textElement = document.createElement("span");
  textElement.className = "typewriter-text";
  textElement.setAttribute("aria-hidden", "true");

  const cursorElement = document.createElement("span");
  cursorElement.className = "typewriter-cursor";
  cursorElement.setAttribute("aria-hidden", "true");
  cursorElement.textContent = "|";

  title.replaceChildren(textElement, cursorElement);

  const characters = splitTextIntoCharacters(originalText);
  let index = 0;

  window.setTimeout(typeNextCharacter, 380);

  function typeNextCharacter() {
    if (index >= characters.length) {
      window.setTimeout(() => {
        title.classList.add("hide-typewriter-cursor");
      }, 2200);

      return;
    }

    textElement.textContent += characters[index];
    index += 1;

    const delay = 38 + Math.random() * 34;
    window.setTimeout(typeNextCharacter, delay);
  }
}

function splitTextIntoCharacters(text) {
  if (
    typeof Intl !== "undefined" &&
    typeof Intl.Segmenter === "function"
  ) {
    const segmenter = new Intl.Segmenter("pt-BR", {
      granularity: "grapheme"
    });

    return Array.from(
      segmenter.segment(text),
      (segment) => segment.segment
    );
  }

  return Array.from(text);
}

/* =========================================================
   Eventos
   ========================================================= */

function registerEvents() {
  elements.selectFilesButton.addEventListener("click", (event) => {
    event.stopPropagation();
    elements.fileInput.click();
  });

  elements.dropZone.addEventListener("click", (event) => {
    if (event.target.closest("button")) {
      return;
    }

    elements.fileInput.click();
  });

  elements.dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      elements.fileInput.click();
    }
  });

  elements.fileInput.addEventListener("change", () => {
    addFiles(elements.fileInput.files);
    elements.fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();

      elements.dropZone.classList.add("is-dragging");
      elements.dropZoneTitle.textContent = "Pode soltar os arquivos";
      elements.dropZoneDescription.textContent =
        "Os documentos serão adicionados à fila.";
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();

      resetDropZoneText();
    });
  });

  elements.dropZone.addEventListener("drop", (event) => {
    addFiles(event.dataTransfer.files);
  });

  elements.fileList.addEventListener("click", handleFileAction);

  elements.pauseButton.addEventListener("click", togglePause);
  elements.retryAllButton.addEventListener("click", retryAllErrors);

  elements.removeCompletedButton.addEventListener(
    "click",
    removeCompletedItems
  );

  elements.removeErrorsButton.addEventListener(
    "click",
    removeErrorItems
  );

  elements.clearQueueButton.addEventListener("click", clearQueue);

  /**
   * Fecha menus quando o usuário clica fora deles.
   */
  document.addEventListener("click", (event) => {
    document.querySelectorAll("details[open]").forEach((details) => {
      if (!details.contains(event.target)) {
        details.removeAttribute("open");
      }
    });
  });

  window.addEventListener("beforeunload", (event) => {
    const hasUnfinishedItems = state.items.some((item) =>
      [STATUS.WAITING, STATUS.PROCESSING].includes(item.status)
    );

    if (!hasUnfinishedItems) {
      return;
    }

    event.preventDefault();
    event.returnValue = "";
  });
}

function resetDropZoneText() {
  elements.dropZone.classList.remove("is-dragging");
  elements.dropZoneTitle.textContent = "Solte seus roteiros aqui";
  elements.dropZoneDescription.textContent =
    "Arraste os documentos ou selecione no seu computador.";
}

/* =========================================================
   Arquivos e validação
   ========================================================= */

function updateUploadInformation() {
  elements.uploadLimit.textContent =
    `Limite de ${formatBytes(CONFIG.MAX_FILE_SIZE_BYTES)} por arquivo`;
}

function addFiles(fileList) {
  const files = Array.from(fileList || []);

  if (files.length === 0) {
    return;
  }

  clearValidationMessages();

  let acceptedCount = 0;
  const errors = [];

  for (const file of files) {
    const validation = validateFile(file);

    if (!validation.valid) {
      errors.push(
        `${file.name || "Arquivo sem nome"}: ${validation.message}`
      );
      continue;
    }

    state.items.push(createQueueItem(file));
    acceptedCount += 1;
  }

  if (acceptedCount > 0) {
    addValidationMessage(
      acceptedCount === 1
        ? "Arquivo adicionado à fila."
        : `${acceptedCount} arquivos adicionados à fila.`,
      "success"
    );
  }

  errors.forEach((message) => {
    addValidationMessage(message, "error");
  });

  render();
  startQueue();
}

function validateFile(file) {
  if (!(file instanceof File)) {
    return {
      valid: false,
      message: "arquivo inválido."
    };
  }

  if (!file.name || !file.name.trim()) {
    return {
      valid: false,
      message: "o arquivo não possui um nome válido."
    };
  }

  if (
    file.name.length > 255 ||
    /[\u0000-\u001F]/.test(file.name)
  ) {
    return {
      valid: false,
      message: "o nome do arquivo é inválido."
    };
  }

  const extension = getFileExtension(file.name);

  if (!CONFIG.ALLOWED_EXTENSIONS.includes(extension)) {
    return {
      valid: false,
      message: `extensão .${extension || "desconhecida"} não permitida.`
    };
  }

  if (file.size <= 0) {
    return {
      valid: false,
      message: "o arquivo está vazio."
    };
  }

  if (file.size > CONFIG.MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      message:
        `o arquivo excede o limite de ` +
        `${formatBytes(CONFIG.MAX_FILE_SIZE_BYTES)}.`
    };
  }

  if (isDuplicate(file)) {
    return {
      valid: false,
      message: "este arquivo já está na fila."
    };
  }

  return {
    valid: true
  };
}

function isDuplicate(file) {
  return state.items.some((item) => (
    item.file.name === file.name &&
    item.file.size === file.size &&
    item.file.lastModified === file.lastModified
  ));
}

function createQueueItem(file) {
  return {
    id: createId(),
    requestId: createId(),
    file,
    extension: getFileExtension(file.name),
    status: STATUS.WAITING,
    message: "Aguardando envio.",
    attempts: 0,
    addedAt: Date.now(),
    justCompleted: false
  };
}

function createId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/* =========================================================
   Processamento
   ========================================================= */

async function startQueue() {
  if (state.isRunnerActive || state.isPaused) {
    render();
    return;
  }

  state.isRunnerActive = true;
  render();

  try {
    while (!state.isPaused) {
      const nextItem = state.items.find(
        (item) => item.status === STATUS.WAITING
      );

      if (!nextItem) {
        break;
      }

      /*
       * Aguarda até completar três segundos desde o início
       * do envio anterior.
       */
      await waitForDispatchInterval();

      if (state.isPaused) {
        break;
      }

      /*
       * O arquivo pode ter sido excluído enquanto o runner
       * aguardava o intervalo.
       */
      const itemStillExists = state.items.some(
        (item) =>
          item.id === nextItem.id &&
          item.status === STATUS.WAITING
      );

      if (!itemStillExists) {
        continue;
      }

      /*
       * Registra o momento do início antes de disparar a requisição.
       */
      state.lastDispatchAt = Date.now();

      /*
       * Não utiliza await.
       *
       * A requisição começa agora, mas a fila continua e poderá
       * iniciar o próximo arquivo após três segundos.
       */
      void processItem(nextItem).catch((error) => {
        /*
         * processItem já trata normalmente os próprios erros.
         * Este catch evita uma Promise rejeitada sem tratamento
         * caso ocorra alguma falha fora do fluxo esperado.
         */
        console.error(
          "[Fila] Erro inesperado durante o processamento:",
          error
        );
      });
    }
  } finally {
    state.isRunnerActive = false;
    render();

    /*
     * Protege contra arquivos adicionados exatamente no momento
     * em que o agendador estava sendo encerrado.
     */
    if (
      !state.isPaused &&
      state.items.some(
        (item) => item.status === STATUS.WAITING
      )
    ) {
      startQueue();
    }
  }
}

async function waitForDispatchInterval() {
  if (!state.lastDispatchAt) {
    return;
  }

  const nextAllowedTime =
    state.lastDispatchAt + CONFIG.SEND_INTERVAL_MS;

  const waitingTime = nextAllowedTime - Date.now();

  if (waitingTime > 0) {
    await sleep(waitingTime);
  }
}

async function processItem(item) {
  item.status = STATUS.PROCESSING;
  item.message = "Enviando arquivo e aguardando resposta...";
  item.attempts += 1;
  item.justCompleted = false;

  render();

  const controller = new AbortController();

  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, CONFIG.REQUEST_TIMEOUT_MS);

  try {
    validateIntegrationConfiguration();

    const formData = new FormData();

    formData.append(
      CONFIG.FILE_FIELD_NAME,
      item.file,
      item.file.name
    );

    if (CONFIG.REQUEST_ID_FIELD_NAME) {
      formData.append(
        CONFIG.REQUEST_ID_FIELD_NAME,
        item.requestId
      );
    }

    const response = await fetch(CONFIG.WEBHOOK_URL, {
      method: "POST",
      body: formData,
      signal: controller.signal,
      credentials: "omit"
    });

    const responseText = await response.text();

    if (!response.ok) {
      const workflowMessage =
        extractMessageFromText(responseText);

      throw new Error(
        workflowMessage
          ? `Erro HTTP ${response.status}: ${workflowMessage}`
          : `O workflow retornou erro HTTP ${response.status}.`
      );
    }

    const result = parseWorkflowResponse(responseText);

    if (result.success) {
      item.status = STATUS.SUCCESS;
      item.message = result.message;
      item.justCompleted = true;

      window.setTimeout(() => {
        item.justCompleted = false;
      }, 800);
    } else {
      item.status = STATUS.ERROR;
      item.message = result.message;
    }
  } catch (error) {
    item.status = STATUS.ERROR;
    item.message = getRequestErrorMessage(error);
  } finally {
    window.clearTimeout(timeoutId);
    render();
  }
}

function validateIntegrationConfiguration() {
  if (
    !CONFIG.WEBHOOK_URL ||
    CONFIG.WEBHOOK_URL.includes("SEU-N8N.EXEMPLO.COM")
  ) {
    throw new Error(
      "A URL do webhook ainda não foi configurada no app.js."
    );
  }

  if (!CONFIG.FILE_FIELD_NAME) {
    throw new Error(
      "O nome do campo de arquivo não foi configurado."
    );
  }
}

function parseWorkflowResponse(responseText) {
  if (!responseText || !responseText.trim()) {
    throw new Error("O workflow retornou uma resposta vazia.");
  }

  let data;

  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error("O workflow retornou um JSON inválido.");
  }

  const result = Array.isArray(data) ? data[0] : data;

  if (!result || typeof result !== "object") {
    throw new Error(
      "A resposta do workflow possui uma estrutura inesperada."
    );
  }

  if (typeof result.success !== "boolean") {
    throw new Error(
      'A resposta não contém o campo booleano "success".'
    );
  }

  if (
    typeof result.message !== "string" ||
    !result.message.trim()
  ) {
    throw new Error(
      'A resposta não contém uma propriedade "message" válida.'
    );
  }

  return {
    success: result.success,
    message: result.message.trim()
  };
}

function extractMessageFromText(responseText) {
  if (!responseText || !responseText.trim()) {
    return "";
  }

  try {
    const data = JSON.parse(responseText);
    const result = Array.isArray(data) ? data[0] : data;

    if (result && typeof result.message === "string") {
      return result.message.trim();
    }
  } catch {
    return "";
  }

  return "";
}

function getRequestErrorMessage(error) {
  if (error && error.name === "AbortError") {
    return "A requisição excedeu o tempo limite configurado.";
  }

  if (error instanceof TypeError) {
    return (
      "Não foi possível acessar o workflow. Verifique a conexão, " +
      "a URL do webhook e a configuração de CORS."
    );
  }

  if (
    error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message.trim();
  }

  return "Não foi possível concluir a comunicação com o workflow.";
}

/* =========================================================
   Ações da fila
   ========================================================= */

function handleFileAction(event) {
  const button = event.target.closest("button[data-action]");

  if (!button) {
    return;
  }

  const itemId = button.dataset.itemId;
  const action = button.dataset.action;

  closeAllMenus();

  if (action === "retry") {
    retryItem(itemId);
  }

  if (action === "remove") {
    removeItem(itemId);
  }
}

function retryItem(itemId) {
  const itemIndex = state.items.findIndex(
    (item) => item.id === itemId
  );

  if (itemIndex === -1) {
    return;
  }

  const item = state.items[itemIndex];

  if (
    item.status !== STATUS.ERROR ||
    !canRetry(item)
  ) {
    return;
  }

  item.status = STATUS.WAITING;
  item.message = "Aguardando nova tentativa.";
  item.justCompleted = false;

  state.items.splice(itemIndex, 1);
  state.items.push(item);

  render();
  startQueue();
}

function retryAllErrors() {
  const retryableItems = state.items.filter(
    (item) =>
      item.status === STATUS.ERROR &&
      canRetry(item)
  );

  if (retryableItems.length === 0) {
    return;
  }

  const retryableIds = new Set(
    retryableItems.map((item) => item.id)
  );

  const remainingItems = state.items.filter(
    (item) => !retryableIds.has(item.id)
  );

  retryableItems.forEach((item) => {
    item.status = STATUS.WAITING;
    item.message = "Aguardando nova tentativa.";
    item.justCompleted = false;
  });

  state.items = [...remainingItems, ...retryableItems];

  render();
  startQueue();
}

function canRetry(item) {
  return (
    CONFIG.MAX_ATTEMPTS === null ||
    item.attempts < CONFIG.MAX_ATTEMPTS
  );
}

function removeItem(itemId) {
  const item = state.items.find(
    (queueItem) => queueItem.id === itemId
  );

  if (!item) {
    return;
  }

  if (item.status === STATUS.PROCESSING) {
    addValidationMessage(
      `O arquivo "${item.file.name}" não pode ser excluído ` +
      "durante o processamento.",
      "error"
    );

    return;
  }

  state.items = state.items.filter(
    (queueItem) => queueItem.id !== itemId
  );

  state.renderedItemIds.delete(itemId);
  render();
}

function removeCompletedItems() {
  const completedIds = state.items
    .filter((item) => item.status === STATUS.SUCCESS)
    .map((item) => item.id);

  state.items = state.items.filter(
    (item) => item.status !== STATUS.SUCCESS
  );

  completedIds.forEach((id) => {
    state.renderedItemIds.delete(id);
  });

  closeAllMenus();
  render();
}

function removeErrorItems() {
  const errorIds = state.items
    .filter((item) => item.status === STATUS.ERROR)
    .map((item) => item.id);

  state.items = state.items.filter(
    (item) => item.status !== STATUS.ERROR
  );

  errorIds.forEach((id) => {
    state.renderedItemIds.delete(id);
  });

  closeAllMenus();
  render();
}

function clearQueue() {
  if (state.items.length === 0) {
    return;
  }

  const processingCount = state.items.filter(
    (item) => item.status === STATUS.PROCESSING
  ).length;

  const message = processingCount > 0
    ? (
      "Deseja excluir todos os arquivos que não estão sendo " +
      "processados? O arquivo em processamento será mantido."
    )
    : "Deseja realmente limpar toda a fila?";

  if (!window.confirm(message)) {
    return;
  }

  const processingIds = new Set(
    state.items
      .filter((item) => item.status === STATUS.PROCESSING)
      .map((item) => item.id)
  );

  state.items = state.items.filter(
    (item) => item.status === STATUS.PROCESSING
  );

  state.renderedItemIds.forEach((id) => {
    if (!processingIds.has(id)) {
      state.renderedItemIds.delete(id);
    }
  });

  closeAllMenus();
  render();
}

function togglePause() {
  state.isPaused = !state.isPaused;

  render();

  if (!state.isPaused) {
    startQueue();
  }
}

function closeAllMenus() {
  document.querySelectorAll("details[open]").forEach((details) => {
    details.removeAttribute("open");
  });
}

/* =========================================================
   Renderização
   ========================================================= */

function render() {
  const counts = getCounts();

  renderCounters(counts);
  renderProgress(counts);
  renderQueueState(counts);
  renderFileList();
  renderGeneralActions(counts);

  state.previousCounts = { ...counts };
}

function getCounts() {
  return {
    total: state.items.length,

    waiting: state.items.filter(
      (item) => item.status === STATUS.WAITING
    ).length,

    processing: state.items.filter(
      (item) => item.status === STATUS.PROCESSING
    ).length,

    success: state.items.filter(
      (item) => item.status === STATUS.SUCCESS
    ).length,

    error: state.items.filter(
      (item) => item.status === STATUS.ERROR
    ).length
  };
}

function renderCounters(counts) {
  updateCounter(
    elements.countTotal,
    counts.total,
    state.previousCounts.total
  );

  updateCounter(
    elements.countWaiting,
    counts.waiting,
    state.previousCounts.waiting
  );

  updateCounter(
    elements.countProcessing,
    counts.processing,
    state.previousCounts.processing
  );

  updateCounter(
    elements.countSuccess,
    counts.success,
    state.previousCounts.success
  );

  updateCounter(
    elements.countError,
    counts.error,
    state.previousCounts.error
  );
}

function updateCounter(element, value, previousValue) {
  element.textContent = String(value);

  if (value === previousValue) {
    return;
  }

  element.classList.remove("has-changed");

  void element.offsetWidth;

  element.classList.add("has-changed");

  window.setTimeout(() => {
    element.classList.remove("has-changed");
  }, 340);
}

function renderProgress(counts) {
  const finished = counts.success + counts.error;

  const percentage = counts.total > 0
    ? Math.round((finished / counts.total) * 100)
    : 0;

  elements.progressBar.style.width = `${percentage}%`;
  elements.progressPercentage.textContent = `${percentage}%`;

  elements.progressTrack.setAttribute(
    "aria-valuenow",
    String(percentage)
  );

  if (counts.total === 0) {
    elements.progressDescription.textContent =
      "Nenhum arquivo processado";
    return;
  }

  if (finished === counts.total) {
    elements.progressDescription.textContent =
      counts.error > 0
        ? (
          `${finished} de ${counts.total} processados · ` +
          `${counts.error} com erro`
        )
        : `${finished} de ${counts.total} processados com sucesso`;

    return;
  }

  elements.progressDescription.textContent =
    `${finished} de ${counts.total} processados`;
}

function renderQueueState(counts) {
  if (counts.total === 0) {
    elements.queueStateMessage.textContent =
      "Adicione arquivos para iniciar o processamento.";
    return;
  }

  if (state.isPaused) {
    elements.queueStateMessage.textContent =
      "A fila está pausada. O processamento atual não será cancelado.";
    return;
  }

  if (counts.processing > 0) {
    elements.queueStateMessage.textContent =
      counts.processing === 1
        ? "Um arquivo está sendo processado."
        : `${counts.processing} arquivos estão sendo processados.`;

    return;
  }

  if (counts.waiting > 0) {
    elements.queueStateMessage.textContent =
      counts.waiting === 1
        ? "Um arquivo aguarda processamento."
        : `${counts.waiting} arquivos aguardam processamento.`;

    return;
  }

  if (counts.error > 0) {
    elements.queueStateMessage.textContent =
      "Processamento finalizado com arquivos que precisam de atenção.";
    return;
  }

  elements.queueStateMessage.textContent =
    "Todos os arquivos foram processados com sucesso.";
}

function renderFileList() {
  elements.fileList.replaceChildren();

  const hasItems = state.items.length > 0;

  elements.emptyState.hidden = hasItems;
  elements.fileList.hidden = !hasItems;

  for (const item of state.items) {
    const isNew = !state.renderedItemIds.has(item.id);

    elements.fileList.append(
      createFileItemElement(item, isNew)
    );

    state.renderedItemIds.add(item.id);
  }
}

function createFileItemElement(item, isNew) {
  const listItem = document.createElement("li");
  listItem.className = "file-item";

  if (isNew) {
    listItem.classList.add("is-new");
  }

  if (item.status === STATUS.PROCESSING) {
    listItem.classList.add("is-processing");
  }

  if (item.justCompleted) {
    listItem.classList.add("just-completed");
  }

  const type = document.createElement("span");
  type.className = "file-type";
  type.textContent = getShortExtension(item.extension);
  type.setAttribute(
    "aria-label",
    `Arquivo ${item.extension.toUpperCase()}`
  );

  const main = document.createElement("div");
  main.className = "file-main";

  const heading = document.createElement("div");
  heading.className = "file-heading";

  const name = document.createElement("p");
  name.className = "file-name";
  name.textContent = item.file.name;
  name.title = item.file.name;

  const status = createStatusBadge(item.status);

  heading.append(name, status);

  const metadata = document.createElement("p");
  metadata.className = "file-metadata";
  metadata.textContent =
    `${item.extension.toUpperCase()} · ` +
    `${formatBytes(item.file.size)} · ` +
    `${formatAttempts(item.attempts)}`;

  const message = document.createElement("p");
  message.className = "file-message";
  message.textContent = item.message;
  message.title = item.message;

  main.append(heading, metadata, message);

  const actions = document.createElement("div");
  actions.className = "file-actions";

  if (
    item.status === STATUS.ERROR &&
    canRetry(item)
  ) {
    const retryButton = document.createElement("button");

    retryButton.type = "button";
    retryButton.className = "button button-retry";
    retryButton.dataset.action = "retry";
    retryButton.dataset.itemId = item.id;
    retryButton.textContent = "Reenviar";

    actions.append(retryButton);
  }

  if (item.status !== STATUS.PROCESSING) {
    actions.append(createItemMenu(item));
  }

  listItem.append(type, main, actions);

  return listItem;
}

function createStatusBadge(status) {
  const badge = document.createElement("span");

  badge.className = `status-badge status-${status}`;

  if (status === STATUS.PROCESSING) {
    const spinner = document.createElement("span");
    spinner.className = "processing-indicator";
    spinner.setAttribute("aria-hidden", "true");

    badge.append(spinner);
  }

  const label = document.createElement("span");
  label.textContent = STATUS_LABEL[status];

  badge.append(label);

  return badge;
}

function createItemMenu(item) {
  const details = document.createElement("details");
  details.className = "item-menu";

  const summary = document.createElement("summary");
  summary.setAttribute(
    "aria-label",
    `Abrir ações de ${item.file.name}`
  );
  summary.textContent = "•••";

  const popover = document.createElement("div");
  popover.className = "menu-popover";

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "menu-danger";
  removeButton.dataset.action = "remove";
  removeButton.dataset.itemId = item.id;
  removeButton.textContent = "Excluir arquivo";

  popover.append(removeButton);
  details.append(summary, popover);

  return details;
}

function renderGeneralActions(counts) {
  elements.pauseButton.disabled =
    counts.waiting === 0 &&
    counts.processing === 0;

  const pauseLabel =
    elements.pauseButton.querySelector("span:last-child");

  const pauseIcon =
    elements.pauseButton.querySelector(".button-icon");

  pauseLabel.textContent = state.isPaused
    ? "Retomar"
    : "Pausar";

  pauseIcon.textContent = state.isPaused
    ? "▶"
    : "Ⅱ";

  const hasRetryableErrors = state.items.some(
    (item) =>
      item.status === STATUS.ERROR &&
      canRetry(item)
  );

  elements.retryAllButton.hidden = !hasRetryableErrors;
  elements.retryAllButton.disabled = !hasRetryableErrors;

  elements.removeCompletedButton.disabled =
    counts.success === 0;

  elements.removeErrorsButton.disabled =
    counts.error === 0;

  elements.clearQueueButton.disabled =
    counts.total === 0;
}

/* =========================================================
   Mensagens
   ========================================================= */

function addValidationMessage(message, type = "error") {
  const element = document.createElement("p");

  element.className = "validation-message";

  if (type === "success") {
    element.classList.add("is-success");
  }

  element.textContent = message;
  elements.validationMessages.append(element);
}

function clearValidationMessages() {
  elements.validationMessages.replaceChildren();
}

/* =========================================================
   Utilitários
   ========================================================= */

function getFileExtension(fileName) {
  const lastDotIndex = fileName.lastIndexOf(".");

  if (
    lastDotIndex === -1 ||
    lastDotIndex === fileName.length - 1
  ) {
    return "";
  }

  return fileName
    .slice(lastDotIndex + 1)
    .trim()
    .toLowerCase();
}

function getShortExtension(extension) {
  const labels = {
    docx: "DOC",
    pdf: "PDF",
    txt: "TXT",
    rtf: "RTF"
  };

  return labels[extension] || extension.slice(0, 3).toUpperCase();
}

function formatAttempts(attempts) {
  if (attempts === 0) {
    return "nenhuma tentativa";
  }

  return attempts === 1
    ? "1 tentativa"
    : `${attempts} tentativas`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];

  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );

  const value = bytes / Math.pow(1024, unitIndex);

  const decimals =
    unitIndex === 0
      ? 0
      : value >= 10
        ? 1
        : 2;

  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function initializeHealthCheck() {
  if (
    !elements.connectionStatus ||
    !elements.connectionStatusLabel
  ) {
    console.error(
      "[Healthcheck] Os elementos do indicador não foram encontrados."
    );
    return;
  }

  if (!CONFIG.HEALTHCHECK_URL) {
    console.error("[Healthcheck] HEALTHCHECK_URL não foi configurada.");
    updateConnectionStatus("offline");
    return;
  }

  console.log(
    "[Healthcheck] Inicializado:",
    CONFIG.HEALTHCHECK_URL
  );

  checkWorkflowHealth();

  state.healthCheckIntervalId = window.setInterval(() => {
    if (!document.hidden) {
      checkWorkflowHealth();
    }
  }, CONFIG.HEALTHCHECK_INTERVAL_MS);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      checkWorkflowHealth();
    }
  });
}

async function checkWorkflowHealth() {
  if (state.isHealthCheckRunning) {
    return;
  }

  state.isHealthCheckRunning = true;
  updateConnectionStatus("checking");

  const controller = new AbortController();

  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, CONFIG.HEALTHCHECK_TIMEOUT_MS);

  try {
    const healthUrl = new URL(CONFIG.HEALTHCHECK_URL);

    healthUrl.searchParams.set(
      "_healthcheck",
      Date.now().toString()
    );

    console.log(
      "[Healthcheck] Verificando:",
      healthUrl.toString()
    );

    const response = await fetch(healthUrl.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal
    });

    console.log("[Healthcheck] HTTP:", response.status);

    if (!response.ok) {
      throw new Error(
        `O healthcheck retornou HTTP ${response.status}.`
      );
    }

    const responseText = await response.text();

    console.log("[Healthcheck] Resposta:", responseText);

    if (!responseText.trim()) {
      throw new Error(
        "O healthcheck retornou uma resposta vazia."
      );
    }

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error(
        "O healthcheck não retornou um JSON válido."
      );
    }

    const result = Array.isArray(data) ? data[0] : data;

    if (!result || result.online !== true) {
      throw new Error(
        'O healthcheck não retornou { "online": true }.'
      );
    }

    updateConnectionStatus("online");
  } catch (error) {
    if (error?.name === "AbortError") {
      console.warn("[Healthcheck] Tempo limite excedido.");
    } else {
      console.warn("[Healthcheck] Indisponível:", error);
    }

    updateConnectionStatus("offline");
  } finally {
    window.clearTimeout(timeoutId);
    state.isHealthCheckRunning = false;
  }
}

function updateConnectionStatus(status) {
  const labels = {
    checking: "Verificando...",
    online: "Workflow disponível",
    offline: "Workflow indisponível"
  };

  if (
    !elements.connectionStatus ||
    !elements.connectionStatusLabel
  ) {
    return;
  }

  elements.connectionStatus.classList.remove(
    "is-checking",
    "is-online",
    "is-offline"
  );

  elements.connectionStatus.classList.add(`is-${status}`);

  elements.connectionStatusLabel.textContent =
    labels[status] || "Estado desconhecido";
}
"use strict";

/* =========================================================
   Configuração
   ========================================================= */

const CONFIG = Object.freeze({
  /*
   * A extração acontece no navegador (extractor.js). O resultado e o
   * arquivo original vão para a Pages Function, que cria o card no
   * Trello. Use null para só extrair e exportar, sem servidor.
   */
  API_URL: "/api/roteiros",
  HEALTHCHECK_URL: "/api/health",

  /* Enviar o arquivo original para ser anexado ao card. */
  ATTACH_ORIGINAL_FILE: true,

  REQUEST_TIMEOUT_MS: 120000,
  HEALTHCHECK_INTERVAL_MS: 30000,
  HEALTHCHECK_TIMEOUT_MS: 8000,

  MAX_FILE_SIZE_BYTES: 25 * 1024 * 1024,
  ALLOWED_EXTENSIONS: ["docx", "txt", "pdf", "rtf"],

  /**
   * null permite tentativas ilimitadas.
   */
  MAX_ATTEMPTS: null,

  /** Nome base dos arquivos exportados. */
  EXPORT_FILE_NAME: "roteiros"
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
  isWorkspaceExpanded: false,
  renderedItemIds: new Set(),
  isHealthCheckRunning: false,

  previousCounts: {
    total: 0,
    waiting: 0,
    processing: 0,
    success: 0,
    error: 0
  }
};

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
  exportJsonButton: document.querySelector("#export-json-button"),
  exportCsvButton: document.querySelector("#export-csv-button"),

  resultDialog: document.querySelector("#result-dialog"),
  resultTitle: document.querySelector("#result-title"),
  resultMeta: document.querySelector("#result-meta"),
  resultWarnings: document.querySelector("#result-warnings"),
  resultArtesCount: document.querySelector("#result-artes-count"),
  resultArtes: document.querySelector("#result-artes"),
  resultText: document.querySelector("#result-text"),
  resultCopyButton: document.querySelector("#result-copy-button"),
  resultDownloadButton: document.querySelector("#result-download-button"),
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
  initializeMouseGradient();

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      document.body.classList.add("motion-ready");
    });
  });
}

function initializeMouseGradient() {
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  if (prefersReducedMotion) {
    return;
  }

  let frameId = null;
  let lastX = 14;
  let lastY = 6;

  window.addEventListener(
    "pointermove",
    (event) => {
      if (frameId !== null) {
        return;
      }

      frameId = window.requestAnimationFrame(() => {
        const x = (event.clientX / window.innerWidth) * 100;
        const y = (event.clientY / window.innerHeight) * 100;

        lastX += (x - lastX) * 0.16;
        lastY += (y - lastY) * 0.16;

        document.body.style.setProperty(
          "--mouse-x",
          `${lastX.toFixed(2)}%`
        );

        document.body.style.setProperty(
          "--mouse-y",
          `${lastY.toFixed(2)}%`
        );

        frameId = null;
      });
    },
    { passive: true }
  );
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

  elements.exportJsonButton.addEventListener("click", () => {
    closeAllMenus();
    exportResults("json");
  });

  elements.exportCsvButton.addEventListener("click", () => {
    closeAllMenus();
    exportResults("csv");
  });

  elements.resultCopyButton.addEventListener("click", copyCurrentResult);
  elements.resultDownloadButton.addEventListener("click", downloadCurrentResult);

  elements.resultDialog.addEventListener("click", (event) => {
    if (
      event.target === elements.resultDialog ||
      event.target.closest("[data-close-dialog]")
    ) {
      elements.resultDialog.close();
    }
  });

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
    announceAction(
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
       * Processa um arquivo por vez. A extração é local,
       * então não há intervalo entre arquivos.
       */
      await processItem(nextItem);

      /* Libera a interface entre um arquivo e outro. */
      await sleep(0);
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

async function processItem(item) {
  item.status = STATUS.PROCESSING;
  item.message = "Extraindo texto, autor e artes...";
  item.attempts += 1;
  item.justCompleted = false;
  item.result = null;
  item.cardUrl = null;

  expandWorkspace();
  render();

  try {
    if (!window.RoteiroExtractor) {
      throw new Error("O módulo de extração (extractor.js) não foi carregado.");
    }

    const result = await window.RoteiroExtractor.extractFile(item.file);
    item.result = result;

    let sent = null;

    if (CONFIG.API_URL) {
      item.message = "Criando card no Trello...";
      render();
      sent = await sendResult(item, result);
      item.cardUrl = sent.card_url || null;
    }

    item.status = STATUS.SUCCESS;
    item.message = describeResult(result, sent);
    item.justCompleted = true;

    window.setTimeout(() => {
      item.justCompleted = false;
    }, 800);
  } catch (error) {
    console.error("[Extração]", item.file.name, error);
    item.status = STATUS.ERROR;
    item.message = getRequestErrorMessage(error);
  } finally {
    render();
  }
}

async function sendResult(item, result) {
  const formData = new FormData();

  formData.append("resultado", JSON.stringify(result));
  formData.append("request_id", item.requestId);

  if (CONFIG.ATTACH_ORIGINAL_FILE) {
    formData.append("file", item.file, item.file.name);
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    CONFIG.REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(CONFIG.API_URL, {
      method: "POST",
      body: formData,
      signal: controller.signal,
      credentials: "same-origin"
    });

    const text = await response.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!response.ok || !data || data.success !== true) {
      const detail = data && typeof data.message === "string"
        ? data.message
        : `HTTP ${response.status}`;

      throw new Error(`Texto extraído, mas o card não foi criado: ${detail}`);
    }

    return data;
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error("O servidor demorou demais para responder.");
    }

    if (error instanceof TypeError) {
      throw new Error("Não foi possível acessar o servidor. Verifique a conexão.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function describeResult(result, sent) {
  const parts = [
    result.artes_quantidade === 1
      ? "1 arte"
      : `${result.artes_quantidade} artes`,
    result.autor ? `autor: ${result.autor}` : "autor não identificado"
  ];

  if (sent && sent.message) {
    parts.unshift(sent.message.replace(/\.$/, ""));
  }

  if (result.avisos.length > 0) {
    parts.push(result.avisos[0]);
  }

  return parts.join(" · ");
}

function getRequestErrorMessage(error) {
  if (
    error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message.trim();
  }

  return "Não foi possível processar o arquivo.";
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

  if (action === "view") {
    openResult(itemId);
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

  announceAction(
    `Arquivo ${getFileLabel(item)} voltou para a fila.`,
    "success"
  );

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

  const fileName = item.file.name;

  state.items = state.items.filter(
    (queueItem) => queueItem.id !== itemId
  );

  state.renderedItemIds.delete(itemId);

  announceAction(
    `Arquivo "${fileName}" excluído da fila.`,
    "success"
  );

  render();
}

function removeCompletedItems() {
  const completedIds = state.items
    .filter((item) => item.status === STATUS.SUCCESS)
    .map((item) => item.id);

  const removedCount = completedIds.length;

  state.items = state.items.filter(
    (item) => item.status !== STATUS.SUCCESS
  );

  completedIds.forEach((id) => {
    state.renderedItemIds.delete(id);
  });

  if (removedCount > 0) {
    announceAction(
      removedCount === 1
        ? "1 arquivo concluído foi excluído da fila."
        : `${removedCount} arquivos concluídos foram excluídos da fila.`,
      "success"
    );
  }

  closeAllMenus();
  render();
}

function removeErrorItems() {
  const errorIds = state.items
    .filter((item) => item.status === STATUS.ERROR)
    .map((item) => item.id);

  const removedCount = errorIds.length;

  state.items = state.items.filter(
    (item) => item.status !== STATUS.ERROR
  );

  errorIds.forEach((id) => {
    state.renderedItemIds.delete(id);
  });

  if (removedCount > 0) {
    announceAction(
      removedCount === 1
        ? "1 arquivo com erro foi excluído da fila."
        : `${removedCount} arquivos com erro foram excluídos da fila.`,
      "success"
    );
  }

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

  announceAction(
    processingCount > 0
      ? "A fila foi limpa. O arquivo em processamento foi mantido."
      : "A fila foi limpa.",
    "success"
  );

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

  if (counts.total === 0) {
    collapseWorkspace();
  }

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
  type.className = `file-type file-type--${item.extension}`;
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

  if (item.status === STATUS.SUCCESS && item.cardUrl) {
    const cardLink = document.createElement("a");

    cardLink.className = "button button-retry";
    cardLink.href = item.cardUrl;
    cardLink.target = "_blank";
    cardLink.rel = "noopener";
    cardLink.textContent = "Abrir card";

    actions.append(cardLink);
  }

  if (item.status === STATUS.SUCCESS && item.result) {
    const viewButton = document.createElement("button");

    viewButton.type = "button";
    viewButton.className = "button button-retry";
    viewButton.dataset.action = "view";
    viewButton.dataset.itemId = item.id;
    viewButton.textContent = "Ver resultado";

    actions.append(viewButton);
  }

  if (
    item.status === STATUS.ERROR &&
    canRetry(item)
  ) {
    const retryButton = document.createElement("button");

    retryButton.type = "button";
    retryButton.className = "button button-retry";
    retryButton.dataset.action = "retry";
    retryButton.dataset.itemId = item.id;
    retryButton.textContent = "Reprocessar";

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

  elements.exportJsonButton.disabled =
    counts.success === 0;

  elements.exportCsvButton.disabled =
    counts.success === 0;
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

/* =========================================================
   Resultados e exportação
   ========================================================= */

let currentResultItemId = null;

function getResults() {
  return state.items
    .filter((item) => item.status === STATUS.SUCCESS && item.result)
    .map((item) => item.result);
}

function openResult(itemId) {
  const item = state.items.find((queueItem) => queueItem.id === itemId);

  if (!item || !item.result) {
    return;
  }

  const result = item.result;
  currentResultItemId = item.id;

  elements.resultTitle.textContent = result.arquivo;
  elements.resultMeta.replaceChildren(
    createMetaEntry("Autor", result.autor || "não identificado"),
    createMetaEntry("Formato", result.formato.toUpperCase()),
    createMetaEntry(
      "Interrompido em",
      result.interrompido_em || "fim do documento"
    )
  );

  elements.resultWarnings.replaceChildren(
    ...result.avisos.map((aviso) => {
      const element = document.createElement("p");
      element.textContent = aviso;
      return element;
    })
  );
  elements.resultWarnings.hidden = result.avisos.length === 0;

  elements.resultArtesCount.textContent = String(result.artes_quantidade);
  elements.resultArtes.replaceChildren(
    ...result.artes.map((arte) => {
      const element = document.createElement("li");
      element.textContent = arte;
      return element;
    })
  );

  if (result.artes.length === 0) {
    const element = document.createElement("li");
    element.className = "result-empty";
    element.textContent = "Nenhum texto sublinhado encontrado.";
    elements.resultArtes.append(element);
  }

  elements.resultText.textContent = result.texto || "(sem texto)";

  if (!elements.resultDialog.open) {
    elements.resultDialog.showModal();
  }
}

function createMetaEntry(label, value) {
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");

  term.textContent = label;
  description.textContent = value;
  wrapper.append(term, description);

  return wrapper;
}

function getCurrentResult() {
  const item = state.items.find(
    (queueItem) => queueItem.id === currentResultItemId
  );

  return item ? item.result : null;
}

async function copyCurrentResult() {
  const result = getCurrentResult();

  if (!result) {
    return;
  }

  try {
    await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    elements.resultCopyButton.textContent = "Copiado!";
  } catch {
    elements.resultCopyButton.textContent = "Não foi possível copiar";
  }

  window.setTimeout(() => {
    elements.resultCopyButton.textContent = "Copiar JSON";
  }, 1600);
}

function downloadCurrentResult() {
  const result = getCurrentResult();

  if (!result) {
    return;
  }

  const baseName = result.arquivo.replace(/\.[^.]+$/, "");
  downloadFile(
    `${baseName}.json`,
    JSON.stringify(result, null, 2),
    "application/json"
  );
}

function exportResults(format) {
  const results = getResults();

  if (results.length === 0) {
    return;
  }

  if (format === "json") {
    downloadFile(
      `${CONFIG.EXPORT_FILE_NAME}.json`,
      JSON.stringify(results, null, 2),
      "application/json"
    );
    return;
  }

  /* CSV: uma linha por arte (separador ";", pronto para Excel). */
  const header = ["arquivo", "autor", "formato", "arte", "artes_quantidade"];
  const rows = [header];

  for (const result of results) {
    const artes = result.artes.length > 0 ? result.artes : [""];

    for (const arte of artes) {
      rows.push([
        result.arquivo,
        result.autor,
        result.formato,
        arte,
        String(result.artes_quantidade)
      ]);
    }
  }

  const csv = rows
    .map((row) => row.map(escapeCsvValue).join(";"))
    .join("\r\n");

  downloadFile(
    `${CONFIG.EXPORT_FILE_NAME}.csv`,
    "\uFEFF" + csv,
    "text/csv;charset=utf-8"
  );
}

function escapeCsvValue(value) {
  const text = String(value ?? "");
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadFile(fileName, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function initializeHealthCheck() {
  if (!CONFIG.API_URL || !CONFIG.HEALTHCHECK_URL) {
    updateConnectionStatus("local");
    return;
  }

  checkWorkflowHealth();

  window.setInterval(() => {
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

  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    CONFIG.HEALTHCHECK_TIMEOUT_MS
  );

  try {
    const response = await fetch(CONFIG.HEALTHCHECK_URL, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data || data.online !== true) {
      throw new Error(data && data.message ? data.message : `HTTP ${response.status}`);
    }

    updateConnectionStatus("online");
  } catch (error) {
    console.warn("[Healthcheck] Indisponível:", error.message || error);
    updateConnectionStatus("offline");
  } finally {
    window.clearTimeout(timeoutId);
    state.isHealthCheckRunning = false;
  }
}

function updateConnectionStatus(status) {
  const labels = {
    checking: "Verificando...",
    online: "Trello conectado",
    offline: "Trello indisponível",
    local: "Processamento local"
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

  elements.connectionStatus.classList.add(
    `is-${status === "local" ? "online" : status}`
  );

  elements.connectionStatusLabel.textContent =
    labels[status] || "Estado desconhecido";
}

function expandWorkspace() {
  if (state.isWorkspaceExpanded) {
    return;
  }

  state.isWorkspaceExpanded = true;
  document.querySelector(".app-shell")?.classList.add("is-expanded");
}

function collapseWorkspace() {
  if (!state.isWorkspaceExpanded) {
    return;
  }

  state.isWorkspaceExpanded = false;
  document.querySelector(".app-shell")?.classList.remove("is-expanded");
}

function announceAction(message, type = "success") {
  clearValidationMessages();
  addValidationMessage(message, type);
}

function getFileLabel(item) {
  return `"${item.file.name}"`;
}
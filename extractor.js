"use strict";

/* =========================================================
   Extração de roteiros no navegador (sem n8n)

   Para cada arquivo (.docx, .pdf, .rtf, .txt) devolve:
     arquivo, formato, autor, texto, artes, artes_quantidade, avisos

   "Artes" são os textos sublinhados:
     - DOCX: runs com <w:u> (direto ou herdado de estilo);
     - RTF:  trechos entre \ul ... \ulnone (e variações);
     - PDF:  traços horizontais desenhados sob o texto e
             anotações de sublinhado feitas em leitores de PDF.
   Texto dentro de links é ignorado.

   Todas as fontes viram o mesmo modelo (parágrafos com runs
   { t, u, link, soft }) e passam pela mesma regra de montagem
   das artes, então o comportamento é igual nos três formatos.

   Depende de pdf.js apenas para PDF (carregado sob demanda de
   ./vendor/pdfjs/). DOCX usa DecompressionStream nativo.
   ========================================================= */

(function (root) {
  const EXTRACTION_CONFIG = Object.freeze({
    /* Tudo a partir desta palavra é descartado (texto e artes). */
    STOP_WORD: "DECUPAGEM",

    /* Espaço/tab/quebra de linha manual entre dois sublinhados não separa as artes. */
    BRIDGE_WHITESPACE: true,

    /* Arte terminada nesses sinais é unida à próxima arte sublinhada
       (mesmo no parágrafo seguinte), se não houver texto normal no meio. */
    JOIN_IF_ENDS_WITH: /[:\-–,/&+]$/,

    /* true = sublinhado que atravessa parágrafos é unido (normalmente false). */
    MERGE_ACROSS_PARAGRAPHS: false,

    /* Palavras com cara de link/caminho são removidas da arte. */
    LINK_WORD: /^[(\[<"']*(?:https?:\/\/|ftp:\/\/|file:|smb:\/\/|www\.|\\\\|\/\/|[A-Za-z]:[\\/]|[\w-]+(?:\.[\w-]+)+\/)/i,

    /* Artes (já divididas) que são descartadas. */
    IGNORE_PATTERNS: [
      /\\\\(cpp|vfx)-ml-(hp|sp)\b/i,
      /servicos\.corp\.tvglobo\.com\.br/i,
      /\\\\[\w.-]+\\/,
      /^\\\\/,
      /\b[a-z]:\\/i,
      /\b(https?|ftp|file|smb):\/\//i,
      /^\d+:\d+:\d+(?:[:;.]\d+)?$/, // timecode sozinho
      /\bwww\./i
    ],

    PDFJS_URL: "./vendor/pdfjs/pdf.min.mjs",
    PDFJS_WORKER_URL: "./vendor/pdfjs/pdf.worker.min.mjs",

    /* PDF: espessura máxima e largura mínima (pt) de um traço de sublinhado. */
    PDF_STROKE_MAX: 3.0,
    PDF_STROKE_MIN_WIDTH: 2.0
  });

  const CFG = EXTRACTION_CONFIG;

  /* =======================================================
     API pública
     ======================================================= */

  async function extractFile(file) {
    const name = file.name || "arquivo";
    const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
    const buffer = await file.arrayBuffer();

    let doc;
    if (ext === "docx") doc = await parseDocx(buffer);
    else if (ext === "pdf") doc = await parsePdf(buffer);
    else if (ext === "rtf") doc = parseRtf(buffer);
    else if (ext === "txt") doc = parseTxt(buffer);
    else throw new Error(`Formato .${ext || "?"} não suportado.`);

    return finalize(name, ext, doc);
  }

  function finalize(name, ext, doc) {
    const avisos = [...(doc.warnings || [])];
    const stopped = applyStopWord(doc.paragraphs, CFG.STOP_WORD);

    const texto = doc.paragraphs
      .map((p) => p.map((r) => r.t).join("").replace(/[ \t ]+/g, " ").trim())
      .filter(Boolean)
      .join("\n");

    const artes = [...new Set(buildArtes(doc.paragraphs))];

    if (!texto) {
      avisos.push(
        ext === "pdf"
          ? "Nenhum texto encontrado (PDF digitalizado? precisa de OCR)."
          : "Nenhum texto encontrado."
      );
    }

    return {
      arquivo: name,
      formato: ext,
      autor: (doc.author || "").trim(),
      texto,
      artes,
      artes_quantidade: artes.length,
      interrompido_em: stopped ? CFG.STOP_WORD : null,
      avisos
    };
  }

  /* =======================================================
     Regras comuns
     ======================================================= */

  /* Corta tudo a partir da primeira ocorrência da palavra de parada. */
  function applyStopWord(paragraphs, stopWord) {
    if (!stopWord) return false;
    for (let i = 0; i < paragraphs.length; i++) {
      const runs = paragraphs[i];
      const full = runs.map((r) => r.t).join("");
      const idx = full.indexOf(stopWord);
      if (idx === -1) continue;

      let pos = 0;
      const kept = [];
      for (const r of runs) {
        if (pos + r.t.length <= idx) kept.push(r);
        else if (pos < idx) kept.push({ ...r, t: r.t.slice(0, idx - pos) });
        pos += r.t.length;
      }
      paragraphs.length = i;
      if (kept.length) paragraphs.push(kept);
      return true;
    }
    return false;
  }

  /* Monta a lista de artes a partir dos runs (mesma lógica do workflow DOCX). */
  function buildArtes(paragraphs) {
    const out = [];
    const normalize = (t) => t.replace(/\s+/g, " ").trim();
    let current = "";
    let active = false;
    let pending = "";

    function emit(text) {
      const words = normalize(text).split(" ").filter((w) => w && !CFG.LINK_WORD.test(w));
      for (const part of words.join(" ").split("/")) {
        const clean = normalize(part);
        if (!clean || !/[\p{L}\p{N}]/u.test(clean)) continue;
        if (CFG.IGNORE_PATTERNS.some((re) => re.test(clean))) continue;
        out.push(clean);
      }
    }

    function flushPending() {
      if (pending) emit(pending);
      pending = "";
    }

    function closeCurrent() {
      if (!active) return;
      let chunk = normalize(current);
      current = "";
      active = false;
      if (!chunk) return;
      if (pending) {
        chunk = pending + " " + chunk;
        pending = "";
      }
      if (CFG.JOIN_IF_ENDS_WITH.test(chunk)) pending = chunk;
      else emit(chunk);
    }

    for (const runs of paragraphs) {
      for (const run of runs) {
        if (!run.t) continue;
        const isSpace = !run.t.trim();
        if (run.u && !run.link && !isSpace) {
          current += run.t;
          active = true;
        } else if (isSpace) {
          if (active && (run.u || CFG.BRIDGE_WHITESPACE)) current += run.t;
          else closeCurrent();
        } else {
          closeCurrent();
          flushPending();
        }
      }
      if (active && CFG.MERGE_ACROSS_PARAGRAPHS) current += " ";
      else closeCurrent();
    }
    closeCurrent();
    flushPending();
    return out;
  }

  /* Acrescenta texto ao parágrafo, juntando com o run anterior se tiver a mesma marcação. */
  function pushRun(runs, t, u, link, soft) {
    if (!t) return;
    const last = runs[runs.length - 1];
    if (last && last.u === u && last.link === link && !!last.soft === !!soft) last.t += t;
    else runs.push({ t, u, link, soft: !!soft });
  }

  /* =======================================================
     TXT
     ======================================================= */

  function decodeText(buffer) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      return new TextDecoder("windows-1252").decode(buffer);
    }
  }

  function parseTxt(buffer) {
    const text = decodeText(buffer).replace(/^﻿/, "");
    return {
      author: "",
      paragraphs: text.split(/\r\n|\r|\n/).map((l) => [{ t: l, u: false, link: false }]),
      warnings: ["TXT não tem sublinhado nem autor: apenas o texto foi extraído."]
    };
  }

  /* =======================================================
     DOCX
     ======================================================= */

  const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

  async function readZip(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd === -1) throw new Error("O arquivo DOCX está corrompido (não é um ZIP válido).");

    const count = view.getUint16(eocd + 10, true);
    let ptr = view.getUint32(eocd + 16, true);
    const entries = new Map();
    const dec = new TextDecoder();

    for (let n = 0; n < count; n++) {
      if (view.getUint32(ptr, true) !== 0x02014b50) break;
      const method = view.getUint16(ptr + 10, true);
      const csize = view.getUint32(ptr + 20, true);
      const nameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const local = view.getUint32(ptr + 42, true);
      const name = dec.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
      entries.set(name, { method, csize, local });
      ptr += 46 + nameLen + extraLen + commentLen;
    }

    async function read(name) {
      const e = entries.get(name);
      if (!e) return null;
      const lnameLen = view.getUint16(e.local + 26, true);
      const lextraLen = view.getUint16(e.local + 28, true);
      const start = e.local + 30 + lnameLen + lextraLen;
      const data = bytes.subarray(start, start + e.csize);
      if (e.method === 0) return dec.decode(data);
      if (e.method !== 8) throw new Error(`Compressão ZIP não suportada (${e.method}).`);
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return await new Response(stream).text();
    }

    return { read };
  }

  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("XML inválido no DOCX.");
    return doc;
  }

  const wChild = (el, name) => {
    if (!el) return null;
    for (const c of el.children) if (c.namespaceURI === W_NS && c.localName === name) return c;
    return null;
  };
  const wAttr = (el, name) => (el ? el.getAttributeNS(W_NS, name) ?? el.getAttribute("w:" + name) : null);

  /* Valor de <w:u>: true, false, ou undefined (não definido aqui). */
  function underlineOf(rPr) {
    const u = wChild(rPr, "u");
    if (!u) return undefined;
    const val = wAttr(u, "val");
    return val !== "none";
  }

  function loadStyles(xml) {
    const styles = new Map();
    let defaultU;
    let defaultParaStyle = null;
    if (!xml) return { resolve: () => undefined, defaultParaStyle, defaultU };
    const doc = parseXml(xml);

    const rPrDefault = doc.getElementsByTagNameNS(W_NS, "rPrDefault")[0];
    if (rPrDefault) defaultU = underlineOf(wChild(rPrDefault, "rPr"));

    for (const s of doc.getElementsByTagNameNS(W_NS, "style")) {
      const id = wAttr(s, "styleId");
      const basedOn = wAttr(wChild(s, "basedOn"), "val");
      styles.set(id, { basedOn, u: underlineOf(wChild(s, "rPr")) });
      if (wAttr(s, "type") === "paragraph" && ["1", "true"].includes(wAttr(s, "default"))) {
        defaultParaStyle = id;
      }
    }

    const resolve = (id) => {
      for (let i = 0; id && i < 20; i++) {
        const s = styles.get(id);
        if (!s) return undefined;
        if (s.u !== undefined) return s.u;
        id = s.basedOn;
      }
      return undefined;
    };
    return { resolve, defaultParaStyle, defaultU };
  }

  async function parseDocx(buffer) {
    const zip = await readZip(buffer);
    const docXml = await zip.read("word/document.xml");
    if (!docXml) throw new Error("O arquivo não parece ser um DOCX do Word (word/document.xml ausente).");

    const styles = loadStyles(await zip.read("word/styles.xml"));
    const author = readDocxAuthor(await zip.read("docProps/core.xml"));
    const body = parseXml(docXml).getElementsByTagNameNS(W_NS, "body")[0];

    const paragraphs = [];
    const fields = []; // pilha de campos complexos (fldChar)

    function runUnderlined(r, pStyle) {
      const rPr = wChild(r, "rPr");
      const direct = underlineOf(rPr);
      if (direct !== undefined) return direct;
      const rStyle = wAttr(wChild(rPr, "rStyle"), "val");
      const fromChar = rStyle ? styles.resolve(rStyle) : undefined;
      if (fromChar !== undefined) return fromChar;
      const fromPara = styles.resolve(pStyle || styles.defaultParaStyle);
      if (fromPara !== undefined) return fromPara;
      return !!styles.defaultU;
    }

    function walkBlock(node) {
      for (const el of node.children) {
        if (el.namespaceURI === W_NS && el.localName === "p") processParagraph(el);
        else if (el.localName === "Fallback" || el.localName === "sectPr") continue;
        else walkBlock(el);
      }
    }

    function processParagraph(p) {
      const runs = [];
      const nested = []; // caixas de texto dentro do parágrafo
      const pStyle = wAttr(wChild(wChild(p, "pPr"), "pStyle"), "val");

      const inField = () => fields.some((f) => f.phase === "result" && f.link);

      function processRun(r, link) {
        const u = runUnderlined(r, pStyle);
        for (const c of r.children) {
          const name = c.localName;
          const lk = link || inField();
          if (name === "t") pushRun(runs, c.textContent, u, lk, false);
          else if (name === "tab" || name === "br" || name === "cr") pushRun(runs, " ", u, lk, true);
          else if (name === "noBreakHyphen") pushRun(runs, "-", u, lk, false);
          else if (name === "fldChar") {
            const type = wAttr(c, "fldCharType");
            if (type === "begin") fields.push({ instr: "", phase: "instr", link: false });
            else if (type === "separate" && fields.length) {
              const f = fields[fields.length - 1];
              f.phase = "result";
              f.link = /^\s*HYPERLINK\b/i.test(f.instr);
            } else if (type === "end") fields.pop();
          } else if (name === "instrText") {
            if (fields.length) fields[fields.length - 1].instr += c.textContent;
          } else if (name === "drawing" || name === "pict" || name === "AlternateContent" || name === "object") {
            collectTextBoxes(c, nested);
          }
        }
      }

      function walkInline(node, link) {
        for (const c of node.children) {
          const name = c.localName;
          if (name === "r") processRun(c, link);
          else if (name === "hyperlink") walkInline(c, true);
          else if (name === "fldSimple") walkInline(c, link || /^\s*HYPERLINK\b/i.test(wAttr(c, "instr") || ""));
          else if (["pPr", "del", "moveFrom", "Fallback", "rPr"].includes(name)) continue;
          else walkInline(c, link);
        }
      }

      walkInline(p, false);
      paragraphs.push(runs);
      for (const box of nested) walkBlock(box);
    }

    function collectTextBoxes(node, list) {
      for (const c of node.children) {
        if (c.localName === "Fallback") continue;
        if (c.localName === "txbxContent") list.push(c);
        else collectTextBoxes(c, list);
      }
    }

    if (body) walkBlock(body);
    return { author, paragraphs, warnings: [] };
  }

  function readDocxAuthor(xml) {
    if (!xml) return "";
    const doc = parseXml(xml);
    const get = (local) => {
      const el = [...doc.documentElement.children].find((c) => c.localName === local);
      return el ? el.textContent.trim() : "";
    };
    return get("creator") || get("lastModifiedBy");
  }

  /* =======================================================
     RTF
     ======================================================= */

  /* Destinos cujo texto não faz parte do documento. */
  const RTF_SKIP = new Set([
    "fonttbl", "colortbl", "stylesheet", "listtable", "listoverridetable", "revtbl",
    "rsidtbl", "generator", "pict", "object", "objdata", "themedata", "colorschememapping",
    "latentstyles", "datastore", "xmlnstbl", "header", "headerl", "headerr", "headerf",
    "footer", "footerl", "footerr", "footerf", "footnote", "pntext", "pntxta", "pntxtb",
    "filetbl", "info", "bkmkstart", "bkmkend", "nonshppict", "mmathPr", "fldinst"
  ]);

  const RTF_UL_ON = /^ul(?:d|db|dash|dashd|dashdd|hair|hwave|ldash|th|thd|thdash|thdashd|thdashdd|thldash|thmdash|mdash|ulwave|w|wave)?$/;

  const RTF_SYMBOLS = {
    emdash: "—", endash: "–", lquote: "‘", rquote: "’", ldblquote: "“",
    rdblquote: "”", bullet: "•", emspace: " ", enspace: " ", qmspace: " "
  };

  function parseRtf(buffer) {
    const bytes = new Uint8Array(buffer);
    const len = bytes.length;
    const head = String.fromCharCode(...bytes.subarray(0, 5));
    if (head !== "{\\rtf") throw new Error("O arquivo não é um RTF válido.");

    let decoder = new TextDecoder("windows-1252");
    const paragraphs = [];
    let runs = [];
    let author = "";

    // Estado do grupo atual (copiado ao abrir "{")
    let st = { ul: false, skip: false, uc: 1, link: false, capture: null, field: null, dest: false };
    const stack = [];
    let ucSkip = 0;          // caracteres a pular depois de \uN
    let pendingBytes = [];   // bytes de \'hh aguardando decodificação

    const flushBytes = () => {
      if (!pendingBytes.length) return;
      const text = decoder.decode(new Uint8Array(pendingBytes));
      pendingBytes = [];
      emitText(text);
    };

    function emitText(text) {
      if (st.capture) { st.capture.text += text; return; }
      if (st.skip) return;
      pushRun(runs, text, st.ul, st.link, false);
    }

    function endParagraph() {
      flushBytes();
      if (st.skip || st.capture) return;
      paragraphs.push(runs);
      runs = [];
    }

    let i = 0;
    while (i < len) {
      const b = bytes[i];

      if (b === 0x7b) { // {
        flushBytes();
        stack.push(st);
        st = { ...st, dest: true };
        i++;
        continue;
      }
      if (b === 0x7d) { // }
        flushBytes();
        const closing = st;
        st = stack.pop() || st;
        if (closing.capture && closing.capture !== st.capture) {
          const cap = closing.capture;
          if (cap.kind === "author" && !author) author = cap.text.trim();
          if (cap.kind === "fldinst" && closing.field) closing.field.link = /^\s*HYPERLINK\b/i.test(cap.text);
        }
        i++;
        continue;
      }
      if (b === 0x0d || b === 0x0a) { i++; continue; }

      if (b === 0x5c) { // \
        const n = bytes[i + 1];
        // \'hh
        if (n === 0x27) {
          const hex = String.fromCharCode(bytes[i + 2], bytes[i + 3]);
          i += 4;
          if (ucSkip > 0) { ucSkip--; continue; }
          pendingBytes.push(parseInt(hex, 16));
          continue;
        }
        // símbolos de um caractere
        if (n === undefined) break;
        if (!isAlpha(n)) {
          i += 2;
          const ch = String.fromCharCode(n);
          if (ch === "*") { st.starred = true; continue; }
          if (ucSkip > 0) { ucSkip--; continue; }
          flushBytes();
          if (ch === "\\" || ch === "{" || ch === "}") emitText(ch);
          else if (ch === "~") emitText(" ");
          else if (ch === "_") emitText("-");
          else if (ch === "\n" || ch === "\r") endParagraph();
          continue;
        }

        // palavra de controle
        let j = i + 1;
        while (j < len && isAlpha(bytes[j])) j++;
        const word = String.fromCharCode(...bytes.subarray(i + 1, j));
        let param = null;
        let k = j;
        if (bytes[k] === 0x2d || isDigit(bytes[k])) {
          k++;
          while (k < len && isDigit(bytes[k])) k++;
          param = parseInt(String.fromCharCode(...bytes.subarray(j, k)), 10);
        }
        if (bytes[k] === 0x20) k++;
        i = k;

        if (word === "bin" && param > 0) { flushBytes(); i += param; continue; }

        if (word === "u" && param !== null) {
          flushBytes();
          const code = param < 0 ? param + 65536 : param;
          emitText(String.fromCharCode(code));
          ucSkip = st.uc;
          continue;
        }
        if (ucSkip > 0 && word !== "uc") { ucSkip = 0; }

        // Primeira palavra de um grupo: decide se é destino a pular/capturar
        const first = st.dest;
        st.dest = false;
        if (first) {
          if (word === "fldinst" || word === "author") {
            flushBytes();
            st.capture = { kind: word, text: "" };
            st.starred = false;
            continue;
          }
          if (st.starred || RTF_SKIP.has(word)) {
            flushBytes();
            st.skip = true;
            continue;
          }
        }
        if (st.starred) st.starred = false;

        switch (word) {
          case "ansicpg":
            decoder = makeDecoder(param);
            break;
          case "uc":
            st.uc = param ?? 1;
            break;
          case "par":
          case "sect":
          case "row":
          case "cell":
          case "nestcell":
          case "page":
            endParagraph();
            break;
          case "line":
          case "tab":
            flushBytes();
            if (!st.skip && !st.capture) pushRun(runs, " ", st.ul, st.link, true);
            break;
          case "plain":
            flushBytes();
            st.ul = false;
            break;
          case "ulnone":
            flushBytes();
            st.ul = false;
            break;
          case "field":
            st.field = { link: false };
            break;
          case "fldrslt":
            st.link = st.link || !!(st.field && st.field.link);
            break;
          default:
            if (RTF_UL_ON.test(word)) {
              flushBytes();
              st.ul = param !== 0;
            } else if (RTF_SYMBOLS[word]) {
              flushBytes();
              emitText(RTF_SYMBOLS[word]);
            }
        }
        continue;
      }

      // texto comum
      if (ucSkip > 0) { ucSkip--; i++; continue; }
      if (b < 0x80) { flushBytes(); emitText(String.fromCharCode(b)); }
      else pendingBytes.push(b);
      i++;
    }
    flushBytes();
    if (runs.length) paragraphs.push(runs);

    return { author, paragraphs, warnings: [] };
  }

  const isAlpha = (b) => (b >= 0x61 && b <= 0x7a) || (b >= 0x41 && b <= 0x5a);
  const isDigit = (b) => b >= 0x30 && b <= 0x39;

  function makeDecoder(cp) {
    const labels = cp === 65001 ? ["utf-8"] : [`windows-${cp}`, `cp${cp}`, `ibm${cp}`];
    if (cp === 10000) labels.unshift("macintosh");
    for (const label of labels) {
      try { return new TextDecoder(label); } catch { /* tenta o próximo */ }
    }
    return new TextDecoder("windows-1252");
  }

  /* =======================================================
     PDF
     ======================================================= */

  let pdfjsPromise = null;

  function loadPdfjs() {
    if (!pdfjsPromise) {
      const base = (typeof document !== "undefined" && document.baseURI) || root.location?.href;
      const lib = new URL(CFG.PDFJS_URL, base).href;
      pdfjsPromise = import(lib).then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(CFG.PDFJS_WORKER_URL, base).href;
        return pdfjs;
      }).catch((error) => {
        pdfjsPromise = null;
        throw new Error("Não foi possível carregar o leitor de PDF (vendor/pdfjs). " + error.message);
      });
    }
    return pdfjsPromise;
  }

  /* Larguras aproximadas (Helvetica, /1000) para posicionar cada letra dentro de um trecho. */
  const HELV = (() => {
    const w = {};
    const s = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";
    const v = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
      556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
      667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722,
      667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333,
      556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333,
      500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
    for (let k = 0; k < s.length; k++) w[s[k]] = v[k];
    return w;
  })();
  const charWeight = (c) => HELV[c] ?? HELV[c.normalize("NFD")[0]] ?? 556;

  async function parsePdf(buffer) {
    const pdfjs = await loadPdfjs();
    let pdf;
    try {
      pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
    } catch (error) {
      if (error && error.name === "PasswordException") throw new Error("PDF protegido por senha.");
      throw new Error("Não foi possível abrir o PDF: " + (error?.message || error));
    }

    const warnings = [];
    let author = "";
    try {
      const meta = await pdf.getMetadata();
      author = meta?.info?.Author || "";
      if (!author && meta?.metadata) {
        const c = meta.metadata.get("dc:creator");
        author = Array.isArray(c) ? c.join(", ") : c || "";
      }
    } catch { /* sem metadados */ }

    const paragraphs = [];
    let scanned = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const result = await extractPdfPage(pdfjs, page);
      if (!result) {
        scanned += await pageHasImages(pdfjs, page) ? 1 : 0;
        continue;
      }
      paragraphs.push(...result);
      page.cleanup();
    }
    await pdf.destroy();

    if (scanned) warnings.push(`${scanned} página(s) sem texto (digitalizadas): precisam de OCR.`);
    return { author, paragraphs, warnings };
  }

  async function pageHasImages(pdfjs, page) {
    const ol = await page.getOperatorList();
    const OPS = pdfjs.OPS;
    return ol.fnArray.some((f) => f === OPS.paintImageXObject || f === OPS.paintInlineImageXObject || f === OPS.paintJpegXObject);
  }

  async function extractPdfPage(pdfjs, page) {
    const [, , , top] = page.view;
    const flipY = (y) => top - y;

    const content = await page.getTextContent();
    const lines = buildPdfLines(content.items, flipY);
    if (!lines.length) return null;

    const ol = await page.getOperatorList();
    const traces = collectTraces(pdfjs.OPS, ol, flipY);
    const annots = await page.getAnnotations();
    markPdf(lines, traces, annots, flipY);
    return pdfLinesToParagraphs(lines);
  }

  /* Agrupa os trechos de texto em linhas visuais; cada letra guarda posição. */
  function buildPdfLines(items, flipY) {
    const lines = [];
    for (const it of items) {
      if (!it.str || !it.transform) continue;
      const [a, b, c, d, e, f] = it.transform;
      if (a <= 0 || Math.abs(b) > 1e-3 || Math.abs(c) > 1e-3) continue; // texto girado
      const tam = Math.abs(d) || it.height || 10;
      const base = flipY(f);
      const chars = [...it.str];
      const weights = chars.map(charWeight);
      const total = weights.reduce((s, w) => s + w, 0) || 1;
      const width = it.width || total / 1000 * tam;
      let x = e;
      let list = chars.map((ch, k) => {
        const w = weights[k] / total * width;
        const obj = { c: ch, x0: x, x1: x + w, base, tam, cov: 0, ann: false, link: false };
        x += w;
        return obj;
      });
      while (list.length && !list[list.length - 1].c.trim()) list.pop();
      while (list.length && !list[0].c.trim()) list.shift();
      if (!list.length) continue;

      const ant = lines[lines.length - 1];
      const gap = ant ? list[0].x0 - ant.x1 : 0;
      if (ant && Math.abs(ant.base - base) <= 0.3 * tam && gap >= -1 && gap <= 4 * tam) {
        if (gap > 0.15 * tam) {
          ant.chars.push({ c: " ", x0: ant.x1, x1: list[0].x0, base: ant.base, tam, cov: 0, ann: false, link: false });
        }
        ant.chars.push(...list);
        ant.x1 = list[list.length - 1].x1;
        ant.tam = Math.max(ant.tam, tam);
        continue;
      }
      lines.push({ chars: list, x0: list[0].x0, x1: list[list.length - 1].x1, base, tam });
    }
    return lines;
  }

  /* Traços horizontais finos (linhas e retângulos) desenhados na página. */
  function collectTraces(OPS, ol, flipY) {
    const traces = [];
    const stack = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    let lineWidth = 1;
    let path = [];

    const mul = (m, n) => [
      m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
      m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
      m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]
    ];
    const pt = (x, y) => ({ x: ctm[0] * x + ctm[2] * y + ctm[4], y: flipY(ctm[1] * x + ctm[3] * y + ctm[5]) });
    const scale = () => Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) || 1;

    const STROKE = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
    const FILL = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
    const MAX = CFG.PDF_STROKE_MAX;
    const MIN = CFG.PDF_STROKE_MIN_WIDTH;

    function paint(stroke, fill) {
      if (!path.length) return;
      const all = path.flatMap((s) => (s.type === "re" ? [s.p0, s.p1] : s.pts));
      const bx0 = Math.min(...all.map((p) => p.x)), bx1 = Math.max(...all.map((p) => p.x));
      const by0 = Math.min(...all.map((p) => p.y)), by1 = Math.max(...all.map((p) => p.y));
      if (fill && by1 - by0 <= MAX && bx1 - bx0 >= MIN) {
        traces.push([bx0, bx1, (by0 + by1) / 2]);
        return;
      }
      const lw = lineWidth * scale();
      for (const s of path) {
        if (s.type === "l" && stroke) {
          const [p1, p2] = s.pts;
          if (Math.abs(p1.y - p2.y) <= 1 && Math.abs(p1.x - p2.x) >= MIN && lw <= MAX) {
            traces.push([Math.min(p1.x, p2.x), Math.max(p1.x, p2.x), (p1.y + p2.y) / 2]);
          }
        } else if (s.type === "re") {
          const x0 = Math.min(s.p0.x, s.p1.x), x1 = Math.max(s.p0.x, s.p1.x);
          const h = Math.abs(s.p0.y - s.p1.y);
          if (h <= MAX && x1 - x0 >= MIN) traces.push([x0, x1, (s.p0.y + s.p1.y) / 2]);
        }
      }
    }

    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i];
      const args = ol.argsArray[i];
      if (fn === OPS.save) stack.push([ctm, lineWidth]);
      else if (fn === OPS.restore) { if (stack.length) [ctm, lineWidth] = stack.pop(); }
      else if (fn === OPS.transform) ctm = mul(args, ctm);
      else if (fn === OPS.paintFormXObjectBegin) {
        stack.push([ctm, lineWidth]);
        if (Array.isArray(args[0]) || ArrayBuffer.isView(args[0])) ctm = mul([...args[0]], ctm);
      } else if (fn === OPS.paintFormXObjectEnd) { if (stack.length) [ctm, lineWidth] = stack.pop(); }
      else if (fn === OPS.setLineWidth) lineWidth = args[0];
      else if (fn === OPS.setGState) {
        for (const [key, val] of args[0] || []) if (key === "LW") lineWidth = val;
      } else if (fn === OPS.constructPath) {
        const [ops, coords] = args;
        let c = 0;
        let cur = null;
        for (const op of ops) {
          if (op === OPS.moveTo) { cur = pt(coords[c], coords[c + 1]); c += 2; }
          else if (op === OPS.lineTo) {
            const p = pt(coords[c], coords[c + 1]); c += 2;
            if (cur) path.push({ type: "l", pts: [cur, p] });
            cur = p;
          } else if (op === OPS.curveTo) {
            const p = [pt(coords[c], coords[c + 1]), pt(coords[c + 2], coords[c + 3]), pt(coords[c + 4], coords[c + 5])];
            c += 6; path.push({ type: "c", pts: cur ? [cur, ...p] : p }); cur = p[2];
          } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
            const p = [pt(coords[c], coords[c + 1]), pt(coords[c + 2], coords[c + 3])];
            c += 4; path.push({ type: "c", pts: cur ? [cur, ...p] : p }); cur = p[1];
          } else if (op === OPS.rectangle) {
            const [x, y, w, h] = [coords[c], coords[c + 1], coords[c + 2], coords[c + 3]];
            c += 4;
            path.push({ type: "re", p0: pt(x, y), p1: pt(x + w, y + h) });
          }
        }
      } else if (STROKE.has(fn) || FILL.has(fn)) {
        paint(STROKE.has(fn), FILL.has(fn));
        path = [];
      } else if (fn === OPS.endPath) {
        path = [];
      }
    }
    return traces;
  }

  /* Marca as letras sublinhadas (por traço ou anotação) e as que estão em links. */
  function markPdf(lines, traces, annots, flipY) {
    for (const ln of lines) {
      const t = ln.tam;
      for (const [x0, x1, y] of traces) {
        if (!(ln.base - 0.06 * t <= y && y <= ln.base + 0.35 * t)) continue;
        if (x0 < ln.x0 - 0.5 * t || x1 > ln.x1 + t) continue; // régua/borda de tabela
        for (const ch of ln.chars) {
          const w = ch.x1 - ch.x0;
          if (w > 0) ch.cov += Math.max(0, Math.min(ch.x1, x1) - Math.max(ch.x0, x0)) / w;
        }
      }
    }

    const boxesOf = (a) => {
      const q = a.quadPoints;
      if (q && q.length) {
        const flat = typeof q[0] === "number" ? [...q] : q.flatMap((quad) => quad.flatMap((p) => [p.x, p.y]));
        const boxes = [];
        for (let k = 0; k + 7 < flat.length; k += 8) {
          const xs = [flat[k], flat[k + 2], flat[k + 4], flat[k + 6]];
          const ys = [flat[k + 1], flat[k + 3], flat[k + 5], flat[k + 7]].map(flipY);
          boxes.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
        }
        if (boxes.length) return boxes;
      }
      const r = a.rect;
      return r ? [[Math.min(r[0], r[2]), flipY(Math.max(r[1], r[3])), Math.max(r[0], r[2]), flipY(Math.min(r[1], r[3]))]] : [];
    };

    const hit = (boxes, ch) => {
      const px = (ch.x0 + ch.x1) / 2;
      const py = ch.base - 0.3 * ch.tam;
      return boxes.some(([x0, y0, x1, y1]) => x0 <= px && px <= x1 && y0 <= py && py <= y1);
    };

    const underlineBoxes = annots.filter((a) => a.subtype === "Underline" || a.subtype === "Squiggly").flatMap(boxesOf);
    const linkBoxes = annots.filter((a) => a.subtype === "Link").flatMap(boxesOf);

    for (const ln of lines) {
      for (const ch of ln.chars) {
        if (underlineBoxes.length && hit(underlineBoxes, ch)) ch.ann = true;
        if (linkBoxes.length && hit(linkBoxes, ch)) ch.link = true;
      }
      // decide por palavra: a posição de cada letra é estimada
      let k = 0;
      const cs = ln.chars;
      while (k < cs.length) {
        if (!cs[k].c.trim()) { cs[k].u = false; k++; continue; }
        let j = k;
        while (j < cs.length && cs[j].c.trim()) j++;
        let covered = 0, width = 0, ann = 0;
        for (let m = k; m < j; m++) {
          const w = cs[m].x1 - cs[m].x0;
          covered += Math.min(1, cs[m].cov) * w;
          width += w;
          if (cs[m].ann) ann++;
        }
        const u = (width > 0 && covered / width >= 0.5) || ann * 2 >= j - k;
        // pontuação nas pontas da palavra só conta se estiver sob o traço
        let a = k, z = j - 1;
        while (a <= z && !/[\p{L}\p{N}]/u.test(cs[a].c)) a++;
        while (z >= a && !/[\p{L}\p{N}]/u.test(cs[z].c)) z--;
        for (let m = k; m < j; m++) {
          cs[m].u = m >= a && m <= z ? u : u && (cs[m].cov >= 0.6 || cs[m].ann);
        }
        k = j;
      }
    }
  }

  /* A linha i+1 continua a linha i por quebra automática?
     null = não; " " = sim; "" = sim, com palavra cortada no meio. */
  function autoWrap(lines, i) {
    const a = lines[i], b = lines[i + 1];
    const t = a.tam;
    if (Math.abs(a.x0 - b.x0) > 2 || !(b.base - a.base > 0 && b.base - a.base <= 2.2 * t)) return null;
    let first = b.x1;
    for (const ch of b.chars) if (!ch.c.trim()) { first = ch.x0; break; }
    const available = Math.max(...lines.filter((l) => Math.abs(l.x0 - a.x0) <= 2).map((l) => l.x1 - l.x0));
    if ((a.x1 - a.x0) + 0.25 * t + (first - b.x0) <= available + 0.5) return null;
    const oneWord = !a.chars.some((ch) => !ch.c.trim());
    const full = available - (a.x1 - a.x0) < 0.9 * t;
    return oneWord && full ? "" : " ";
  }

  function pdfLinesToParagraphs(lines) {
    const paragraphs = [];
    let runs = [];
    lines.forEach((ln, i) => {
      if (i > 0) {
        const sep = autoWrap(lines, i - 1);
        if (sep === null) { paragraphs.push(runs); runs = []; }
        else if (sep) pushRun(runs, sep, false, false, true);
      }
      for (const ch of ln.chars) pushRun(runs, ch.c, !!ch.u, ch.link, false);
    });
    paragraphs.push(runs);
    return paragraphs;
  }

  /* ======================================================= */

  const api = { extractFile, EXTRACTION_CONFIG, _internals: { parseRtf, parseDocx, parsePdf, buildArtes } };
  root.RoteiroExtractor = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

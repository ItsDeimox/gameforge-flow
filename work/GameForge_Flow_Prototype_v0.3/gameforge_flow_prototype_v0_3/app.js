
(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const STORAGE_KEY = "gameforge-flow-prototype-v3";
  const STAGES = ["vision", "production", "execution"];

  const DEFAULT_SAVE = {
    id: crypto.randomUUID(),
    name: "Pentagory",
    updatedAt: Date.now(),
    docs: [
      {
        id: crypto.randomUUID(),
        title: "Visão do Projeto",
        status: "canon",
        content: `# Pentagory

## Experiência central
Exploração em primeira pessoa, puzzle e descoberta.

O jogador deve sentir que está montando uma verdade proibida **peça por peça**.

> A ambientação precisa contar história antes do texto contar.

### Level 0
- Câmara embrionária
- Câmara do traje
- Mezanino / servidores
- Sala de religar sistemas
- Saída / elevador

Selecione qualquer trecho e envie para **Produção**.`
      },
      {
        id: crypto.randomUUID(),
        title: "Narrativa / Lore",
        status: "probable",
        content: `# Lore

AISI, o Sistema Oculto e os cinco **Vértices** formam a espinha dorsal da narrativa.

## Perguntas abertas
- O que o jogador acredita no início?
- O que muda no primeiro Vértice?
- O que deve permanecer deliberadamente ambíguo?`
      }
    ],
    production: [
      {
        id: crypto.randomUUID(),
        text: "Graybox da Câmara Embrionária com rota principal legível.",
        category: "design",
        status: "backlog",
        deadline: "Sem prazo",
        source: "Visão do Projeto"
      },
      {
        id: crypto.randomUUID(),
        text: "Shader do portal central com leitura clara a distância.",
        category: "art",
        status: "ready",
        deadline: "3 dias",
        source: "Visão do Projeto"
      }
    ],
    execution: [
      {
        id: crypto.randomUUID(),
        text: "Sistema de interação base em C#",
        category: "code",
        status: "doing",
        assignee: "Deimox",
        deadline: "Sem prazo"
      }
    ]
  };

  const state = {
    saves: [],
    selectedSaveId: null,
    activeSaveId: null,
    activeDocId: null,
    currentScreen: "saves",
    currentStage: "vision",
    sound: true,
    editorMode: "edit",
    selectionText: ""
  };

  function esc(s = "") {
    return String(s).replace(/[&<>"']/g, m => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[m]));
  }

  function toast(html) {
    const t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = html;
    $("#toastHost").appendChild(t);
    setTimeout(() => {
      t.style.opacity = 0;
      t.style.transform = "translateX(12px)";
      t.style.transition = ".22s";
      setTimeout(() => t.remove(), 220);
    }, 2400);
  }

  function openModal(html) {
    $("#modalContent").innerHTML = html;
    $("#modalBackdrop").classList.remove("hidden");
    $$("[data-close]").forEach(b => b.onclick = closeModal);
    sound.click();
  }

  function closeModal() {
    $("#modalBackdrop").classList.add("hidden");
  }

  function currentSave() {
    return state.saves.find(s => s.id === state.activeSaveId) || state.saves[0];
  }

  function selectedSave() {
    return state.saves.find(s => s.id === state.selectedSaveId) || state.saves[0];
  }

  function currentDoc() {
    const save = currentSave();
    return save?.docs.find(d => d.id === state.activeDocId) || save?.docs?.[0];
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      saves: state.saves,
      selectedSaveId: state.selectedSaveId,
      activeSaveId: state.activeSaveId,
      sound: state.sound
    }));
    const saveIndicator = $("#saveIndicator");
    if (saveIndicator) saveIndicator.textContent = "SALVO";
  }

  function loadState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      state.saves = [DEFAULT_SAVE];
      state.selectedSaveId = DEFAULT_SAVE.id;
      state.activeSaveId = DEFAULT_SAVE.id;
      state.activeDocId = DEFAULT_SAVE.docs[0].id;
      saveState();
      return;
    }
    try {
      const data = JSON.parse(raw);
      state.saves = data.saves?.length ? data.saves : [DEFAULT_SAVE];
      state.selectedSaveId = data.selectedSaveId || data.activeSaveId || state.saves[0].id;
      state.activeSaveId = data.activeSaveId || state.saves[0].id;
      state.sound = data.sound !== false;
      state.activeDocId = currentSave()?.docs?.[0]?.id || null;
    } catch {
      state.saves = [DEFAULT_SAVE];
      state.selectedSaveId = DEFAULT_SAVE.id;
      state.activeSaveId = DEFAULT_SAVE.id;
      state.activeDocId = DEFAULT_SAVE.docs[0].id;
    }
  }

  // Audio
  let audioCtx;
  function tone(freq=520, duration=.05, type="sine", gain=.02) {
    if (!state.sound) return;
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, audioCtx.currentTime);
    g.gain.setValueAtTime(gain, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + duration);
  }
  const sound = {
    hover: () => tone(720, .03, "sine", .008),
    click: () => { tone(390, .05, "triangle", .018); setTimeout(() => tone(590, .05, "triangle", .012), 28); },
    enter: () => { tone(320, .07, "sine", .022); setTimeout(() => tone(660, .08, "sine", .017), 40); },
    move: () => tone(250, .04, "triangle", .014),
    success: () => { tone(500, .06, "sine", .02); setTimeout(() => tone(760, .07, "sine", .016), 55); }
  };

  // Screen nav
  function go(screen) {
    if (state.currentScreen === screen) return;
    $$(".screen").forEach(s => s.classList.remove("active"));
    const map = { saves: "#saveScreen", hub: "#hubScreen", work: "#workScreen" };
    $(map[screen]).classList.add("active");
    state.currentScreen = screen;
    if (screen === "saves") {
      renderSaves();
      centerSelectedSave();
    }
    if (screen === "hub") renderHub();
    if (screen === "work") openStage(state.currentStage);
    sound.enter();
  }

  // Save screen
  function renderSaves() {
    const list = $("#saveList");
    list.innerHTML = "";

    state.saves.forEach((save, idx) => {
      const btn = document.createElement("button");
      btn.className = "save-slot" + (save.id === state.selectedSaveId ? " active" : "");
      btn.dataset.id = save.id;
      btn.innerHTML = `
        <strong>${esc(save.name)}</strong>
        <small><span>SLOT ${String(idx + 1).padStart(2, "0")}</span><span>${save.production.length + save.execution.length} TASKS</span></small>
      `;
      btn.onclick = () => {
        state.selectedSaveId = save.id;
        renderSaves();
        renderSavePreview();
        sound.click();
      };
      btn.ondblclick = () => openSelectedSave();
      btn.onmouseenter = sound.hover;
      list.appendChild(btn);
    });

    renderSavePreview();
    requestAnimationFrame(updateSaveScale);
  }

  function renderSavePreview() {
    const s = selectedSave();
    if (!s) return;
    $("#selectedSaveName").textContent = s.name;
    $("#selectedSaveMeta").textContent = `${s.docs.length} documentos · ${s.production.length} itens · ${s.execution.length} tarefas`;
    $("#statDocs").textContent = s.docs.length;
    $("#statProd").textContent = s.production.length;
    $("#statExec").textContent = s.execution.length;
  }

  function updateSaveScale() {
    const list = $("#saveList");
    const rect = list.getBoundingClientRect();
    const center = rect.top + rect.height / 2;

    $$("#saveList .save-slot").forEach(el => {
      const r = el.getBoundingClientRect();
      const d = Math.abs((r.top + r.height/2) - center);
      const t = Math.min(1, d / (rect.height * .46));
      const scale = 1.06 - (t * .12);
      const opacity = .98 - (t * .40);
      el.style.transform = `scale(${scale})`;
      el.style.opacity = opacity;
    });
  }

  function centerSelectedSave() {
    setTimeout(() => {
      const active = $("#saveList .save-slot.active");
      active?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  }

  function openSelectedSave() {
    const save = selectedSave();
    if (!save) return;
    state.activeSaveId = save.id;
    state.activeDocId = save.docs?.[0]?.id || null;
    saveState();
    renderHub();
    go("hub");
  }

  function createSaveModal() {
    openModal(`
      <span class="eyebrow">NEW GAME</span>
      <h3>Criar novo Save</h3>
      <p>Um Save funciona como o workspace do projeto.</p>
      <div class="form-row full">
        <div class="form-field">
          <label>NOME DO PROJETO</label>
          <input id="newSaveName" placeholder="Ex.: Project Blackstar" autofocus />
        </div>
      </div>
      <div class="modal-actions">
        <button class="hud-button" data-close>CANCELAR</button>
        <button id="confirmSaveBtn" class="accent-button">CRIAR SAVE</button>
      </div>
    `);

    setTimeout(() => $("#newSaveName")?.focus(), 40);

    const create = () => {
      const name = $("#newSaveName").value.trim() || "Untitled Save";
      const save = {
        id: crypto.randomUUID(),
        name,
        updatedAt: Date.now(),
        docs: [
          {
            id: crypto.randomUUID(),
            title: "Visão do Projeto",
            status: "experiment",
            content: `# ${name}\n\nComece pela direção criativa do jogo.\n`
          }
        ],
        production: [],
        execution: []
      };
      state.saves.push(save);
      state.selectedSaveId = save.id;
      state.activeSaveId = save.id;
      state.activeDocId = save.docs[0].id;
      saveState();
      closeModal();
      renderSaves();
      centerSelectedSave();
      sound.success();
      toast("<b>Save criado.</b> Novo slot na área.");
    };

    $("#confirmSaveBtn").onclick = create;
    $("#newSaveName").addEventListener("keydown", e => {
      if (e.key === "Enter") create();
    });
  }

  // HUB
  function renderHub() {
    const s = currentSave();
    $("#hubSaveName").textContent = s?.name || "Save";
  }

  $$(".stage-card").forEach(card => {
    card.addEventListener("mouseenter", () => {
      $("#stageCards").classList.add("has-hover");
      card.classList.add("hovered");
      sound.hover();
    });
    card.addEventListener("mouseleave", () => {
      $("#stageCards").classList.remove("has-hover");
      card.classList.remove("hovered");
      card.style.transform = "";
      card.style.setProperty("--mx", "50%");
      card.style.setProperty("--my", "50%");
    });
    card.addEventListener("mousemove", e => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      card.style.setProperty("--mx", `${x*100}%`);
      card.style.setProperty("--my", `${y*100}%`);
      card.style.transform = `rotateX(${(-(y-.5)*7).toFixed(2)}deg) rotateY(${((x-.5)*8).toFixed(2)}deg) translateY(-4px) scale(1.012)`;
    });
    card.onclick = () => {
      state.currentStage = card.dataset.stage;
      go("work");
    };
  });

  // Work / stage
  function openStage(stage) {
    state.currentStage = stage;
    const map = {
      vision: ["STAGE 01", "VISÃO"],
      production: ["STAGE 02", "PRODUÇÃO"],
      execution: ["STAGE 03", "EXECUÇÃO"]
    };
    $("#workEyebrow").textContent = map[stage][0];
    $("#workTitle").textContent = map[stage][1];

    $$(".work-panel").forEach(p => p.classList.add("hidden"));
    $(`#${stage}Panel`).classList.remove("hidden");

    updateStageArrows();

    if (stage === "vision") renderVision();
    if (stage === "production") renderProduction();
    if (stage === "execution") renderExecution(currentDept());
  }

  function updateStageArrows() {
    const idx = STAGES.indexOf(state.currentStage);
    const prev = STAGES[idx - 1];
    const next = STAGES[idx + 1];

    const prevBtn = $("#prevStageBtn");
    const nextBtn = $("#nextStageBtn");

    if (prev) {
      prevBtn.classList.remove("hidden");
      prevBtn.classList.add("left");
      prevBtn.textContent = "← " + stageLabel(prev);
      prevBtn.onclick = () => {
        state.currentStage = prev;
        openStage(prev);
        sound.enter();
      };
    } else {
      prevBtn.classList.add("hidden");
    }

    if (next) {
      nextBtn.classList.remove("hidden");
      nextBtn.classList.add("right");
      nextBtn.textContent = stageLabel(next) + " →";
      nextBtn.onclick = () => {
        state.currentStage = next;
        openStage(next);
        sound.enter();
      };
    } else {
      nextBtn.classList.add("hidden");
    }
  }

  function stageLabel(stage) {
    return ({ vision: "VISÃO", production: "PRODUÇÃO", execution: "EXECUÇÃO" })[stage];
  }

  // Markdown
  function inlineMd(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  }

  function renderMarkdown(md) {
    const lines = md.replace(/\r/g, "").split("\n");
    let html = "";
    let inList = false;
    let paragraph = [];

    const flushParagraph = () => {
      if (paragraph.length) {
        html += `<p>${inlineMd(paragraph.join(" "))}</p>`;
        paragraph = [];
      }
    };

    const closeList = () => {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
    };

    for (const line of lines) {
      if (/^---+$/.test(line.trim())) {
        flushParagraph();
        closeList();
        html += "<hr>";
        continue;
      }

      const heading = line.match(/^(#{1,3})\s+(.+)/);
      if (heading) {
        flushParagraph();
        closeList();
        html += `<h${heading[1].length}>${inlineMd(heading[2])}</h${heading[1].length}>`;
        continue;
      }

      const quote = line.match(/^>\s?(.*)/);
      if (quote) {
        flushParagraph();
        closeList();
        html += `<blockquote>${inlineMd(quote[1])}</blockquote>`;
        continue;
      }

      const li = line.match(/^\s*[-*]\s+(.+)/);
      if (li) {
        flushParagraph();
        if (!inList) {
          html += "<ul>";
          inList = true;
        }
        html += `<li>${inlineMd(li[1])}</li>`;
        continue;
      }

      if (!line.trim()) {
        flushParagraph();
        closeList();
        continue;
      }

      paragraph.push(line.trim());
    }

    flushParagraph();
    closeList();
    return html || "<p></p>";
  }

  function setEditorMode(mode) {
    state.editorMode = mode;
    $$("[data-editor-mode]").forEach(btn => btn.classList.toggle("active", btn.dataset.editorMode === mode));
    $("#visionEditor").classList.toggle("hidden", mode !== "edit");
    $("#markdownToolbar").classList.toggle("hidden", mode !== "edit");
    $("#markdownPreview").classList.toggle("hidden", mode !== "preview");

    if (mode === "preview") {
      $("#markdownPreview").innerHTML = renderMarkdown(currentDoc().content);
    }
  }

  function statusLabel(status) {
    return ({ canon: "CANÔNICO", probable: "PROVÁVEL", experiment: "EXPERIMENTO" })[status] || "EXPERIMENTO";
  }

  function paintStatus(status) {
    const chip = $("#docStatus");
    chip.className = `status-chip ${status}`;
    chip.textContent = statusLabel(status);
  }

  function renderVision() {
    const save = currentSave();
    if (!save.docs.length) {
      const doc = { id: crypto.randomUUID(), title: "Novo documento", status: "experiment", content: "# Novo documento\n" };
      save.docs.push(doc);
      state.activeDocId = doc.id;
    }
    if (!save.docs.some(d => d.id === state.activeDocId)) {
      state.activeDocId = save.docs[0].id;
    }

    $("#docList").innerHTML = save.docs.map(d => `
      <button class="doc-item ${d.id === state.activeDocId ? "active" : ""}" data-id="${d.id}">
        ${esc(d.title)}
        <small>${statusLabel(d.status)}</small>
      </button>
    `).join("");

    $$("#docList .doc-item").forEach(btn => {
      btn.onclick = () => {
        state.activeDocId = btn.dataset.id;
        renderVision();
        sound.click();
      };
    });

    const doc = currentDoc();
    $("#docTitle").value = doc.title;
    $("#visionEditor").value = doc.content;
    $("#markdownPreview").innerHTML = renderMarkdown(doc.content);
    $("#docStatusSelect").value = doc.status;
    paintStatus(doc.status);
    setEditorMode(state.editorMode);
  }

  function captureSelection() {
    const ta = $("#visionEditor");
    const text = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
    state.selectionText = text;
    $("#selectionInfo").textContent = text ? `${text.length} caracteres selecionados.` : "Selecione um trecho e envie para Produção.";
    return text;
  }

  function sendSelectionToProduction() {
    const selected = captureSelection();
    if (!selected) {
      toast("<b>Nada selecionado.</b> Marca um trecho primeiro :V");
      return;
    }

    openModal(`
      <span class="eyebrow">VISION → PRODUCTION</span>
      <h3>Enviar para Produção</h3>
      <p>A direção criativa vira um item que o producer consegue organizar.</p>

      <div class="form-row">
        <div class="form-field">
          <label>CATEGORIA</label>
          <select id="sendCategory">
            <option value="design">Game Design</option>
            <option value="art">Art / 3D</option>
            <option value="code">Programming</option>
            <option value="audio">Audio</option>
            <option value="lore">Narrative / Lore</option>
          </select>
        </div>
        <div class="form-field">
          <label>ESTADO</label>
          <select id="sendStatus">
            <option value="backlog">Backlog</option>
            <option value="ready">Planejando</option>
          </select>
        </div>
      </div>

      <div class="form-row full">
        <div class="form-field">
          <label>CONTEÚDO</label>
          <textarea id="sendText">${esc(selected)}</textarea>
        </div>
      </div>

      <div class="modal-actions">
        <button class="hud-button" data-close>CANCELAR</button>
        <button id="confirmSendBtn" class="accent-button">ENVIAR →</button>
      </div>
    `);

    $("#confirmSendBtn").onclick = () => {
      currentSave().production.push({
        id: crypto.randomUUID(),
        text: $("#sendText").value.trim(),
        category: $("#sendCategory").value,
        status: $("#sendStatus").value,
        deadline: "Sem prazo",
        source: currentDoc().title
      });
      saveState();
      closeModal();
      sound.success();
      toast("<b>Enviado para Produção.</b> Agora virou peça do pipeline.");
    };
  }

  function newDoc() {
    const doc = {
      id: crypto.randomUUID(),
      title: "Novo documento",
      status: "experiment",
      content: "# Novo documento\n\n"
    };
    currentSave().docs.push(doc);
    state.activeDocId = doc.id;
    saveState();
    renderVision();
    setTimeout(() => { $("#docTitle").focus(); $("#docTitle").select(); }, 40);
    sound.success();
  }

  // Production
  const PROD_COLS = [
    ["backlog", "BACKLOG"],
    ["ready", "PLANEJANDO"],
    ["scheduled", "PRONTO → EXECUÇÃO"]
  ];

  function categoryLabel(category) {
    return ({
      design: "GAME DESIGN",
      art: "ART / 3D",
      code: "PROGRAMMING",
      audio: "AUDIO",
      lore: "NARRATIVE"
    })[category] || category.toUpperCase();
  }

  function renderProduction() {
    const items = currentSave().production;
    $("#productionBoard").innerHTML = PROD_COLS.map(([key, label]) => `
      <section class="board-column">
        <div class="board-col-head"><span>${label}</span><span>${items.filter(i => i.status === key).length}</span></div>
        <div class="card-stack" data-drop="${key}">
          ${items.filter(i => i.status === key).map(item => `
            <article class="prod-card" data-id="${item.id}">
              <span class="kind">${categoryLabel(item.category)}</span>
              <h4>${esc(item.text)}</h4>
              <p>Origem: ${esc(item.source || "Manual")}</p>
              <div class="prod-card-foot">
                <span>${esc(item.deadline || "Sem prazo")}</span>
                ${item.status === "scheduled" ? `<button data-send-exec="${item.id}">ENVIAR →</button>` : `<span>${({ backlog: "IDEIA", ready: "QUEBRANDO" })[item.status] || "READY"}</span>`}
              </div>
            </article>
          `).join("")}
        </div>
      </section>
    `).join("");

    $$(".prod-card").forEach(card => {
      card.draggable = true;
      card.addEventListener("dragstart", e => {
        card.classList.add("dragging");
        e.dataTransfer.setData("text/plain", card.dataset.id);
        sound.move();
      });
      card.addEventListener("dragend", () => card.classList.remove("dragging"));
    });

    $$(".card-stack").forEach(stack => {
      stack.addEventListener("dragover", e => {
        e.preventDefault();
        stack.classList.add("drop-active");
      });
      stack.addEventListener("dragleave", () => stack.classList.remove("drop-active"));
      stack.addEventListener("drop", e => {
        e.preventDefault();
        stack.classList.remove("drop-active");
        const id = e.dataTransfer.getData("text/plain");
        const item = items.find(i => i.id === id);
        if (item) {
          item.status = stack.dataset.drop;
          saveState();
          renderProduction();
          sound.success();
        }
      });
    });

    $$("[data-send-exec]").forEach(btn => {
      btn.onclick = () => sendProductionToExecution(btn.dataset.sendExec);
    });
  }

  function newProductionCard() {
    openModal(`
      <span class="eyebrow">PRODUCTION</span>
      <h3>Novo Card</h3>

      <div class="form-row">
        <div class="form-field">
          <label>CATEGORIA</label>
          <select id="newProdCat">
            <option value="design">Game Design</option>
            <option value="art">Art / 3D</option>
            <option value="code">Programming</option>
            <option value="audio">Audio</option>
            <option value="lore">Narrative</option>
          </select>
        </div>
        <div class="form-field">
          <label>PRAZO</label>
          <input id="newProdDeadline" placeholder="Ex.: sexta / 3 dias" />
        </div>
      </div>

      <div class="form-row full">
        <div class="form-field">
          <label>ITEM</label>
          <textarea id="newProdText" placeholder="O que precisa ser produzido?"></textarea>
        </div>
      </div>

      <div class="modal-actions">
        <button class="hud-button" data-close>CANCELAR</button>
        <button id="confirmNewProdBtn" class="accent-button">CRIAR</button>
      </div>
    `);

    $("#confirmNewProdBtn").onclick = () => {
      const text = $("#newProdText").value.trim();
      if (!text) return;
      currentSave().production.push({
        id: crypto.randomUUID(),
        text,
        category: $("#newProdCat").value,
        status: "backlog",
        deadline: $("#newProdDeadline").value.trim() || "Sem prazo",
        source: "Manual"
      });
      saveState();
      closeModal();
      renderProduction();
      sound.success();
    };
  }

  function sendProductionToExecution(id) {
    const item = currentSave().production.find(i => i.id === id);
    if (!item) return;

    openModal(`
      <span class="eyebrow">PRODUCTION → EXECUTION</span>
      <h3>Preparar para Execução</h3>

      <div class="form-row">
        <div class="form-field">
          <label>RESPONSÁVEL</label>
          <input id="execAssignee" value="Deimox" />
        </div>
        <div class="form-field">
          <label>PRAZO</label>
          <input id="execDeadline" value="${esc(item.deadline === "Sem prazo" ? "3 dias" : item.deadline)}" />
        </div>
      </div>

      <div class="form-row full">
        <div class="form-field">
          <label>TAREFA</label>
          <textarea id="execText">${esc(item.text)}</textarea>
        </div>
      </div>

      <div class="modal-actions">
        <button class="hud-button" data-close>CANCELAR</button>
        <button id="confirmExecBtn" class="accent-button">CRIAR TAREFA →</button>
      </div>
    `);

    $("#confirmExecBtn").onclick = () => {
      currentSave().execution.push({
        id: crypto.randomUUID(),
        text: $("#execText").value.trim(),
        category: item.category,
        status: "todo",
        assignee: $("#execAssignee").value.trim() || "Unassigned",
        deadline: $("#execDeadline").value.trim() || "Sem prazo"
      });
      currentSave().production = currentSave().production.filter(x => x.id !== id);
      saveState();
      closeModal();
      renderProduction();
      sound.success();
      toast("<b>Entrou em Execução.</b> Agora tem dono e prazo.");
    };
  }

  // Execution
  function currentDept() {
    return $(".department.active")?.dataset.dept || "all";
  }

  function renderExecution(filter = "all") {
    const all = currentSave().execution;
    const items = filter === "all" ? all : all.filter(i => i.category === filter);
    const cols = [["todo", "TO DO"], ["doing", "IN PROGRESS"], ["done", "DONE"]];

    $("#executionBoard").innerHTML = cols.map(([key, label]) => `
      <section class="exec-col">
        <div class="exec-head"><span>${label}</span><span>${items.filter(i => i.status === key).length}</span></div>
        <div class="exec-stack">
          ${items.filter(i => i.status === key).map(item => `
            <article class="exec-card ${item.status === "done" ? "done" : ""}">
              <div class="exec-card-top">
                <span class="dept-badge">${categoryLabel(item.category)}</span>
                <span class="eyebrow">${esc(item.deadline || "")}</span>
              </div>
              <h4>${esc(item.text)}</h4>
              <div class="assignee">
                <span>@ ${esc(item.assignee || "Unassigned")}</span>
                <button data-advance="${item.id}">
                  ${item.status === "todo" ? "COMEÇAR →" : item.status === "doing" ? "CONCLUIR ✓" : "REABRIR ↺"}
                </button>
              </div>
            </article>
          `).join("")}
        </div>
      </section>
    `).join("");

    const done = all.filter(i => i.status === "done").length;
    const pct = all.length ? Math.round((done / all.length) * 100) : 0;
    $("#sprintProgress").style.width = pct + "%";
    $("#progressLabel").textContent = pct + "%";

    $$("[data-advance]").forEach(btn => {
      btn.onclick = () => {
        const item = all.find(i => i.id === btn.dataset.advance);
        if (!item) return;
        item.status = item.status === "todo" ? "doing" : item.status === "doing" ? "done" : "todo";
        saveState();
        renderExecution(currentDept());
        sound.success();
      };
    });
  }

  function newExecutionTask() {
    openModal(`
      <span class="eyebrow">EXECUTION</span>
      <h3>Nova Tarefa</h3>

      <div class="form-row">
        <div class="form-field">
          <label>SETOR</label>
          <select id="newExecCat">
            <option value="design">Game Design</option>
            <option value="art">Art / 3D</option>
            <option value="code">Programming</option>
            <option value="audio">Audio</option>
            <option value="lore">Narrative</option>
          </select>
        </div>
        <div class="form-field">
          <label>RESPONSÁVEL</label>
          <input id="newExecWho" value="Deimox" />
        </div>
      </div>

      <div class="form-row full">
        <div class="form-field">
          <label>TAREFA</label>
          <textarea id="newExecText"></textarea>
        </div>
      </div>

      <div class="modal-actions">
        <button class="hud-button" data-close>CANCELAR</button>
        <button id="confirmNewExecBtn" class="accent-button">CRIAR</button>
      </div>
    `);

    $("#confirmNewExecBtn").onclick = () => {
      const text = $("#newExecText").value.trim();
      if (!text) return;
      currentSave().execution.push({
        id: crypto.randomUUID(),
        text,
        category: $("#newExecCat").value,
        status: "todo",
        assignee: $("#newExecWho").value.trim() || "Unassigned",
        deadline: "Sem prazo"
      });
      saveState();
      closeModal();
      renderExecution(currentDept());
      sound.success();
    };
  }

  // Pause / settings
  function pauseMenu() {
    if (state.currentScreen === "saves") return;
    $("#pauseMenu").classList.remove("hidden");
    sound.click();
  }

  function resumeMenu() {
    $("#pauseMenu").classList.add("hidden");
    sound.click();
  }

  function openSettings() {
    openModal(`
      <span class="eyebrow">CONFIG</span>
      <h3>Configurações</h3>
      <p>Atalhos rápidos de estágio já estão ativos: Alt + 1, Alt + 2 e Alt + 3.</p>

      <div class="form-row full">
        <div class="form-field">
          <label>NOME DO SAVE</label>
          <input id="renameSaveInput" value="${esc(currentSave().name)}" />
        </div>
      </div>

      <div class="modal-actions">
        <button id="resetAppBtn" class="hud-button">RESETAR</button>
        <button id="saveSettingsBtn" class="accent-button">SALVAR</button>
      </div>
    `);

    $("#saveSettingsBtn").onclick = () => {
      currentSave().name = $("#renameSaveInput").value.trim() || currentSave().name;
      saveState();
      renderSaves();
      renderHub();
      closeModal();
      sound.success();
    };

    $("#resetAppBtn").onclick = () => {
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    };
  }

  // Events
  $("#newSaveBtn").onclick = createSaveModal;
  $("#openSaveBtn").onclick = openSelectedSave;
  $("#soundToggle").onclick = () => {
    state.sound = !state.sound;
    $("#soundToggle").textContent = `SOM: ${state.sound ? "ON" : "OFF"}`;
    saveState();
    if (state.sound) sound.click();
  };

  $("#saveList").addEventListener("scroll", updateSaveScale, { passive: true });
  $$("[data-nav='saves']").forEach(b => b.onclick = () => go("saves"));
  $$("[data-nav='hub']").forEach(b => b.onclick = () => go("hub"));

  $("#hubMenuBtn").onclick = pauseMenu;
  $("#workMenuBtn").onclick = pauseMenu;

  $("[data-pause-action='resume']").onclick = resumeMenu;
  $("[data-pause-action='hub']").onclick = () => { resumeMenu(); go("hub"); };
  $("[data-pause-action='saves']").onclick = () => { resumeMenu(); go("saves"); };
  $("[data-pause-action='settings']").onclick = () => { resumeMenu(); openSettings(); };

  $("#newDocBtn").onclick = newDoc;
  $("#sendSelectionBtn").onclick = sendSelectionToProduction;
  $("#newProdBtn").onclick = newProductionCard;
  $("#newExecBtn").onclick = newExecutionTask;

  $("#docTitle").addEventListener("input", () => {
    currentDoc().title = $("#docTitle").value;
    $("#saveIndicator").textContent = "SALVANDO...";
    clearTimeout(window.__saveDocTitle);
    window.__saveDocTitle = setTimeout(() => {
      saveState();
      renderVision();
    }, 350);
  });

  $("#visionEditor").addEventListener("input", () => {
    currentDoc().content = $("#visionEditor").value;
    $("#markdownPreview").innerHTML = renderMarkdown(currentDoc().content);
    $("#saveIndicator").textContent = "SALVANDO...";
    clearTimeout(window.__saveEditor);
    window.__saveEditor = setTimeout(saveState, 300);
  });

  $("#visionEditor").addEventListener("mouseup", captureSelection);
  $("#visionEditor").addEventListener("keyup", captureSelection);

  $("#docStatusSelect").onchange = () => {
    currentDoc().status = $("#docStatusSelect").value;
    paintStatus(currentDoc().status);
    saveState();
    renderVision();
  };

  $$("[data-editor-mode]").forEach(btn => {
    btn.onclick = () => setEditorMode(btn.dataset.editorMode);
  });

  $$(".markdown-toolbar button").forEach(btn => {
    btn.onclick = () => {
      const ta = $("#visionEditor");
      const mark = btn.dataset.md;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const selected = ta.value.slice(start, end);
      const replacement = (mark === "**" || mark === "*") ? `${mark}${selected}${mark}` : `${mark}${selected}`;
      ta.setRangeText(replacement, start, end, "end");
      ta.dispatchEvent(new Event("input"));
      ta.focus();
    };
  });

  $("#visionEditor").addEventListener("contextmenu", e => {
    const txt = captureSelection();
    if (!txt) return;
    e.preventDefault();
    const menu = $("#contextMenu");
    menu.classList.remove("hidden");
    menu.style.left = Math.min(e.clientX, innerWidth - 230) + "px";
    menu.style.top = Math.min(e.clientY, innerHeight - 150) + "px";
  });

  document.addEventListener("click", e => {
    if (!e.target.closest("#contextMenu")) $("#contextMenu").classList.add("hidden");
  });

  $("#contextMenu").addEventListener("click", e => {
    const action = e.target.dataset.action;
    if (!action) return;
    if (action === "send-production") sendSelectionToProduction();
    if (action === "mark-canon") {
      currentDoc().status = "canon";
      saveState();
      renderVision();
      toast("<b>Canônico.</b> Agora virou lei do universo.");
    }
    if (action === "copy") navigator.clipboard?.writeText(state.selectionText);
    $("#contextMenu").classList.add("hidden");
  });

  $$(".department").forEach(btn => {
    btn.onclick = () => {
      $$(".department").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderExecution(btn.dataset.dept);
      sound.click();
    };
  });

  $("#modalClose").onclick = closeModal;
  $("#modalBackdrop").onclick = e => {
    if (e.target === $("#modalBackdrop")) closeModal();
  };

  document.addEventListener("keydown", e => {
    const modalOpen = !$("#modalBackdrop").classList.contains("hidden");
    const pauseOpen = !$("#pauseMenu").classList.contains("hidden");

    if (e.key === "Escape") {
      if (modalOpen) return closeModal();
      if (pauseOpen) return resumeMenu();
      return pauseMenu();
    }

    if (modalOpen || pauseOpen) return;

    if ((e.altKey) && ["1","2","3"].includes(e.key) && state.currentScreen === "work") {
      e.preventDefault();
      const stage = STAGES[Number(e.key) - 1];
      if (stage) {
        state.currentStage = stage;
        openStage(stage);
        sound.enter();
      }
    }

    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "p" && state.currentScreen === "work" && state.currentStage === "vision") {
      e.preventDefault();
      sendSelectionToProduction();
    }

    if (e.key === "Enter" && state.currentScreen === "saves") {
      e.preventDefault();
      openSelectedSave();
    }

    if (e.key.toLowerCase() === "n" && state.currentScreen === "saves") {
      e.preventDefault();
      createSaveModal();
    }
  });

  // particles
  const canvas = $("#particleCanvas");
  const ctx = canvas.getContext("2d");
  let particles = [];

  function resizeCanvas() {
    canvas.width = innerWidth * devicePixelRatio;
    canvas.height = innerHeight * devicePixelRatio;
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  function seedParticles() {
    particles = Array.from({ length: 52 }, () => ({
      x: Math.random() * innerWidth,
      y: Math.random() * innerHeight,
      r: Math.random() * 1.1 + .2,
      vx: (Math.random() - .5) * .08,
      vy: (Math.random() - .5) * .08,
      a: Math.random() * .2 + .03
    }));
  }

  function animateParticles() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = innerWidth;
      if (p.x > innerWidth) p.x = 0;
      if (p.y < 0) p.y = innerHeight;
      if (p.y > innerHeight) p.y = 0;
      ctx.beginPath();
      ctx.fillStyle = `rgba(182,210,232,${p.a})`;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(animateParticles);
  }

  addEventListener("resize", () => {
    resizeCanvas();
    seedParticles();
  });

  // Boot
  loadState();
  $("#soundToggle").textContent = `SOM: ${state.sound ? "ON" : "OFF"}`;
  renderSaves();
  renderHub();
  resizeCanvas();
  seedParticles();
  animateParticles();
  centerSelectedSave();
})();

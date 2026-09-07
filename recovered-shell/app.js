import {
  CATEGORIES, DOC_STATUSES, EXEC_COLUMNS, PRIORITIES, PROD_COLUMNS, STAGES,
  addHistory, categoryLabel, createProject, createVisionHandoff, now, productionItem, productionTitle, productionContent,
  sourceState, statusLabel, task, uid, migrateProject, eligibleMembers, assignMember, saveMember, removeMember
} from "./src/domain.js";
import { downloadProject, importProject, loadWorkspace, saveWorkspace } from "./src/storage.js";
import { htmlToMarkdown, renderMarkdown } from "./src/markdown.js";
import { api, Collaboration, connectionLink, readConnectionLink } from "./src/collaboration.js";

// BEGIN VISION UI — self-contained so existing local hosts need no restart.
// The popup is UI only: it never inserts selection markup into the document.
function selectionLineRect(rects) {
  const visible = [...rects].filter(rect => rect.width > 0 && rect.height > 0);
  const last = visible.at(-1);
  if (!last) return null;
  const line = visible.filter(rect => Math.abs(rect.bottom - last.bottom) < 3);
  return {left:Math.min(...line.map(rect => rect.left)), right:Math.max(...line.map(rect => rect.right)), top:Math.min(...line.map(rect => rect.top)), bottom:Math.max(...line.map(rect => rect.bottom))};
}
function selectionMenuPlacement(anchor, bounds, size) {
  const gap = 14, inset = 8;
  if (anchor.bottom <= bounds.top || anchor.top >= bounds.bottom || anchor.right < bounds.left || anchor.left > bounds.right) return null;
  const left = Math.max(bounds.left + inset, Math.min(anchor.left, bounds.right - size.width - inset));
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - size.height;
  const side = below + size.height <= bounds.bottom - inset || above < bounds.top + inset ? 'below' : 'above';
  const top = Math.max(bounds.top + inset, Math.min(side === 'below' ? below : above, bounds.bottom - size.height - inset));
  return {left, top, side, notch: Math.max(18, Math.min(anchor.left + Math.min(120, (anchor.right - anchor.left) / 2) - left, size.width - 18))};
}

// Textareas expose offsets, not a Range. A hidden mirror measures the last selected
// line with the exact same wrapping, typography and scroll offsets as the editor.
function markdownSelectionRect(editor) {
  const doc = editor.ownerDocument, view = doc.defaultView;
  const bounds = editor.getBoundingClientRect(), style = view.getComputedStyle(editor);
  const mirror = doc.createElement('div');
  for (const property of ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','wordSpacing','textTransform','textIndent','tabSize','paddingTop','paddingBottom','paddingLeft','paddingRight','direction']) mirror.style[property] = style[property];
  Object.assign(mirror.style, {position:'fixed',left:`${bounds.left + editor.clientLeft}px`,top:`${bounds.top + editor.clientTop - editor.scrollTop}px`,width:`${editor.clientWidth}px`,boxSizing:'border-box',whiteSpace:'pre-wrap',overflowWrap:'break-word',visibility:'hidden',pointerEvents:'none'});
  mirror.setAttribute('aria-hidden', 'true');
  const end = editor.selectionEnd, start = Math.max(editor.selectionStart, editor.value.lastIndexOf('\n', end - 1) + 1);
  mirror.appendChild(doc.createTextNode(editor.value.slice(0, start)));
  const marker = doc.createElement('span');
  marker.textContent = editor.value.slice(start, end) || '\u200b';
  mirror.appendChild(marker); doc.body.appendChild(mirror);
  try {
    const rects = [...marker.getClientRects()];
    const rect = rects.at(-1) || marker.getBoundingClientRect();
    return {left:rect.left - editor.scrollLeft, right:rect.right - editor.scrollLeft, top:rect.top, bottom:rect.bottom};
  } finally { mirror.remove(); }
}

function createVisionSelection({visual, markdown, menu, getMode, isActive, capture, clear}) {
  const doc = visual.ownerDocument, view = doc.defaultView;
  const editors = [visual, markdown];
  let dragging = false, dismissed = true, queued = false;
  const editor = () => getMode() === 'markdown' ? markdown : visual;
  function hide(reset = true) {
    menu.classList.add('hidden');
    dismissed = true;
    if (reset) clear();
  }
  function refresh() {
    if (dragging || dismissed) return;
    if (!isActive()) { hide(); return; }
    if (menu.contains(doc.activeElement)) return;
    if (!capture()) { hide(); return; }
    const target = editor(), viewport = target.getBoundingClientRect();
    let anchor;
    if (target === markdown) anchor = markdownSelectionRect(markdown);
    else {
      const selection = view.getSelection();
      if (!selection?.rangeCount || !visual.contains(selection.anchorNode) || !visual.contains(selection.focusNode)) { hide(); return; }
      anchor = selectionLineRect(selection.getRangeAt(0).getClientRects());
    }
    if (!anchor) { hide(); return; }
    const vv = view.visualViewport;
    const bounds = {left:Math.max(viewport.left, vv?.offsetLeft || 0), right:Math.min(viewport.right, (vv?.offsetLeft || 0) + (vv?.width || view.innerWidth)), top:Math.max(viewport.top, vv?.offsetTop || 0), bottom:Math.min(viewport.bottom, (vv?.offsetTop || 0) + (vv?.height || view.innerHeight))};
    // Measure without flashing at an old position. A scroll out of view hides the
    // action but retains the selection, so it can reappear when scrolled back.
    menu.style.visibility = 'hidden';
    menu.classList.remove('hidden');
    menu.style.maxWidth = `${Math.max(0, bounds.right - bounds.left - 16)}px`;
    const position = selectionMenuPlacement(anchor, bounds, {width:menu.offsetWidth, height:menu.offsetHeight});
    if (!position) { menu.classList.add('hidden'); menu.style.visibility = ''; return; }
    menu.style.left = `${position.left}px`; menu.style.top = `${position.top}px`;
    menu.style.setProperty('--selection-notch', `${position.notch}px`);
    menu.dataset.side = position.side;
    menu.style.visibility = '';
  }
  function schedule() {
    if (queued) return;
    queued = true;
    view.requestAnimationFrame(() => { queued = false; refresh(); });
  }
  function reveal() { dismissed = false; refresh(); }
  for (const target of editors) {
    target.addEventListener('pointerdown', () => { dragging = true; hide(); });
    target.addEventListener('keyup', event => { if (!['Escape','Tab','Control','Meta','Alt'].includes(event.key)) reveal(); });
    target.addEventListener('select', () => { if (!dragging && doc.activeElement === target) { dismissed = false; schedule(); } });
    target.addEventListener('input', () => hide());
    target.addEventListener('scroll', schedule, {passive:true});
    target.addEventListener('contextmenu', event => {
      if (!isActive() || !capture()) return;
      event.preventDefault(); dragging = false; reveal();
      if (event.button === 0) menu.querySelector('button').focus({preventScroll:true});
    });
    // Tab after a selection reaches the contextual action without traversing the
    // entire page. Shift+Tab from it returns to the editor, preserving selection.
    target.addEventListener('keydown', event => {
      if (event.key === 'Tab' && !event.shiftKey && !menu.classList.contains('hidden')) { event.preventDefault(); menu.querySelector('button').focus({preventScroll:true}); }
    });
  }
  menu.addEventListener('pointerdown', event => event.preventDefault());
  menu.addEventListener('keydown', event => {
    if (event.key === 'Tab' && event.shiftKey) { event.preventDefault(); editor().focus({preventScroll:true}); }
  });
  doc.addEventListener('pointerup', () => { if (dragging) { dragging = false; reveal(); } });
  doc.addEventListener('pointercancel', () => { dragging = false; hide(); });
  doc.addEventListener('pointerdown', event => {
    if (!menu.contains(event.target) && !editors.some(target => target.contains(event.target))) hide();
  });
  doc.addEventListener('selectionchange', schedule);
  doc.addEventListener('focusin', event => {
    if (!menu.contains(event.target) && !editors.includes(event.target)) hide();
  });
  view.addEventListener('resize', schedule);
  view.visualViewport?.addEventListener('resize', schedule);
  view.visualViewport?.addEventListener('scroll', schedule);
  return {hide, refresh, reveal, focusEditor: () => editor().focus({preventScroll:true})};
}
// END VISION UI

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const workspace = loadWorkspace();
const state = {
  ...workspace,
  activeDocId: null,
  currentScreen: "saves",
  currentStage: "vision",
  hubSelectedStage: "production",
  productionFilter: "all",
  activeProductionId: null,
  activeTaskId: null,
  editorMode: "live",
  selectionText: "",
  department: "all",
  saveTimer: null,
  scrollFrame: null,
  wheelDelta: 0,
  wheelLocked: false,
  wheelResetTimer: null
};
let localSnapshot = null;
let pendingDocumentCommit = null;
let visionSelection = null;
let visionRenderedDocId = null;
let visionAnimations = [];
const collaboration = new Collaboration({
  onStatus: updateConnectionStatus,
  onRemote: applyRemoteProject,
  canApply: () => !state.saveTimer && $("#modalBackdrop").classList.contains("hidden") && !document.activeElement?.closest('#liveEditor, #visionEditor, #docTitle')
});

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function currentProject() {
  return state.projects.find(project => project.id === state.activeProjectId) || state.projects[0];
}
function selectedProject() {
  return state.projects.find(project => project.id === state.selectedProjectId) || state.projects[0];
}
function currentDoc() {
  return currentProject()?.docs.find(doc => doc.id === state.activeDocId) || currentProject()?.docs[0];
}
function optionList(items, selected) {
  return items.map(([value, label]) => `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(label)}</option>`).join("");
}

function persist() {
  if (collaboration.active) { collaboration.queue(currentProject()); updateConnectionStatus(collaboration.status); return; }
  saveWorkspace({ projects: state.projects, selectedProjectId: state.selectedProjectId, activeProjectId: state.activeProjectId });
  const indicator = $("#saveIndicator");
  if (indicator) indicator.textContent = navigator.onLine ? "SALVO · LOCAL" : "SALVO · OFFLINE";
}
function schedulePersist(callback) {
  const indicator = $("#saveIndicator");
  if (indicator) indicator.textContent = "SALVANDO...";
  clearTimeout(state.saveTimer);
  pendingDocumentCommit = callback;
  state.saveTimer = setTimeout(flushDocumentEdit, 340);
}
function flushDocumentEdit() {
  clearTimeout(state.saveTimer); state.saveTimer = null;
  const callback = pendingDocumentCommit; pendingDocumentCommit = null;
  callback?.(); persist();
}
function toast(message) {
  const element = document.createElement("div");
  element.className = "toast";
  element.innerHTML = message;
  $("#toastHost").appendChild(element);
  setTimeout(() => { element.classList.add("leaving"); setTimeout(() => element.remove(), 240); }, 2600);
}
let modalReturnFocus = null;
let pauseReturnFocus = null;
let productionEditor = null;
function syncOverlayFocus() {
  const modalOpen = !$("#modalBackdrop").classList.contains("hidden");
  $("#app").inert = modalOpen || !$("#pauseMenu").classList.contains("hidden");
  $("#pauseMenu").inert = modalOpen;
}
function openModal(html, className = "") {
  const contextualReturn = document.activeElement?.closest("#contextMenu") ? $(state.editorMode === "markdown" ? "#visionEditor" : "#liveEditor") : null;
  visionSelection?.hide();
  productionEditor?.dispose();
  productionEditor = null;
  $("#modalBackdrop").classList.remove("production-editor-backdrop", "editor-focus-backdrop");
  if ($("#modalBackdrop").classList.contains("hidden")) modalReturnFocus = contextualReturn || document.activeElement;
  $("#modalContent").innerHTML = html;
  $("#modal").className = `modal ${className.includes("save-create-modal") ? "" : "system-modal"} ${className}`.trim();
  const title = $("#modalContent h3");
  if (title) { title.id = "modalTitle"; title.tabIndex = -1; }
  $("#modal").scrollTop = 0;
  $("#contextMenu").classList.add("hidden");
  $("#modalBackdrop").classList.remove("hidden");
  syncOverlayFocus();
  $$('[data-close]').forEach(button => button.onclick = closeModal);
  requestAnimationFrame(() => { if (title?.isConnected && !$("#modalBackdrop").classList.contains("hidden")) title.focus({ preventScroll: true }); });
  sound.play("ui_open");
}
function closeModal(force = false) {
  if (force !== true && productionEditor?.requestClose()) return;
  productionEditor?.dispose();
  productionEditor = null;
  $("#modalBackdrop").classList.remove("production-editor-backdrop", "editor-focus-backdrop");
  $("#modalBackdrop").classList.add("hidden");
  $("#modal").className = "modal";
  syncOverlayFocus();
  if (modalReturnFocus?.isConnected && !modalReturnFocus.closest(".hidden")) modalReturnFocus.focus({ preventScroll: true });
  modalReturnFocus = null;
  sound.play("ui_close");
}

function handleModalBackdropClick(event) {
  // An onclick handler returning false cancels native checkbox/label activation.
  // Only dismiss direct background clicks; leave child controls' defaults intact.
  if (event.target === $("#modalBackdrop") && !productionEditor) closeModal();
}

let audioContext;
function tone(frequency, duration, type, gain) {
  const settings = currentProject()?.settings;
  if (!settings?.sound) return;
  const AudioEngine = window.AudioContext || window.webkitAudioContext;
  if (!AudioEngine) return;
  try {
    audioContext ||= new AudioEngine();
    const oscillator = audioContext.createOscillator();
    const envelope = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
    envelope.gain.setValueAtTime(gain * Number(settings.volume ?? 0.65), audioContext.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
    oscillator.connect(envelope).connect(audioContext.destination);
    oscillator.start(); oscillator.stop(audioContext.currentTime + duration);
  } catch {
    audioContext = null;
  }
}
const sound = {
  play(event) {
    const sounds = {
      ui_hover: [720, .025, "sine", .008], ui_click: [390, .05, "triangle", .018],
      ui_back: [280, .07, "sine", .016], ui_open: [480, .06, "sine", .016],
      ui_close: [330, .05, "sine", .012], ui_confirm: [660, .08, "sine", .018],
      ui_drag_start: [250, .04, "triangle", .014], ui_drag_drop: [560, .07, "triangle", .018],
      ui_error: [180, .12, "sawtooth", .012], ui_notification: [760, .07, "sine", .014]
    };
    tone(...(sounds[event] || sounds.ui_click));
  }
};

function go(screen) {
  visionSelection?.hide();
  if (state.saveTimer) flushDocumentEdit();
  if (state.currentScreen === screen) return;
  $$(".screen").forEach(panel => panel.classList.remove("active"));
  $(({ saves: "#saveScreen", hub: "#hubScreen", work: "#workScreen" })[screen]).classList.add("active");
  state.currentScreen = screen;
  if (screen === "saves") { renderSaves(); centerSelectedSave(); }
  if (screen === "hub") renderHub();
  if (screen === "work") openStage(state.currentStage);
  sound.play(screen === "saves" ? "ui_back" : "ui_confirm");
}

function renderSaves() {
  const emptySlot = `
    <button class="save-placeholder" tabindex="-1" aria-label="Criar novo Save">
      <strong>EMPTY SLOT</strong><small>CRIAR NOVO SAVE</small>
    </button>`;
  const projectSlots = state.projects.map(project => `
    <button class="save-slot ${project.id === state.selectedProjectId ? "active" : ""}" data-id="${project.id}" role="option" aria-selected="${project.id === state.selectedProjectId}">
      <strong>${esc(project.name)}</strong>
      <small class="save-slot-meta">
        <span>VISÃO <b>${project.docs.length}</b></span>
        <i></i>
        <span>PRODUÇÃO <b>${project.production.length}</b></span>
        <i></i>
        <span>EXECUÇÃO <b>${project.execution.length}</b></span>
      </small>
    </button>`).join("");
  $("#saveList").innerHTML = `<div class="save-list-track">${projectSlots}${emptySlot}</div>`;
  $$("#saveList .save-slot").forEach(button => {
    button.onclick = () => selectSave(button.dataset.id, true);
    button.ondblclick = openSelectedSave;
    button.onmouseenter = () => sound.play("ui_hover");
  });
  $$("#saveList .save-placeholder").forEach(button => button.onclick = createSaveModal);
  renderSavePreview();
  updateDeleteSaveAction();
  requestAnimationFrame(() => {
    updateSaveScale();
    centerSelectedSave(false);
  });
}
function selectSave(id, center = false) {
  state.selectedProjectId = id;
  $$("#saveList .save-slot").forEach(button => {
    const active = button.dataset.id === id;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  renderSavePreview(); persist();
  updateSaveScale();
  if (center) centerSelectedSave(true);
  sound.play("ui_click");
}
function renderSavePreview() {
  const project = selectedProject();
  if (!project) return;
  $("#saveScreen").dataset.selectedName = project.name;
  $("#openSaveBtn").setAttribute("aria-label", `Abrir Save ${project.name}`);
  updateDeleteSaveAction();
}
function updateDeleteSaveAction() {
  const button = $("#deleteSelectedSaveBtn");
  if (!button) return;
  const locked = state.projects.length <= 1;
  button.disabled = locked;
  button.title = locked ? "Crie outro Save antes de excluir este" : `Excluir ${selectedProject()?.name || "Save"}`;
  button.setAttribute("aria-label", button.title);
}
function updateSaveScale() {
  const selectedIndex = Math.max(0, state.projects.findIndex(project => project.id === state.selectedProjectId));
  $$("#saveList .save-slot").forEach((element, index) => {
    const distance = Math.min(3, Math.abs(index - selectedIndex));
    const ratio = distance / 3;
    element.style.setProperty("--save-scale", String(1 - distance * .055));
    element.style.setProperty("--save-distance", ratio.toFixed(3));
    element.style.opacity = String(Math.max(.24, 1 - distance * .24));
  });
}
function navigateSave(direction) {
  const index = state.projects.findIndex(project => project.id === state.selectedProjectId);
  const nextIndex = Math.max(0, Math.min(state.projects.length - 1, index + direction));
  if (nextIndex === index || !state.projects[nextIndex]) return;
  selectSave(state.projects[nextIndex].id, true);
}
function centerSelectedSave(animate = true) {
  const track = $("#saveList .save-list-track");
  const active = $("#saveList .save-slot.active");
  if (!track || !active) return;
  track.classList.toggle("no-transition", !animate || currentProject()?.settings.reducedMotion);
  const center = active.offsetTop + active.offsetHeight / 2;
  track.style.transform = `translate3d(0, ${-center}px, 0)`;
  if (!animate) requestAnimationFrame(() => track.classList.remove("no-transition"));
}
function openSelectedSave() {
  const project = selectedProject();
  if (!project) return;
  state.activeProjectId = project.id;
  state.activeDocId = project.docs[0]?.id || null;
  persist(); go("hub");
}
function createSaveModal() {
  if (collaboration.active) return toast("Saia da sessão compartilhada para criar outro Save local.");
  openModal(`
    <form id="newSaveForm" class="save-create-form" autocomplete="off">
      <header class="save-create-head">
        <span class="save-create-mark">GF</span>
        <span class="eyebrow">NEW SAVE</span>
        <h3>Nomeie seu novo mundo.</h3>
        <p>Você poderá alterar esse nome depois.</p>
      </header>
      <label class="save-name-field" for="newSaveName">
        <span>NOME DO PROJETO</span>
        <input id="newSaveName" name="saveName" maxlength="80" placeholder="UNTITLED PROJECT" spellcheck="false">
        <i aria-hidden="true"></i>
      </label>
      <div class="save-create-actions">
        <button type="button" class="save-modal-cancel" data-close>CANCELAR <kbd>ESC</kbd></button>
        <button id="confirmSaveBtn" type="submit" class="save-modal-confirm">CRIAR SAVE <kbd>ENTER</kbd></button>
      </div>
    </form>`, "save-create-modal");
  const create = () => {
    const project = createProject($("#newSaveName").value.trim() || "Untitled Save", false);
    state.projects.push(project); state.selectedProjectId = project.id; state.activeProjectId = project.id; state.activeDocId = project.docs[0].id;
    persist(); closeModal(); renderSaves(); centerSelectedSave();
    toast("<b>Save criado.</b> Tudo pronto para definir a Visão.");
  };
  $("#newSaveForm").onsubmit = event => {
    event.preventDefault();
    create();
  };
  $("#confirmSaveBtn").onclick = event => {
    event.preventDefault();
    create();
  };
  $("#newSaveName").addEventListener("keydown", event => {
    if (!["Escape", "Tab"].includes(event.key)) event.stopPropagation();
  });
  requestAnimationFrame(() => $("#newSaveName")?.focus({ preventScroll: true }));
}

function openDeleteSaveModal(project = selectedProject()) {
  if (collaboration.active) return toast("O Save compartilhado fica no host. Use Conexão para sair e guardar uma cópia.");
  if (!project || state.projects.length <= 1) {
    toast("<b>Este é seu único Save.</b> Crie outro antes de excluí-lo.");
    sound.play("ui_error");
    return;
  }
  openModal(`
    <div class="save-create-form save-delete-form">
      <header class="save-create-head">
        <span class="save-create-mark save-delete-mark">!</span>
        <span class="eyebrow">DELETE SAVE</span>
        <h3>Excluir “${esc(project.name)}”?</h3>
        <p>O Save e todo o conteúdo dele serão removidos deste dispositivo.</p>
      </header>
      <div class="save-delete-summary" aria-label="Conteúdo do Save">
        <span>VISÃO <b>${project.docs.length}</b></span>
        <i></i>
        <span>PRODUÇÃO <b>${project.production.length}</b></span>
        <i></i>
        <span>EXECUÇÃO <b>${project.execution.length}</b></span>
      </div>
      <div class="save-create-actions">
        <button type="button" class="save-modal-cancel" data-close>CANCELAR <kbd>ESC</kbd></button>
        <button id="confirmDeleteSaveBtn" type="button" class="save-modal-delete">EXCLUIR SAVE</button>
      </div>
    </div>`, "save-create-modal save-delete-modal");
  $("#confirmDeleteSaveBtn").onclick = () => deleteSave(project);
}

function deleteSave(project) {
  const deletedIndex = state.projects.findIndex(candidate => candidate.id === project.id);
  if (deletedIndex < 0 || state.projects.length <= 1) return;
  state.projects.splice(deletedIndex, 1);
  const fallback = state.projects[Math.min(deletedIndex, state.projects.length - 1)] || state.projects[0];
  state.selectedProjectId = fallback.id;
  if (state.activeProjectId === project.id) state.activeProjectId = fallback.id;
  state.activeDocId = currentProject()?.docs[0]?.id || null;
  persist();
  closeModal();
  $("#pauseMenu").classList.add("hidden");
  if (state.currentScreen === "saves") {
    renderSaves();
    centerSelectedSave();
  } else {
    go("saves");
  }
  toast(`<b>Save excluído.</b> “${esc(project.name)}” foi removido deste dispositivo.`);
}

function renderHub() { selectHubStage(state.hubSelectedStage || "production", false); }
function selectHubStage(stage, focus = false) {
  state.hubSelectedStage = stage;
  $("#stageCards")?.setAttribute("data-selected", stage);
  $$(".stage-choice").forEach(choice => {
    const selected = choice.dataset.stage === stage;
    choice.classList.toggle("selected", selected);
    choice.setAttribute("aria-selected", String(selected));
    if (selected && focus) choice.focus({ preventScroll: true });
  });
}
function launchHubStage(card) {
  if (!card) return;
  selectHubStage(card.dataset.stage);
  card.classList.add("launching");
  $("#stageCards").classList.add("launching");
  state.currentStage = card.dataset.stage;
  setTimeout(() => {
    card.classList.remove("launching");
    $("#stageCards").classList.remove("launching");
    go("work");
  }, currentProject()?.settings.reducedMotion ? 0 : 220);
}
function prepareStageCards() {
  $$(".stage-choice").forEach(card => {
    card.onmouseenter = () => { selectHubStage(card.dataset.stage); sound.play("ui_hover"); };
    card.onfocus = () => selectHubStage(card.dataset.stage);
    card.onclick = () => launchHubStage(card);
  });
}
function openStage(stage) {
  visionSelection?.hide();
  if (state.saveTimer) flushDocumentEdit();
  state.currentStage = stage;
  document.body.dataset.stage = stage;
  $$(".work-panel").forEach(panel => panel.classList.add("hidden"));
  $(`#${stage}Panel`).classList.remove("hidden"); updateStageRail();
  if (stage === "vision") renderVision();
  if (stage === "production") renderProduction();
  if (stage === "execution") renderExecution();
}
function updateStageRail() {
  $("#workStageRail").dataset.active = state.currentStage;
  $$('[data-work-stage]').forEach(button => {
    const active = button.dataset.workStage === state.currentStage;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $$('[data-stage-node]').forEach(node => node.classList.toggle("active", node.dataset.stageNode === state.currentStage));
}

function ensureDocument() {
  const project = currentProject();
  if (!project.docs.length) {
    const doc = createProject(project.name, false).docs[0]; doc.projectId = project.id; project.docs.push(doc);
  }
  if (!project.docs.some(doc => doc.id === state.activeDocId)) state.activeDocId = project.docs[0].id;
}
function renderVision() {
  ensureDocument();
  visionSelection?.hide();
  state.selectionText = "";
  $("#selectionInfo").textContent = "";
  renderDocumentList();
  const doc = currentDoc();
  const changed = visionRenderedDocId !== doc.id;
  visionRenderedDocId = doc.id;
  $("#docTitle").value = doc.title; $("#visionEditor").value = doc.markdown;
  $("#liveEditor").innerHTML = renderMarkdown(doc.markdown); paintDocumentStatus(doc.status); setEditorMode(state.editorMode, false);
  if (changed) {
    $("#liveEditor").scrollTop = 0; $("#visionEditor").scrollTop = 0;
    animateVisionDocument();
  }
}
function renderDocumentList() {
  const project = currentProject();
  $("#docList").innerHTML = project.docs.map(doc => `<button class="doc-item ${doc.id === state.activeDocId ? "active" : ""}" data-id="${doc.id}" aria-current="${doc.id === state.activeDocId ? "page" : "false"}" aria-label="${esc(doc.title)} · ${statusLabel(doc.status)}"><i aria-hidden="true"></i><span>${esc(doc.title)}</span></button>`).join("");
  $$("#docList .doc-item").forEach(button => button.onclick = () => {
    if (button.dataset.id === state.activeDocId) return;
    if (state.saveTimer) flushDocumentEdit();
    state.activeDocId = button.dataset.id; renderVision();
    $$("#docList .doc-item").find(item => item.dataset.id === state.activeDocId)?.focus({preventScroll:true});
    sound.play("ui_click");
  });
}
function animateVisionDocument() {
  visionAnimations.forEach(animation => animation.cancel()); visionAnimations = [];
  if (document.documentElement.classList.contains("reduced-motion") || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const animate = (selector, frames, options) => {
    const element = $(selector);
    if (element?.animate) visionAnimations.push(element.animate(frames, options));
  };
  animate("#visionPanel .editor-surface", [{opacity:.35, transform:"translateY(5px)"}, {opacity:1, transform:"translateY(0)"}], {duration:240, easing:"ease-out"});
  animate("#visionPanel .vision-title-rule", [{clipPath:"inset(-12px 50% -12px 50%)"}, {clipPath:"inset(-12px 0% -12px 0%)"}], {duration:440, easing:"cubic-bezier(.22,1,.36,1)"});
  animate("#visionPanel .vision-title-rule circle", [{opacity:0}, {opacity:1}], {duration:180, delay:320, fill:"backwards"});
}
function paintDocumentStatus(status) {
  $("#docStatus").className = `doc-state-control ${status}`;
  $("#docStatusSelect").value = status;
}
function setEditorMode(mode, sync = true) {
  visionSelection?.hide();
  // Live input already updates the Markdown. Merely viewing another mode must
  // not normalize an untouched document or create a revision.
  if (sync && state.editorMode === "live" && mode === "markdown") $("#visionEditor").value = currentDoc().markdown;
  if (sync && state.editorMode === "markdown" && mode === "live") syncMarkdownToLive();
  state.editorMode = mode;
  $$("[data-editor-mode]").forEach(button => button.classList.toggle("active", button.dataset.editorMode === mode));
  $("#liveEditor").classList.toggle("hidden", mode !== "live"); $("#visionEditor").classList.toggle("hidden", mode !== "markdown");
}
function syncLiveToMarkdown() {
  currentDoc().markdown = htmlToMarkdown($("#liveEditor")); $("#visionEditor").value = currentDoc().markdown;
}
function syncMarkdownToLive() {
  currentDoc().markdown = $("#visionEditor").value; $("#liveEditor").innerHTML = renderMarkdown(currentDoc().markdown);
}
function commitDocumentEdit(label = "Documento editado") {
  const doc = currentDoc(); doc.revision += 1; doc.updatedAt = now();
  addHistory(currentProject(), "DOC_UPDATED", `${label}: “${doc.title}” (R${doc.revision})`);
}
function captureSelection() {
  let text = "";
  if (state.editorMode === "markdown") {
    const editor = $("#visionEditor"); text = editor.value.slice(editor.selectionStart, editor.selectionEnd).trim();
  } else {
    const selection = getSelection();
    if (selection?.rangeCount && $("#liveEditor").contains(selection.anchorNode) && $("#liveEditor").contains(selection.focusNode)) text = selection.toString().trim();
  }
  state.selectionText = text;
  $("#selectionInfo").textContent = text ? "Trecho selecionado. Enviar para Produção: Ctrl ou Command, Shift e P." : "";
  return text;
}
function sendSelectionToProduction() {
  const previousSelection = state.selectionText;
  const selected = captureSelection() || previousSelection;
  if (!selected) { toast("<b>Nada selecionado.</b> Marque um trecho primeiro."); sound.play("ui_error"); return; }
  if (state.saveTimer) flushDocumentEdit();
  const project = currentProject();
  const doc = { ...currentDoc() };
  const creativeStatuses = ["draft", "canon", "probable", "experiment", "deprecated"].map(key => [key, DOC_STATUSES[key]]);
  openModal(`<span class="eyebrow">VISÃO <i aria-hidden="true">→</i> PRODUÇÃO</span><h3>Enviar para Produção</h3><p>Compartilhe a intenção criativa. A Produção recebe na caixa de entrada e define categoria, responsável e prazo.</p>
    <div class="form-row full"><label class="form-field"><span>TÍTULO</span><input id="sendTitle" value="${esc(productionTitle(selected))}" placeholder="Título da demanda"></label></div>
    <div class="form-row"><label class="form-field"><span>STATUS CRIATIVO DO TRECHO</span><select id="sendCreativeStatus" aria-describedby="sendStatusHint">${optionList(creativeStatuses, doc.status || "draft")}</select><small id="sendStatusHint">Vale para este envio; não altera o status do documento.</small></label><label class="form-field"><span>PRIORIDADE SUGERIDA</span><select id="sendPriority" aria-describedby="sendPriorityHint">${optionList(PRIORITIES, "normal")}</select><small id="sendPriorityHint">Indica a importância criativa. A Produção pode revisar.</small></label></div>
    <div class="form-row full"><label class="form-field"><span>DESCRIÇÃO · MARKDOWN</span><textarea id="sendText">${esc(selected)}</textarea></label></div>
    <p id="sendFormError" class="form-error" role="alert"></p>
    <div class="modal-actions"><button class="hud-button" data-close>CANCELAR</button><button id="confirmSendBtn" class="accent-button">ENVIAR →</button></div>`, "modal-wide vision-handoff-modal");
  $("#confirmSendBtn").onclick = () => {
    let item;
    try {
      item = createVisionHandoff(project, doc, {
        title: $("#sendTitle").value, description: $("#sendText").value, excerpt: selected,
        creativeStatus: $("#sendCreativeStatus").value, priority: $("#sendPriority").value
      });
    } catch (error) { $("#sendFormError").textContent = error.message; return; }
    project.production.push(item); addHistory(project, "VISION_SENT", `“${item.text}” enviado à caixa de entrada da Produção · ${statusLabel(item.creativeStatus)}`);
    persist(); closeModal(); toast("<b>Enviado para a caixa de entrada.</b> A Produção fará a triagem; a origem está vinculada.");
  };
}
function newDocument() {
  if (state.saveTimer) flushDocumentEdit();
  const project = currentProject();
  const doc = { id: uid(), projectId: project.id, parentId: null, title: "Novo documento", markdown: "# Novo documento\n\n", status: "draft", tags: [], revision: 1, createdAt: now(), updatedAt: now() };
  project.docs.push(doc); state.activeDocId = doc.id; addHistory(project, "DOC_CREATED", "Novo documento criado");
  persist(); renderVision(); setTimeout(() => { $("#docTitle").focus(); $("#docTitle").select(); }, 30);
}

function renderProductionCard(item) {
  const content = productionContent(item);
  const source = sourceState(currentProject(), item);
  const linkedTask = currentProject().execution.find(taskItem => taskItem.productionItemId === item.id);
  const sourceLabels = { manual: "MANUAL", linked: "FONTE OK", changed: "FONTE ALTERADA", missing: "FONTE AUSENTE" };
  const selected = item.id === state.activeProductionId;
  return `<article class="production-demand priority-${item.priority} ${selected ? "selected" : ""}" data-id="${item.id}">
    <div class="production-demand-line">
      <span class="demand-grip">⠿</span>
      <div class="demand-title markdown-content">${renderMarkdown(content.text)}</div>
      ${selected ? '<div class="demand-card-rule" aria-hidden="true"><i></i><svg viewBox="0 0 80 28" focusable="false"><path d="M0 2H27L40 15L53 2H80"/><circle cx="40" cy="23" r="2.5"/></svg><i></i></div>' : ""}
      <span class="demand-category">${esc(categoryLabel(item.category))}</span>
      <i class="demand-priority"></i>
      <span class="demand-source source-state ${source}" title="${sourceLabels[source]}">⌁</span>
    </div>
    ${!selected && content.description ? `<div class="demand-summary markdown-content">${renderMarkdown(content.description)}</div>` : ""}
    ${selected ? `<div class="production-demand-detail">
      <div class="production-demand-description markdown-content">${content.description ? renderMarkdown(content.description) : `<p>Origem: ${esc(item.sourceDocumentTitle || "Manual")}</p>`}</div>
      <dl><div><dt>FONTE</dt><dd>${esc(item.sourceDocumentTitle || "Manual")}</dd></div><div><dt>RESPONSÁVEL</dt><dd>${esc(item.assignee || "Não atribuído")}</dd></div><div><dt>PRAZO</dt><dd>${esc(item.deadline || "Sem prazo")}</dd></div></dl>
      <div class="production-demand-actions"><button data-edit-production="${item.id}">DETALHES</button>${linkedTask ? `<button data-open-execution="${linkedTask.id}">ABRIR EXECUÇÃO →</button>` : ["ready", "execution"].includes(item.status) ? `<button data-send-execution="${item.id}">CRIAR TAREFA →</button>` : ""}</div>
    </div>` : ""}
  </article>`;
}
function renderProduction() {
  const project = currentProject();
  const lanes = [
    { key: "inbox", label: "BACKLOG", statuses: ["inbox"], icon: '<path d="m5 9 7-4 7 4-7 4-7-4Zm0 4 7 4 7-4m-14 4 7 4 7-4"/>' },
    { key: "breakdown", label: "EM PREPARO", statuses: ["breakdown"], icon: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5h4"/>' },
    { key: "ready", label: "PRONTO", statuses: ["ready", "execution"], icon: '<path d="m6 12 4 4 9-9"/>' }
  ];
  const filterGroups = {
    design: ["design", "level", "ui"],
    art: ["art2d", "art", "animation", "vfx"],
    code: ["code", "techart"],
    audio: ["audio", "music"],
    qa: ["qa"],
    lore: ["lore"]
  };
  const filtered = project.production.filter(item => state.productionFilter === "all" || (filterGroups[state.productionFilter] || []).includes(item.category));
  $$('[data-prod-filter]').forEach(button => button.classList.toggle("active", button.dataset.prodFilter === state.productionFilter));
  if (!filtered.some(item => item.id === state.activeProductionId)) state.activeProductionId = filtered[0]?.id || null;
  const focusItem = filtered.find(item => item.id === state.activeProductionId);
  const focusLane = focusItem ? lanes.findIndex(lane => lane.statuses.includes(focusItem.status)) : 1;
  $("#productionPanel").style.setProperty("--production-focus-x", `${((Math.max(0, focusLane) + .5) / lanes.length) * 100}%`);
  $("#productionBoard").innerHTML = lanes.map(lane => {
    const items = filtered.filter(item => lane.statuses.includes(item.status));
    return `<section class="production-lane"><div class="production-lane-head"><span class="production-lane-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false">${lane.icon}</svg></span><span>${lane.label}</span><b>${items.length}</b></div><div class="production-demand-stack" data-prod-drop="${lane.key}">${items.map(renderProductionCard).join("")}</div></section>`;
  }).join("");
  $$(".production-demand").forEach(card => {
    card.draggable = true;
    card.ondragstart = event => { card.classList.add("dragging"); event.dataTransfer.setData("text/plain", card.dataset.id); sound.play("ui_drag_start"); };
    card.ondragend = () => card.classList.remove("dragging");
    card.onclick = event => {
      if (event.target.closest("button, a, input, pre, code") || state.activeProductionId === card.dataset.id) return;
      state.activeProductionId = card.dataset.id; renderProduction(); sound.play("ui_click");
    };
    card.ondblclick = event => !event.target.closest("button, a, input, pre, code") && editProductionCard(card.dataset.id);
  });
  $$('[data-prod-drop]').forEach(stack => {
    stack.ondragover = event => { event.preventDefault(); stack.classList.add("drop-active"); };
    stack.ondragleave = () => stack.classList.remove("drop-active");
    stack.ondrop = event => {
      event.preventDefault(); stack.classList.remove("drop-active");
      const item = project.production.find(candidate => candidate.id === event.dataTransfer.getData("text/plain"));
      if (!item || item.status === stack.dataset.prodDrop) return;
      const previous = item.status; item.status = stack.dataset.prodDrop; item.updatedAt = now();
      addHistory(project, "CARD_MOVED", `“${item.text}” movido de ${previous.toUpperCase()} para ${item.status.toUpperCase()}`);
      persist(); renderProduction(); sound.play("ui_drag_drop");
    };
  });
  $$('[data-send-execution]').forEach(button => button.onclick = () => sendProductionToExecution(button.dataset.sendExecution));
  $$('[data-open-execution]').forEach(button => button.onclick = () => {
    state.activeTaskId = button.dataset.openExecution;
    openStage("execution");
    sound.play("ui_click");
  });
  $$('[data-edit-production]').forEach(button => button.onclick = () => editProductionCard(button.dataset.editProduction));
}
function editProductionCard(id = null) {
  const project = currentProject();
  const item = id ? project.production.find(candidate => candidate.id === id) : productionItem(project);
  if (!item) return;
  const content = productionContent(item);
  const parents = project.production.filter(candidate => candidate.id !== item.id).map(candidate => [candidate.id, candidate.text.slice(0, 48)]);
  openModal(`
    <div class="demand-editor-shell">
      <header class="demand-editor-head">
        <div class="demand-editor-topline"><h3>PRODUÇÃO <span>/</span> ${id ? "DEMANDA" : "NOVA DEMANDA"}</h3>
          <button id="prodFullscreenBtn" class="editor-text-button" aria-pressed="false" aria-label="Expandir editor para tela cheia"><span aria-hidden="true">⤢</span> TELA CHEIA</button>
        </div>
        <label class="demand-title-field"><span class="sr-only">Título da demanda</span><input id="prodText" type="text" value="${esc(content.text)}" placeholder="Título da demanda" spellcheck="true"></label>
        <div class="demand-title-rule" aria-hidden="true"><i></i><svg viewBox="0 0 100 40"><path pathLength="100" d="M50 28 L0 4"/><path pathLength="100" d="M50 28 L100 4"/><circle cx="50" cy="21" r="3"/></svg><i></i></div>
      </header>
      <div class="demand-editor-body">
        <section class="demand-writing" aria-label="Descrição da demanda">
          <div class="demand-editor-toolbar">
            <div class="demand-editor-modes" role="group" aria-label="Modo de edição">
              <button id="prodVisualBtn" class="active" aria-pressed="true">VISUAL</button><button id="prodMarkdownBtn" aria-pressed="false">MARKDOWN</button>
            </div>
            <div class="demand-format-tools" role="group" aria-label="Formatar descrição">
              <button data-prod-format="# " title="Título 1" aria-label="Título 1">H1</button><button data-prod-format="## " title="Título 2" aria-label="Título 2">H2</button><button data-prod-format="**" title="Negrito" aria-label="Negrito"><b>B</b></button><button data-prod-format="*" title="Itálico" aria-label="Itálico"><em>I</em></button><button data-prod-format="- " title="Lista" aria-label="Lista">☷</button><button data-prod-format="> " title="Citação" aria-label="Citação">❞</button>
            </div>
          </div>
          <div class="demand-writing-surface">
            <article id="prodVisualEditor" class="demand-document" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Descrição · editor visual" tabindex="0" spellcheck="true" data-placeholder="Descreva a demanda, os próximos passos e os critérios de conclusão."></article>
            <textarea id="prodDescription" class="hidden" spellcheck="false" aria-label="Descrição · código Markdown" placeholder="## O que precisa ser feito&#10;&#10;Descreva a demanda usando Markdown.">${esc(content.description)}</textarea>
          </div>
        </section>
        <aside class="demand-properties" aria-label="Dados da demanda">
          <label class="form-field"><span>◇ CATEGORIA</span><select id="prodCategory">${optionList([["unclassified", "A classificar"], ...CATEGORIES], item.category)}</select></label>
          ${assigneeField("prodAssignee")}
          <label class="form-field demand-priority-field" data-priority="${esc(item.priority)}"><span>⚑ PRIORIDADE</span><select id="prodPriority">${optionList(PRIORITIES, item.priority)}</select></label>
          <label class="form-field"><span>◷ PRAZO</span><input id="prodDeadline" value="${esc(item.deadline === "Sem prazo" ? "" : item.deadline || "")}" placeholder="Sem prazo"></label>
          <div class="demand-source-field"><span>↗ FONTE</span><p>${esc(item.sourceDocumentTitle || "Demanda manual")}${item.sourceRevision ? `<small>REVISÃO ${esc(item.sourceRevision)}</small>` : ""}${item.creativeStatus ? `<small>TRECHO ENVIADO · ${esc(statusLabel(item.creativeStatus))}</small>` : ""}${item.suggestedPriority ? `<small>PRIORIDADE SUGERIDA · ${esc(PRIORITIES.find(([key]) => key === item.suggestedPriority)?.[1] || item.suggestedPriority)}</small>` : ""}</p></div>
          <label class="form-field"><span>◎ ETAPA NO QUADRO</span><select id="prodStatus">${optionList(PROD_COLUMNS.map(([key, label]) => [key, ({ inbox: "Backlog", breakdown: "Em preparo", ready: "Pronto", execution: "Em execução" })[key] || label]), item.status)}</select></label>
          <details class="demand-extra"><summary>MAIS OPÇÕES <span aria-hidden="true">＋</span></summary>
            <label class="form-field"><span>ESTIMATIVA</span><input id="prodEstimate" value="${esc(item.estimate || "")}" placeholder="Ex.: 5 pontos"></label>
            <label class="form-field"><span>CARD PAI</span><select id="prodParent"><option value="">Nenhum</option>${optionList(parents, item.parentId)}</select></label>
            <label class="form-field"><span>TAGS · separadas por vírgula</span><input id="prodTags" value="${esc((item.tags || []).join(", "))}"></label>
            <label class="form-field"><span>SUBTAREFAS · uma por linha</span><textarea id="prodSubtasks">${esc((item.subtasks || []).join("\n"))}</textarea></label>
            ${id ? '<button id="deleteProdBtn" class="editor-text-button danger">EXCLUIR DEMANDA</button>' : ""}
          </details>
        </aside>
      </div>
      <footer class="demand-editor-footer">
        <div id="prodEditorActions" class="demand-editor-actions"><button class="editor-text-button" data-close>× <span>CANCELAR</span></button><span id="prodDraftState" role="status">${id ? "SEM ALTERAÇÕES" : "NOVA DEMANDA"}</span><button id="saveProdBtn" class="demand-save-button">SALVAR <span aria-hidden="true">→</span></button></div>
        <div id="prodConfirmClose" class="demand-confirm hidden"><p id="prodConfirmMessage" role="alert"></p><button id="prodKeepEditingBtn" class="editor-text-button">CONTINUAR EDITANDO</button><button id="prodDiscardBtn" class="editor-text-button danger">DESCARTAR</button></div>
      </footer>
    </div>`, "production-editor-modal");
  bindAssignee("prodAssignee", "prodCategory", item);
  productionEditor = bindProductionEditor();
  $("#saveProdBtn").onclick = () => {
    productionEditor.syncMarkdown();
    Object.assign(item, {
      text: $("#prodText").value.trim() ? $("#prodText").value : "Novo item", description: $("#prodDescription").value, contentLayout: "title-description",
      category: $("#prodCategory").value, status: $("#prodStatus").value, priority: $("#prodPriority").value,
      estimate: $("#prodEstimate").value.trim(), deadline: $("#prodDeadline").value.trim() || "Sem prazo", parentId: $("#prodParent").value || null,
      tags: $("#prodTags").value.split(",").map(tag => tag.trim()).filter(Boolean),
      subtasks: $("#prodSubtasks").value.split("\n").map(row => row.trim()).filter(Boolean), updatedAt: now()
    });
    writeAssignee(item, "prodAssignee");
    if (!id) project.production.push(item);
    addHistory(project, id ? "CARD_UPDATED" : "CARD_CREATED", `${id ? "Card atualizado" : "Card criado"}: “${item.text}”`);
    persist(); closeModal(true); renderProduction();
  };
  if (id) $("#deleteProdBtn").onclick = () => {
    productionEditor.confirm("Excluir esta demanda? Essa ação não pode ser desfeita.", "EXCLUIR DEMANDA", () => {
      project.production = project.production.filter(candidate => candidate.id !== id);
      addHistory(project, "CARD_DELETED", `Card removido: “${item.text}”`); persist(); closeModal(true); renderProduction();
    });
  };
}

// One editor instance: expanding never recreates its DOM, selection or draft.
function bindProductionEditor() {
  const modal = $("#modal"), backdrop = $("#modalBackdrop");
  const visual = $("#prodVisualEditor"), markdown = $("#prodDescription");
  let mode = "visual", visualDirty = false, fullscreen = false, savedRange = null, confirmReturnFocus = null;
  let motionAnimations = [];
  let windowAnimation = null, windowTransitionId = 0, disposed = false;
  const reducedMotion = () => document.documentElement.classList.contains("reduced-motion") || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const cancelWindowMotion = () => {
    windowTransitionId += 1;
    if (windowAnimation) { windowAnimation.onfinish = null; windowAnimation.cancel(); windowAnimation = null; }
    modal.classList.remove("editor-resizing");
  };
  const stopMotion = () => { cancelWindowMotion(); motionAnimations.forEach(animation => animation.cancel()); motionAnimations = []; };
  const revealWindow = () => {
    if (disposed || reducedMotion() || !modal.animate) return;
    windowAnimation = modal.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-out" });
  };
  const revealOrnament = () => {
    if (reducedMotion()) return;
    const animate = (selector, frames, options) => $$(selector).forEach(element => {
      if (element.animate) motionAnimations.push(element.animate(frames, options));
    });
    // Both SVG paths begin at the bottom vertex. Rails continue outward only
    // after the diagonals finish; the dot stays hidden until both rails finish.
    const diagonalDuration = 260, railDuration = 420;
    // Retain the visible end frame; CSS also provides that state on cancellation.
    animate(".demand-title-rule path", [{ strokeDasharray: "100 100", strokeDashoffset: 100 }, { strokeDasharray: "100 100", strokeDashoffset: 0 }], { duration: diagonalDuration, easing: "linear", fill: "both" });
    animate(".demand-title-rule i", [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: railDuration, delay: diagonalDuration, easing: "cubic-bezier(.22,1,.36,1)", fill: "both" });
    animate(".demand-title-rule circle", [{ opacity: 0 }, { opacity: 1, offset: .65 }, { opacity: .8 }], { duration: 280, delay: diagonalDuration + railDuration, easing: "ease-out", fill: "both" });
  };
  const fields = ["prodText", "prodDescription", "prodCategory", "prodStatus", "prodPriority", "prodEstimate", "prodDeadline", "prodParent", "prodTags", "prodSubtasks", "prodAssignee"];
  const snapshot = () => JSON.stringify(fields.map(id => $(`#${id}`).value));
  const initial = snapshot();
  const isDirty = () => visualDirty || snapshot() !== initial;
  const syncMarkdown = () => {
    // Avoid a lossy HTML round trip when the visual view was only inspected.
    if (mode === "visual" && visualDirty) { markdown.value = htmlToMarkdown(visual, { preserveFormatting: true }); renderedMarkdown = markdown.value; visualDirty = false; }
  };
  const updateDraft = () => { $("#prodDraftState").textContent = isDirty() ? "ALTERAÇÕES NÃO SALVAS" : "SEM ALTERAÇÕES"; };
  let renderedMarkdown = null;
  const paintVisual = () => {
    if (renderedMarkdown === markdown.value) return;
    visual.innerHTML = markdown.value ? renderMarkdown(markdown.value) : "";
    renderedMarkdown = markdown.value;
  };
  const setMode = next => {
    if (next === mode) return;
    syncMarkdown();
    if (next === "visual") paintVisual();
    mode = next; savedRange = null;
    visual.classList.toggle("hidden", mode !== "visual"); markdown.classList.toggle("hidden", mode !== "markdown");
    for (const [id, active] of [["prodVisualBtn", mode === "visual"], ["prodMarkdownBtn", mode === "markdown"]]) {
      $(`#${id}`).classList.toggle("active", active); $(`#${id}`).setAttribute("aria-pressed", String(active));
    }
    (mode === "visual" ? visual : markdown).focus({ preventScroll: true }); updateDraft();
  };
  const applyWindowLayout = () => {
    modal.classList.toggle("editor-fullscreen", fullscreen); backdrop.classList.toggle("editor-focus-backdrop", fullscreen);
    const button = $("#prodFullscreenBtn");
    button.innerHTML = fullscreen ? '<span aria-hidden="true">⤡</span> RESTAURAR JANELA' : '<span aria-hidden="true">⤢</span> TELA CHEIA';
    button.setAttribute("aria-pressed", String(fullscreen));
    button.setAttribute("aria-label", fullscreen ? "Restaurar editor em janela" : "Expandir editor para tela cheia");
  };
  const toggleFullscreen = () => {
    // Read the current visual rectangle before cancelling an interrupted resize.
    const from = modal.getBoundingClientRect();
    fullscreen = !fullscreen;
    cancelWindowMotion();
    applyWindowLayout();
    if (reducedMotion() || !modal.animate) return;
    const to = modal.getBoundingClientRect(), parent = backdrop.getBoundingClientRect();
    // Animate actual bounds, not scale: text stays sharp while the editor reflows.
    // Coordinates are relative to the backdrop, whose inset changes in focus mode.
    const frame = rect => ({ left: `${rect.left - parent.left}px`, top: `${rect.top - parent.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    if (Math.abs(from.left - to.left) + Math.abs(from.top - to.top) + Math.abs(from.width - to.width) + Math.abs(from.height - to.height) < 1) return;
    const transitionId = windowTransitionId;
    modal.classList.add("editor-resizing");
    windowAnimation = modal.animate([frame(from), frame(to)], { duration: 420, easing: "cubic-bezier(.22,1,.36,1)", fill: "both" });
    windowAnimation.onfinish = () => {
      if (disposed || transitionId !== windowTransitionId) return;
      cancelWindowMotion();
    };
  };
  // A viewport change invalidates pixel targets; settle into the responsive layout.
  const viewportChanged = () => { if (modal.classList.contains("editor-resizing")) cancelWindowMotion(); };
  const dismissConfirmation = () => {
    $("#prodConfirmClose").classList.add("hidden"); $("#prodEditorActions").classList.remove("hidden");
    confirmReturnFocus?.focus({ preventScroll: true }); confirmReturnFocus = null;
  };
  const confirm = (message, label, action) => {
    confirmReturnFocus = document.activeElement;
    $("#prodConfirmMessage").textContent = message; $("#prodDiscardBtn").textContent = label;
    $("#prodDiscardBtn").onclick = action;
    $("#prodEditorActions").classList.add("hidden"); $("#prodConfirmClose").classList.remove("hidden");
    $("#prodKeepEditingBtn").focus({ preventScroll: true });
  };
  const requestClose = () => {
    if (!isDirty()) return false;
    confirm("Descartar as alterações não salvas?", "DESCARTAR", () => closeModal(true)); return true;
  };
  const selectionChanged = () => {
    const selection = getSelection();
    if (selection?.rangeCount && visual.contains(selection.anchorNode) && visual.contains(selection.focusNode)) savedRange = selection.getRangeAt(0).cloneRange();
  };
  const restoreSelection = () => {
    visual.focus({ preventScroll: true });
    if (savedRange && visual.contains(savedRange.commonAncestorContainer)) {
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(savedRange);
    }
  };
  const format = mark => {
    if (mode === "markdown") {
      const start = markdown.selectionStart, end = markdown.selectionEnd, selected = markdown.value.slice(start, end);
      const inline = mark === "**" || mark === "*";
      const lineStart = markdown.value.lastIndexOf("\n", start - 1) + 1;
      const replacement = inline ? `${mark}${selected || "texto"}${mark}` : markdown.value.slice(lineStart, end).split("\n").map(line => mark + line.replace(/^#{1,6} |^[-*] |^> /, "")).join("\n");
      markdown.setRangeText(replacement, inline ? start : lineStart, end, "end");
      markdown.focus({ preventScroll: true }); updateDraft(); return;
    }
    restoreSelection();
    const commands = { "**": ["bold"], "*": ["italic"], "# ": ["formatBlock", "h1"], "## ": ["formatBlock", "h2"], "- ": ["insertUnorderedList"], "> ": ["formatBlock", "blockquote"] };
    const [command, value] = commands[mark]; document.execCommand(command, false, value);
    visualDirty = true; updateDraft(); selectionChanged();
  };
  const beforeUnload = event => { if (isDirty()) { event.preventDefault(); event.returnValue = ""; } };
  backdrop.classList.add("production-editor-backdrop");
  paintVisual();
  revealOrnament();
  revealWindow();
  fields.forEach(id => $(`#${id}`).addEventListener("input", updateDraft));
  fields.forEach(id => $(`#${id}`).addEventListener("change", updateDraft));
  visual.oninput = () => { visualDirty = true; updateDraft(); };
  // Paste text, not arbitrary HTML from other websites; formatting stays deliberate.
  visual.onpaste = event => { event.preventDefault(); restoreSelection(); document.execCommand("insertText", false, event.clipboardData.getData("text/plain")); visualDirty = true; updateDraft(); };
  visual.ondrop = event => event.preventDefault();
  $("#prodPriority").addEventListener("change", () => { $(".demand-priority-field").dataset.priority = $("#prodPriority").value; });
  $("#prodVisualBtn").onclick = () => setMode("visual"); $("#prodMarkdownBtn").onclick = () => setMode("markdown");
  $("#prodFullscreenBtn").onclick = toggleFullscreen; $("#prodKeepEditingBtn").onclick = dismissConfirmation;
  $$('[data-prod-format]').forEach(button => { button.onmousedown = event => event.preventDefault(); button.onclick = () => format(button.dataset.prodFormat); });
  document.addEventListener("selectionchange", selectionChanged);
  window.addEventListener("beforeunload", beforeUnload);
  window.addEventListener("resize", viewportChanged);
  return {
    syncMarkdown, requestClose, confirm,
    handleKeydown(event) {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (!$("#prodConfirmClose").classList.contains("hidden")) dismissConfirmation();
        else if (fullscreen) toggleFullscreen(); else closeModal();
        return true;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault(); if ($("#prodConfirmClose").classList.contains("hidden")) $("#saveProdBtn").click(); return true;
      }
    },
    dispose() { disposed = true; stopMotion(); document.removeEventListener("selectionchange", selectionChanged); window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener("resize", viewportChanged); }
  };
}
function sendProductionToExecution(id) {
  const project = currentProject();
  const item = project.production.find(candidate => candidate.id === id);
  if (!item) return;
  if (item.category === "unclassified") { toast("Defina a categoria nos <b>Detalhes</b> da Produção antes de enviar à Execução."); return; }
  const content = productionContent(item);
  openModal(`<span class="eyebrow">PRODUÇÃO <i aria-hidden="true">→</i> EXECUÇÃO</span><h3>Preparar para Execução</h3><p>A demanda continuará na Produção e a tarefa manterá o vínculo com a origem.</p>
    ${assigneeField("execAssignee")}
    <div class="form-row full"><label class="form-field"><span>PRAZO</span><input id="execDeadline" value="${esc(item.deadline === "Sem prazo" ? "" : item.deadline)}"></label></div>
    <div class="form-row full"><label class="form-field"><span>TAREFA</span><textarea id="execText">${esc(content.text)}</textarea></label></div>
    <div class="modal-actions"><button class="hud-button" data-close>CANCELAR</button><button id="confirmExecBtn" class="accent-button">CRIAR TAREFA →</button></div>`);
  bindAssignee("execAssignee", null, item, item.category);
  $("#confirmExecBtn").onclick = () => {
    const created = task(project, {
      productionItemId: item.id, visionDocumentId: item.sourceDocumentId, text: $("#execText").value.trim(), description: content.description,
      category: item.category, department: item.category, status: "todo",
      deadline: $("#execDeadline").value.trim() || "Sem prazo", priority: item.priority,
      subtasks: (item.subtasks || []).map(text => ({ text, done: false }))
    });
    writeAssignee(created, "execAssignee", item);
    item.status = "execution";
    project.execution.push(created); addHistory(project, "TASK_CREATED", `“${created.text}” criada a partir da Produção`);
    persist(); closeModal(); renderProduction(); toast("<b>Entrou em Execução.</b> A origem continua rastreável.");
  };
}

function renderTaskCard(item) {
  const initials = (item.assignee || "NA").split(/\s+/).map(value => value[0]).join("").slice(0, 2).toUpperCase();
  return `<article class="execution-mission priority-${item.priority} ${item.status === "done" ? "done" : ""} ${item.id === state.activeTaskId ? "selected" : ""}" data-id="${item.id}">
    <i class="mission-node"></i>
    <strong>${esc(item.text)}</strong>
    <div><span class="mission-assignee">${esc(initials)}</span><span>${esc(categoryLabel(item.department || item.category))}</span><time>${esc(item.deadline || "SEM PRAZO")}</time><b>${item.priority === "critical" || item.priority === "high" ? "↑" : item.status === "done" ? "✓" : "—"}</b></div>
  </article>`;
}
function renderExecution() {
  const project = currentProject();
  const departmentGroups = {
    design: ["design", "level", "ui"],
    code: ["code", "techart"],
    art: ["art2d", "art", "animation", "vfx"],
    audio: ["audio", "music"],
    qa: ["qa"],
    production: ["production"]
  };
  const items = state.department === "all" ? project.execution : project.execution.filter(item => (departmentGroups[state.department] || []).includes(item.department || item.category));
  $$('.department').forEach(button => button.classList.toggle("active", button.dataset.dept === state.department));
  const lanes = [
    { key: "todo", label: "A FAZER", statuses: ["todo"] },
    { key: "doing", label: "EM CURSO", statuses: ["doing", "blocked"] },
    { key: "review", label: "REVISÃO", statuses: ["review"] },
    { key: "done", label: "CONCLUÍDO", statuses: ["done"] }
  ];
  if (!items.some(item => item.id === state.activeTaskId)) state.activeTaskId = items[0]?.id || null;
  $("#executionBoard").innerHTML = lanes.map(lane => {
    const laneItems = items.filter(item => lane.statuses.includes(item.status));
    return `<section class="execution-lane"><div class="execution-lane-head"><i></i><span>${lane.label}</span><b>${laneItems.length}</b></div><div class="execution-mission-stack" data-exec-drop="${lane.key}">${laneItems.map(renderTaskCard).join("")}</div></section>`;
  }).join("");
  const weighted = project.execution.reduce((sum, item) => sum + (item.status === "done" ? 1 : item.status === "review" ? .8 : item.status === "doing" ? .45 : 0), 0);
  const percent = project.execution.length ? Math.round(weighted / project.execution.length * 100) : 0;
  $("#sprintProgress").style.width = `${percent}%`; $("#progressLabel").textContent = `${percent}%`;
  $$(".execution-mission").forEach(card => {
    card.draggable = true;
    card.ondragstart = event => { card.classList.add("dragging"); event.dataTransfer.setData("text/plain", card.dataset.id); sound.play("ui_drag_start"); };
    card.ondragend = () => card.classList.remove("dragging");
    card.onclick = () => { state.activeTaskId = card.dataset.id; renderExecution(); sound.play("ui_click"); };
    card.ondblclick = () => editTask(card.dataset.id);
  });
  $$('[data-exec-drop]').forEach(stack => {
    stack.ondragover = event => { event.preventDefault(); stack.classList.add("drop-active"); };
    stack.ondragleave = () => stack.classList.remove("drop-active");
    stack.ondrop = event => {
      event.preventDefault(); stack.classList.remove("drop-active");
      const item = project.execution.find(candidate => candidate.id === event.dataTransfer.getData("text/plain"));
      if (!item || item.status === stack.dataset.execDrop) return;
      const previous = item.status; item.status = stack.dataset.execDrop; item.updatedAt = now();
      addHistory(project, "TASK_MOVED", `“${item.text}” movida de ${previous.toUpperCase()} para ${item.status.toUpperCase()}`);
      persist(); renderExecution(); sound.play("ui_drag_drop");
    };
  });
  renderTaskDetail(project.execution.find(item => item.id === state.activeTaskId));
}
function renderTaskDetail(item) {
  const panel = $("#taskDetailPanel");
  if (!item) { panel.innerHTML = `<div class="task-detail-empty"><span>EXECUÇÃO</span><p>Selecione uma tarefa para ver os detalhes.</p></div>`; return; }
  const subtasks = item.subtasks || [];
  const done = subtasks.filter(row => typeof row === "object" && row.done).length;
  const initials = (item.assignee || "NA").split(/\s+/).map(value => value[0]).join("").slice(0, 2).toUpperCase();
  panel.innerHTML = `<header><strong>${esc(item.text)}</strong><button data-edit-task="${item.id}">↗</button></header>
    <section><h3>DETALHES</h3><span>DESCRIÇÃO</span><p>${esc(item.description || "Sem descrição adicional.")}</p></section>
    <section><h3>CHECKLIST <b>${done} / ${subtasks.length}</b></h3><div class="task-checklist">${subtasks.length ? subtasks.map((row, index) => {
      const entry = typeof row === "string" ? { text: row, done: false } : row;
      return `<button data-toggle-subtask="${index}" class="${entry.done ? "done" : ""}"><i>${entry.done ? "✓" : ""}</i><span>${esc(entry.text)}</span></button>`;
    }).join("") : "<p>Nenhum item no checklist.</p>"}</div></section>
    <section><h3>DEPENDÊNCIAS</h3><div class="task-dependencies">${(item.dependencies || []).length ? item.dependencies.map(value => `<span>◇ ${esc(value)}</span>`).join("") : "<span>SEM DEPENDÊNCIAS</span>"}</div></section>
    <footer><div><span>ATRIBUÍDO</span><b title="${esc(item.assignee || "Não atribuído")}" aria-label="${esc(item.assignee || "Não atribuído")}">${esc(initials)}</b></div><div><span>PRIORIDADE</span><strong>${esc((item.priority || "normal").toUpperCase())}</strong></div><div><span>PRAZO</span><strong>${esc(item.deadline || "SEM PRAZO")}</strong></div></footer>`;
  $$('[data-edit-task]').forEach(button => button.onclick = () => editTask(button.dataset.editTask));
  $$('[data-toggle-subtask]').forEach(button => button.onclick = () => {
    const index = Number(button.dataset.toggleSubtask);
    const row = item.subtasks[index];
    item.subtasks[index] = typeof row === "string" ? { text: row, done: true } : { ...row, done: !row.done };
    item.updatedAt = now(); persist(); renderExecution();
  });
}
function editTask(id = null) {
  const project = currentProject();
  const item = id ? project.execution.find(candidate => candidate.id === id) : task(project);
  if (!item) return;
  const subtaskText = (item.subtasks || []).map(row => typeof row === "string" ? row : `${row.done ? "[x]" : "[ ]"} ${row.text}`).join("\n");
  openModal(`<span class="eyebrow">EXECUÇÃO · TAREFA</span><h3>${id ? "Detalhes da tarefa" : "Nova tarefa"}</h3><p>Defina o responsável, o prazo e os próximos passos.</p>
    <div class="form-row full"><label class="form-field"><span>TÍTULO</span><textarea id="taskText">${esc(item.text)}</textarea></label></div>
    <div class="form-row full"><label class="form-field"><span>DESCRIÇÃO</span><textarea id="taskDescription">${esc(item.description || "")}</textarea></label></div>
    <div class="form-row"><label class="form-field"><span>SETOR</span><select id="taskCategory">${optionList(CATEGORIES, item.department || item.category)}</select></label><label class="form-field"><span>ESTADO</span><select id="taskStatus">${optionList(EXEC_COLUMNS, item.status)}</select></label></div>
    ${assigneeField("taskAssignee")}
    <div class="form-row full"><label class="form-field"><span>PRIORIDADE</span><select id="taskPriority">${optionList(PRIORITIES, item.priority)}</select></label></div>
    <div class="form-row"><label class="form-field"><span>PRAZO</span><input id="taskDeadline" value="${esc(item.deadline || "")}"></label><label class="form-field"><span>DEPENDÊNCIAS</span><input id="taskDependencies" value="${esc((item.dependencies || []).join(", "))}"></label></div>
    <div class="form-row full"><label class="form-field"><span>SUBTAREFAS · use [x] para concluídas</span><textarea id="taskSubtasks">${esc(subtaskText)}</textarea></label></div>
    <div class="modal-actions">${id ? '<button id="deleteTaskBtn" class="hud-button danger">EXCLUIR</button>' : ""}<button class="hud-button" data-close>CANCELAR</button><button id="saveTaskBtn" class="accent-button">SALVAR</button></div>`, "modal-wide");
  bindAssignee("taskAssignee", "taskCategory", item);
  $("#saveTaskBtn").onclick = () => {
    Object.assign(item, {
      text: $("#taskText").value.trim() || "Nova tarefa", description: $("#taskDescription").value.trim(),
      category: $("#taskCategory").value, department: $("#taskCategory").value, status: $("#taskStatus").value,
      priority: $("#taskPriority").value,
      deadline: $("#taskDeadline").value.trim() || "Sem prazo", dependencies: $("#taskDependencies").value.split(",").map(value => value.trim()).filter(Boolean),
      subtasks: $("#taskSubtasks").value.split("\n").map(value => value.trim()).filter(Boolean).map(value => ({ done: /^\[x\]/i.test(value), text: value.replace(/^\[[ x]\]\s*/i, "") })), updatedAt: now()
    });
    writeAssignee(item, "taskAssignee");
    if (!id) project.execution.push(item);
    addHistory(project, id ? "TASK_UPDATED" : "TASK_CREATED", `${id ? "Tarefa atualizada" : "Tarefa criada"}: “${item.text}”`);
    persist(); closeModal(); renderExecution();
  };
  if (id) $("#deleteTaskBtn").onclick = () => {
    project.execution = project.execution.filter(candidate => candidate.id !== id);
    addHistory(project, "TASK_DELETED", `Tarefa removida: “${item.text}”`); persist(); closeModal(); renderExecution();
  };
}

function assigneeField(id) {
  return `<div class="form-row full assignee-field"><label class="form-field"><span>RESPONSÁVEL · EQUIPE DESTE SAVE</span><select id="${id}"></select></label><label class="team-check"><input type="checkbox" id="${id}All"> Mostrar toda a equipe</label><small id="${id}Hint"></small></div>`;
}
function bindAssignee(id, categoryId, item = {}, fixedCategory) {
  let current = item.assigneeId || (item.assignee && item.assignee !== "Não atribuído" ? "__legacy" : "");
  const refresh = () => {
    const category = categoryId ? $(`#${categoryId}`).value : fixedCategory;
    const all = $(`#${id}All`).checked;
    const eligible = eligibleMembers(currentProject(), category, all);
    const selected = currentProject().members.find(member => member.id === current);
    const options = eligible.map(member => [member.id, `${member.name} · ${member.role}`]);
    if (selected && !eligible.includes(selected)) options.unshift([selected.id, `${selected.name} · atual, outra especialidade`]);
    if (current === "__legacy") options.unshift(["__legacy", `${item.assignee} · responsável antigo, sem vínculo`]);
    $(`#${id}`).innerHTML = optionList([["", "Não atribuído"], ...options], current);
    $(`#${id}Hint`).textContent = all ? `${eligible.length} pessoa(s) neste Save.` : category === "unclassified" ? "Escolha a categoria para filtrar por especialidade, ou mostre toda a equipe." : eligible.length ? `${eligible.length} pessoa(s) com especialidade ${categoryLabel(category)}.` : `Ninguém cadastrado em ${categoryLabel(category)}. Cadastre em Equipe ou mostre toda a equipe.`;
  };
  $(`#${id}`).onchange = () => { current = $(`#${id}`).value; };
  $(`#${id}All`).onchange = refresh;
  if (categoryId) $(`#${categoryId}`).addEventListener("change", refresh);
  refresh();
}
function writeAssignee(item, id, previous = item) {
  const selected = $(`#${id}`).value;
  if (selected === "__legacy") { item.assigneeId = null; item.assignee = previous.assignee; return; }
  assignMember(currentProject(), item, selected || null);
}
function requireTeamAdmin() {
  if (collaboration.admin) return true;
  toast("Somente o host pode gerenciar a equipe e as configurações deste Save."); return false;
}
function openTeam() {
  const project = currentProject();
  openModal(`<span class="eyebrow">SAVE · EQUIPE</span><h3>Equipe de ${esc(project.name)}</h3><p>Cargos são livres. Especialidades organizam a escolha de responsáveis nas próximas etapas.</p>
    <div class="team-roster">${project.members.length ? project.members.map(member => `<article><div><strong>${esc(member.name)}</strong><span>${esc(member.role)}</span><div class="specialty-tags">${member.specialties.length ? member.specialties.map(key => `<b>${esc(categoryLabel(key))}</b>`).join("") : "<small>Sem especialidade definida</small>"}</div></div>${collaboration.admin ? `<div class="team-row-actions"><button class="hud-button" data-edit-member="${esc(member.id)}">EDITAR</button><button class="hud-button" data-remove-member="${esc(member.id)}">REMOVER</button></div>` : ""}</article>`).join("") : '<p class="team-empty">A equipe deste Save está vazia. Adicione a primeira pessoa para começar.</p>'}</div>
    <p>${collaboration.active ? "Cada convite dá acesso somente a este Save. Remover alguém revoga o convite após a sincronização com o host." : "Esta equipe pertence só a este Save. Para trabalhar entre computadores, abra Conexão."}</p>
    <div class="modal-actions"><button class="hud-button" data-close>FECHAR</button>${collaboration.admin ? '<button id="addMemberBtn" class="accent-button">ADICIONAR PESSOA</button>' : ""}</div>`, "modal-wide team-modal");
  if (collaboration.admin) {
    $("#addMemberBtn").onclick = () => editMember();
    $$('[data-edit-member]').forEach(button => button.onclick = () => editMember(button.dataset.editMember));
    $$('[data-remove-member]').forEach(button => button.onclick = () => confirmRemoveMember(button.dataset.removeMember));
  }
}
function editMember(id) {
  if (!requireTeamAdmin()) return;
  const member = currentProject().members.find(member => member.id === id) || { name: "", role: "", specialties: [] };
  openModal(`<span class="eyebrow">EQUIPE · MEMBRO</span><h3>${id ? "Editar pessoa" : "Adicionar pessoa"}</h3><p>Uma pessoa pode atuar em várias especialidades.</p>
    <div class="form-row"><label class="form-field"><span>NOME</span><input id="memberName" maxlength="80" value="${esc(member.name)}"></label><label class="form-field"><span>CARGO</span><input id="memberRole" maxlength="100" value="${esc(member.role)}" placeholder="Ex.: VFX Artist / Artista de efeitos"></label></div>
    <fieldset class="specialty-picker"><legend>ESPECIALIDADES</legend>${CATEGORIES.map(([key, label]) => `<label class="team-check" for="specialty-${key}"><input id="specialty-${key}" type="checkbox" value="${key}" name="specialty" ${member.specialties.includes(key) ? "checked" : ""}><span>${esc(label)}</span></label>`).join("")}</fieldset>
    <p id="teamFormError" class="form-error" role="alert"></p><div class="modal-actions"><button id="cancelMemberBtn" class="hud-button">VOLTAR</button><button id="saveMemberBtn" class="accent-button">SALVAR PESSOA</button></div>`, "modal-wide team-member-modal");
  $("#cancelMemberBtn").onclick = openTeam;
  $("#saveMemberBtn").onclick = () => {
    try {
      saveMember(currentProject(), { id, name: $("#memberName").value, role: $("#memberRole").value, specialties: $$('input[name="specialty"]:checked').map(input => input.value) });
      persist(); openTeam();
    } catch (error) { $("#teamFormError").textContent = error.message; }
  };
}
function confirmRemoveMember(id) {
  if (!requireTeamAdmin()) return;
  const member = currentProject().members.find(member => member.id === id);
  if (!member) return;
  const count = [...currentProject().production, ...currentProject().execution].filter(item => item.assigneeId === id).length;
  openModal(`<span class="eyebrow">EQUIPE · REMOVER</span><h3>Remover ${esc(member.name)}?</h3><p>${count} demanda(s)/tarefa(s) ficarão sem responsável. Nenhum conteúdo será apagado. Em um Save compartilhado, o convite dessa pessoa será revogado quando a alteração chegar ao host.</p><div class="modal-actions"><button id="cancelRemoveMember" class="hud-button">CANCELAR</button><button id="confirmRemoveMember" class="hud-button danger">REMOVER PESSOA</button></div>`);
  $("#cancelRemoveMember").onclick = openTeam;
  $("#confirmRemoveMember").onclick = () => { removeMember(currentProject(), id); persist(); openTeam(); };
}

function pauseMenu() {
  visionSelection?.hide();
  if (state.currentScreen === "saves") return;
  pauseReturnFocus = document.activeElement;
  $("#pauseProjectName").textContent = currentProject().name;
  $("#contextMenu").classList.add("hidden");
  $("#pauseMenu").classList.remove("hidden");
  syncOverlayFocus();
  $('[data-pause-action="resume"]').focus({ preventScroll: true });
  sound.play("ui_open");
}
function resumeMenu() {
  $("#pauseMenu").classList.add("hidden");
  syncOverlayFocus();
  if (pauseReturnFocus?.isConnected) pauseReturnFocus.focus({ preventScroll: true });
  pauseReturnFocus = null;
  sound.play("ui_close");
}
function openSettings() {
  const project = currentProject();
  openModal(`<span class="eyebrow">SISTEMA · PREFERÊNCIAS</span><h3>Configurações</h3><p>Seu projeto, do seu jeito. Preferências salvas neste Save.</p><div class="settings-grid">
    <section><h4><i aria-hidden="true"></i>PROJETO</h4><label class="form-field"><span>NOME DO SAVE</span><input id="renameSaveInput" maxlength="80" value="${esc(project.name)}"></label><div class="inline-actions"><button id="exportSaveBtn" class="hud-button">EXPORTAR <span aria-hidden="true">↗</span></button><button id="importInsideBtn" class="hud-button">IMPORTAR <span aria-hidden="true">↙</span></button><button id="historyBtn" class="hud-button">HISTÓRICO <span aria-hidden="true">↗</span></button></div><p class="settings-note">Exporte uma cópia para guardar seu projeto fora deste dispositivo.</p></section>
    <section><h4><i aria-hidden="true"></i>INTERFACE</h4><label class="toggle-row"><span>Som da interface<small>Feedback sonoro ao navegar.</small></span><input id="settingsSound" type="checkbox" role="switch" ${project.settings.sound ? "checked" : ""}></label><label class="form-field volume-field"><span>VOLUME <output id="settingsVolumeValue" for="settingsVolume">${Math.round(project.settings.volume * 100)}%</output></span><input id="settingsVolume" type="range" min="0" max="1" step=".05" value="${project.settings.volume}"></label><label class="toggle-row"><span>Movimento reduzido<small>Menos animações e transições.</small></span><input id="settingsMotion" type="checkbox" role="switch" ${project.settings.reducedMotion ? "checked" : ""}></label></section>
    <section class="full-span"><h4><i aria-hidden="true"></i>EQUIPE DESTE SAVE</h4><div class="member-list">${project.members.map(member => `<div><i class="member-avatar" aria-hidden="true">${esc(member.name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase())}</i><span><b>${esc(member.name)}</b><small>${esc(member.role)}</small></span><em>${(member.specialties || []).map(value => esc(categoryLabel(value))).join(" · ") || "SEM ESPECIALIDADE"}</em></div>`).join("") || "<p>Nenhuma pessoa cadastrada.</p>"}</div><div class="inline-actions"><button id="manageTeamBtn" class="hud-button">GERENCIAR EQUIPE</button><button id="settingsConnectionBtn" class="hud-button">CONEXÃO</button></div><p class="settings-note">Colaboradores convidados podem editar o conteúdo. Somente o host gerencia a equipe e as configurações compartilhadas.</p></section></div>
    <div class="modal-actions"><button id="deleteSaveBtn" class="hud-button danger" ${state.projects.length === 1 ? 'disabled title="Mantenha ao menos um Save no dispositivo"' : ""}>EXCLUIR SAVE</button><button class="hud-button" data-close>CANCELAR</button><button id="saveSettingsBtn" class="accent-button">SALVAR ALTERAÇÕES</button></div>`, "modal-wide settings-modal");
  const updateVolumeControl = () => {
    const slider = $("#settingsVolume");
    const percent = Math.round(Number(slider.value) * 100);
    $("#settingsVolumeValue").textContent = `${percent}%`;
    slider.style.setProperty("--range-value", `${percent}%`);
    slider.disabled = !$("#settingsSound").checked;
    $(".volume-field").classList.toggle("muted", slider.disabled);
  };
  $("#settingsVolume").oninput = updateVolumeControl;
  $("#settingsSound").onchange = updateVolumeControl;
  updateVolumeControl();
  $("#manageTeamBtn").onclick = openTeam;
  $("#settingsConnectionBtn").onclick = openConnection;
  if (!collaboration.admin) {
    $$('#modalContent input, #saveSettingsBtn, #deleteSaveBtn, #importInsideBtn').forEach(control => { control.disabled = true; });
  }
  $("#exportSaveBtn").onclick = () => downloadProject(project);
  $("#importInsideBtn").onclick = () => $("#importFileInput").click();
  $("#historyBtn").onclick = openHistory;
  $("#saveSettingsBtn").onclick = () => {
    if (!requireTeamAdmin()) return;
    project.name = $("#renameSaveInput").value.trim() || project.name; project.settings.sound = $("#settingsSound").checked;
    project.settings.volume = Number($("#settingsVolume").value); project.settings.reducedMotion = $("#settingsMotion").checked;
    document.documentElement.classList.toggle("reduced-motion", project.settings.reducedMotion);
    addHistory(project, "SETTINGS_UPDATED", "Configurações do Save atualizadas"); persist(); renderHub(); closeModal(); updateSoundLabel();
    toast("<b>Configurações salvas.</b> Seu Save está atualizado.");
  };
  $("#deleteSaveBtn").onclick = () => openDeleteSaveModal(project);
}
function openHistory() {
  const history = currentProject().history;
  openModal(`<span class="eyebrow">PROJETO · REGISTROS</span><h3>Histórico</h3><p>O caminho percorrido por ${esc(currentProject().name)}.</p><div class="history-caption"><span>ATIVIDADE RECENTE</span><span>${Math.min(history.length, 80)} REGISTROS</span></div><div class="history-list">${history.length ? history.slice(0, 80).map(entry => `<article><i aria-hidden="true"></i><div><b>${esc(entry.message)}</b><span>${esc(entry.actor)} <i>·</i> <time datetime="${esc(entry.at)}">${new Date(entry.at).toLocaleString("pt-BR")}</time></span></div></article>`).join("") : '<div class="history-empty"><i aria-hidden="true">◇</i><p>Nenhuma ação registrada.</p><span>As próximas decisões do projeto aparecerão aqui.</span></div>'}</div><div class="modal-actions"><button class="hud-button" data-close>FECHAR</button></div>`, "modal-wide history-modal");
}
function updateConnectionStatus(status, message = "") {
  const labels = { local: "LOCAL", synced: "CONECTADO", pending: "SINCRONIZANDO", offline: "HOST OFFLINE", conflict: "REVISAR CONFLITO", denied: "ACESSO INTERROMPIDO" };
  const label = labels[status] || status;
  $("#connectionStateText")?.replaceChildren(document.createTextNode(label));
  $("#connectionDetailStatus")?.replaceChildren(document.createTextNode(`${label}${message ? " · " + message : ""}`));
  if (collaboration.active && $("#saveIndicator")) $("#saveIndicator").textContent = status === "synced" ? "SALVO · HOST" : label;
  for (const id of ["newSaveBtn", "importSaveBtn", "deleteSelectedSaveBtn"]) if ($(`#${id}`)) $(`#${id}`).disabled = collaboration.active;
  if (["conflict", "denied", "offline"].includes(status) && updateConnectionStatus.previous !== status) toast(`<b>${label}.</b> ${esc(message || "Rascunho preservado neste dispositivo. Abra Conexão.")}`);
  updateConnectionStatus.previous = status;
}
function applyRemoteProject(project) {
  state.projects = [migrateProject(project)]; state.activeProjectId = state.projects[0].id; state.selectedProjectId = state.activeProjectId;
  renderSaves(); renderHub();
  if (state.currentScreen === "work") openStage(state.currentStage);
  updateSoundLabel(); updateConnectionStatus(collaboration.status);
}
async function enterShared(session, initial) {
  if (state.saveTimer) flushDocumentEdit();
  if (collaboration.active) throw new Error("Saia da sessão atual antes de entrar em outra.");
  const snapshot = { projects: state.projects, selectedProjectId: state.selectedProjectId, activeProjectId: state.activeProjectId };
  const project = await collaboration.connect(session, initial);
  localSnapshot = snapshot;
  applyRemoteProject(project); closeModal(); go("hub");
  toast(`<b>Save compartilhado aberto.</b> ${esc(collaboration.principal.name)} · ${collaboration.admin ? "Host" : "Colaborador"}`);
}
function leaveShared() {
  if (state.saveTimer) flushDocumentEdit();
  const copy = migrateProject(JSON.parse(JSON.stringify(currentProject())));
  copy.id = uid(); copy.name = `${copy.name.slice(0, 64)} · cópia local`;
  for (const row of [...copy.docs, ...copy.production, ...copy.execution]) row.projectId = copy.id;
  const restored = { ...localSnapshot, projects: [...localSnapshot.projects, copy], selectedProjectId: copy.id, activeProjectId: copy.id };
  saveWorkspace(restored); // Do not abandon the session if local storage is full.
  collaboration.stop(); sessionStorage.removeItem("gf-session");
  Object.assign(state, restored); localSnapshot = null;
  closeModal(); go("saves"); updateConnectionStatus("local");
  toast("<b>Cópia local guardada.</b> O Save do host continua disponível para a equipe.");
}
function connectionError(error) {
  const field = $("#connectionError");
  if (field) field.textContent = error.message || "Não foi possível conectar.";
  else toast(esc(error.message || "Não foi possível conectar."));
}
function openConnection() {
  const shared = collaboration.active;
  const project = state.currentScreen === "saves" ? selectedProject() : currentProject();
  const hostKey = sessionStorage.getItem("gf-host-key") || "";
  openModal(`<span class="eyebrow">EQUIPE · REDE</span><h3>${shared ? "Save compartilhado" : "Conexão"}</h3><p>O host guarda o Save. A equipe abre o endereço dele pela rede, Radmin VPN ou um túnel HTTPS.</p>
    ${shared ? `<p id="connectionDetailStatus" class="connection-state"></p><p>${esc(collaboration.principal.name)} · ${collaboration.admin ? "HOST / ADMINISTRADOR" : "COLABORADOR"} · revisão ${collaboration.revision}</p>
      ${collaboration.admin ? `<div class="form-row full"><label class="form-field"><span>ENDEREÇO PARA A EQUIPE · IP DA VPN OU URL HTTPS</span><input id="inviteBase" value="${esc(sessionStorage.getItem("gf-public-origin") || location.origin)}" placeholder="http://26.x.x.x:8765"></label></div>
      <div class="form-row"><label class="form-field"><span>CONVIDAR MEMBRO DESTE SAVE</span><select id="inviteMember">${optionList(currentProject().members.map(member => [member.id, member.name]), "")}</select></label><button id="createInviteBtn" class="hud-button" ${currentProject().members.length ? "" : "disabled"}>GERAR CONVITE INDIVIDUAL</button></div><p class="settings-note">Gerar outro convite para a mesma pessoa invalida o anterior. O link é uma credencial: envie só ao destinatário.</p>
      <div class="form-row full"><label class="form-field"><span>LINK DO CONVITE</span><input id="inviteResult" readonly placeholder="O convite aparecerá aqui."></label><button id="copyInviteBtn" class="hud-button">COPIAR LINK</button></div>` : ""}
      <div class="inline-actions"><button id="retryConnectionBtn" class="hud-button">TENTAR SINCRONIZAR</button><button id="downloadDraftBtn" class="hud-button">EXPORTAR MEU RASCUNHO</button><button id="acceptHostBtn" class="hud-button">BAIXAR RASCUNHO E USAR HOST</button></div>
      <p class="settings-note">Conflitos não são mesclados automaticamente. Guarde sua versão antes de carregar a versão do host.</p>` : `<section class="connection-section"><h4>CRIAR SERVIDOR / HOSPEDAR SAVE</h4><p>Execute START.bat neste computador. Ele abre o app com a chave do host. A chave também fica em GameForge_Flow_Data/host-key.txt, fora da pasta pública.</p><div class="form-row"><label class="form-field"><span>CHAVE DO HOST · NÃO COMPARTILHE</span><input id="hostKeyInput" type="password" autocomplete="off" value="${esc(hostKey)}"></label><button id="loadHostBtn" class="hud-button">VERIFICAR HOST</button></div>
      <div id="hostInfo"></div><div class="inline-actions"><button id="publishSaveBtn" class="accent-button">COMPARTILHAR ${esc(project.name)}</button></div><p class="settings-note">Uma cópia independente vai para o servidor. Seu Save local original fica preservado.</p></section>
      <section class="connection-section"><h4>ENTRAR NA EQUIPE</h4><label class="form-field"><span>CONVITE RECEBIDO DO HOST</span><input id="joinLink" type="password" autocomplete="off" placeholder="Cole o link completo do convite"></label><div class="inline-actions"><button id="joinServerBtn" class="hud-button">ABRIR CONVITE</button>${sessionStorage.getItem("gf-session") ? '<button id="resumeConnectionBtn" class="hud-button">RETOMAR SESSÃO</button>' : ""}</div></section>`}
    <p class="connection-warning">Use rede confiável/VPN para HTTP. Para acesso público, use HTTPS no túnel; não exponha a porta HTTP diretamente na internet. Firewall e túnel são configurados por você.</p>
    <p id="connectionError" class="form-error" role="alert"></p><div class="modal-actions"><button class="hud-button" data-close>FECHAR</button>${shared ? '<button id="leaveSharedBtn" class="accent-button">SAIR COM CÓPIA LOCAL</button>' : ""}</div>`, "modal-wide connection-modal");
  if (shared) {
    updateConnectionStatus(collaboration.status, collaboration.message);
    $("#downloadDraftBtn").onclick = () => downloadProject(currentProject());
    $("#retryConnectionBtn").onclick = async () => { await collaboration.flush(); await collaboration.tick(); updateConnectionStatus(collaboration.status, collaboration.message); };
    $("#acceptHostBtn").onclick = async () => { try { if (state.saveTimer) flushDocumentEdit(); downloadProject(currentProject()); await collaboration.acceptHost(); closeModal(); } catch (error) { connectionError(error); } };
    $("#leaveSharedBtn").onclick = () => { try { leaveShared(); } catch (error) { connectionError(error); } };
    if (collaboration.admin) {
      $("#createInviteBtn").onclick = async () => {
        const button = $("#createInviteBtn"); button.disabled = true;
        try {
          const base = $("#inviteBase").value.trim(); connectionLink(base, "validate", "validate");
          await collaboration.flush();
          if (collaboration.dirty || collaboration.busy) throw new Error("Sincronize a equipe com o host antes de gerar convites.");
          const result = await api(collaboration.path("/invites"), { method: "POST", token: collaboration.session.token, body: { memberId: $("#inviteMember").value } });
          sessionStorage.setItem("gf-public-origin", base);
          $("#inviteResult").value = connectionLink(base, result.roomId, result.token);
        } catch (error) { connectionError(error); } finally { if (button.isConnected) button.disabled = false; }
      };
      $("#copyInviteBtn").onclick = async () => {
        const input = $("#inviteResult");
        if (!input.value) return;
        try { await navigator.clipboard.writeText(input.value); toast("Convite copiado."); }
        catch { input.focus(); input.select(); toast("Link selecionado. Use Ctrl+C para copiar."); }
      };
    }
  } else {
    const getHost = async () => {
      const key = $("#hostKeyInput").value.trim();
      const info = await api("/api/host", { hostKey: key });
      sessionStorage.setItem("gf-host-key", key);
      $("#hostInfo").innerHTML = `<p class="settings-note">Endereços encontrados: ${info.addresses.map(esc).join(" · ") || "informe manualmente o IP da VPN no convite"}. Escolha o IP alcançável pela equipe.</p>${info.rooms.map(room => `<button class="hud-button" data-host-room="${esc(room.roomId)}">RETOMAR ${esc(room.name)}</button>`).join("")}`;
      $$('[data-host-room]').forEach(button => button.onclick = async () => {
        try { const result = await api(`/api/rooms/${encodeURIComponent(button.dataset.hostRoom)}/admin`, { method: "POST", hostKey: key }); await enterShared({ roomId: result.roomId, token: result.token }, result); }
        catch (error) { connectionError(error); }
      });
      return key;
    };
    $("#loadHostBtn").onclick = () => getHost().catch(connectionError);
    $("#publishSaveBtn").onclick = async () => {
      const button = $("#publishSaveBtn"); button.disabled = true;
      try {
        if (state.saveTimer) flushDocumentEdit();
        const key = await getHost();
        const result = await api("/api/rooms", { method: "POST", hostKey: key, body: { project: migrateProject(JSON.parse(JSON.stringify(project))) } });
        await enterShared({ roomId: result.roomId, token: result.token }, result);
      } catch (error) { connectionError(error); } finally { if (button.isConnected) button.disabled = false; }
    };
    $("#joinServerBtn").onclick = () => {
      try {
        const url = new URL($("#joinLink").value.trim());
        const params = new URLSearchParams(url.hash.slice(1));
        if (!params.get("room") || !params.get("token")) throw new Error("Cole o convite completo, incluindo o código após #.");
        const target = connectionLink(url.origin, params.get("room"), params.get("token"));
        location.assign(target);
        if (url.origin === location.origin) location.reload();
      } catch (error) { connectionError(error); }
    };
    if ($("#resumeConnectionBtn")) $("#resumeConnectionBtn").onclick = () => enterShared(JSON.parse(sessionStorage.getItem("gf-session"))).catch(connectionError);
  }
}

async function handleImport(file) {
  if (collaboration.active) return toast("Saia da sessão compartilhada antes de importar outro Save.");
  if (!file) return;
  try {
    const project = await importProject(file);
    if (state.projects.some(candidate => candidate.id === project.id)) {
      project.id = uid();
      project.docs.forEach(doc => { doc.projectId = project.id; });
      project.production.forEach(item => { item.projectId = project.id; });
      project.execution.forEach(item => { item.projectId = project.id; });
    }
    state.projects.push(project); state.selectedProjectId = project.id; state.activeProjectId = project.id; state.activeDocId = project.docs[0]?.id;
    persist(); closeModal(); renderSaves(); go("saves"); centerSelectedSave(); toast("<b>Save importado.</b> O projeto já está disponível offline.");
  } catch (error) { toast(`<b>Falha ao importar.</b> ${esc(error.message)}`); sound.play("ui_error"); }
  finally { $("#importFileInput").value = ""; }
}
function updateSoundLabel() { $("#soundToggle").textContent = `SOM: ${currentProject()?.settings.sound ? "ON" : "OFF"}`; }

function applyMarkdownCommand(mark) {
  if (state.editorMode === "markdown") {
    const editor = $("#visionEditor"), start = editor.selectionStart, end = editor.selectionEnd;
    const selected = editor.value.slice(start, end); const replacement = mark === "**" || mark === "*" ? `${mark}${selected}${mark}` : `${mark}${selected}`;
    editor.setRangeText(replacement, start, end, "end"); editor.dispatchEvent(new Event("input")); editor.focus(); return;
  }
  const commands = { "**": ["bold"], "*": ["italic"], "# ": ["formatBlock", "h1"], "## ": ["formatBlock", "h2"], "### ": ["formatBlock", "h3"], "- ": ["insertUnorderedList"], "> ": ["formatBlock", "blockquote"] };
  if (mark === "- [ ] ") document.execCommand("insertText", false, "☐ ");
  else if (commands[mark]) document.execCommand(commands[mark][0], false, commands[mark][1]);
  $("#liveEditor").dispatchEvent(new Event("input")); $("#liveEditor").focus();
}
function handleKeydown(event) {
  const modalOpen = !$("#modalBackdrop").classList.contains("hidden"), pauseOpen = !$("#pauseMenu").classList.contains("hidden");
  if (modalOpen && productionEditor?.handleKeydown(event)) return;
  if (event.key === "Escape" && !$("#contextMenu").classList.contains("hidden")) { visionSelection?.hide(); $("#contextMenu").classList.add("hidden"); visionSelection?.focusEditor(); event.preventDefault(); return; }
  if (event.key === "Escape") { if (modalOpen) return closeModal(); if (pauseOpen) return resumeMenu(); return pauseMenu(); }
  if (event.key === "Tab" && (modalOpen || pauseOpen)) {
    const overlay = modalOpen ? $("#modal") : $("#pauseMenu");
    const focusable = [...overlay.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [href], [tabindex="0"]')].filter(element => element.getClientRects().length > 0);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (!focusable.includes(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  if (modalOpen || pauseOpen) return;
  if (event.altKey && ["1", "2", "3"].includes(event.key) && state.currentScreen === "work") { event.preventDefault(); openStage(STAGES[Number(event.key) - 1]); }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "p" && state.currentStage === "vision" && state.currentScreen === "work") { event.preventDefault(); sendSelectionToProduction(); }
  if (state.currentScreen === "saves" && ["ArrowUp", "ArrowDown"].includes(event.key)) {
    event.preventDefault();
    navigateSave(event.key === "ArrowUp" ? -1 : 1);
  }
  if (state.currentScreen === "hub" && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    const index = STAGES.indexOf(state.hubSelectedStage);
    const nextIndex = Math.max(0, Math.min(STAGES.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)));
    if (nextIndex !== index) { selectHubStage(STAGES[nextIndex], true); sound.play("ui_click"); }
  }
  if (event.key === "Enter" && state.currentScreen === "hub") {
    event.preventDefault();
    launchHubStage($(`.stage-choice[data-stage="${state.hubSelectedStage}"]`));
  }
  if (event.key === "Enter" && state.currentScreen === "saves") { event.preventDefault(); openSelectedSave(); }
  if (event.key.toLowerCase() === "n" && state.currentScreen === "saves") { event.preventDefault(); createSaveModal(); }
}
function bindSectionActions() {
  $("#newDemandBtn").onclick = () => editProductionCard();
  $("#newTaskBtn").onclick = () => editTask();
}
function bindEvents() {
  bindSectionActions();
  $("#newSaveBtn").onclick = createSaveModal; $("#importSaveBtn").onclick = () => $("#importFileInput").click();
  $("#deleteSelectedSaveBtn").onclick = () => openDeleteSaveModal();
  $("#importFileInput").onchange = event => handleImport(event.target.files?.[0]); $("#openSaveBtn").onclick = openSelectedSave;
  $("#soundToggle").onclick = () => { if (!requireTeamAdmin()) return; currentProject().settings.sound = !currentProject().settings.sound; updateSoundLabel(); persist(); if (currentProject().settings.sound) sound.play("ui_click"); };
  $("#connectSaveBtn").onclick = openConnection;
  $("#saveWindow").addEventListener("wheel", event => {
    event.preventDefault();
    state.wheelDelta += event.deltaY;
    clearTimeout(state.wheelResetTimer);
    state.wheelResetTimer = setTimeout(() => {
      state.wheelLocked = false;
      state.wheelDelta = 0;
    }, 190);
    if (state.wheelLocked || Math.abs(state.wheelDelta) < 18) return;
    navigateSave(state.wheelDelta > 0 ? 1 : -1);
    state.wheelDelta = 0;
    state.wheelLocked = true;
  }, { passive: false });
  $$('[data-nav="saves"]').forEach(button => button.onclick = () => go("saves")); $$('[data-nav="hub"]').forEach(button => button.onclick = () => go("hub"));
  $("#workMenuBtn").onclick = pauseMenu;
  $("#pauseClose").onclick = resumeMenu;
  $("#pauseMenu").onclick = event => { if (event.target === $("#pauseMenu")) resumeMenu(); };
  $('[data-pause-action="resume"]').onclick = resumeMenu; $('[data-pause-action="hub"]').onclick = () => { resumeMenu(); go("hub"); };
  $('[data-pause-action="saves"]').onclick = () => { resumeMenu(); go("saves"); }; $('[data-pause-action="settings"]').onclick = () => { resumeMenu(); openSettings(); };
  $('[data-pause-action="team"]').onclick = () => { resumeMenu(); openTeam(); };
  $('[data-pause-action="connection"]').onclick = () => { resumeMenu(); openConnection(); };
  $("#newDocBtn").onclick = newDocument; $("#sendSelectionBtn").onclick = sendSelectionToProduction;
  $$('[data-work-stage]').forEach(button => button.onclick = () => openStage(button.dataset.workStage));
  $$("[data-prod-filter]").forEach(button => button.onclick = () => {
    $$("[data-prod-filter]").forEach(candidate => candidate.classList.remove("active")); button.classList.add("active");
    state.productionFilter = button.dataset.prodFilter; renderProduction(); sound.play("ui_click");
  });
  $("#docTitle").oninput = () => { currentDoc().title = $("#docTitle").value; schedulePersist(() => { commitDocumentEdit("Título editado"); renderDocumentList(); }); };
  $("#liveEditor").oninput = () => { syncLiveToMarkdown(); schedulePersist(() => commitDocumentEdit()); };
  $("#visionEditor").oninput = () => { currentDoc().markdown = $("#visionEditor").value; schedulePersist(() => commitDocumentEdit()); };
  $("#docStatusSelect").onchange = () => {
    currentDoc().status = $("#docStatusSelect").value; paintDocumentStatus(currentDoc().status);
    addHistory(currentProject(), "DOC_STATUS", `“${currentDoc().title}” marcado como ${statusLabel(currentDoc().status)}`); persist();
    renderDocumentList();
  };
  $$("[data-editor-mode]").forEach(button => button.onclick = () => setEditorMode(button.dataset.editorMode));
  $$(".markdown-toolbar button").forEach(button => button.onclick = () => applyMarkdownCommand(button.dataset.md));
  visionSelection = createVisionSelection({
    visual:$("#liveEditor"), markdown:$("#visionEditor"), menu:$("#contextMenu"),
    getMode:() => state.editorMode,
    isActive:() => state.currentScreen === "work" && state.currentStage === "vision" && $("#modalBackdrop").classList.contains("hidden") && $("#pauseMenu").classList.contains("hidden"),
    capture:captureSelection,
    clear:() => { state.selectionText = ""; $("#selectionInfo").textContent = ""; }
  });
  $$(".department").forEach(button => button.onclick = () => {
    $$(".department").forEach(candidate => candidate.classList.remove("active")); button.classList.add("active");
    state.department = button.dataset.dept; renderExecution(); sound.play("ui_click");
  });
  $("#modalClose").onclick = closeModal; $("#modalBackdrop").onclick = handleModalBackdropClick;
  document.addEventListener("keydown", handleKeydown); addEventListener("online", persist); addEventListener("offline", persist);
}

function animateParticles() {
  const canvas = $("#particleCanvas"), context = canvas.getContext("2d"); let particles = [];
  const resize = () => {
    canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio;
    canvas.style.width = `${innerWidth}px`; canvas.style.height = `${innerHeight}px`; context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    particles = Array.from({ length: 54 }, () => ({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, r: Math.random() * 1.1 + .2, vx: (Math.random() - .5) * .08, vy: (Math.random() - .5) * .08, a: Math.random() * .2 + .03 }));
  };
  const frame = () => {
    context.clearRect(0, 0, innerWidth, innerHeight);
    if (!currentProject()?.settings.reducedMotion) particles.forEach(particle => {
      particle.x = (particle.x + particle.vx + innerWidth) % innerWidth; particle.y = (particle.y + particle.vy + innerHeight) % innerHeight;
      context.beginPath(); context.fillStyle = `rgba(182,210,232,${particle.a})`; context.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2); context.fill();
    });
    requestAnimationFrame(frame);
  };
  addEventListener("resize", resize); resize(); frame();
}
function boot() {
  const savedSession = readConnectionLink();
  state.activeProjectId = currentProject().id; state.selectedProjectId ||= state.activeProjectId; state.activeDocId = currentProject().docs[0]?.id;
  document.documentElement.classList.toggle("reduced-motion", currentProject().settings.reducedMotion);
  bindEvents(); prepareStageCards(); renderSaves(); renderHub(); updateSoundLabel(); centerSelectedSave(); animateParticles(); persist();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").then(registration => registration.update()).catch(() => {});
  if (savedSession) enterShared(savedSession).catch(error => toast(`<b>Sessão não retomada.</b> ${esc(error.message)} Abra Conexão para tentar novamente.`));
  addEventListener("beforeunload", event => {
    if (state.saveTimer) flushDocumentEdit();
    if (collaboration.dirty) { event.preventDefault(); event.returnValue = ""; }
  });
}
boot();

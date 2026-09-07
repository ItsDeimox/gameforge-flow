export const STAGES = ["vision", "production", "execution"];
export const MEMBER_PERMISSIONS = [
  ["vision", "Visão"], ["production", "Produção"], ["execution", "Execução"],
  ["comments", "Comentários"], ["files", "Arquivos"],
  ["team", "Gerenciar equipe"], ["settings", "Configurações"]
];
export const DEFAULT_MEMBER_PERMISSIONS = ["vision", "production", "execution", "comments", "files"];

export const PROD_COLUMNS = [
  ["inbox", "INBOX"],
  ["breakdown", "BREAKDOWN"],
  ["ready", "READY"],
  ["execution", "EXECUTION"]
];

export const EXEC_COLUMNS = [
  ["todo", "TODO"],
  ["doing", "IN PROGRESS"],
  ["blocked", "BLOCKED"],
  ["review", "REVIEW"],
  ["done", "DONE"]
];

export const CATEGORIES = [
  ["design", "Game Design"],
  ["code", "Programming"],
  ["level", "Level Design"],
  ["art2d", "2D Art"],
  ["art", "3D Art"],
  ["animation", "Animation"],
  ["vfx", "VFX"],
  ["techart", "Technical Art"],
  ["ui", "UI/UX"],
  ["audio", "Audio"],
  ["music", "Music"],
  ["lore", "Narrative"],
  ["qa", "QA"],
  ["production", "Production"]
];

export const PRIORITIES = [
  ["low", "Baixa"],
  ["normal", "Normal"],
  ["high", "Alta"],
  ["critical", "Crítica"]
];

export const DOC_STATUSES = {
  draft: "RASCUNHO",
  experiment: "EXPERIMENTO",
  probable: "PROVÁVEL",
  canon: "CANÔNICO",
  deprecated: "DEPRECIADO"
};

export function uid() {
  return globalThis.crypto?.randomUUID?.() || `gf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function now() {
  return new Date().toISOString();
}

export function categoryLabel(category) {
  if (category === "unclassified") return "A classificar";
  return CATEGORIES.find(([key]) => key === category)?.[1] || String(category || "Geral");
}

export function statusLabel(status) {
  return DOC_STATUSES[status] || DOC_STATUSES.draft;
}

export function createProject(name = "Pentagory", starter = true) {
  const projectId = uid();
  const createdAt = now();
  const mainDoc = {
    id: uid(),
    projectId,
    parentId: null,
    title: "Visão do Projeto",
    markdown: starter ? `# ${name}\n\n## Experiência central\nExploração em primeira pessoa, puzzle e descoberta.\n\nO jogador deve sentir que está montando uma verdade proibida **peça por peça**.\n\n> A ambientação precisa contar história antes do texto contar.\n\n### Level 0\n- [ ] Câmara embrionária\n- [ ] Câmara do traje\n- [ ] Mezanino / servidores\n- [ ] Sala de religar sistemas\n- [ ] Saída / elevador\n\nSelecione qualquer trecho e envie para **Produção**.` : `# ${name}\n\nComece pela direção criativa do jogo.\n`,
    status: starter ? "canon" : "draft",
    tags: ["core"],
    attachments: [],
    comments: [],
    revision: 1,
    createdAt,
    updatedAt: createdAt
  };

  const project = {
    schemaVersion: 5,
    id: projectId,
    name,
    createdAt,
    updatedAt: createdAt,
    settings: {
      sound: true,
      volume: 0.65,
      reducedMotion: false,
      shortcuts: { vision: "Alt+1", production: "Alt+2", execution: "Alt+3" }
    },
    docs: [mainDoc],
    production: [],
    execution: [],
    members: starter ? [
      { id: uid(), name: "Deimox", role: "Creative Director", specialties: ["design", "code"], permissions: [...DEFAULT_MEMBER_PERMISSIONS] },
      { id: uid(), name: "Iki", role: "Producer", specialties: ["production"], permissions: [...DEFAULT_MEMBER_PERMISSIONS] }
    ] : [],
    history: []
  };

  if (starter) {
    project.production.push(
      productionItem(project, {
        text: "Graybox da Câmara Embrionária com rota principal legível.",
        category: "level",
        status: "breakdown",
        priority: "high",
        sourceDocumentId: mainDoc.id,
        sourceDocumentTitle: mainDoc.title,
        sourceRevision: mainDoc.revision,
        sourceExcerpt: "Câmara embrionária"
      }),
      productionItem(project, {
        text: "Shader do portal central com leitura clara a distância.",
        category: "vfx",
        status: "ready",
        deadline: "3 dias",
        sourceDocumentId: mainDoc.id,
        sourceDocumentTitle: mainDoc.title,
        sourceRevision: mainDoc.revision,
        sourceExcerpt: "A ambientação precisa contar história antes do texto contar."
      })
    );
    project.execution.push(task(project, {
      text: "Sistema de interação base em C#",
      category: "code",
      status: "doing",
      assignee: "Deimox",
      priority: "high"
    }));
  }

  addHistory(project, "PROJECT_CREATED", `Save “${name}” criado`, "Sistema");
  return project;
}

export function productionTitle(markdown = "") {
  const firstLine = String(markdown).split(/\r?\n/).find(line => line.trim() && !/^\s*(```|~~~|[-*_]{3,}\s*$)/.test(line)) || "";
  const title = firstLine.trim()
    .replace(/^(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/, "")
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]/g, "").replace(/\s+/g, " ").trim();
  const chars = Array.from(title);
  return chars.length > 100 ? chars.slice(0, 99).join("").trimEnd() + "…" : title || "Nova demanda";
}

// Older Vision transfers stored the whole excerpt in `text` (the title).
// Present a corrected draft without mutating the saved item just by opening it.
export function productionContent(item) {
  const text = String(item.text || ""), description = String(item.description || "");
  if (item.contentLayout === "title-description") return { text, description };
  const emptyDescription = !description.trim();
  const hasBodyInTitle = /\r?\n/.test(text.trim()) || text.length > 140
    || (emptyDescription && (item.sourceDocumentId || /^\s*(?:#{1,6}\s|>\s|[-*+]\s|\d+[.)]\s|```)/.test(text)));
  if (!text.trim() || !hasBodyInTitle) return { text, description };
  return {
    text: productionTitle(text),
    description: emptyDescription ? text : description === text || description.startsWith(text + "\n") ? description : `${text}\n\n${description}`
  };
}

export function productionItem(project, partial = {}) {
  const createdAt = now();
  return {
    id: uid(),
    projectId: project.id,
    parentId: null,
    sourceDocumentId: null,
    sourceDocumentTitle: "Manual",
    sourceRevision: null,
    sourceExcerpt: "",
    text: "Novo item",
    description: "",
    category: "design",
    status: "inbox",
    priority: "normal",
    estimate: "",
    deadline: "Sem prazo",
    tags: [],
    dependencies: [],
    subtasks: [],
    attachments: [],
    comments: [],
    assigneeId: null,
    assignee: "Não atribuído",
    createdAt,
    updatedAt: createdAt,
    ...partial
  };
}

// Creative intent is a source snapshot, not a production scheduling decision.
export function createVisionHandoff(project, doc, { title = "", description = "", excerpt = "", creativeStatus = doc.status || "draft", priority = "normal" } = {}) {
  if (!description.trim()) throw new Error("Informe a descrição para enviar à Produção.");
  if (!Object.hasOwn(DOC_STATUSES, creativeStatus)) throw new Error("Selecione um status criativo válido.");
  if (!PRIORITIES.some(([key]) => key === priority)) throw new Error("Selecione uma prioridade sugerida válida.");
  return productionItem(project, {
    text: title.trim() || productionTitle(description), description, contentLayout: "title-description",
    creativeStatus, suggestedPriority: priority, priority,
    category: "unclassified", status: "inbox", deadline: "Sem prazo", assigneeId: null, assignee: "Não atribuído",
    sourceDocumentId: doc.id, sourceDocumentTitle: doc.title, sourceRevision: doc.revision, sourceExcerpt: excerpt
  });
}

export function task(project, partial = {}) {
  const createdAt = now();
  return {
    id: uid(),
    projectId: project.id,
    productionItemId: null,
    visionDocumentId: null,
    text: "Nova tarefa",
    description: "",
    category: "design",
    department: "design",
    assignee: "Não atribuído",
    assigneeId: null,
    status: "todo",
    priority: "normal",
    deadline: "Sem prazo",
    dependencies: [],
    subtasks: [],
    attachments: [],
    comments: [],
    createdAt,
    updatedAt: createdAt,
    ...partial
  };
}

export function addHistory(project, type, message, actor = "Você", meta = {}) {
  project.history ||= [];
  project.history.unshift({ id: uid(), type, message, actor, at: now(), meta });
  project.history = project.history.slice(0, 300);
  project.updatedAt = now();
}

export function sourceState(project, item) {
  if (!item.sourceDocumentId) return "manual";
  const doc = project.docs.find(candidate => candidate.id === item.sourceDocumentId);
  if (!doc) return "missing";
  return doc.revision === item.sourceRevision ? "linked" : "changed";
}

export function migrateProject(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Save inválido");
  const project = { ...raw };
  project.schemaVersion = 5;
  project.id ||= uid();
  project.name ||= "Untitled Save";
  project.createdAt ||= now();
  project.updatedAt ||= now();
  project.settings = {
    sound: project.settings?.sound ?? project.sound ?? true,
    volume: Number(project.settings?.volume ?? 0.65),
    reducedMotion: Boolean(project.settings?.reducedMotion),
    shortcuts: project.settings?.shortcuts || { vision: "Alt+1", production: "Alt+2", execution: "Alt+3" }
  };
  project.docs = (project.docs || []).map(doc => ({
    id: doc.id || uid(),
    projectId: project.id,
    parentId: doc.parentId || null,
    title: doc.title || "Documento",
    markdown: doc.markdown ?? doc.content ?? "",
    status: doc.status || "draft",
    tags: doc.tags || [],
    attachments: Array.isArray(doc.attachments) ? doc.attachments : [],
    comments: Array.isArray(doc.comments) ? doc.comments : [],
    revision: Number(doc.revision || 1),
    createdAt: doc.createdAt || now(),
    updatedAt: doc.updatedAt || now()
  }));
  if (!project.docs.length) project.docs = createProject(project.name, false).docs.map(doc => ({ ...doc, projectId: project.id }));
  const statusMap = { backlog: "inbox", scheduled: "ready" };
  project.production = (project.production || []).map(item => productionItem(project, {
    ...item,
    status: statusMap[item.status] || item.status || "inbox",
    sourceDocumentTitle: item.sourceDocumentTitle || item.source || "Manual"
  }));
  project.execution = (project.execution || []).map(item => task(project, {
    ...item,
    department: item.department || item.category || "design"
  }));
  project.members = (project.members || []).map(member => ({
    id: member.id || uid(), name: String(member.name || "Sem nome"), role: String(member.role || "Colaborador"),
    specialties: [...new Set((member.specialties || []).filter(value => CATEGORIES.some(([key]) => key === value)))],
    permissions: [...new Set((Array.isArray(member.permissions) ? member.permissions : DEFAULT_MEMBER_PERMISSIONS)
      .filter(value => MEMBER_PERMISSIONS.some(([key]) => key === value)))]
  }));
  for (const item of [...project.production, ...project.execution]) {
    const matches = project.members.filter(member => member.name === item.assignee);
    const member = project.members.find(member => member.id === item.assigneeId) || (!item.assigneeId && matches.length === 1 ? matches[0] : null);
    item.assigneeId = member?.id || null;
    if (member) item.assignee = member.name;
  }
  project.history ||= [];
  return project;
}

export function eligibleMembers(project, category, all = false) {
  return project.members.filter(member => all || member.specialties?.includes(category));
}

export function assignMember(project, item, memberId) {
  const member = project.members.find(candidate => candidate.id === memberId);
  if (memberId && !member) throw new Error("Esse membro não faz mais parte da equipe deste Save.");
  item.assigneeId = member?.id || null;
  item.assignee = member?.name || "Não atribuído";
  return item;
}

export function saveMember(project, { id, name, role, specialties, permissions }) {
  name = String(name || "").trim();
  if (!name || name.length > 80) throw new Error("Informe um nome com até 80 caracteres.");
  if (project.members.some(member => member.id !== id && member.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("Já existe um membro com esse nome neste Save.");
  const member = id ? project.members.find(member => member.id === id) : { id: uid() };
  if (!member) throw new Error("Membro não encontrado.");
  Object.assign(member, {
    name,
    role: String(role || "Colaborador").trim().slice(0, 100),
    specialties: [...new Set((specialties || []).filter(value => CATEGORIES.some(([key]) => key === value)))],
    permissions: [...new Set((permissions || member.permissions || DEFAULT_MEMBER_PERMISSIONS)
      .filter(value => MEMBER_PERMISSIONS.some(([key]) => key === value)))]
  });
  if (!id) project.members.push(member);
  for (const item of [...project.production, ...project.execution]) if (item.assigneeId === member.id) item.assignee = member.name;
  addHistory(project, id ? "MEMBER_UPDATED" : "MEMBER_ADDED", `${id ? "Membro atualizado" : "Membro adicionado"}: ${name}`);
  return member;
}

export function removeMember(project, memberId) {
  const member = project.members.find(member => member.id === memberId);
  if (!member) return;
  project.members = project.members.filter(member => member.id !== memberId);
  for (const item of [...project.production, ...project.execution]) if (item.assigneeId === memberId) assignMember(project, item, null);
  addHistory(project, "MEMBER_REMOVED", `Membro removido: ${member.name}. Demandas e tarefas foram desatribuídas.`);
}

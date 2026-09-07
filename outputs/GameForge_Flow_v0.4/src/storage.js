import { createProject, migrateProject } from "./domain.js";

const STORAGE_KEY = "gameforge-flow-v4";
const LEGACY_KEY = "gameforge-flow-prototype-v3";

export function loadWorkspace() {
  const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY);
  if (!raw) {
    const project = createProject();
    return { projects: [project], selectedProjectId: project.id, activeProjectId: project.id };
  }
  try {
    const parsed = JSON.parse(raw);
    const candidates = parsed.projects || parsed.saves || [];
    const projects = candidates.map(migrateProject);
    if (!projects.length) projects.push(createProject());
    return {
      projects,
      selectedProjectId: parsed.selectedProjectId || parsed.selectedSaveId || projects[0].id,
      activeProjectId: parsed.activeProjectId || parsed.activeSaveId || projects[0].id
    };
  } catch (error) {
    console.warn("Falha ao carregar workspace", error);
    const project = createProject();
    return { projects: [project], selectedProjectId: project.id, activeProjectId: project.id };
  }
}

export function saveWorkspace(workspace) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    schemaVersion: 5,
    projects: workspace.projects,
    selectedProjectId: workspace.selectedProjectId,
    activeProjectId: workspace.activeProjectId
  }));
}

export function downloadProject(project) {
  const payload = JSON.stringify({ type: "gameforge-flow-save", version: 5, project }, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${project.name.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-|-$/g, "") || "gameforge-save"}.gameforge.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function importProject(file) {
  const parsed = JSON.parse(await file.text());
  if (parsed.type !== "gameforge-flow-save" || !parsed.project) throw new Error("Arquivo não é um Save do GameForge Flow");
  return migrateProject(parsed.project);
}

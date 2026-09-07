const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.GAMEFORGE_PLAYWRIGHT || "C:/Users/kevin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");

(async () => {
  const root = path.resolve(__dirname, "..");
  const appRoot = path.join(root, "outputs", "GameForge_Flow_v0.4");
  const out = path.join(root, "docs", "screenshots");
  fs.mkdirSync(out, { recursive: true });

  const domain = await import(pathToFileURL(path.join(appRoot, "src", "domain.js")));
  const project = domain.createProject("Pentagory", true);
  project.settings.sound = false;
  project.members.push(
    { id: "bia-vfx", name: "Bia", role: "VFX Artist", specialties: ["vfx", "art3d"], permissions: [...domain.DEFAULT_MEMBER_PERMISSIONS] },
    { id: "leo-audio", name: "Leo", role: "Sound Designer", specialties: ["audio", "music"], permissions: [...domain.DEFAULT_MEMBER_PERMISSIONS] }
  );
  project.docs.push({
    ...project.docs[0], id: "world-doc", title: "Mundo e atmosfera", status: "probable", revision: 3,
    markdown: "# Mundo e atmosfera\n\n## Linguagem visual\nRuínas tecnológicas, névoa volumétrica e arquitetura que reage à presença do jogador.\n\n> A luz revela caminhos sem quebrar o mistério."
  });
  project.production.push(
    domain.productionItem(project, { text: "Portal central com leitura clara à distância", description: "Criar o shader, a silhueta e a resposta luminosa do portal.", category: "vfx", status: "ready", priority: "high", deadline: "3 dias", assigneeId: "bia-vfx", assignee: "Bia", contentLayout: "title-description" }),
    domain.productionItem(project, { text: "Paisagem sonora da câmara", description: "Definir camadas ambientes e resposta dos sistemas ao jogador.", category: "audio", status: "breakdown", priority: "normal", deadline: "5 dias", assigneeId: "leo-audio", assignee: "Leo", contentLayout: "title-description" }),
    domain.productionItem(project, { text: "Teste de integração do pipeline", description: "Validar importação, iluminação e colisões na build atual.", category: "qa", status: "inbox", priority: "normal", contentLayout: "title-description" })
  );
  project.execution.push(
    domain.task(project, { text: "Shader do portal central", description: "Implementar pulso, distorção e emissivo do portal.", category: "vfx", department: "art", status: "review", assigneeId: "bia-vfx", assignee: "Bia", priority: "high", deadline: "Amanhã", subtasks: [{ text: "Emissivo base", done: true }, { text: "Pulso de energia", done: true }, { text: "Integração na cena", done: false }] }),
    domain.task(project, { text: "Áudio reativo dos sistemas", description: "Conectar estados de energia ao ambiente sonoro.", category: "audio", department: "audio", status: "todo", assigneeId: "leo-audio", assignee: "Leo", priority: "normal", deadline: "5 dias" })
  );
  const aurora = domain.createProject("Project Aurora", false);
  const nebula = domain.createProject("Project Nebula", false);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.GAMEFORGE_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe" });

  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, serviceWorkers: "block" });
    await context.addInitScript(data => localStorage.setItem("gameforge-flow-v4", JSON.stringify(data)), {
      projects: [project, aurora, nebula], activeProjectId: project.id, selectedProjectId: project.id
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("http://127.0.0.1:8765/?readme=090", { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, "01-save-selection.png") });

    await page.locator("#openSaveBtn").click();
    await page.locator('.stage-choice[data-stage="vision"]').click();
    await page.locator("#visionPanel").waitFor({ state: "visible" });
    await page.waitForTimeout(850);
    await page.screenshot({ path: path.join(out, "02-vision.png") });

    await page.locator('[data-work-stage="production"]').click();
    await page.locator("#productionPanel").waitFor({ state: "visible" });
    await page.locator(".production-demand").nth(2).click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(out, "03-production.png") });

    await page.locator(".production-demand").nth(2).locator("[data-edit-production]").click();
    await page.locator("#prodDescription").waitFor({ state: "attached" });
    await page.waitForTimeout(850);
    await page.screenshot({ path: path.join(out, "04-demand-editor.png") });
    await page.locator("#modalClose").click();

    await page.locator('[data-work-stage="execution"]').click();
    await page.locator("#executionPanel").waitFor({ state: "visible" });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(out, "05-execution.png") });

    await page.locator("#workMenuBtn").click();
    await page.locator('[data-pause-action="team"]').click();
    await page.locator(".team-modal").waitFor({ state: "visible" });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, "06-team.png") });

    if (errors.length) throw new Error(`Erros na página: ${errors.join(" | ")}`);
    console.log(`Capturas salvas em ${out}`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

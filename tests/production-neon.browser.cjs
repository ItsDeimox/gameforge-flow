// Isolated local UI QA. Never connects to an existing browser/profile or team room.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.GAMEFORGE_PLAYWRIGHT || 'C:/Users/kevin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const {createProject,productionItem} = await import(pathToFileURL(path.join(root,'outputs/GameForge_Flow_v0.4/src/domain.js')));
  const project = createProject('QA visual — dados fictícios', false);
  project.settings.sound = false;
  project.members = [{id:'bia',name:'Bia',role:'VFX Artist',specialties:['vfx'],permissions:['vision','production','execution']}];
  const samples = [
    ['atmosfera','Atmosfera da câmara','unclassified','inbox','Sensação de descoberta e isolamento.'],
    ['contato','Primeiro contato','unclassified','inbox','Definir a intenção do encontro.'],
    ['portal','Portal central','vfx','breakdown','Testar leitura à distância e chegada do jogador.'],
    ['rota','Rota principal','level','breakdown','Definir a rota e os pontos de interesse.'],
    ['interacao','Sistema de interação','code','ready','Interação base com os objetos do cenário.'],
    ['som','Som do portal','audio','ready','Entrada e saída do portal.']
  ];
  project.production = samples.map(([id,text,category,status,description]) => productionItem(project,{id,text,category,status,description,contentLayout:'title-description',sourceDocumentId:project.docs[0].id,sourceDocumentTitle:'Visão do Projeto',sourceRevision:1,priority:id==='portal'?'high':'normal',assigneeId:id==='portal'?'bia':null,assignee:id==='portal'?'Bia':'Não atribuído'}));
  const captureName = process.argv[2] === 'before' ? 'before' : 'after';
  const out = path.join(root,'outputs/qa/neon-v0.8.3'); fs.mkdirSync(out,{recursive:true});
  const browser = await chromium.launch({headless:true,executablePath:process.env.GAMEFORGE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try {
    const context = await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,serviceWorkers:'block'});
    await context.addInitScript(data => localStorage.setItem('gameforge-flow-v4',JSON.stringify({projects:[data],activeProjectId:data.id,selectedProjectId:data.id})),project);
    const page = await context.newPage(), errors = [];
    page.on('pageerror',error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8765/?qa=neon',{waitUntil:'networkidle'});
    await page.locator('#openSaveBtn').click();
    await page.locator('.stage-choice.production').click();
    await page.locator('#productionPanel').waitFor({state:'visible'});
    const card = page.locator('.production-demand[data-id="portal"]');
    await card.click();
    await page.waitForTimeout(700);
    await page.screenshot({path:path.join(out,`${captureName}-1920.png`)});
    if (captureName === 'before') { assert.deepEqual(errors,[]); return; }
    // Hover must not move or resize content, and completed glow stays visible.
    const bounds = await card.boundingBox(); await card.hover(); await page.waitForTimeout(250);
    assert.deepEqual(await card.boundingBox(),bounds);
    assert.equal(await card.locator('.demand-card-rule').getAttribute('aria-hidden'),'true');
    await page.waitForTimeout(950);
    assert.equal(await card.locator('.demand-card-rule circle').evaluate(el=>getComputedStyle(el).opacity),'1');
    for (const [width,height] of [[2560,1440],[1366,768],[390,844]]) {
      await page.setViewportSize({width,height}); await page.waitForTimeout(500);
      const panelBounds = await page.locator('#productionPanel').boundingBox();
      assert.ok(panelBounds.width<=width+1 && panelBounds.x>=-1, 'the active panel must fit; its board may scroll horizontally');
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(out,`${captureName}-${width}.png`)});
    }
    await page.setViewportSize({width:1920,height:1080});
    await page.locator('[data-prod-filter="qa"]').click();
    assert.equal(await page.locator('.production-demand').count(),0);
    assert.equal(await page.locator('#productionPanel').evaluate(el=>el.style.getPropertyValue('--production-focus-x')),'50%');
    await page.locator('[data-prod-filter="all"]').click();
    const readyCard = page.locator('.production-demand[data-id="interacao"]');
    await readyCard.click();
    assert.ok(Number.parseFloat(await page.locator('#productionPanel').evaluate(el=>el.style.getPropertyValue('--production-focus-x'))) > 83);
    await readyCard.dragTo(page.locator('[data-prod-drop="breakdown"]'));
    assert.equal(await page.locator('[data-prod-drop="breakdown"] .production-demand[data-id="interacao"]').count(),1);
    assert.equal(await page.locator('#productionPanel').evaluate(el=>el.style.getPropertyValue('--production-focus-x')),'50%');
    await readyCard.dragTo(page.locator('[data-prod-drop="ready"]'));
    await card.click();
    await page.locator('[data-edit-production="portal"]').click();
    await page.locator('#prodDescription').waitFor({state:'attached'});
    await page.waitForTimeout(1100); await page.screenshot({path:path.join(out,'after-modal.png')});
    await page.locator('#prodMarkdownBtn').click();
    assert.equal(await page.locator('#prodDescription').inputValue(),samples[2][4]);
    await page.locator('#modalClose').click();
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.locator('.production-demand[data-id="rota"]').click();
    const animation = await page.locator('.production-demand.selected .demand-card-rule').evaluate(el=>getComputedStyle(el).animationName);
    assert.equal(animation,'none');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({screens:[1920,2560,1366,390],hoverStable:true,filters:true,dragDrop:true,glowFollowsSelection:true,modalIntact:true,reducedMotion:true,pageErrors:errors,captures:out}));
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});

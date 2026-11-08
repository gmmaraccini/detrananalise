'use strict';

const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const parsePdf = require('pdf-parse/lib/pdf-parse');

const URL_INICIAL = 'https://getran.detran.pi.gov.br/site/apps/veiculo/servicos/e-crlv/filtro-e-crlv-emissao.jsp';
const PRAZO = 80000;
let browser;
let finished = false;
const seguranca = { token_enviado: false, tamanho_token: 0, dados_enviados: false, cookie_sessao: false };

class PortalError extends Error {
  constructor(message, details) { super(message); this.details = details; }
}

function finish(result) {
  if (finished) return;
  finished = true;
  process.stdout.write(JSON.stringify(result), () => process.exit(result.status === 'ok' ? 0 : 1));
}
const timer = setTimeout(() => finish({ status: 'erro', etapa: 'tempo', mensagem: 'Tempo limite da consulta excedido.' }), PRAZO);

function pdfResult(bytes) {
  if (!bytes || bytes.length < 8 || bytes.length > 20 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== '%PDF-') return null;
  return { status: 'ok', content_type: 'application/pdf', pdf_base64: bytes.toString('base64') };
}

async function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: process.env.HEADLESS !== 'false', args: process.env.CHROME_NO_SANDBOX === '1' ? ['--no-sandbox'] : [] });
  const context = await browser.newContext({ acceptDownloads: true });
  // O portal pode criar campos homônimos: um textarea vazio precede o token
  // válido. Servlets que leem o primeiro parâmetro acabam recebendo vazio.
  // Preserva o token gerado pelo próprio portal e remove somente duplicatas.
  await context.addInitScript(() => {
    const submit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
      const fields = Array.from(this.querySelectorAll('[name="g-recaptcha-response"]'));
      const populated = fields.filter(field => field.value);
      if (new Set(populated.map(field => field.value)).size === 1) {
        for (const field of fields) if (field !== populated[0]) field.remove();
      }
      return submit.call(this);
    };
  });
  const page = await context.newPage();
  const navegacao = [];
  page.on('request', async request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/consulta-veiculo-emissao.jsp')) {
      const body = new URLSearchParams(request.postData() || '');
      const token = body.get('g-recaptcha-response') || '';
      seguranca.token_enviado = !!token;
      seguranca.tamanho_token = token.length;
      seguranca.tamanhos_tokens = body.getAll('g-recaptcha-response').map(value => value.length);
      const values = Array.from(body.values());
      seguranca.dados_enviados = values.includes(input.placa) && values.includes(input.renavam);
      seguranca.cookie_sessao = /JSESSIONID=/.test((await request.allHeaders()).cookie || '');
    }
  });
  seguranca.recursos = [];
  page.on('requestfailed', request => {
    const url = new URL(request.url());
    if (/recaptcha|gstatic/.test(url.href)) seguranca.recursos.push({host: url.hostname, caminho: url.pathname, erro: request.failure()?.errorText});
  });
  let falhaSeguranca = false;
  page.on('dialog', async dialog => {
    if (/falha.*valida[cç][aã]o.*seguran[cç]a/i.test(dialog.message())) falhaSeguranca = true;
    await dialog.dismiss().catch(() => {});
  });
  page.on('response', response => {
    if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
      const url = new URL(response.url());
      navegacao.push({ pagina: url.pathname.split('/').pop(), status: response.status() });
    }
  });
  page.setDefaultTimeout(15000);
  let captured = null;
  let pending = [];
  function observe(p) {
    p.on('response', response => {
      const type = (response.headers()['content-type'] || '').toLowerCase();
      if (type.includes('application/pdf')) {
        const task = response.body().then(pdfResult).then(result => { if (result) captured = result; }).catch(() => {});
        pending.push(task);
      }
    });
    p.on('download', download => {
      const task = download.path().then(path => path && fs.promises.readFile(path)).then(pdfResult).then(result => { if (result) captured = result; }).catch(() => {});
      pending.push(task);
    });
  }
  context.on('page', observe);
  observe(page);
  await page.goto(URL_INICIAL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  if (!await page.getByText('Impressão do CRLV', { exact: false }).count()) throw new Error('Página inicial inesperada.');
  await page.getByRole('textbox', { name: /placa/i }).fill(input.placa).catch(async () => page.locator('input[title="Placa"]').fill(input.placa));
  await page.locator('input[title="Renavam"]').fill(input.renavam);
  // O portal gera o token pelo seu próprio JavaScript. Uma recusa do reCAPTCHA é reportada.
  await page.waitForFunction(() => typeof window.grecaptcha !== 'undefined' && !!document.querySelector('input[name="g-recaptcha-response"]')?.value, null, { timeout: 20000 }).catch(() => {});
  seguranca.navegador = await page.evaluate(() => ({ api: typeof window.grecaptcha !== 'undefined', campos: Array.from(document.querySelectorAll('[name="g-recaptcha-response"]')).map(el => ({tag: el.tagName, tamanho: el.value.length})), scripts: Array.from(document.scripts).filter(el => /recaptcha/.test(el.src)).map(el => new URL(el.src).pathname), botao_classe: document.querySelector('#submeter').className }));
  await page.locator('#submeter').click();
  await page.waitForURL(/consulta-veiculo-emissao\.jsp/, { timeout: 18000 }).catch(() => {});
  if (!page.url().includes('consulta-veiculo-emissao.jsp')) {
    if (falhaSeguranca) throw new Error('O portal recusou a validação de segurança. Tente novamente mais tarde.');
    throw new Error('O portal não avançou para a confirmação do proprietário; a validação de segurança pode ter falhado.');
  }
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  // O endereço pode mudar antes de o formulário anterior sair do DOM.
  await page.waitForFunction(() => !document.querySelector('form[action*="consulta-veiculo-emissao"]'), null, { timeout: 8000 }).catch(() => {});
  const textoConsulta = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  // O portal também pode entregar os acentos como caracteres de substituição.
  if (/\bve[ií\uFFFD]culo\s+n[aã\uFFFD]o\s+cadastrado\b/i.test(textoConsulta)) {
    throw new PortalError('Veículo não cadastrado.');
  }
  if (await page.locator('form[action*="consulta-veiculo-emissao"]').count()) {
    if (falhaSeguranca) throw new Error('O portal recusou a validação de segurança. Tente novamente mais tarde.');
    throw new PortalError('O portal retornou à consulta inicial; não houve confirmação do proprietário.', { navegacao });
  }
  let form = page.locator('form[action*="processa-emissao-crlv"]');
  // Algumas versões submetem o formulário por JavaScript e não usam esse action.
  if (!await form.count()) {
    const candidates = page.locator('form').filter({ has: page.locator('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio])') });
    if (await candidates.count() === 1 && /documento|propriet[aá]rio|\bcpf\b/i.test(await candidates.first().innerText())) form = candidates.first();
  }
  if (!await form.count()) {
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    if (/falha.{0,80}(?:seguran[cç]a|recaptcha)|(?:seguran[cç]a|recaptcha).{0,80}(?:falha|inv[aá]lid|erro)/i.test(body)) throw new Error('O portal recusou a validação de segurança.');
    if (/sess[aã]o expir/i.test(body)) throw new Error('A sessão no portal expirou.');
    const details = await page.locator('form').evaluateAll(forms => forms.map(form => {
      const rawAction = form.getAttribute('action') || '';
      const action = rawAction.split('?')[0].split('/').pop();
      return {
        destino: /^[a-z0-9_.-]{1,80}$/i.test(action) ? action : '(não informado ou dinâmico)',
        campos_visiveis: form.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button])').length,
        tem_documento: /documento|propriet[aá]rio|\bcpf\b/i.test(form.innerText),
        tem_imprimir: /imprimir/i.test(form.innerText + ' ' + Array.from(form.querySelectorAll('input[type=submit]')).map(e => e.value).join(' '))
      };
    }));
    throw new PortalError('O portal não apresentou um formulário de proprietário reconhecido.', {
      pagina_menciona_documento: /documento|propriet[aá]rio|\bcpf\b/i.test(body),
      pagina_menciona_veiculo_nao_encontrado: /ve[ií]culo.{0,40}n[aã]o.{0,30}(?:encontrad|localizad)/i.test(body),
      pagina_menciona_erro: /erro|falha|inv[aá]lid|n[aã]o encontrad/i.test(body),
      formularios: details
    });
  }
  const externalDocument = page.locator('#cpfCnpjInput');
  const fields = await externalDocument.count() === 1 ? externalDocument : form.locator('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]):not([disabled]):not([readonly])');
  const fieldDetails = await fields.evaluateAll(elements => elements.map(el => {
    const labels = Array.from(el.labels || []).map(label => label.innerText).join(' ');
    const hint = [labels, el.getAttribute('name'), el.id, el.getAttribute('placeholder'), el.getAttribute('title'), el.getAttribute('aria-label')].join(' ');
    return {
      tipo: (el.getAttribute('type') || 'text').toLowerCase(),
      documento: /cpf|cnpj|documento/i.test(hint),
      placa: /placa/i.test(hint),
      renavam: /renavam/i.test(hint),
      visivel: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
    };
  }));
  const visible = fieldDetails.map((field, index) => ({ ...field, index })).filter(field => field.visivel);
  const named = visible.filter(field => field.documento && !field.placa && !field.renavam);
  const possible = named.length === 1 ? named : visible.filter(field => !field.placa && !field.renavam);
  if (possible.length !== 1) throw new PortalError('Não foi possível identificar com segurança o campo do CPF na segunda página.', { campos: fieldDetails });
  await fields.nth(possible[0].index).fill(input.cpf);
  const submit = form.locator('button[type=submit], input[type=submit], button:not([type]), input[type=button]').first();
  if (!await submit.count()) throw new Error('Botão de emissão não encontrado.');
  await submit.click();
  const deadline = Date.now() + 25000;
  while (!captured && Date.now() < deadline) {
    await Promise.allSettled(pending);
    pending = [];
    if (!captured) await page.waitForTimeout(500);
  }
  if (!captured) throw new Error('O portal não retornou um PDF válido; a emissão não foi confirmada.');
  const pdf = await parsePdf(Buffer.from(captured.pdf_base64, 'base64'));
  const text = pdf.text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  captured.verificacao_conteudo = {
    paginas: pdf.numpages,
    placa_confere: text.includes(input.placa),
    renavam_confere: text.includes(input.renavam),
    cpf_confere: text.includes(input.cpf)
  };
  if (!captured.verificacao_conteudo.placa_confere || !captured.verificacao_conteudo.renavam_confere || !captured.verificacao_conteudo.cpf_confere) {
    throw new Error('O portal retornou um PDF cujo conteúdo não confirma os dados solicitados.');
  }
  const pdfDirectory = path.join(__dirname, 'pdfs');
  const pdfFilename = `crlv-${randomUUID()}.pdf`;
  try {
    await fs.promises.mkdir(pdfDirectory, { recursive: true, mode: 0o700 });
    await fs.promises.writeFile(path.join(pdfDirectory, pdfFilename), Buffer.from(captured.pdf_base64, 'base64'), { flag: 'wx', mode: 0o600 });
  } catch (_) {
    throw new PortalError('Não foi possível salvar o PDF na pasta pdfs do projeto. Verifique a permissão de escrita.');
  }
  captured.arquivo_pdf = `pdfs/${pdfFilename}`;
  clearTimeout(timer);
  await browser.close();
  finish(captured);
}

main().catch(async error => {
  clearTimeout(timer);
  if (browser) await browser.close().catch(() => {});
  const result = { status: 'erro', mensagem: error instanceof PortalError || error.message.startsWith('O portal') || error.message.startsWith('A sessão') || error.message.startsWith('Não foi possível') || error.message.startsWith('Botão') || error.message.startsWith('Página inicial') ? error.message : 'Falha ao acessar o portal ou executar o navegador.' };
  if (error instanceof PortalError) result.diagnostico = error.details;
  if (/valida[cç][aã]o de seguran[cç]a/.test(result.mensagem)) result.diagnostico = seguranca;
  finish(result);
});

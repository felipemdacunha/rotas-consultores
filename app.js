/* =========================================================
   Visitas em Campo — lógica do aplicativo
   ---------------------------------------------------------
   Fluxo:
   1. O consultor registra a visita no celular.
   2. O app tenta enviar para a planilha do Google.
   3. Sem internet (ou sem URL configurada), a visita fica
      numa fila no localStorage e sobe sozinha depois.
   4. O gerente lê a planilha, filtra e exporta o PDF.
   ========================================================= */

'use strict';

/* ---------------------------------------------------------
   1. CONFIGURAÇÃO — preencha depois de publicar o Apps Script
   --------------------------------------------------------- */

// Cole aqui a URL do app da Web do Google Apps Script.
// Enquanto estiver vazia, o app roda 100% local (modo teste):
// tudo é salvo no navegador e o painel do gerente lê dali.
const GOOGLE_SCRIPT_URL = '';

const CHAVES = {
  consultor: 'vc.consultor',   // nome de quem está usando o aparelho
  fila:      'vc.fila',        // visitas ainda não enviadas
  local:     'vc.local',       // visitas confirmadas (e cache do gerente)
};

const INTERVALO_TENTATIVA = 30000; // tenta esvaziar a fila a cada 30 s

/* ---------------------------------------------------------
   2. Utilitários
   --------------------------------------------------------- */

const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function ler(chave, padrao) {
  try {
    const bruto = localStorage.getItem(chave);
    return bruto ? JSON.parse(bruto) : padrao;
  } catch (e) {
    console.warn('Não consegui ler', chave, e);
    return padrao;
  }
}

function gravar(chave, valor) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
    return true;
  } catch (e) {
    // Cota estourada ou navegação privada: avisa em vez de perder em silêncio.
    console.error('Não consegui gravar', chave, e);
    mostrarStatus('Não foi possível salvar neste navegador. Verifique o espaço disponível.', 'offline', 8000);
    return false;
  }
}

function novoId() {
  return 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function escapar(txt) {
  const d = document.createElement('div');
  d.textContent = txt == null ? '' : String(txt);
  return d.innerHTML;
}

/** ISO -> "09/09/2026 14:30" */
function formatarData(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Preenche o campo datetime-local com o momento atual. */
function agoraLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const CLASSE_STATUS = {
  'Sucesso':       'ok',
  'Em negociação': 'and',
  'Perdido':       'no',
};

/* ---------------------------------------------------------
   3. Barra de status
   --------------------------------------------------------- */

let timerStatus = null;

function mostrarStatus(texto, tipo, some) {
  const b = $('#statusBar');
  b.textContent = texto;
  b.className = 'statusbar visivel ' + (tipo || '');
  clearTimeout(timerStatus);
  if (some) timerStatus = setTimeout(atualizarBarra, some);
}

function esconderStatus() {
  $('#statusBar').className = 'statusbar';
}

/** Estado permanente da barra: offline, ou fila pendente. */
function atualizarBarra() {
  // Em modo local não existe destino: nada fica "aguardando envio".
  if (modoLocal()) { esconderStatus(); return; }

  const fila = ler(CHAVES.fila, []);
  if (!navigator.onLine) {
    const extra = fila.length ? ` · ${fila.length} visita(s) na fila` : '';
    mostrarStatus('Sem conexão — pode continuar registrando' + extra, 'offline');
  } else if (fila.length) {
    mostrarStatus(`${fila.length} visita(s) aguardando envio`, 'pendente');
  } else {
    esconderStatus();
  }
}

/* ---------------------------------------------------------
   4. Comunicação com a planilha do Google
   --------------------------------------------------------- */

const modoLocal = () => !GOOGLE_SCRIPT_URL;

/**
 * Envia uma visita.
 * Usa Content-Type "text/plain" de propósito: com "application/json"
 * o navegador dispara uma requisição OPTIONS de verificação, que o
 * Apps Script não responde — e o envio falha por CORS.
 */
async function enviarVisita(visita) {
  if (modoLocal()) throw new Error('modo-local');

  const resposta = await fetch(GOOGLE_SCRIPT_URL, {
    method: 'POST',
    mode: 'cors',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'criar', visita }),
  });

  if (!resposta.ok) throw new Error('HTTP ' + resposta.status);

  const dados = await resposta.json();
  if (!dados || dados.ok !== true) throw new Error(dados && dados.erro ? dados.erro : 'resposta inesperada');
  return dados;
}

/** Busca todas as visitas consolidadas. */
async function buscarVisitas() {
  if (modoLocal()) return ler(CHAVES.local, []);

  const resposta = await fetch(GOOGLE_SCRIPT_URL + '?action=listar', {
    method: 'GET',
    mode: 'cors',
    redirect: 'follow',
  });
  if (!resposta.ok) throw new Error('HTTP ' + resposta.status);

  const dados = await resposta.json();
  const lista = Array.isArray(dados) ? dados : (dados.visitas || []);
  gravar(CHAVES.local, lista); // cache: o gerente enxerga algo mesmo offline
  return lista;
}

/* ---------------------------------------------------------
   5. Fila offline
   --------------------------------------------------------- */

function enfileirar(visita) {
  const fila = ler(CHAVES.fila, []);
  fila.push(visita);
  gravar(CHAVES.fila, fila);
  atualizarBarra();
}

/** Guarda localmente uma visita já confirmada (também alimenta o modo local). */
function guardarLocal(visita) {
  const lista = ler(CHAVES.local, []);
  if (!lista.some((v) => v.id === visita.id)) {
    lista.unshift(visita);
    gravar(CHAVES.local, lista);
  }
}

let esvaziando = false;

/** Tenta subir tudo o que está na fila. Silencioso quando falha. */
async function esvaziarFila() {
  if (esvaziando || modoLocal() || !navigator.onLine) return;

  const fila = ler(CHAVES.fila, []);
  if (!fila.length) return;

  esvaziando = true;
  const restantes = [];
  let enviadas = 0;

  for (const visita of fila) {
    try {
      await enviarVisita(visita);
      guardarLocal(visita);
      enviadas++;
    } catch (e) {
      restantes.push(visita); // mantém na fila e tenta de novo depois
    }
  }

  gravar(CHAVES.fila, restantes);
  esvaziando = false;

  if (enviadas) {
    mostrarStatus(`${enviadas} visita(s) enviada(s)`, 'enviado', 4000);
    renderRecentes();
  } else {
    atualizarBarra();
  }
}

/* ---------------------------------------------------------
   6. Navegação entre telas
   --------------------------------------------------------- */

function irPara(tela) {
  $$('.tela').forEach((s) => s.classList.remove('ativa'));
  $('#tela' + tela.charAt(0).toUpperCase() + tela.slice(1)).classList.add('ativa');

  $$('.aba').forEach((b) => {
    const ativa = b.dataset.tela === tela;
    b.classList.toggle('ativa', ativa);
    if (ativa) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });

  window.scrollTo(0, 0);
  if (tela === 'gerente') carregarPainel();
}

/* ---------------------------------------------------------
   7. Login
   --------------------------------------------------------- */

function entrar(nome) {
  gravar(CHAVES.consultor, nome);
  $('#saudacao').innerHTML = `Registrando como <strong>${escapar(nome)}</strong>`;
  $('#abas').hidden = false;
  $('#btnSair').hidden = false;
  $('#datahora').value = agoraLocal();
  irPara('consultor');
  renderRecentes();
}

$('#formLogin').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const nome = $('#loginNome').value.trim();
  const erro = $('#erroLogin');

  if (nome.length < 3) {
    erro.textContent = 'Escreva seu nome completo para continuar.';
    erro.hidden = false;
    return;
  }
  erro.hidden = true;
  entrar(nome);
});

$('#btnSair').addEventListener('click', () => {
  const fila = ler(CHAVES.fila, []);
  if (fila.length && !confirm(`Há ${fila.length} visita(s) ainda não enviada(s). Trocar de consultor mesmo assim?`)) return;

  localStorage.removeItem(CHAVES.consultor);
  $('#abas').hidden = true;
  $('#btnSair').hidden = true;
  $('#loginNome').value = '';
  $$('.tela').forEach((s) => s.classList.remove('ativa'));
  $('#telaLogin').classList.add('ativa');
});

$$('.aba').forEach((b) => b.addEventListener('click', () => irPara(b.dataset.tela)));

/* ---------------------------------------------------------
   8. GPS
   --------------------------------------------------------- */

let coordenadas = null;

$('#btnGps').addEventListener('click', () => {
  const info = $('#gpsInfo');
  const botao = $('#btnGps');

  if (!('geolocation' in navigator)) {
    info.textContent = 'Este aparelho não informa localização';
    info.className = 'gps-info falhou';
    return;
  }

  botao.disabled = true;
  info.textContent = 'Buscando sinal…';
  info.className = 'gps-info';

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      coordenadas = {
        lat: +pos.coords.latitude.toFixed(6),
        lng: +pos.coords.longitude.toFixed(6),
        precisao: Math.round(pos.coords.accuracy),
      };
      info.textContent = `${coordenadas.lat}, ${coordenadas.lng} (±${coordenadas.precisao} m)`;
      info.className = 'gps-info ok';
      botao.disabled = false;
      botao.textContent = 'Marcar de novo';
    },
    (err) => {
      const motivo = {
        1: 'Permissão de localização negada',
        2: 'Sinal de GPS indisponível',
        3: 'O GPS demorou demais para responder',
      }[err.code] || 'Não foi possível obter a localização';
      info.textContent = motivo;
      info.className = 'gps-info falhou';
      botao.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
  );
});

/* ---------------------------------------------------------
   9. Registrar visita
   --------------------------------------------------------- */

$('#formVisita').addEventListener('submit', async (ev) => {
  ev.preventDefault();

  const form = ev.currentTarget;
  const erro = $('#erroVisita');
  const botao = form.querySelector('button[type=submit]');
  const status = form.querySelector('input[name=status]:checked');

  const cliente  = $('#cliente').value.trim();
  const cidade   = $('#cidade').value.trim();
  const datahora = $('#datahora').value;

  if (!cliente || !cidade || !datahora || !status) {
    erro.textContent = 'Preencha empresa, cidade, data e status antes de registrar.';
    erro.hidden = false;
    return;
  }
  erro.hidden = true;

  const visita = {
    id:        novoId(),
    consultor: ler(CHAVES.consultor, ''),
    cliente,
    contato:   $('#contato').value.trim(),
    cidade,
    datahora:  new Date(datahora).toISOString(),
    status:    status.value,
    resumo:    $('#resumo').value.trim(),
    lat:       coordenadas ? coordenadas.lat : '',
    lng:       coordenadas ? coordenadas.lng : '',
    registradoEm: new Date().toISOString(),
  };

  botao.disabled = true;
  botao.textContent = 'Registrando…';

  try {
    await enviarVisita(visita);
    guardarLocal(visita);
    mostrarStatus('Visita registrada e enviada', 'enviado', 4000);
  } catch (e) {
    // Offline ou planilha sem resposta: nada se perde, vai para a fila.
    // Em modo local não há fila — a visita já está salva e é isso mesmo.
    if (!modoLocal()) enfileirar(visita);
    guardarLocal(visita);
    mostrarStatus(
      modoLocal()
        ? 'Visita salva neste aparelho (modo teste, sem planilha)'
        : 'Sem conexão — visita guardada e será enviada sozinha',
      modoLocal() ? 'enviado' : 'offline',
      5000
    );
  }

  // Limpa só o que muda de uma visita para a outra.
  form.reset();
  coordenadas = null;
  $('#gpsInfo').textContent = 'Sem coordenadas';
  $('#gpsInfo').className = 'gps-info';
  $('#btnGps').textContent = 'Marcar localização';
  $('#datahora').value = agoraLocal();

  botao.disabled = false;
  botao.textContent = 'Registrar visita';
  renderRecentes();
  $('#cliente').focus();
});

/* ---------------------------------------------------------
   10. Últimas visitas do consultor
   --------------------------------------------------------- */

function renderRecentes() {
  const eu = ler(CHAVES.consultor, '');
  const fila = ler(CHAVES.fila, []);
  const idsNaFila = new Set(fila.map((v) => v.id));

  const minhas = ler(CHAVES.local, [])
    .filter((v) => v.consultor === eu)
    .sort((a, b) => String(b.registradoEm || b.datahora).localeCompare(String(a.registradoEm || a.datahora)))
    .slice(0, 8);

  const ul = $('#listaRecentes');

  if (!minhas.length) {
    ul.innerHTML = '<li class="vazio">Nenhuma visita registrada ainda.</li>';
    return;
  }

  ul.innerHTML = minhas.map((v) => {
    const pendente = idsNaFila.has(v.id);
    const tag = modoLocal()
      ? '<span class="rec-tag tag-sinc">salva</span>'
      : (pendente
          ? '<span class="rec-tag tag-fila">na fila</span>'
          : '<span class="rec-tag tag-sinc">enviada</span>');
    return `<li>
      <div>
        <span class="rec-nome">${escapar(v.cliente)}</span>
        <span class="rec-meta">${escapar(v.cidade)} · ${escapar(v.status)} · ${formatarData(v.datahora)}</span>
      </div>${tag}
    </li>`;
  }).join('');
}

/* ---------------------------------------------------------
   11. Painel do gerente
   --------------------------------------------------------- */

let todasVisitas = [];

async function carregarPainel() {
  const botao = $('#btnAtualizar');
  botao.disabled = true;
  botao.textContent = 'Carregando…';

  try {
    todasVisitas = await buscarVisitas();
  } catch (e) {
    todasVisitas = ler(CHAVES.local, []); // cai para o cache local
    mostrarStatus('Não consegui ler a planilha — mostrando o que está salvo neste aparelho', 'offline', 6000);
  }

  // Junta o que ainda está na fila, marcado, para o gerente não achar que sumiu.
  const fila = ler(CHAVES.fila, []);
  const ids = new Set(todasVisitas.map((v) => v.id));
  fila.forEach((v) => { if (!ids.has(v.id)) todasVisitas.push({ ...v, pendente: true }); });

  todasVisitas.sort((a, b) => String(b.datahora).localeCompare(String(a.datahora)));

  preencherSelect('#fConsultor', 'consultor', 'Todos');
  preencherSelect('#fCidade', 'cidade', 'Todas');
  aplicarFiltros();

  botao.disabled = false;
  botao.textContent = 'Atualizar';
}

function preencherSelect(seletor, campo, rotuloTodos) {
  const sel = $(seletor);
  const anterior = sel.value;
  const valores = [...new Set(todasVisitas.map((v) => v[campo]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  sel.innerHTML = `<option value="">${rotuloTodos}</option>` +
    valores.map((v) => `<option>${escapar(v)}</option>`).join('');
  if (valores.includes(anterior)) sel.value = anterior;
}

function filtradas() {
  const c = $('#fConsultor').value;
  const ci = $('#fCidade').value;
  const s = $('#fStatus').value;
  const q = $('#fBusca').value.trim().toLowerCase();

  return todasVisitas.filter((v) =>
    (!c  || v.consultor === c) &&
    (!ci || v.cidade === ci) &&
    (!s  || v.status === s) &&
    (!q  || String(v.cliente || '').toLowerCase().includes(q))
  );
}

function aplicarFiltros() {
  const lista = filtradas();

  // Indicadores
  const conta = (st) => lista.filter((v) => v.status === st).length;
  $('#indicadores').innerHTML = `
    <div class="ind"><b>${lista.length}</b><span>visitas</span></div>
    <div class="ind ind-ok"><b>${conta('Sucesso')}</b><span>sucesso</span></div>
    <div class="ind ind-and"><b>${conta('Em negociação')}</b><span>em negociação</span></div>
    <div class="ind ind-no"><b>${conta('Perdido')}</b><span>perdido</span></div>`;

  // Tabela
  $('#tbody').innerHTML = lista.map((v) => `
    <tr>
      <td class="data">${formatarData(v.datahora)}</td>
      <td>${escapar(v.consultor)}</td>
      <td class="cliente">${escapar(v.cliente)}${v.pendente ? ' <span class="rec-tag tag-fila">na fila</span>' : ''}</td>
      <td>${escapar(v.cidade)}</td>
      <td><span class="pill pill-${CLASSE_STATUS[v.status] || 'and'}">${escapar(v.status)}</span></td>
      <td class="resumo">${escapar(v.resumo)}</td>
    </tr>`).join('');

  $('#vazio').hidden = lista.length > 0;
}

['#fConsultor', '#fCidade', '#fStatus'].forEach((s) => $(s).addEventListener('change', aplicarFiltros));
$('#fBusca').addEventListener('input', aplicarFiltros);
$('#btnAtualizar').addEventListener('click', carregarPainel);

$('#btnLimpar').addEventListener('click', () => {
  $('#fConsultor').value = '';
  $('#fCidade').value = '';
  $('#fStatus').value = '';
  $('#fBusca').value = '';
  aplicarFiltros();
});

/* ---------------------------------------------------------
   12. Relatório em PDF
   --------------------------------------------------------- */

$('#btnPdf').addEventListener('click', () => {
  // Falha explícita: sem isso o botão não faz nada e ninguém sabe por quê.
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert('A biblioteca de PDF não carregou. Verifique a conexão e recarregue a página.');
    return;
  }

  const lista = filtradas();
  if (!lista.length) {
    alert('Não há visitas para exportar com os filtros atuais.');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  if (typeof doc.autoTable !== 'function') {
    alert('O complemento de tabelas do PDF não carregou. Recarregue a página.');
    return;
  }

  const larguraPagina = doc.internal.pageSize.getWidth();

  // ---- Cabeçalho ----
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(31, 59, 52);
  doc.text('Relatório Consolidado de Visitas Comerciais', 14, 17);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text('Gerado em ' + formatarData(new Date().toISOString()), 14, 23.5);

  // Filtros aplicados: sem isso, ninguém sabe do que o relatório fala.
  const filtros = [];
  if ($('#fConsultor').value) filtros.push('Consultor: ' + $('#fConsultor').value);
  if ($('#fCidade').value)    filtros.push('Cidade: ' + $('#fCidade').value);
  if ($('#fStatus').value)    filtros.push('Status: ' + $('#fStatus').value);
  if ($('#fBusca').value.trim()) filtros.push('Busca: "' + $('#fBusca').value.trim() + '"');
  doc.text('Filtros: ' + (filtros.length ? filtros.join('  ·  ') : 'nenhum (todas as visitas)'), 14, 29);

  // Totais por status
  const conta = (st) => lista.filter((v) => v.status === st).length;
  doc.text(
    `Total: ${lista.length}  ·  Sucesso: ${conta('Sucesso')}  ·  ` +
    `Em negociação: ${conta('Em negociação')}  ·  Perdido: ${conta('Perdido')}`,
    14, 34.5
  );

  // ---- Tabela ----
  doc.autoTable({
    startY: 40,
    head: [['Data', 'Consultor', 'Cliente', 'Cidade', 'Status', 'Resumo']],
    body: lista.map((v) => [
      formatarData(v.datahora),
      v.consultor || '',
      v.cliente || '',
      v.cidade || '',
      v.status || '',
      v.resumo || '',
    ]),
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2.6, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: [31, 59, 52], textColor: 255, fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [245, 247, 243] },
    columnStyles: {
      0: { cellWidth: 27 },
      1: { cellWidth: 36 },
      2: { cellWidth: 46 },
      3: { cellWidth: 30 },
      4: { cellWidth: 26 },
      5: { cellWidth: 'auto' },
    },
    margin: { left: 14, right: 14, bottom: 18 },

    // Colore o status linha a linha.
    didParseCell: (dados) => {
      if (dados.section !== 'body' || dados.column.index !== 4) return;
      const cor = { 'Sucesso': [47, 109, 92], 'Em negociação': [138, 97, 0], 'Perdido': [156, 59, 46] }[dados.cell.raw];
      if (cor) { dados.cell.styles.textColor = cor; dados.cell.styles.fontStyle = 'bold'; }
    },
  });

  // ---- Rodapé com paginação ----
  const total = doc.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    const altura = doc.internal.pageSize.getHeight();
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text('Visitas em Campo', 14, altura - 8);
    doc.text(`Página ${i} de ${total}`, larguraPagina - 14, altura - 8, { align: 'right' });
  }

  const hoje = new Date().toISOString().slice(0, 10);
  doc.save(`relatorio-visitas-${hoje}.pdf`);
});

/* ---------------------------------------------------------
   13. Service Worker e ciclo de vida
   --------------------------------------------------------- */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Caminho relativo: funciona em qualquer subpasta do GitHub Pages.
    navigator.serviceWorker.register('./sw.js')
      .catch((e) => console.warn('Service Worker não registrado:', e));
  });
}

window.addEventListener('online', () => { atualizarBarra(); esvaziarFila(); });
window.addEventListener('offline', atualizarBarra);
setInterval(esvaziarFila, INTERVALO_TENTATIVA);

// Volta do segundo plano: bom momento para tentar de novo.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { atualizarBarra(); esvaziarFila(); }
});

// Início
(function iniciar() {
  const salvo = ler(CHAVES.consultor, '');
  if (salvo) entrar(salvo);
  else $('#datahora').value = agoraLocal();
  atualizarBarra();
  esvaziarFila();
})();

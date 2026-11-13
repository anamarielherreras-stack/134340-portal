'use strict';
// Masterlist completa: consulta histórica de solo lectura, exclusiva de la administradora.
// Se carga únicamente al abrir la sección. Las respuestas viven solo en memoria (nunca en storage).
// Todo texto recibido se trata como no confiable: se escapa con esc() y los enlaces se validan.
(function () {
  const PAGE_SIZE = 50;
  const MAX_ROWS = 200, MAX_COLS = 200, MAX_TEXT = 5000, MAX_QUERY = 200;
  const st = {gen: 0, loading: false, error: '', data: null, section: 'Pedidos', q: '', draft: '', page: 0, sections: []};

  const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s_\-.]+/g, ' ').trim();
  // Campos que nunca se muestran, aunque lleguen por error en la respuesta.
  const isSensitive = name => /clave ?privada|hash ?clave|token/.test(fold(name));
  const txt = v => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') ? String(v).slice(0, MAX_TEXT) : '';
  const int = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : d; };

  function safeSheetsURL(value) {
    if (typeof value !== 'string' || !value || value.length > 2048) return '';
    let u;
    try { u = new URL(value); } catch { return ''; }
    if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com' || u.port || u.username || u.password) return '';
    if (!/^\/spreadsheets\/d\/[A-Za-z0-9_-]+(\/|$)/.test(u.pathname)) return '';
    return u.href;
  }

  function normalize(raw, req) {
    if (!raw || typeof raw !== 'object' || raw.ok !== true) throw new Error('La masterlist respondió con un formato no válido.');
    const allCols = Array.isArray(raw.columns) ? raw.columns.slice(0, MAX_COLS).map(txt) : [];
    const keep = allCols.map((name, index) => ({name, index})).filter(c => !isSensitive(c.name));
    const rowsIn = Array.isArray(raw.rows) ? raw.rows.slice(0, MAX_ROWS) : [];
    const rowsOut = rowsIn.filter(r => r && typeof r === 'object').map(r => {
      const values = Array.isArray(r.values) ? r.values : [];
      return {id: txt(r.id), row: int(r.row, 0), values: keep.map(c => txt(values[c.index])), source: safeSheetsURL(r.source_url)};
    });
    const seen = new Set();
    const sections = (Array.isArray(raw.sections) ? raw.sections : []).filter(s => {
      const key = s && txt(s.key);
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, 300).map(s => ({key: txt(s.key), label: txt(s.label) || txt(s.key), count: int(s.count, 0)}));
    const pageSize = int(raw.page_size, PAGE_SIZE) || PAGE_SIZE;
    const total = int(raw.total, rowsOut.length);
    const pages = Math.max(int(raw.pages, 0), Math.ceil(total / pageSize), 1);
    return {
      section: txt(raw.section) || req.section, columns: keep.map(c => c.name), rows: rowsOut,
      page: Math.min(int(raw.page, req.page), pages - 1), pageSize, total, pages, sections,
      sheetURL: safeSheetsURL(raw.sheet_url), note: txt(raw.note), version: txt(raw.version)
    };
  }

  // ---------- Vista de diseño (?demo=1): datos ficticios, ninguna consulta a Sheets ----------
  const DEMO_SECTIONS = [
    ['Pedidos', 'Pedidos históricos', 123], ['Catalogo', 'Catálogo', 18], ['Variantes', 'Variantes y stock', 24],
    ['Clientas', 'Clientas', 12], ['Pagos', 'Pagos', 40], ['Cargos', 'Cargos', 35], ['Envios', 'Envíos', 22],
    ['Almacen', 'Almacén', 16], ['Pendientes_revision', 'Pendientes de revisión', 7], ['Fotos', 'Fotos', 9],
    ['Filas_originales', 'Filas originales', 60], ['Original · Hoja ejemplo', 'Pestaña original · Hoja ejemplo', 14]
  ];
  function demoResponse(req) {
    const meta = DEMO_SECTIONS.find(s => s[0] === req.section) || DEMO_SECTIONS[0];
    const columns = ['Referencia', 'Clienta (ficticia)', 'Producto de ejemplo', 'Estado', 'Marca de pago', 'Clave privada'];
    const all = Array.from({length: meta[2]}, (_, i) => ({
      id: `DEMO-${meta[0]}-${i + 1}`, row: i + 2, source_url: '',
      values: [`EJ-${String(i + 1).padStart(3, '0')}`, `Clienta ficticia ${String(i % 12 + 1).padStart(2, '0')}`,
        `${meta[1]} · Colección inventada ${i % 5 + 1}`, ['Por revisar', 'Registrado', 'En almacén'][i % 3],
        i % 4 === 0 ? '☑️' : i % 4 === 1 ? '1' : '', 'NO-MOSTRAR-FICTICIA']
    }));
    const q = fold(req.q);
    const filtered = q ? all.filter(r => fold(r.values.join(' ')).includes(q)) : all;
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const page = Math.min(req.page, pages - 1);
    return {
      ok: true, version: 'demo', section: meta[0], columns, rows: filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
      page, page_size: PAGE_SIZE, total: filtered.length, pages,
      sections: DEMO_SECTIONS.map(([key, label, count]) => ({key, label, count})), sheet_url: '',
      note: 'Datos ficticios de la vista de diseño. No provienen de ninguna hoja real.'
    };
  }

  // ---------- Consultas con protección contra respuestas obsoletas ----------
  const owner = () => demo ? 'demo' : [S.user?.id || '', S.staff?.role || '', S.staff?.active ? 1 : 0].join('|');
  const current = (gen, who) => gen === st.gen && isAdmin() && owner() === who && (demo || !!S.session?.access_token);
  const rerender = () => { if (S.route === 'masterlist') render(); };

  async function fetchPage(req) {
    if (!isAdmin()) return;
    const gen = ++st.gen, who = owner();
    st.loading = true; st.error = ''; st.section = req.section; st.q = req.q; st.page = req.page;
    rerender();
    try {
      const raw = demo ? demoResponse(req) : await sheetsRequest('masterlist', {section: req.section, q: req.q, page: req.page});
      if (!current(gen, who)) return;
      const data = normalize(raw, req);
      st.data = data; st.section = data.section; st.page = data.page;
      if (data.sections.length) st.sections = data.sections;
    } catch (e) {
      if (!current(gen, who)) return;
      st.error = errorMessage(e) || 'No se pudo consultar la masterlist.';
    } finally {
      if (gen === st.gen) { st.loading = false; if (current(gen, who)) rerender(); }
    }
  }

  function invalidate() {
    st.gen++;
    Object.assign(st, {loading: false, error: '', data: null, section: 'Pedidos', q: '', draft: '', page: 0, sections: []});
  }

  function open() {
    if (!isAdmin()) return;
    if (!st.data && !st.loading) fetchPage({section: st.section, q: st.q, page: st.page});
    else rerender();
  }

  // ---------- Render (todo texto pasa por esc()) ----------
  function sectionOptions() {
    const list = st.sections.slice();
    if (!list.some(s => s.key === st.section)) list.unshift({key: st.section, label: st.section, count: null});
    return list.map(s => `<option value="${esc(s.key)}" ${s.key === st.section ? 'selected' : ''}>${esc(s.label)}${s.count === null ? '' : ' (' + esc(s.count) + ')'}</option>`).join('');
  }
  const link = (href, text, cls = 'btn light sm') => href ? `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${text}</a>` : '';

  function table(d) {
    if (!d.rows.length) return empty('Sin filas en esta búsqueda', st.q ? 'Prueba con otra palabra o limpia la búsqueda.' : 'Esta sección no tiene filas para mostrar.');
    const hasSource = d.rows.some(r => r.source);
    return `<div class="table-wrap ml-scroll" tabindex="0" role="region" aria-label="Tabla de la masterlist"><table class="ml-table"><thead><tr><th scope="col">FILA</th>${d.columns.map(c => `<th scope="col">${esc(c)}</th>`).join('')}${hasSource ? '<th scope="col">ORIGEN</th>' : ''}</tr></thead><tbody>${d.rows.map(r => `<tr><td>${r.row ? esc(r.row) : '—'}</td>${r.values.map(v => `<td>${esc(v)}</td>`).join('')}${hasSource ? `<td>${link(r.source, 'Ver origen', 'ml-link')}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
  }

  function page() {
    if (!isAdmin()) return empty('Acceso restringido', 'Solo la administradora puede consultar la masterlist completa.');
    const d = st.data, busy = st.loading;
    const label = st.sections.find(s => s.key === st.section)?.label || st.section;
    const from = d && d.total ? d.page * d.pageSize + 1 : 0, to = d ? Math.min(d.total, d.page * d.pageSize + d.rows.length) : 0;
    return `${pageHead('Masterlist completa', 'Consulta de solo lectura de la masterlist histórica, sección por sección.', `<button class="btn light" type="button" data-ml-act="refresh" ${busy ? 'disabled' : ''}>Actualizar</button>`)}
<div class="notice"><b>Esta es la masterlist histórica</b><p>Muestra los registros anteriores tal como están en Google Sheets, solo para consulta. Aquí no se edita nada ni se crean pedidos o cargos. Las marcas de pago sin confirmar (por ejemplo “1” o “☑️”) se muestran como texto y no generan cargos nuevos. Los saldos de estas hojas no se dan por conciliados con el portal.</p><p>Las imágenes y el formato original de cada hoja no se reproducen en esta tabla: consúltalos en la pestaña original con “Abrir en Sheets” o “Ver origen”.</p></div>
${demo ? '<div class="notice warning"><b>Vista de diseño</b><p>Las filas son ficticias y no se consulta ninguna hoja real.</p></div>' : ''}
<form id="ml-form" class="filters ml-toolbar" role="search">
 <div class="field"><label for="ml-section">Sección de masterlist</label><select id="ml-section">${sectionOptions()}</select></div>
 <div class="field ml-q"><label for="ml-q">Buscar en masterlist</label><input id="ml-q" type="search" maxlength="${MAX_QUERY}" autocomplete="off" value="${esc(st.draft)}" placeholder="Producto, clienta, referencia…"></div>
 <div class="ml-submit"><button class="btn" type="submit">Buscar</button></div>
</form>
<section class="panel">
 <div class="panel-head"><div><h2>${esc(label)}</h2><p>${busy ? 'Consultando…' : d ? `${esc(d.total)} filas en total${st.q ? ' · búsqueda: “' + esc(st.q) + '”' : ''}${d.total ? ` · mostrando ${esc(from)}–${esc(to)}` : ''}` : 'Sin consultar todavía'}</p></div>${d ? (d.sheetURL ? link(d.sheetURL, 'Abrir en Sheets') : '<small>Enlace de Sheets no disponible</small>') : ''}</div>
 ${st.error ? `<div class="notice error" role="alert"><b>No se pudo consultar la masterlist</b><p>${esc(st.error)}</p><button class="btn light sm" type="button" data-ml-act="retry">Reintentar</button></div>` : ''}
 ${d?.note ? `<div class="notice"><p>${esc(d.note)}</p></div>` : ''}
 ${busy ? '<div class="loading" role="status"><div class="loader"></div>Cargando masterlist…</div>' : d ? table(d) : st.error ? '' : '<p role="status">Preparando la consulta…</p>'}
 ${d && !busy ? `<nav class="ml-pager" aria-label="Paginación de la masterlist"><button class="btn light sm" type="button" data-ml-act="prev" ${d.page <= 0 ? 'disabled' : ''}>Anterior</button><span>Página ${esc(d.page + 1)} de ${esc(d.pages)}</span><button class="btn light sm" type="button" data-ml-act="next" ${d.page >= d.pages - 1 ? 'disabled' : ''}>Siguiente</button></nav>` : ''}
</section>`;
  }

  // ---------- Eventos propios (no interfieren con data-act del portal) ----------
  document.addEventListener('submit', e => {
    if (e.target.id !== 'ml-form') return;
    e.preventDefault();
    const q = (document.querySelector('#ml-q')?.value || '').trim().slice(0, MAX_QUERY);
    st.draft = q;
    fetchPage({section: st.section, q, page: 0});
  });
  document.addEventListener('input', e => { if (e.target.id === 'ml-q') st.draft = e.target.value; });
  document.addEventListener('change', e => {
    if (e.target.id !== 'ml-section') return;
    const key = e.target.value;
    if (!st.sections.some(s => s.key === key)) return;
    fetchPage({section: key, q: st.q, page: 0});
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-ml-act]');
    if (!b || b.disabled || S.route !== 'masterlist') return;
    const d = st.data, act = b.dataset.mlAct;
    if (act === 'prev' && d && d.page > 0) fetchPage({section: st.section, q: st.q, page: d.page - 1});
    else if (act === 'next' && d && d.page < d.pages - 1) fetchPage({section: st.section, q: st.q, page: d.page + 1});
    else if (act === 'refresh' || act === 'retry') fetchPage({section: st.section, q: st.q, page: st.page});
  });

  window.Masterlist = Object.freeze({page, open, invalidate, _test: Object.freeze({normalize, safeSheetsURL, isSensitive, state: st, fetchPage})});
})();

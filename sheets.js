'use strict';
// Historial de consulta. No cambia el destino de los pedidos ni genera cargos.
async function sheetsRequest(action, payload = {}) {
  if (!S.session?.access_token) throw new Error('Inicia sesión antes de consultar tu historial.');
  if (S.session.expires_at * 1000 < Date.now() + 30000) await refresh();
  const response = await fetch(SHEETS_API, {
    method: 'POST', redirect: 'follow', credentials: 'omit', cache: 'no-store',
    headers: {'Content-Type': 'text/plain;charset=utf-8'},
    body: JSON.stringify({...payload, action, access_token: S.session.access_token}),
    signal: AbortSignal.timeout(90000)
  });
  let result;
  try { result = await response.json(); }
  catch { throw new Error('La conexión de Sheets no respondió. Intenta actualizar en unos segundos.'); }
  if (!response.ok || !result.ok) throw new Error(result.message || 'No se pudo consultar Sheets.');
  return result;
}

function adaptSheetsHistory(result, userId) {
  const data = result.data || {};
  const clients = (result.clientas || []).map(c => ({
    id: 'sheets:' + c.code, customer_code: c.code,
    display_name: c.name, owner_user_id: c.user_id || null
  }));
  if (result.codigo && !clients.some(c => c.customer_code === result.codigo)) {
    clients.push({id:'sheets:' + result.codigo, customer_code:result.codigo,
      display_name:'Mi historial', owner_user_id:userId});
  }
  const ordersById = new Map((data.Pedidos || []).map(o => [String(o['ID pedido']), o]));
  const itemsByOrder = new Map();
  (data.Detalle_pedidos || []).forEach(i => {
    const id = String(i['ID pedido']);
    if (!itemsByOrder.has(id)) itemsByOrder.set(id, []);
    itemsByOrder.get(id).push(i);
  });
  const records = [];
  const config = [
    ['Pedidos','order','ID pedido','Colección'],
    ['Cargos','charge','ID cargo','Concepto'],
    ['Pagos','payment','ID pago','Concepto original'],
    ['Envios','shipment','ID referencia envío','Producto'],
    ['Almacen','warehouse','ID referencia almacén','Producto'],
    ['Etapas_logisticas','logistics','ID etapa','Producto']
  ];
  for (const [sheet, kind, idKey, titleKey] of config) {
    for (const row of data[sheet] || []) {
      const code = String(row['Código clienta'] || ordersById.get(String(row['ID pedido']))?.['Código clienta'] || '');
      if (!code) continue;
      const id = String(row[idKey] ?? '');
      const fields = Object.entries(row).filter(([key,value]) =>
        value !== '' && value !== null && value !== undefined &&
        key !== 'Código clienta' && !key.startsWith('ID ') && key !== 'Habilitar cobro'
      ).map(([label,value]) => ({label,value:String(value)}));
      if (sheet === 'Pedidos') {
        (itemsByOrder.get(id) || []).forEach((item, index) => {
          ['Producto original','Variante original','Cantidad','Precio unitario','Total original','Moneda confirmada'].forEach(key => {
            if (item[key] !== '' && item[key] !== undefined && item[key] !== null) {
              fields.push({label:(index ? `Artículo ${index+1} · ` : '') + key, value:String(item[key])});
            }
          });
        });
      }
      records.push({id:'sheets:' + sheet + ':' + id, legacy_customer_id:'sheets:' + code,
        customer_code:code, order_id:String(row['ID pedido'] || ''),
        sheet_name:sheet, source_row:id, section:row[titleKey] || sheet,
        kind, details:fields, from_sheets:true});
    }
  }
  return {clients, records};
}

async function loadSheetsIdentity() {
  S.sheetsLoaded = false;
  S.data.legacy_customers = [];
  S.data.legacy_history = [];
  try {
    const result = await sheetsRequest('identity');
    S.data.legacy_customers = adaptSheetsHistory(result, S.user.id).clients;
  } catch (error) { S.errors.push({table:'sheets', message:errorMessage(error)}); }
}

async function loadSheetsHistory() {
  S.sheetsLoaded = false;
  S.data.legacy_history = [];
  S.errors = S.errors.filter(e=>e.table !== 'sheets');
  try {
    const result = await sheetsRequest('snapshot');
    const adapted = adaptSheetsHistory(result, S.user.id);
    S.data.legacy_customers = adapted.clients;
    S.data.legacy_history = adapted.records;
    S.sheetsLoaded = true;
  } catch (error) {
    S.errors.push({table:'sheets', message:errorMessage(error)});
  }
}

async function importReview() {
  if (!isAdmin()) throw new Error('Solo la administradora puede revisar la importación.');
  if (demo) { toast('La vista de diseño no consulta datos reales.'); return; }
  const result = await sheetsRequest('review');
  showModal('Revisión de la masterlist', `<div class="notice"><b>${result.review.length} referencias para revisar</b><p>La revisión se mantiene en la pestaña Pendientes_revision del Sheets. Estas referencias no generan cobros automáticamente.</p></div><div class="table-wrap"><table><thead><tr><th>REFERENCIA</th><th>QUÉ REVISAR</th><th>ESTADO</th></tr></thead><tbody>${result.review.map(r=>`<tr><td>${esc(r['ID relacionado'] || r['ID revisión'])}<br><small>${esc(r.Tema)}</small></td><td>${esc(r['Qué revisar'])}</td><td>${esc(r.Estado)}</td></tr>`).join('')}</tbody></table></div>`);
}

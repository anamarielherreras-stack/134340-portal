'use strict';
const boxStates={korea:'En almacén de origen',in_transit:'En camino',receiving:'Llegada parcial',received:'Recibida'};
let boxDraft=null;
async function loadBoxes(){
 if(!can('shipments')&&!can('payments'))return;
 S.boxesLoading=true;S.boxesError='';render();
 try{
  if(demo){S.data.international_boxes=[{id:'demo-box',code:'KR-64',status:'receiving'}];S.data.international_box_items=[{id:'demo-bi',box_id:'demo-box',source_key:'portal:sample-item',source_kind:'portal',customer_id:'sample1',product_name:'Colección de nuestro universo',variant_name:'Lavanda',source_total:3,quantity:3}];S.data.arrival_charge_lines=[];}
  else{const names=['international_boxes','international_box_items','arrival_charge_lines','charges','payments'];const results=await Promise.all(names.map(t=>get(t)));names.forEach((t,i)=>S.data[t]=results[i]);}
  S.boxesLoaded=true;
 }catch(e){S.boxesError=errorMessage(e);S.boxesLoaded=false;}
 finally{S.boxesLoading=false;render();}
}
function pendingBoxQty(item,concept){return Math.max(0,Number(item.quantity)-rows('arrival_charge_lines').filter(l=>l.box_item_id===item.id&&l.concept===concept).reduce((s,l)=>s+Number(l.quantity),0));}
function boxesPage(){
 if(!can('shipments')&&!can('payments'))return empty('Acceso restringido','Tu cuenta no tiene acceso a cajas.');
 const list=rows('international_boxes').filter(b=>b.code.toLowerCase().includes(S.search.toLowerCase()));
 return `${pageHead('Cajas y llegadas','Agrupa productos por caja y cobra únicamente las piezas seleccionadas.',can('shipments','create')?btn('+ Armar caja','box-new'):'')}
 <div class="notice"><b>De almacén de origen a su caja</b><p>Asigna las piezas que van en cada caja. Al preparar EMS o aduana, selecciona productos, cantidades e importes por clienta.</p></div>
 ${S.boxesError?`<div class="notice warning">${esc(S.boxesError)}</div>`:''}
 <div class="filters"><input id="search" class="search" aria-label="Buscar caja" placeholder="Buscar número o código de caja" value="${esc(S.search)}">${btn('Actualizar','box-refresh','','light')}</div>
 ${S.boxesLoading?'<p role="status">Cargando cajas…</p>':!S.boxesLoaded?'<p>Actualiza para consultar las cajas.</p>':list.length?`<section class="box-grid">${list.map(b=>{const items=rows('international_box_items').filter(i=>i.box_id===b.id),count=items.reduce((n,i)=>n+Number(i.quantity),0);return `<article class="panel box-card"><span class="eyebrow">CAJA INTERNACIONAL</span><h2>${esc(b.code)}</h2><span class="badge blue">${boxStates[b.status]}</span><p>${count} piezas · ${new Set(items.map(i=>i.customer_id)).size} ${new Set(items.map(i=>i.customer_id)).size===1?'clienta':'clientas'}</p><div class="box-counts"><span>EMS pendiente <b>${items.reduce((n,i)=>n+pendingBoxQty(i,'ems'),0)}</b></span><span>Aduana pendiente <b>${items.reduce((n,i)=>n+pendingBoxQty(i,'customs'),0)}</b></span></div><p class="form-hint">Pendiente de generar cargo; el saldo se consulta en Pagos.</p><div class="actions">${btn('Ver productos','box-detail',b.id,'light')}${can('payments','create')?btn('Preparar cargo','box-charge',b.id):''}</div></article>`}).join('')}</section>`:empty('Tu primera caja','Usa el número que ya maneja 134340 y selecciona los productos que viajarán juntos.')}`;
}
function portalBoxCandidates(){return rows('order_items').flatMap(i=>{const o=rows('orders').find(x=>x.id===i.order_id);return o&&o.status!=='cancelled'?[{source_key:'portal:'+i.id,source_kind:'portal',customer_id:o.customer_id,customer_code:customer(o.customer_id),product_name:i.product_name,variant_name:i.variant_name,source_total:Number(i.quantity),lot:'Pedido #'+o.order_number}]:[]});}
function availableForBox(c){return Math.max(0,Number(c.source_total||0)-rows('international_box_items').filter(i=>i.source_key===c.source_key).reduce((n,i)=>n+Number(i.quantity),0));}
async function newBoxForm(){
 if(!can('shipments','create')||!can('shipments'))throw new Error('Necesitas permisos de ver y crear envíos.');
 if(!S.boxesLoaded)await loadBoxes();if(!S.boxesLoaded)throw new Error(S.boxesError||'No se pudieron consultar las cajas.');
 boxDraft={items:portalBoxCandidates(),selected:{},source:'portal',search:'',sheetsLoaded:false,sheetsError:''};
 showModal('Armar una caja',form('box-create',`${field('box_code','Número o código de caja','text','','required maxlength="60" placeholder="Ej. KR-64" list="known-boxes"')}<datalist id="known-boxes">${rows('international_boxes').filter(b=>b.status!=='received').map(b=>`<option value="${esc(b.code)}">`).join('')}</datalist><p class="form-hint">Si el código ya existe, se agregan las piezas a esa caja.</p><div class="filters"><select id="box-source" aria-label="Origen de productos"><option value="portal">Pedidos nuevos del portal</option><option value="sheets">Referencias de la masterlist</option><option value="all">Ambos orígenes</option></select><input id="box-search" class="search" placeholder="Buscar clienta, producto o lote" aria-label="Buscar productos para caja"></div><div id="box-picker"></div><p id="box-selected" role="status"></p><label class="box-confirm"><input name="reviewed" type="checkbox" required> Revisé la cantidad, la clienta y que estas referencias no representan el mismo producto en otra etapa.</label>`,'Guardar productos en caja'));
 renderBoxPicker();
}
function renderBoxPicker(){
 if(!boxDraft)return;
 const filtered=boxDraft.items.filter(c=>(boxDraft.source==='all'||c.source_kind===boxDraft.source)&&[c.product_name,c.variant_name,c.customer_code,c.lot].join(' ').toLowerCase().includes(boxDraft.search.toLowerCase()));
 document.querySelector('#box-picker').innerHTML=`${boxDraft.sheetsError?`<div class="notice warning">${esc(boxDraft.sheetsError)}</div>`:''}${boxDraft.source!=='portal'?'<div class="notice warning"><b>Referencias por conciliar</b><p>Los lotes que mencionan varias cajas no indican cuál corresponde a cada producto. Elige la caja exacta después de revisarlo. Las referencias sin cantidad o sin cuenta vinculada están bloqueadas.</p></div>':''}<small>${filtered.length} referencias · mostrando hasta 100; usa el buscador para acotar.</small><div class="box-picker">${filtered.slice(0,100).map(c=>{const available=availableForBox(c),selected=boxDraft.selected[c.source_key],reason=!c.customer_id?'Clienta sin vincular':!Number.isInteger(c.source_total)||c.source_total<=0?'Falta confirmar cantidad':!available?'Todas las piezas asignadas':'';return `<div class="box-pick-row"><label><input type="checkbox" data-box-pick="${esc(c.source_key)}" ${selected?'checked':''} ${reason?'disabled':''}><span><b>${esc(c.product_name)}</b><small>${esc(c.customer_code||'Sin código')} · ${esc(c.variant_name||'')} · ${esc(c.lot||'')}</small><small>${reason||available+' piezas sin caja'}</small>${c.original_detail?`<details><summary>Ver referencia original</summary><p>${esc(c.original_detail)}</p></details>`:''}</span></label><input type="number" data-box-qty="${esc(c.source_key)}" aria-label="Cantidad de ${esc(c.product_name)}" value="${selected?.quantity||Math.min(1,available)}" min="1" max="${available}" step="1" ${reason?'disabled':''}></div>`}).join('')||'<p>No hay coincidencias.</p>'}</div>`;
 updateBoxSelection();
}
function updateBoxSelection(){const el=document.querySelector('#box-selected');if(el&&boxDraft){const items=Object.values(boxDraft.selected);el.textContent=items.length+' productos seleccionados · '+items.reduce((n,i)=>n+i.quantity,0)+' piezas';}}
async function loadSheetBoxCandidates(){
 if(boxDraft.sheetsLoaded)return;
 if(demo){boxDraft.sheetsLoaded=true;return;}
 const draft=boxDraft;const el=document.querySelector('#box-picker');if(el)el.innerHTML='<p role="status">Consultando referencias de Sheets…</p>';
 try{const result=await sheetsRequest('logistics');if(boxDraft!==draft)return;draft.items=portalBoxCandidates().concat(result.candidates||[]);draft.sheetsLoaded=true;draft.sheetsError='';}
 catch(e){if(boxDraft===draft)draft.sheetsError=errorMessage(e);}
 if(boxDraft===draft&&document.querySelector('#box-picker'))renderBoxPicker();
}
function showBox(id){
 const b=rows('international_boxes').find(x=>x.id===id);if(!b)throw new Error('Caja no encontrada.');
 const items=rows('international_box_items').filter(i=>i.box_id===id);
 showModal('Caja '+b.code,`${can('shipments','edit')?form('box-status',`<input type="hidden" name="id" value="${b.id}">${select('status','Estado de la caja',Object.entries(boxStates),b.status)}`,'Actualizar estado'):`<p>${boxStates[b.status]}</p>`}<div class="table-wrap"><table><thead><tr><th>CLIENTA / PRODUCTO</th><th>PIEZAS EN CAJA</th><th>EMS SIN CARGO</th><th>ADUANA SIN CARGO</th></tr></thead><tbody>${items.map(i=>`<tr><td><b>${esc(i.customer_code||customer(i.customer_id))}</b><br>${esc(i.product_name)}<br><small>${esc(i.variant_name||'')}</small></td><td>${i.quantity}</td><td>${pendingBoxQty(i,'ems')}</td><td>${pendingBoxQty(i,'customs')}</td></tr>`).join('')}</tbody></table></div><p class="form-hint">El estado describe la caja. Recibirla no liquida cargos ni cambia todos los pedidos de la clienta.</p>${can('payments','create')?btn('Preparar cargo de esta caja','box-charge',id):''}`);
}
function boxChargeForm(id){
 if(!can('payments','create')||!can('payments'))throw new Error('Necesitas permisos de ver y crear pagos.');
 const b=rows('international_boxes').find(x=>x.id===id);if(!b)throw new Error('Caja no encontrada.');
 showModal('Cargo · Caja '+b.code,form('box-charge',`<input type="hidden" name="box_id" value="${b.id}"><div class="form-grid">${select('concept','Concepto',[['ems','EMS'],['customs','Aduana']])}${select('currency','Moneda',[['MXN','MXN'],['USD','USD'],['KRW','KRW']])}${field('due_at','Fecha límite','datetime-local')}</div><p>Marca los productos y escribe el <b>importe total para las piezas seleccionadas en cada renglón</b>.</p><div id="box-charge-picker"></div><div id="box-charge-summary" class="notice" aria-live="polite"></div><label class="box-confirm"><input name="unpaid_confirmed" type="checkbox" required> Revisé que este concepto no se haya cobrado o pagado antes, incluidos los cargos manuales y la masterlist.</label><p class="form-hint">EMS y aduana se registran por separado. No se reparten importes automáticamente.</p>`,'Crear cargos seleccionados'));
 renderBoxChargePicker(id,'ems');
}
function renderBoxChargePicker(id,concept){
 const items=rows('international_box_items').filter(i=>i.box_id===id);
 document.querySelector('#box-charge-picker').innerHTML=`<div class="table-wrap"><table><thead><tr><th>PRODUCTO / CLIENTA</th><th>PIEZAS</th><th>IMPORTE TOTAL</th></tr></thead><tbody>${items.map(i=>{const remaining=pendingBoxQty(i,concept);return `<tr data-charge-line="${i.id}"><td><label class="box-confirm"><input type="checkbox" data-charge-pick ${remaining?'':'disabled'}><span><b>${esc(i.product_name)}</b><br>${esc(i.customer_code||customer(i.customer_id))} · ${esc(i.variant_name||'')}<br><small>${remaining?remaining+' piezas sin cargo':'Concepto ya registrado para todas las piezas'}</small></span></label></td><td><input data-charge-qty type="number" aria-label="Piezas de ${esc(i.product_name)}" min="1" max="${remaining}" step="1" value="${remaining?1:0}" ${remaining?'':'disabled'}></td><td><input data-charge-amount type="number" aria-label="Importe total de ${esc(i.product_name)}" min="0.01" max="9999999999.99" step="0.01" placeholder="0.00" ${remaining?'':'disabled'}></td></tr>`}).join('')}</tbody></table></div>`;
 updateBoxChargeSummary();
}
function selectedBoxCharges(f){return [...f.querySelectorAll('[data-charge-line]')].filter(row=>row.querySelector('[data-charge-pick]').checked).map(row=>({item_id:row.dataset.chargeLine,quantity:Number(row.querySelector('[data-charge-qty]').value),amount:Number(row.querySelector('[data-charge-amount]').value),unpaid_confirmed:!!f.querySelector('[name=unpaid_confirmed]')?.checked}));}
function updateBoxChargeSummary(){const f=document.querySelector('form[data-form="box-charge"]');if(!f)return;const items=selectedBoxCharges(f),currency=f.querySelector('[name=currency]').value;const total=items.reduce((n,i)=>n+Math.round(i.amount*100),0)/100;document.querySelector('#box-charge-summary').textContent=`${items.length} ${items.length===1?'cargo':'cargos'} · ${items.reduce((n,i)=>n+i.quantity,0)} piezas · Total ${money(total,currency)}`;}
async function handleBoxForm(f,v,fd){
 if(v===null)return;
 if(f.dataset.form==='box-create'){
  const items=Object.values(boxDraft?.selected||{});
  if(!items.length)throw new Error('Selecciona al menos un producto.');
  if(items.some(i=>!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>availableForBox(i)))throw new Error('Revisa las cantidades seleccionadas.');
  if(v.reviewed!=='on')throw new Error('Confirma la revisión de las referencias.');
  await rpc('save_international_box',{p_code:v.box_code,p_items:items.map(i=>({source_key:i.source_key,source_kind:i.source_kind,quantity:i.quantity,source_total:i.source_total,customer_id:i.customer_id,customer_code:i.customer_code,product_name:i.product_name,variant_name:i.variant_name,reviewed:true})),p_request_id:f.dataset.requestId||(f.dataset.requestId=crypto.randomUUID())});
 }else if(f.dataset.form==='box-status')await rpc('set_international_box_status',{p_id:v.id,p_status:v.status});
 else{
  const items=selectedBoxCharges(f);
  if(!items.length)throw new Error('Selecciona al menos un producto.');
  if(items.some(i=>!Number.isInteger(i.quantity)||i.quantity<1||!Number.isFinite(i.amount)||i.amount<=0))throw new Error('Completa las cantidades y los importes.');
  if(v.unpaid_confirmed!=='on')throw new Error('Revisa si el concepto ya fue cobrado antes.');
  await rpc('charge_international_box',{p_box_id:v.box_id,p_concept:v.concept,p_currency:v.currency,p_due_at:v.due_at?new Date(v.due_at).toISOString():null,p_items:items,p_request_id:f.dataset.requestId||(f.dataset.requestId=crypto.randomUUID())});
 }
}
document.addEventListener('input',e=>{
 if(e.target.id==='box-search'&&boxDraft){boxDraft.search=e.target.value;renderBoxPicker();}
 if(e.target.hasAttribute('data-box-qty')&&boxDraft){const key=e.target.dataset.boxQty;if(boxDraft.selected[key])boxDraft.selected[key].quantity=Number(e.target.value);updateBoxSelection();}
 if(e.target.closest('form[data-form="box-charge"]'))updateBoxChargeSummary();
});
document.addEventListener('change',async e=>{
 try{
 if(e.target.id==='box-source'&&boxDraft){boxDraft.source=e.target.value;if(boxDraft.source!=='portal'&&!boxDraft.sheetsLoaded)await loadSheetBoxCandidates();else renderBoxPicker();}
 if(e.target.hasAttribute('data-box-pick')&&boxDraft){const key=e.target.dataset.boxPick,c=boxDraft.items.find(i=>i.source_key===key),qty=e.target.closest('.box-pick-row').querySelector('[data-box-qty]');if(e.target.checked)boxDraft.selected[key]={...c,quantity:Number(qty.value)};else delete boxDraft.selected[key];updateBoxSelection();}
 const f=e.target.closest('form[data-form="box-charge"]');if(f&&e.target.name==='concept')renderBoxChargePicker(f.querySelector('[name=box_id]').value,e.target.value);else if(f)updateBoxChargeSummary();
 }catch(error){toast(errorMessage(error));}
});

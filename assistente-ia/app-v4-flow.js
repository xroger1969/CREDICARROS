async function loadStock(force=false){
  if(state.stock.length&&!force)return state.stock;
  try{
    const response=await fetch('/api/stock',{cache:'no-store'});
    const data=await response.json();
    state.stock=Array.isArray(data.results)?data.results:[];
    persist();track('stock_loaded',{count:state.stock.length});
  }catch{state.stock=[]}
  return state.stock;
}
function renderCarMedia(item){return item.image?`<img src="${esc(item.image)}" alt="${esc(item.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=&quot;car-media-fallback&quot;>🚘</div>'">`:'<div class="car-media-fallback">🚘</div>'}
function isCompared(item){return state.compare.some(entry=>entry.url&&item.url?entry.url===item.url:entry.title===item.title)}
function renderCarCards(items,{heading='Viaturas no stock',recommended=false}={}){
  const wrap=document.createElement('div');wrap.className='car-options';
  const head=document.createElement('div');head.className='stock-list-head';head.innerHTML=`<strong>${esc(heading)}</strong><span class="stock-count">${items.length}</span>`;wrap.appendChild(head);
  items.forEach((item,index)=>{
    const card=document.createElement('article');card.className='car-card';if(index>=6&&!recommended)card.classList.add('car-extra','hidden');
    const chips=vehicleMeta(item).map(meta=>`<span class="car-chip">${esc(meta)}</span>`).join('');
    card.innerHTML=`<div class="car-media">${renderCarMedia(item)}<button class="compare-toggle ${isCompared(item)?'selected':''}" type="button">${isCompared(item)?'✓ Comparar':'＋ Comparar'}</button></div><div class="car-content"><div class="car-title">${esc(item.title)}</div>${chips?`<div class="car-meta">${chips}</div>`:''}${item.price?`<div class="car-price">${esc(item.price)}</div>`:''}<div class="car-actions"><button class="car-choice" type="button">Escolher viatura</button>${item.url?`<a class="car-details" href="${esc(item.url)}" target="_blank" rel="noopener" aria-label="Abrir anúncio de ${esc(item.title)}">↗</a>`:''}</div></div>`;
    $('.car-choice',card).onclick=()=>selectVehicle(item);
    $('.compare-toggle',card).onclick=()=>{toggleCompare(item);renderCurrentStockView(wrap,items,{heading,recommended})};
    wrap.appendChild(card);
  });
  if(items.length>6&&!recommended){const more=document.createElement('button');more.className='show-more';more.type='button';more.textContent=`Mostrar mais ${items.length-6} viaturas`;more.onclick=()=>{$$('.car-extra',wrap).forEach(card=>card.classList.remove('hidden'));more.remove();chat.scrollTop=chat.scrollHeight};wrap.appendChild(more)}
  const other=document.createElement('button');other.className='car-other';other.type='button';other.textContent='Não encontra a viatura? Escreva a marca ou modelo';other.onclick=()=>showComposer('marca ou modelo',searchStock);wrap.appendChild(other);
  chat.appendChild(wrap);chat.scrollTop=0;
  return wrap;
}
function renderCurrentStockView(previous,items,options){const next=renderCarCards(items,options);previous.replaceWith(next)}
async function showStock(){
  startShell();state.mode='browse';state.quickSelected=[];setStage('stock','Escolha uma viatura','Pode comparar até três viaturas antes de escolher.',1);clearChat();
  addMessage('Estas são as viaturas que encontrei no stock atual. A disponibilidade de cada unidade será sempre confirmada pelo Carlos.');
  const items=await loadStock();
  if(items.length)renderCarCards(items);else{addMessage('Não consegui carregar o stock neste momento. Escreva a marca ou modelo que procura.');showComposer('marca ou modelo',searchStock)}
  track('mode_selected',{mode:'browse'});
}
async function searchStock(query){
  const text=filled(query);if(!text)return;
  addMessage(text,'me');hideComposer();addMessage('Vou procurar no stock por essa marca ou modelo.', 'bot');
  try{
    const response=await fetch('/api/stock?q='+encodeURIComponent(text),{cache:'no-store'});const data=await response.json();const results=Array.isArray(data.results)?data.results:[];
    if(results.length){renderCarCards(results,{heading:'Resultados da pesquisa',recommended:true});return}
  }catch{}
  addMessage('Não encontrei uma correspondência clara no stock. Posso guardar o seu pedido para o Carlos verificar outras opções.');
  state.selectedVehicle={title:text,url:'',custom:true};state.lead.viatura=text;persist();showOptions();
}
function selectVehicle(item){
  state.selectedVehicle={...item};state.lead={...EMPTY_LEAD,viatura:item.title};state.quickSelected=[];persist();track('vehicle_selected',{title:item.title});showOptions();
}

function showOptions(){
  startShell();setStage('options','O que pretende saber?','Escolha uma ou várias opções.',2);clearChat();
  addMessage(`Escolheu: ${state.selectedVehicle?.title||state.lead.viatura}`,'me');
  addMessage('Pode escolher uma ou várias opções. Os valores e confirmações comerciais serão sempre dados pelo Carlos.');
  const wrap=document.createElement('div');wrap.className='quick';
  Object.entries(OPTIONS).forEach(([key,meta])=>{
    const button=document.createElement('button');button.type='button';button.dataset.key=key;button.setAttribute('aria-pressed',String(state.quickSelected.includes(key)));button.classList.toggle('selected',state.quickSelected.includes(key));button.textContent=`${state.quickSelected.includes(key)?'✓ ':''}${meta.icon} ${meta.label}`;
    button.onclick=()=>{if(state.quickSelected.includes(key))state.quickSelected=state.quickSelected.filter(value=>value!==key);else state.quickSelected.push(key);persist();showOptions()};wrap.appendChild(button);
  });
  if(state.quickSelected.length){const continueButton=document.createElement('button');continueButton.type='button';continueButton.className='quick-continue';continueButton.textContent=state.quickSelected.length===1?'Continuar com esta opção →':`Continuar com ${state.quickSelected.length} opções →`;continueButton.onclick=chooseDetailMode;wrap.appendChild(continueButton)}
  chat.appendChild(wrap);chat.scrollTop=chat.scrollHeight;
}
function chooseDetailMode(){
  setStage('details','Como prefere responder?','Pode avançar passo a passo ou escrever tudo de uma vez.',3);clearChat();
  addMessage('Perfeito. Escolha a forma mais cómoda para responder.');
  addSystemCard('Como quer continuar?','O modo passo a passo faz uma pergunta de cada vez. Também pode responder a tudo numa única mensagem.',[
    {label:'Responder passo a passo',primary:true,onClick:()=>startStepFlow()},
    {label:'Responder tudo numa mensagem',onClick:showCombinedQuestion}
  ]);
}
function buildSteps(missingOnly=false){
  const steps=[];
  if(state.quickSelected.includes('disponibilidade')&&(!missingOnly||!/Disponibilidade:/i.test(state.lead.observacoes)))steps.push({key:'availability',label:'disponibilidade',ask:'Pretende apenas confirmar a disponibilidade ou gostaria de avançar para uma possível reserva?',save:text=>{state.lead.observacoes=[state.lead.observacoes,`Disponibilidade: ${text}`].filter(Boolean).join('; ')}});
  if(state.quickSelected.includes('financiamento')&&(!missingOnly||!filled(state.lead.orcamento)))steps.push({key:'finance',label:'entrada e prestação pretendida',ask:'Que entrada inicial está a pensar dar e qual seria uma prestação mensal confortável?',save:text=>{state.lead.financiamento='Pretende financiamento';state.lead.orcamento=text}});
  if(state.quickSelected.includes('retoma')&&(!missingOnly||!filled(state.lead.retoma)))steps.push({key:'trade',label:'dados da retoma',ask:'Qual é a viatura que tem para retoma? Indique marca, modelo, ano e quilómetros, se souber.',save:text=>{state.lead.retoma=text}});
  if(state.quickSelected.includes('visita')&&(!missingOnly||!filled(state.lead.horario)))steps.push({key:'visit',label:'dia e hora preferidos',ask:'Que dia e hora seriam mais convenientes para visitar o stand?',save:text=>{state.lead.horario=text}});
  if(!filled(state.lead.nome))steps.push({key:'name',label:'nome',ask:'Qual é o seu nome?',save:text=>{const clean=String(text).replace(/\d/g,'').trim();if(clean)state.lead.nome=titleCaseName(clean)}});
  if(!filled(state.lead.telefone))steps.push({key:'phone',label:'contacto/WhatsApp',ask:'Qual é o seu número de telemóvel ou WhatsApp?',save:text=>{const number=phoneDigits(text);if(number)state.lead.telefone=number}});
  return steps;
}
function startStepFlow(missingOnly=false){state.detailMode='step';persist();const steps=buildSteps(missingOnly);runStep(steps,0)}
function runStep(steps,index){
  if(index>=steps.length){finishLead();return}
  const step=steps[index];
  if(index===0){clearChat();addMessage('Vamos tratar de uma coisa de cada vez. Pode responder de forma simples.')}
  addMessage(step.ask);
  showComposer(step.label,async value=>{
    const text=filled(value);if(!text)return;
    addMessage(text,'me');input.value='';step.save(text);persist();
    if(step.key==='phone'&&!state.lead.telefone){addMessage('Não consegui identificar um número de telemóvel português. Escreva apenas os nove algarismos.');showComposer(step.label,inputHandler);return}
    hideComposer();runStep(steps,index+1);
  });
}
function combinedItems(){
  const items=[];
  if(state.quickSelected.includes('disponibilidade'))items.push(['✅','DISPONIBILIDADE','Pretende confirmar ou avançar para uma possível reserva?']);
  if(state.quickSelected.includes('financiamento'))items.push(['💳','FINANCIAMENTO','Entrada inicial e prestação mensal pretendida.']);
  if(state.quickSelected.includes('retoma'))items.push(['🔄','RETOMA','Marca, modelo, ano e quilómetros da sua viatura.']);
  if(state.quickSelected.includes('visita'))items.push(['📅','MARCAR VISITA','Dia e hora preferidos.']);
  items.push(['👤','CONTACTO','Nome e número de telemóvel ou WhatsApp.']);
  return items;
}
function showCombinedQuestion(){
  state.detailMode='combined';persist();clearChat();
  const card=document.createElement('section');card.className='option-summary';card.innerHTML=`<div class="option-summary-title">Responda numa única mensagem:</div><div class="option-summary-list">${combinedItems().map(([icon,title,text])=>`<div class="option-summary-item"><strong>${icon} ${title}</strong><span>${esc(text)}</span></div>`).join('')}</div>`;chat.appendChild(card);readBot('Pode responder numa única mensagem com os dados das opções selecionadas e o seu contacto.');
  showComposer('resposta e contacto',submitCombined);
}
async function submitCombined(value){
  const text=filled(value);if(!text)return;
  addMessage(text,'me');input.value='';hideComposer();
  const loading=addMessage('A organizar os dados…','bot',{silent:true});
  try{
    const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,history:state.history.slice(-8),contexto:{...contexto,viatura:state.selectedVehicle?.title||state.lead.viatura,link_anuncio:state.selectedVehicle?.url||contexto.link_anuncio},lead:state.lead})});
    const data=await response.json();loading.remove();if(data.lead)updateLead(data.lead);
  }catch{loading.remove()}
  if(state.quickSelected.includes('disponibilidade')&&!/Disponibilidade:/i.test(state.lead.observacoes))state.lead.observacoes=[state.lead.observacoes,`Resposta conjunta: ${text.slice(0,300)}`].filter(Boolean).join('; ');
  persist();
  const missing=buildSteps(true);
  if(missing.length){addMessage('Obrigado. Já organizei o que consegui. Faltam apenas alguns dados curtos.');runStep(missing,0);return}
  finishLead();
}
async function prepareLead(){
  if(state.leadReceipt)return state.leadReceipt;
  try{
    const response=await fetch('/api/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lead:state.lead,vehicle:state.selectedVehicle,sessionId:state.sessionId,source:contexto.origem})});
    const result=await response.json();state.leadReceipt=result;persist();return result;
  }catch{return {delivered:false}}
}
async function finishLead(){
  setStage('ready','Pedido pronto','Reveja os dados ou envie-os diretamente ao Carlos.',4);clearChat();persist();track('lead_ready',{vehicle:state.lead.viatura,options:state.quickSelected.length});
  addMessage(`Obrigado${state.lead.nome?', '+state.lead.nome:''}. Já tenho os dados essenciais.`);
  const result=await prepareLead();
  const copy=result.delivered?'O pedido foi encaminhado automaticamente para o Carlos. Também pode abrir o WhatsApp para continuar a conversa.':'O pedido ficou guardado neste dispositivo. Use o botão verde para o enviar ao Carlos pelo WhatsApp.';
  addSystemCard('Tudo preparado',copy,[
    {label:'Enviar ao Carlos pelo WhatsApp',primary:true,onClick:()=>{track('whatsapp_opened',{position:'ready'});window.open(whatsappUrl(),'_blank','noopener')}},
    {label:'Rever ou corrigir dados',onClick:openReview}
  ]);
  updateLinks();
}

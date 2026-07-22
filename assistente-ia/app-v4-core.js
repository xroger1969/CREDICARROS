const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const chat=$('#chat');
const form=$('#form');
const input=$('#input');
const showWriter=$('#showWriter');
const welcomeScreen=$('#welcomeScreen');
const assistantScreen=$('#assistantScreen');
const assistantTitle=$('#assistantTitle');
const assistantSubtitle=$('#assistantSubtitle');
const backButton=$('#backButton');
const restartButton=$('#restartButton');
const sendLead=$('#sendLead');
const talkNow=$('#talkNow');
const sideWhatsApp=$('#sideWhatsApp');
const selectedVehicleCard=$('#selectedVehicleCard');
const leadSummary=$('#leadSummary');
const progressBar=$('#progressBar');
const progressText=$('#progressText');
const progressWrap=$('.progress-wrap');
const compareBar=$('#compareBar');
const compareCount=$('#compareCount');
const compareDialog=$('#compareDialog');
const compareGrid=$('#compareGrid');
const reviewDialog=$('#reviewDialog');
const reviewForm=$('#reviewForm');
const toast=$('#toast');
const params=new URLSearchParams(location.search);
const contexto={
  origem:params.get('origem')||'standvirtual',
  viatura:params.get('viatura')||'',
  link_anuncio:params.get('link_anuncio')||params.get('url')||params.get('anuncio')||''
};
const STORAGE_KEY='credicarros-assistente-v4';
const STORAGE_TTL=24*60*60*1000;
const WHATSAPP='351918404101';
const EMPTY_LEAD={nome:'',telefone:'',viatura:'',orcamento:'',financiamento:'',retoma:'',horario:'',observacoes:''};
const OPTIONS={
  disponibilidade:{label:'Disponibilidade',icon:'✅'},
  financiamento:{label:'Financiamento',icon:'💳'},
  retoma:{label:'Retoma',icon:'🔄'},
  visita:{label:'Marcar visita',icon:'📅'}
};
const ADVISOR_QUESTIONS=[
  {key:'budget',title:'Qual é o orçamento aproximado?',subtitle:'Serve apenas para ordenar as sugestões. O preço final é confirmado pelo Carlos.',options:[['Até 15 000 €','15000'],['15 000 € a 20 000 €','20000'],['20 000 € a 30 000 €','30000'],['Mais de 30 000 €','40000'],['Ainda não sei','']]},
  {key:'distance',title:'Quantos quilómetros faz normalmente por dia?',subtitle:'Ajuda a equilibrar autonomia, consumo e utilização.',options:[['Até 30 km','30'],['30 a 80 km','80'],['Mais de 80 km','120'],['Varia muito','']]},
  {key:'space',title:'Que tipo de espaço procura?',subtitle:'Escolha a utilização que mais se aproxima da sua.',options:[['Citadino e fácil de estacionar','compact'],['Familiar e confortável','family'],['SUV ou posição mais alta','suv'],['Sem preferência','']]},
  {key:'powertrain',title:'Tem preferência pela motorização?',subtitle:'As sugestões dependem sempre das viaturas existentes no stock.',options:[['Elétrico','electric'],['Híbrido','hybrid'],['Gasolina ou diesel','combustion'],['Estou aberto a sugestões','']]}
];
let inputHandler=null;
let state=createInitialState();

function createInitialState(){
  return {
    version:4,
    savedAt:Date.now(),
    sessionId:crypto.randomUUID?.()||('s-'+Date.now()+'-'+Math.random().toString(16).slice(2)),
    started:false,
    mode:'',
    stage:'welcome',
    lead:{...EMPTY_LEAD,viatura:contexto.viatura||''},
    selectedVehicle:contexto.viatura?{title:contexto.viatura,url:contexto.link_anuncio||''}:null,
    stock:[],
    compare:[],
    quickSelected:[],
    detailMode:'',
    advisorAnswers:{},
    history:[],
    leadReceipt:null
  };
}

function restoreState(){
  try{
    const parsed=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
    if(!parsed||parsed.version!==4||Date.now()-Number(parsed.savedAt||0)>STORAGE_TTL)return false;
    if(contexto.viatura&&parsed.selectedVehicle?.title&&parsed.selectedVehicle.title!==contexto.viatura)return false;
    state={...createInitialState(),...parsed,lead:{...EMPTY_LEAD,...parsed.lead},advisorAnswers:{...parsed.advisorAnswers}};
    return state.started;
  }catch{return false}
}

function persist(){
  state.savedAt=Date.now();
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify({...state,history:state.history.slice(-12)}))}catch{}
  renderLeadSummary();
  renderSelectedVehicle();
  updateLinks();
}

function track(event,meta={}){
  const safeMeta={};
  for(const [key,value] of Object.entries(meta||{})){
    if(['name','nome','phone','telefone','contact','contacto','message','text'].includes(key.toLowerCase()))continue;
    safeMeta[key]=String(value).slice(0,120);
  }
  fetch('/api/analytics',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:true,body:JSON.stringify({event,sessionId:state.sessionId,meta:safeMeta})}).catch(()=>{});
}

function esc(value){return String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function filled(value){return String(value||'').trim()}
function showToast(message){toast.textContent=message;toast.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>toast.classList.remove('show'),2600)}
function readBot(text,options={}){if(typeof window.queueAssistantSpeech==='function')window.queueAssistantSpeech(text,options)}
function clearChat(){chat.replaceChildren();inputHandler=null;hideComposer()}
function markLatest(element){$$('.msg.bot.latest').forEach(node=>node.classList.remove('latest'));if(element?.classList.contains('bot'))element.classList.add('latest')}
function addMessage(text,role='bot',options={}){
  const node=document.createElement('div');
  node.className='msg '+role;
  node.textContent=String(text||'');
  chat.appendChild(node);
  if(role==='bot'){markLatest(node);if(!options.silent)readBot(text,options)}
  chat.scrollTop=chat.scrollHeight;
  return node;
}
function addSystemCard(title,copy,actions=[]){
  const card=document.createElement('section');
  card.className='system-card';
  const heading=document.createElement('h3');heading.textContent=title;
  const paragraph=document.createElement('p');paragraph.textContent=copy;
  card.append(heading,paragraph);
  if(actions.length){
    const wrap=document.createElement('div');wrap.className='system-actions';
    actions.forEach(action=>{
      const button=document.createElement('button');button.type='button';button.textContent=action.label;if(action.primary)button.classList.add('primary');button.onclick=action.onClick;wrap.appendChild(button);
    });
    card.appendChild(wrap);
  }
  chat.appendChild(card);chat.scrollTop=chat.scrollHeight;return card;
}
function setInputPrompt(label=''){input.classList.toggle('answer-needed',Boolean(label));input.placeholder=label?`Escreva aqui: ${label}…`:'Escreva a sua mensagem...'}
function showComposer(label='',handler=null){form.classList.remove('hidden');showWriter.classList.add('hidden');setInputPrompt(label);inputHandler=handler;requestAnimationFrame(()=>{input.focus();input.scrollIntoView?.({block:'nearest'});chat.scrollTop=chat.scrollHeight})}
function hideComposer(){form.classList.add('hidden');showWriter.classList.remove('hidden');setInputPrompt();inputHandler=null}
function setStage(stage,title,subtitle,step){
  state.stage=stage;
  assistantTitle.textContent=title;
  assistantSubtitle.textContent=subtitle;
  const value=Math.max(1,Math.min(4,Number(step)||1));
  progressBar.style.width=`${value*25}%`;
  progressText.textContent=`Passo ${value} de 4`;
  progressWrap.setAttribute('aria-valuenow',String(value));
  backButton.classList.toggle('hidden',stage==='welcome');
  persist();
}
function startShell(){state.started=true;welcomeScreen.classList.add('hidden');assistantScreen.classList.remove('hidden');persist()}
function showWelcome(){state.stage='welcome';state.mode='';state.started=false;assistantScreen.classList.add('hidden');welcomeScreen.classList.remove('hidden');persist()}

function phoneDigits(value){const match=String(value||'').match(/(?:\+?351\s*)?9\d{1,2}(?:[\s.\-]*\d){6}/);return match?match[0].replace(/\D/g,'').replace(/^351/,''):''}
function titleCaseName(value){const particles=new Set(['da','das','de','do','dos','e']);return String(value||'').trim().replace(/\s+/g,' ').split(' ').map((word,index)=>{const lower=word.toLocaleLowerCase('pt-PT');return index>0&&particles.has(lower)?lower:lower.charAt(0).toLocaleUpperCase('pt-PT')+lower.slice(1)}).join(' ')}
function updateLead(next={}){for(const key of Object.keys(EMPTY_LEAD)){if(filled(next[key]))state.lead[key]=String(next[key]).trim().slice(0,key==='observacoes'?500:280)}if(state.selectedVehicle?.title)state.lead.viatura=state.selectedVehicle.title;persist()}
function hasCommercialDetail(){return Boolean(filled(state.lead.orcamento)||filled(state.lead.financiamento)||filled(state.lead.retoma)||filled(state.lead.horario)||filled(state.lead.observacoes))}
function canSend(){return Boolean(filled(state.lead.viatura)&&filled(state.lead.nome)&&filled(state.lead.telefone)&&hasCommercialDetail())}
function leadText(){
  const lines=['Novo pedido - Assistente Credicarros'];
  if(filled(state.lead.viatura))lines.push('Viatura/Pedido: '+state.lead.viatura);
  if(state.quickSelected.length)lines.push('Assuntos: '+state.quickSelected.map(key=>OPTIONS[key]?.label).filter(Boolean).join(', '));
  if(filled(state.lead.orcamento))lines.push('Financiamento/pretensão: '+state.lead.orcamento);
  if(filled(state.lead.retoma))lines.push('Retoma: '+state.lead.retoma);
  if(filled(state.lead.horario))lines.push('Visita/horário: '+state.lead.horario);
  if(filled(state.lead.observacoes))lines.push('Observações: '+state.lead.observacoes);
  if(filled(state.lead.nome))lines.push('Cliente: '+state.lead.nome);
  if(filled(state.lead.telefone))lines.push('Contacto: '+state.lead.telefone);
  if(filled(state.selectedVehicle?.url))lines.push('Anúncio: '+state.selectedVehicle.url);
  return lines.join('\n');
}
function whatsappUrl(){const text=hasCommercialDetail()||state.selectedVehicle?leadText():'Olá Carlos. Gostaria de obter ajuda para escolher uma viatura.';return `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`}
function updateLinks(){const url=whatsappUrl();talkNow.href=url;sideWhatsApp.href=url;if(canSend()){sendLead.href=url;sendLead.classList.remove('hidden')}else sendLead.classList.add('hidden')}

function renderLeadSummary(){
  const rows=[['Viatura',state.lead.viatura],['Nome',state.lead.nome],['Contacto',state.lead.telefone],['Financiamento',state.lead.orcamento||state.lead.financiamento],['Retoma',state.lead.retoma],['Visita',state.lead.horario]];
  const visible=rows.filter(([,value])=>filled(value));
  if(!visible.length){leadSummary.innerHTML='<p>Ainda não existem dados para mostrar.</p>';return}
  leadSummary.innerHTML=visible.map(([label,value])=>`<div class="lead-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
}
function vehicleMeta(item){return [item?.year,item?.mileage,item?.fuel].filter(Boolean)}
function renderSelectedVehicle(){
  const item=state.selectedVehicle;
  if(!item){selectedVehicleCard.innerHTML='<div class="empty-state"><div class="empty-state-icon">🚘</div><strong>Nenhuma viatura escolhida</strong><p>Escolha uma viatura ou peça sugestões para ver aqui o resumo.</p></div>';return}
  const image=item.image?`<div class="selected-image"><img src="${esc(item.image)}" alt="${esc(item.title)}" referrerpolicy="no-referrer" onerror="this.parentElement.innerHTML='<div class=&quot;car-media-fallback&quot;>🚘</div>'"></div>`:'<div class="selected-image"><div class="car-media-fallback">🚘</div></div>';
  selectedVehicleCard.innerHTML=`${image}<div class="side-card-body"><span class="side-label">Viatura selecionada</span><h3>${esc(item.title)}</h3>${vehicleMeta(item).length?`<p>${vehicleMeta(item).map(esc).join(' · ')}</p>`:''}${item.price?`<div class="car-price" style="margin-top:10px">${esc(item.price)}</div>`:''}<div class="side-actions">${item.url?`<a class="primary" href="${esc(item.url)}" target="_blank" rel="noopener">Ver anúncio</a>`:''}<button id="changeVehicleSide" type="button">↔ Alterar viatura</button><button id="compareVehicleSide" type="button">＋ Adicionar à comparação</button></div></div>`;
  $('#changeVehicleSide')?.addEventListener('click',showStock);
  $('#compareVehicleSide')?.addEventListener('click',()=>toggleCompare(item));
}

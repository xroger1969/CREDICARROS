function parsePriceNumber(value){if(!value)return 0;const digits=String(value).replace(/[^\d]/g,'');return Number(digits)||0}
function rankRecommendations(items){
  const answers=state.advisorAnswers;
  return items.map(item=>{
    const text=`${item.title||''} ${item.fuel||''} ${item.bodyStyle||''}`.toLowerCase();let score=0;const reasons=[];
    const budget=Number(answers.budget||0),price=parsePriceNumber(item.price);
    if(budget&&price){if(price<=budget){score+=4;reasons.push('dentro do orçamento indicado')}else if(price<=budget*1.12){score+=1}}
    if(answers.powertrain==='electric'&&/(el[eé]tric|ev|tesla|spring|zoe|leaf|e-tron|mg4|mgs5|id\.?\d|500e)/i.test(text)){score+=5;reasons.push('motorização elétrica')}
    if(answers.powertrain==='hybrid'&&/(h[ií]brid|phev|hev)/i.test(text)){score+=5;reasons.push('motorização híbrida')}
    if(answers.powertrain==='combustion'&&/(gasolina|diesel|dci|tdi|bluehdi|tsi)/i.test(text)){score+=4;reasons.push('motorização convencional')}
    if(answers.space==='suv'&&/(suv|crossover|u5|mgs5|q4|x1|x3|kona|kauai|captur|2008|3008|sportage|niro)/i.test(text)){score+=4;reasons.push('formato SUV/crossover')}
    if(answers.space==='compact'&&/(500|spring|clio|zoe|leaf|polo|golf|id\.3|mg4|mini)/i.test(text)){score+=3;reasons.push('formato compacto')}
    if(answers.space==='family'&&/(model 3|mgs5|q4|touring|estate|break|megane|passat|octavia|3008|u5)/i.test(text)){score+=3;reasons.push('utilização familiar')}
    if(Number(answers.distance)>=80&&/(el[eé]tric|ev|tesla|e-tron|mg4|mgs5|id\.?\d)/i.test(text)){score+=2;reasons.push('adequado a utilização diária regular')}
    return {...item,_score:score,_reason:reasons.slice(0,2).join(' e ')};
  }).sort((a,b)=>b._score-a._score).slice(0,3);
}
function startAdvisor(){
  startShell();state.mode='advisor';state.advisorAnswers={};setStage('advisor','Vamos perceber o que procura','Quatro perguntas rápidas para ordenar o stock.',1);clearChat();
  addMessage('Vou fazer quatro perguntas simples. No fim mostro até três sugestões iniciais do stock.');renderAdvisorQuestion(0);track('mode_selected',{mode:'advisor'});
}
function renderAdvisorQuestion(index){
  if(index>=ADVISOR_QUESTIONS.length){showRecommendations();return}
  const question=ADVISOR_QUESTIONS[index];
  addSystemCard(question.title,question.subtitle,question.options.map(([label,value])=>({label,primary:false,onClick:()=>{state.advisorAnswers[question.key]=value;persist();track('advisor_answer',{question:question.key});clearChat();renderAdvisorQuestion(index+1)}})));
}
async function showRecommendations(){
  clearChat();addMessage('Obrigado. Vou cruzar as suas respostas com as viaturas do stock, sem assumir disponibilidade ou condições comerciais.');
  const items=await loadStock();
  if(!items.length){addMessage('Não consegui carregar o stock neste momento. Pode escrever a marca ou modelo que prefere.');showComposer('marca ou modelo',searchStock);return}
  const ranked=rankRecommendations(items);
  addMessage('Estas são as sugestões que melhor correspondem aos critérios indicados. O Carlos confirma os detalhes de cada unidade.');
  renderCarCards(ranked,{heading:'Sugestões para si',recommended:true});track('recommendations_shown',{count:ranked.length});
}

function toggleCompare(item){
  const index=state.compare.findIndex(entry=>entry.url&&item.url?entry.url===item.url:entry.title===item.title);
  if(index>=0)state.compare.splice(index,1);
  else if(state.compare.length<3)state.compare.push(item);
  else{showToast('Pode comparar no máximo três viaturas.');return}
  persist();updateCompareBar();track('compare_changed',{count:state.compare.length});
}
function updateCompareBar(){compareBar.classList.toggle('hidden',state.compare.length<2);compareCount.textContent=`${state.compare.length} viatura${state.compare.length===1?'':'s'} selecionada${state.compare.length===1?'':'s'}`}
function openComparison(){
  compareGrid.innerHTML=state.compare.map(item=>`<article class="compare-card">${item.image?`<img src="${esc(item.image)}" alt="${esc(item.title)}" referrerpolicy="no-referrer">`:'<div class="car-media-fallback" style="height:120px">🚘</div>'}<div class="compare-card-body"><h3>${esc(item.title)}</h3><div class="compare-row"><span>Preço anunciado</span>${esc(item.price||'Consultar anúncio')}</div><div class="compare-row"><span>Ano</span>${esc(item.year||'Não indicado')}</div><div class="compare-row"><span>Quilómetros</span>${esc(item.mileage||'Não indicado')}</div><div class="compare-row"><span>Combustível</span>${esc(item.fuel||'Depende da versão')}</div>${item.url?`<a href="${esc(item.url)}" target="_blank" rel="noopener">Ver anúncio ↗</a>`:''}</div></article>`).join('');
  compareDialog.showModal();track('comparison_opened',{count:state.compare.length});
}
function openReview(){
  $('#reviewName').value=state.lead.nome;$('#reviewPhone').value=state.lead.telefone;$('#reviewFinance').value=state.lead.orcamento||state.lead.financiamento;$('#reviewTrade').value=state.lead.retoma;$('#reviewVisit').value=state.lead.horario;$('#reviewNotes').value=state.lead.observacoes;reviewDialog.showModal();
}

async function sendGeneralMessage(value){
  const text=filled(value);if(!text)return;addMessage(text,'me');input.value='';hideComposer();state.history.push({role:'user',content:text});const loading=addMessage('A analisar…','bot',{silent:true});
  try{
    const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,history:state.history.slice(-8),contexto:{...contexto,viatura:state.selectedVehicle?.title||state.lead.viatura,link_anuncio:state.selectedVehicle?.url||contexto.link_anuncio},lead:state.lead})});
    const data=await response.json();loading.remove();if(data.lead)updateLead(data.lead);const reply=data.reply||'Essa informação precisa de ser confirmada pelo Carlos.';addMessage(reply);state.history.push({role:'assistant',content:reply});persist();
  }catch{loading.remove();addMessage('Não consegui responder automaticamente neste momento. Pode enviar a pergunta ao Carlos pelo botão de contacto.')}
}
function handleBack(){
  if(state.stage==='stock'||state.stage==='advisor'){showWelcome();return}
  if(state.stage==='options'){showStock();return}
  if(state.stage==='details'||state.stage==='ready'){showOptions();return}
  showWelcome();
}
function restart(){if(!confirm('Recomeçar e apagar os dados guardados neste dispositivo?'))return;localStorage.removeItem(STORAGE_KEY);track('restarted');location.href='./novo.html'+location.search}
function resume(){
  startShell();updateCompareBar();
  if(state.selectedVehicle){addMessage('Retomámos o seu pedido guardado neste dispositivo. Pode continuar ou rever os dados.');showOptions();return}
  if(state.mode==='advisor'){startAdvisor();return}
  showStock();
}

$('#browseMode').onclick=showStock;
$('#advisorMode').onclick=startAdvisor;
backButton.onclick=handleBack;
restartButton.onclick=restart;
showWriter.onclick=()=>{if(!state.selectedVehicle&&(state.stage==='stock'||state.stage==='advisor'))showComposer('marca ou modelo',searchStock);else showComposer('mensagem',sendGeneralMessage)};
form.onsubmit=event=>{event.preventDefault();const value=input.value;if(inputHandler)inputHandler(value);else sendGeneralMessage(value)};
talkNow.onclick=()=>track('whatsapp_opened',{position:'header'});
sideWhatsApp.onclick=()=>track('whatsapp_opened',{position:'sidebar'});
sendLead.onclick=()=>track('whatsapp_opened',{position:'footer'});
$('#openCompare').onclick=openComparison;
$('#reviewData').onclick=openReview;
$$('[data-close-dialog]').forEach(button=>button.onclick=()=>document.getElementById(button.dataset.closeDialog)?.close());
reviewForm.onsubmit=event=>{event.preventDefault();updateLead({nome:titleCaseName($('#reviewName').value),telefone:phoneDigits($('#reviewPhone').value)||$('#reviewPhone').value,orcamento:$('#reviewFinance').value,retoma:$('#reviewTrade').value,horario:$('#reviewVisit').value,observacoes:$('#reviewNotes').value});reviewDialog.close();showToast('Dados atualizados.');if(state.stage==='ready')finishLead()};

let viewportMax=Math.max(window.innerHeight,window.visualViewport?.height||0);
function syncViewport(){const current=window.visualViewport?.height||window.innerHeight;viewportMax=Math.max(viewportMax,current);const keyboardOpen=viewportMax-current>120;document.documentElement.style.setProperty('--app-height',Math.round(current)+'px');document.body.classList.toggle('keyboard-open',keyboardOpen);if(keyboardOpen)requestAnimationFrame(()=>chat.scrollTop=chat.scrollHeight)}
window.visualViewport?.addEventListener('resize',syncViewport);window.visualViewport?.addEventListener('scroll',syncViewport);window.addEventListener('orientationchange',()=>{viewportMax=0;setTimeout(syncViewport,250)});input.addEventListener('focus',()=>setTimeout(syncViewport,80));input.addEventListener('blur',()=>setTimeout(syncViewport,120));

track('opened',{source:contexto.origem});
const restored=restoreState();
renderLeadSummary();renderSelectedVehicle();updateCompareBar();updateLinks();syncViewport();
if(restored)resume();

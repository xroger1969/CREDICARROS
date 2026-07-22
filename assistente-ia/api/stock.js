const STOCK_URL=process.env.STOCK_URL||'https://spremium.standvirtual.com/inventory';
const BAD_TITLE_PATTERNS=/[{}`;]|height\s*:|width\s*:|object-fit|cursor\s*:|\.ooa-|css|style|function|var\(|url\(|svg|path\b/i;
const LEGAL_PAGE_PATTERNS=/(politica\s+de\s+privacidade|política\s+de\s+privacidade|privacidade|privacy|termos|cookies|condicoes|condições|reclamacoes|reclamações|livro\s+de\s+reclamacoes|livro\s+de\s+reclamações)/i;
const CAR_WORDS=/(porsche|tesla|mg|renault|fiat|nissan|mercedes|bmw|volkswagen|vw|audi|peugeot|citroen|opel|hyundai|kia|toyota|volvo|smart|mini|dacia|seat|cupra|ford|model|zoe|taycan|e tron|etron|q4|500e|leaf|id\.?3|id\.?4|eqc|eqa|ioniq|kona|kauai|twingo|megane|golf|polo|classe|long range|standard|plus|limited|icon|quattro|s line|spring|u5|mgs5|mg4)/i;
const GENERIC_TITLES=new Set(['inventory','stock','carros','anuncio','anúncio','spremium','standvirtual','ver stock','detalhes','ver detalhes']);

function clean(value=''){
  return String(value).replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<svg[\s\S]*?<\/svg>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').replace(/&euro;/gi,'€').replace(/\s+/g,' ').trim();
}
function formatTitle(value=''){
  return clean(value).toLowerCase().replace(/\b\w/g,char=>char.toUpperCase()).replace(/\bMg\b/g,'MG').replace(/\bVw\b/g,'VW').replace(/\bBmw\b/g,'BMW').replace(/\bEv\b/g,'EV').replace(/\bRwd\b/g,'RWD').replace(/\bAwd\b/g,'AWD').replace(/\bKwh\b/g,'kWh').replace(/\bId\b/g,'ID').replace(/\bE Tron\b/g,'e-tron').replace(/\bEtron\b/g,'e-tron').replace(/\bS Line\b/g,'S line');
}
function normalise(value=''){return clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim()}
function tokens(value=''){return normalise(value).split(' ').filter(Boolean)}
function absoluteUrl(href){try{return new URL(String(href||'').replace(/\\\//g,'/'),STOCK_URL).toString()}catch{return ''}}
function looksLikeCarUrl(url){if(!/standvirtual\.com|spremium\.standvirtual\.com/i.test(url))return false;if(/\/inventory\/?(?:$|[?#])/i.test(url))return false;if(LEGAL_PAGE_PATTERNS.test(url))return false;return /(carros|anuncio|auto|id[0-9a-z])/i.test(url)}
function isBadTitle(title){const text=clean(title),normalized=normalise(text);if(!text||text.length<3)return true;if(LEGAL_PAGE_PATTERNS.test(text)||GENERIC_TITLES.has(normalized)||BAD_TITLE_PATTERNS.test(text))return true;if(text.length>120&&!CAR_WORDS.test(text))return true;return (text.match(/[{};]/g)||[]).length>0}
function titleFromUrl(url){try{const parsed=new URL(url);const parts=parsed.pathname.split('/').filter(Boolean);let candidate=parts.at(-1)||'';if(/^id[0-9a-z]+(?:\.html?)?$/i.test(candidate)&&parts.length>1)candidate=parts.at(-2);candidate=decodeURIComponent(candidate).replace(/\.html?$/i,'').replace(/^anuncio[-_]?/i,'').replace(/^carros[-_]?/i,'').replace(/[-_]+/g,' ').replace(/\bID[0-9a-z]+\b/gi,'').replace(/\s+/g,' ').trim();return !candidate||isBadTitle(candidate)?'':formatTitle(candidate).slice(0,120)}catch{return ''}}
function safeTitle(rawTitle,url){const title=clean(rawTitle).slice(0,180);if(!isBadTitle(title)&&CAR_WORDS.test(title))return formatTitle(title);const fromUrl=titleFromUrl(url);if(fromUrl)return fromUrl;if(!isBadTitle(title))return formatTitle(title).slice(0,100);return ''}
function attr(source,name){return (String(source).match(new RegExp(`${name}=["']([^"']+)["']`,'i'))||[])[1]||''}
function safeImage(raw){const url=absoluteUrl(raw);if(!url||/logo|icon|avatar|placeholder|sprite/i.test(url))return '';return /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(url)||/image|img|photo|media/i.test(url)?url:''}
function imageFromHtml(html=''){
  const tags=String(html).match(/<img\b[^>]*>/gi)||[];
  for(const tag of tags){
    const srcset=attr(tag,'srcset').split(',').pop()?.trim().split(/\s+/)[0];
    const candidate=attr(tag,'data-src')||attr(tag,'data-lazy-src')||attr(tag,'src')||srcset;
    const image=safeImage(candidate);if(image)return image;
  }
  return '';
}
function formatPrice(raw=''){const digits=String(raw).replace(/[^\d]/g,'');if(!digits)return '';const value=Number(digits);if(value<1000||value>500000)return '';return new Intl.NumberFormat('pt-PT',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(value)}
function metaFromText(value=''){
  const text=clean(value);
  const priceRaw=(text.match(/(?:€\s*)?\b\d{1,3}(?:[.\s]\d{3})+(?:,\d{2})?\s*€?|\b\d{4,6}\s*€/i)||[])[0]||'';
  const year=(text.match(/\b(?:19|20)\d{2}\b/)||[])[0]||'';
  const mileage=(text.match(/\b\d{1,3}(?:[.\s]\d{3})*\s*(?:km|quilómetros|quilometros)\b/i)||[])[0]||'';
  const fuelMatch=text.match(/\b(el[eé]trico|h[ií]brido plug-in|h[ií]brido|gasolina|diesel|GPL)\b/i);
  const bodyMatch=text.match(/\b(SUV|crossover|carrinha|break|berlina|citadino|monovolume)\b/i);
  return {price:formatPrice(priceRaw),year,mileage:mileage.replace(/quil[oó]metros/i,'km'),fuel:fuelMatch?fuelMatch[1].replace(/^./,c=>c.toUpperCase()):'',bodyStyle:bodyMatch?bodyMatch[1]:''};
}
function directUrlFromQuery(query=''){const match=String(query).match(/https?:\/\/\S*standvirtual\.com\S*/i);return match?match[0].replace(/[)\],.;]+$/g,''):''}
function phraseAppearsInTitle(title,phrase){return (` ${normalise(title)} `).includes(` ${normalise(phrase)} `)}
function scoreItem(item,queryTerms,queryRaw){const titleNorm=normalise(item.title),titleTokens=tokens(item.title),queryNorm=normalise(queryRaw);let score=0;if(!queryNorm||!queryTerms.length)return 0;if(queryTerms.length===1)return titleTokens.includes(queryNorm)?100:0;if(phraseAppearsInTitle(item.title,queryNorm))score+=60;for(const term of queryTerms){if(titleTokens.includes(term))score+=term.length>=4?12:6;else if(term.length>=4&&titleNorm.includes(term))score+=2}if(!queryTerms.some(term=>titleTokens.includes(term)))return 0;if(CAR_WORDS.test(item.title))score+=2;return score}
function mergeItem(base,next){return {title:base.title||next.title,url:base.url||next.url,image:base.image||next.image,price:base.price||next.price,year:base.year||next.year,mileage:base.mileage||next.mileage,fuel:base.fuel||next.fuel,bodyStyle:base.bodyStyle||next.bodyStyle}}
function unique(items){const map=new Map();for(const item of items){const key=item.url||normalise(item.title);if(!key)continue;map.set(key,map.has(key)?mergeItem(map.get(key),item):item)}return [...map.values()]}
function extractAnchors(html){
  const items=[];const regex=/<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;let match;
  while((match=regex.exec(html))){const attrs=`${match[1]} ${match[3]}`,href=match[2],inside=match[4],url=absoluteUrl(href);if(!url||!looksLikeCarUrl(url))continue;const title=safeTitle(attr(attrs,'title')||attr(attrs,'aria-label')||inside,url);if(!title)continue;items.push({title,url,image:imageFromHtml(inside),...metaFromText(inside)})}
  return items;
}
function extractJsonHints(html){
  const items=[];const urlRegex=/https?:\\?\/\\?\/[^"'\\]+standvirtual[^"'\\]+/gi;const urls=html.match(urlRegex)||[];
  for(const raw of urls.slice(0,500)){const url=raw.replace(/\\\//g,'/').replace(/\\u002F/g,'/');if(!looksLikeCarUrl(url))continue;const title=titleFromUrl(url);if(title)items.push({title,url,image:'',price:'',year:'',mileage:'',fuel:'',bodyStyle:''})}
  return items;
}
function extractVehicleTextHints(html){
  const items=[],text=clean(html),regex=new RegExp(`\\b(${CAR_WORDS.source})\\b.{0,120}`,'gi');const matches=text.match(regex)||[];
  for(const value of matches.slice(0,80)){const title=clean(value).replace(BAD_TITLE_PATTERNS,'').slice(0,100);if(isBadTitle(title)||!CAR_WORDS.test(title))continue;items.push({title:formatTitle(title),url:STOCK_URL,image:'',...metaFromText(value)})}
  return items;
}
export async function fetchStockItems(){
  const response=await fetch(STOCK_URL,{headers:{'user-agent':'Mozilla/5.0 assistente-credicarros-stock-search','accept':'text/html,application/xhtml+xml'}});
  if(!response.ok)return [];
  const html=await response.text();
  return unique([...extractAnchors(html),...extractJsonHints(html),...extractVehicleTextHints(html)]).map(item=>({...item,title:safeTitle(item.title,item.url)||item.title})).filter(item=>item.title&&!isBadTitle(item.title));
}
export default async function handler(req,res){
  if(req.method!=='GET'){res.status(405).json({error:'Use GET.'});return}
  const rawQuery=String(req.query.q||'').trim(),directUrl=directUrlFromQuery(rawQuery);
  if(directUrl&&looksLikeCarUrl(directUrl)){const title=titleFromUrl(directUrl);if(title){res.status(200).json({query:rawQuery,source:'direct_url',results:[{title,url:directUrl,image:'',price:'',year:'',mileage:'',fuel:'',bodyStyle:''}]});return}}
  const query=rawQuery.slice(0,120);
  try{
    const all=await fetchStockItems();
    if(!query){res.status(200).json({query:'',source:STOCK_URL,results:all.slice(0,12)});return}
    const queryTerms=tokens(query).filter(term=>term.length>=2);
    const results=all.map(item=>({...item,score:scoreItem(item,queryTerms,query)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score).slice(0,6).map(({score,...item})=>item);
    res.status(200).json({query,source:STOCK_URL,results});
  }catch(error){res.status(200).json({query,results:[],warning:'Pesquisa indisponível neste momento.'})}
}

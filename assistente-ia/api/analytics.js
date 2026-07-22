const ALLOWED_EVENTS=new Set(['opened','mode_selected','stock_loaded','vehicle_selected','option_selected','advisor_answer','recommendations_shown','compare_changed','comparison_opened','lead_ready','whatsapp_opened','restarted']);
function safe(value,max=120){return String(value||'').replace(/[<>\n\r]/g,' ').trim().slice(0,max)}
export default async function handler(req,res){
  if(req.method!=='POST'){res.status(405).json({error:'Use POST.'});return}
  const event=safe(req.body?.event,40);if(!ALLOWED_EVENTS.has(event)){res.status(204).end();return}
  const meta={};for(const [key,value] of Object.entries(req.body?.meta||{})){if(Object.keys(meta).length>=8)break;meta[safe(key,40)]=safe(value,120)}
  console.log(JSON.stringify({type:'credicarros_funnel',event,sessionId:safe(req.body?.sessionId,80),meta,at:new Date().toISOString()}));
  res.status(204).end();
}

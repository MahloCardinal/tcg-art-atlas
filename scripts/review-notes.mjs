import {readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import '../public/review-notes.js';
const queues=new Map();
export function saveObservation(root,catalog,payload) {
  const target=path.join(root,'CARD_REVIEW.json');
  const previous=queues.get(target) || Promise.resolve();
  const task=previous.catch(()=>{}).then(async()=>{
    const entry=globalThis.TCG_REVIEW_NOTES.createObservation(catalog,payload);
    const registry=JSON.parse(await readFile(target,'utf8'));
    const saved=globalThis.TCG_REVIEW_NOTES.appendObservation(registry,entry);
    const pending=target+'.observations.pending';
    await writeFile(pending,JSON.stringify(registry,null,2)+'\n','utf8');
    await rename(pending,target);
    return saved;
  });
  queues.set(target,task);
  return task.finally(()=>{if(queues.get(target)===task) queues.delete(target);});
}
export async function handleObservationRequest(request,response,root,readCatalog) {
  const respond=(status,data)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(data));};
  const address=request.socket.localAddress;
  const host=request.headers.host;
  const expected='http://127.0.0.1:'+request.socket.localPort;
  if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address) || !['127.0.0.1:'+request.socket.localPort,'localhost:'+request.socket.localPort].includes(host) || ![expected,'http://localhost:'+request.socket.localPort].includes(request.headers.origin)) return respond(403,{error:'Origine non autorizzata.'});
  if (request.method!=='POST') return respond(405,{error:'Usa il pulsante Invia dal popup.'});
  if (!request.headers['content-type']?.startsWith('application/json')) return respond(415,{error:'Formato della richiesta non valido.'});
  try {
    const chunks=[];let size=0;
    for await (const chunk of request) {size+=chunk.length;if(size>24000) return respond(413,{error:'Osservazione troppo lunga.'});chunks.push(chunk);}
    const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const saved=await saveObservation(root,await readCatalog(),payload);
    respond(201,{id:saved.id,status:'saved',file:'CARD_REVIEW.json',code:saved.code});
  } catch(error) {respond(error instanceof SyntaxError?400:422,{error:error.message || 'Salvataggio non riuscito.'});}
}

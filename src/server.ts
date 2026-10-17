import {createHash,timingSafeEqual} from 'node:crypto';
import {ApiError,TelegramApi,chatId} from './api';
import {contentInput,preview} from './plugin';
import {InputError} from './types';
export const MAX_BODY_BYTES=256*1024;
export interface Configuration {
 listen:string;
 bots:Record<string,{token_env:string}>;
 clients:Record<string,{token_sha256:string;bots:string[];chats:string[]}>;
}
function object(value:unknown):Record<string,unknown> {
 if(!value || typeof value!=='object' || Array.isArray(value)) throw new InputError('Expected a JSON object');
 return value as Record<string,unknown>;
}
function keys(value:Record<string,unknown>,allowed:string[]) {if(Object.keys(value).some(key=>!allowed.includes(key))) throw new InputError('Unknown configuration field');}
function listenAddress(value:string) {
 const match=value.match(/^(\[[\da-f:]+\]|[a-zA-Z0-9.-]+):(\d+)$/i);
 if(!match || Number(match[2])>65535) throw new InputError('listen must be host:port');
 return {hostname:match[1].replace(/^\[|\]$/g,''),port:Number(match[2])};
}
export function validateConfig(value:unknown):Configuration {
 const config=object(value);keys(config,['listen','bots','clients']);
 const bots=object(config.bots),clients=object(config.clients);
 const result:Configuration={listen:config.listen===undefined?'127.0.0.1:8787':String(config.listen),bots:Object.create(null),clients:Object.create(null)};
 listenAddress(result.listen);
 for(const [name,entry] of Object.entries(bots)) {
  if(!/^[\w-]{1,64}$/.test(name)) throw new InputError('Invalid bot name');
  const bot=object(entry);keys(bot,['token_env']);
  if(typeof bot.token_env!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(bot.token_env)) throw new InputError('Bots require token_env, never inline tokens');
  result.bots[name]={token_env:bot.token_env};
 }
 const hashes=new Set<string>();
 for(const [name,entry] of Object.entries(clients)) {
  if(!/^[\w-]{1,64}$/.test(name)) throw new InputError('Invalid client name');
  const client=object(entry);keys(client,['token_sha256','bots','chats']);
  if(typeof client.token_sha256!=='string'||!/^[a-f0-9]{64}$/i.test(client.token_sha256)) throw new InputError('Clients require a SHA-256 hex digest');
  if(!Array.isArray(client.bots)||client.bots.some(bot=>typeof bot!=='string'||!Object.hasOwn(result.bots,bot))) throw new InputError('Client bots must reference configured bots');
  if(!Array.isArray(client.chats)) throw new InputError('Client chats must be an array');
  const hash=client.token_sha256.toLowerCase();if(hashes.has(hash)) throw new InputError('Client token hashes must be unique');hashes.add(hash);
  result.clients[name]={token_sha256:hash,bots:client.bots as string[],chats:client.chats.map(chatId)};
 }
 return result;
}
class HttpError extends Error {constructor(readonly status:number,message:string){super(message);}}
async function readBody(request:Request,onSize:(size:number)=>void):Promise<unknown> {
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json') throw new HttpError(415,'Content-Type must be application/json');
 if(Number(request.headers.get('content-length'))>MAX_BODY_BYTES) throw new HttpError(413,'Request body exceeds 256 KB');
 const reader=request.body?.getReader();if(!reader) throw new HttpError(400,'JSON body required');
 const chunks:Uint8Array[]=[];let size=0;
 try {
  while(true) {const {done,value}=await reader.read();if(done) break;size+=value.length;onSize(size);if(size>MAX_BODY_BYTES) {await reader.cancel();throw new HttpError(413,'Request body exceeds 256 KB');}chunks.push(value);}
 } finally {reader.releaseLock();}
 try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw new HttpError(400,'Invalid JSON body');}
}
export function startServer(configuration:Configuration,options:{environment?:Record<string,string|undefined>;log?:(line:string)=>void}={}) {
 const config=validateConfig(configuration);const environment=options.environment ?? process.env;
 const log=options.log ?? ((line:string)=>process.stderr.write(line+'\n'));
 const bots=new Map<string,TelegramApi>();
 for(const [name,bot] of Object.entries(config.bots)) {const token=environment[bot.token_env];if(!token) throw new InputError(`Missing bot environment variable: ${bot.token_env}`);bots.set(name,new TelegramApi(token,environment.TELEGRAM_API_BASE));}
 const clients=Object.entries(config.clients).map(([name,client])=>({name,...client,digest:Buffer.from(client.token_sha256,'hex')}));
 return Bun.serve({...listenAddress(config.listen),maxRequestBodySize:MAX_BODY_BYTES+1024,idleTimeout:30,
  async fetch(request) {
   const path=new URL(request.url).pathname;
   if(request.method==='GET'&&path==='/health') return Response.json({ok:true});
   let clientName:string|undefined,botName:string|undefined,chat:string|undefined,size=0,status=200;
   try {
    if(request.method!=='POST'||!['/send','/preview'].includes(path)) throw new HttpError(404,'Not found');
    const authorization=request.headers.get('authorization')?.match(/^Bearer (\S+)$/);
    const digest=createHash('sha256').update(authorization?.[1] ?? '').digest();
    let client:typeof clients[number]|undefined;
    for(const candidate of clients) {const matches=timingSafeEqual(digest,candidate.digest);if(matches && authorization) client=candidate;}
    if(!client) throw new HttpError(401,'Unauthorized');clientName=client.name;
    const body=object(await readBody(request,value=>{size=value;}));
    if(path==='/preview') return Response.json(preview(contentInput(body,'blocks')));
    if(typeof body.bot!=='string'||!client.bots.includes(body.bot)) throw new HttpError(403,'Bot is not allowed');botName=body.bot;
    const identifier=chatId(body.chat_id);if(!client.chats.includes(identifier)) throw new HttpError(403,'Chat is not allowed');chat=identifier;
    const message=contentInput(body,'blocks');
    const result=await bots.get(botName)!.send(chat,message,{silent:body.silent as boolean|undefined,reply_to:body.reply_to as number|undefined,thread_id:body.thread_id as number|undefined});
    return Response.json(result);
   } catch(error) {
    status=error instanceof HttpError?error.status:error instanceof InputError?400:error instanceof ApiError?502:500;
    return Response.json({ok:false,error:error instanceof HttpError||error instanceof InputError?error.message:error instanceof ApiError?'Telegram request failed':'Internal server error',...(error instanceof ApiError?{message_ids:error.message_ids}:{})},{status});
   } finally {log(JSON.stringify({bot:botName ?? null,chat:chat ?? null,client:clientName ?? null,size,status}));}
  }
 });
}

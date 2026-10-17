import { singleMessage, splitMessage } from './limits';
import { plaintext } from './plaintext';
import { InputError, type RichMessage } from './types';
export interface SendOptions { silent?:boolean; reply_to?:number; thread_id?:number }
export interface SendResult { ok:true; message_ids:number[]; fallback?:true }
export function redact(value:unknown,token?:string):string {
  let text=value instanceof Error?value.message:String(value);
  if(token) text=text.split(token).join('[REDACTED]');
  return text.replace(/bot\d+:[A-Za-z0-9_-]+/g,'bot[REDACTED]');
}
export class ApiError extends Error {
  constructor(message:string,readonly unsupported=false,readonly message_ids:number[]=[]) { super(message); }
}
export function positiveInteger(value:unknown,name:string):number {
  const number=typeof value==='number'?value:typeof value==='string' && /^\d+$/.test(value)?Number(value):NaN;
  if(!Number.isSafeInteger(number)||number<=0) throw new InputError(`${name} must be a positive integer`);
  return number;
}
export function chatId(value:unknown):string {
  if(typeof value==='number' && Number.isSafeInteger(value) && value!==0) return String(value);
  if(typeof value==='string' && /^-?[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))) return value;
  throw new InputError('chat_id must be a non-zero numeric chat ID');
}
export function requestOptions(options:SendOptions):Record<string,unknown> {
  if(options.silent!==undefined && typeof options.silent!=='boolean') throw new InputError('silent must be boolean');
  return {
    ...(options.silent!==undefined?{disable_notification:options.silent}:{}),
    ...(options.reply_to!==undefined?{reply_parameters:{message_id:positiveInteger(options.reply_to,'reply_to')}}:{}),
    ...(options.thread_id!==undefined?{message_thread_id:positiveInteger(options.thread_id,'thread_id')}:{})
  };
}
export class TelegramApi {
  constructor(private readonly token:string,private readonly base=process.env.TELEGRAM_API_BASE ?? 'https://api.telegram.org') {
    if(!token || /[\s/]/.test(token)) throw new InputError('A valid bot token is required');
  }
  private async request(method:string,body:Record<string,unknown>):Promise<unknown> {
    try {
      const response=await fetch(`${this.base.replace(/\/$/,'')}/bot${this.token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000),redirect:'error'});
      let data:{ok?:boolean;result?:unknown;description?:string;error_code?:number}={};
      try { data=await response.json() as typeof data; } catch {}
      if(!response.ok || data.ok!==true) {
        const description=redact(data.description ?? `HTTP ${response.status}`,this.token);
        throw new ApiError(description,response.status===404 || data.error_code===404 || /method\s+not\s+found|unsupported/i.test(description));
      }
      return data.result;
    } catch(error) {
      if(error instanceof ApiError) throw error;
      throw new ApiError(redact(error,this.token));
    }
  }
  private identifier(result:unknown):number {
    const identifier=(result as {message_id?:unknown})?.message_id;
    if(!Number.isSafeInteger(identifier)) throw new ApiError('Telegram returned no valid message_id');
    return identifier as number;
  }
  private async fallback(chat_id:string,message:RichMessage,options:SendOptions,ids:number[]):Promise<void> {
    const text=plaintext(message);
    if(!text.trim()) throw new ApiError('No plain text representation is available');
    // UTF-16 chunks are conservative and never split a surrogate pair.
    for(let offset=0;offset<text.length;) {
      let end=Math.min(offset+4096,text.length);
      if(end<text.length && /[\uD800-\uDBFF]/.test(text[end-1])) end--;
      ids.push(this.identifier(await this.request('sendMessage',{chat_id,text:text.slice(offset,end),...requestOptions(options)})));
      offset=end;
    }
  }
  async send(chat:unknown,message:RichMessage,options:SendOptions={}):Promise<SendResult> {
    const chat_id=chatId(chat); const fields=requestOptions(options); const parts=splitMessage(message);
    const ids:number[]=[]; let fallback=false;
    try {
      for(const part of parts) {
        if(!fallback) {
          try { ids.push(this.identifier(await this.request('sendRichMessage',{chat_id,rich_message:part,...fields}))); continue; }
          catch(error) { if(!(error instanceof ApiError) || !error.unsupported) throw error; fallback=true; }
        }
        await this.fallback(chat_id,part,options,ids);
      }
    } catch(error) { throw new ApiError(`${redact(error,this.token)}; completed message IDs: ${JSON.stringify(ids)}`,false,ids); }
    return {ok:true,message_ids:ids,...(fallback?{fallback:true}:{})};
  }
  async draft(chat:unknown,draft_id:number,message:RichMessage,can_stop?:boolean):Promise<SendResult> {
    const chat_id=Number(chatId(chat));
    if(chat_id<0) throw new InputError('Drafts require a private chat');
    if(!Number.isSafeInteger(draft_id)||draft_id===0) throw new InputError('draft_id must be a non-zero integer');
    if(can_stop!==undefined && typeof can_stop!=='boolean') throw new InputError('can_stop must be boolean');
    singleMessage(message);
    const hasMedia=(value:unknown):boolean=>!!value && typeof value==='object' && (Array.isArray(value)?value.some(hasMedia):Object.entries(value).some(([key,child])=>key==='media'||hasMedia(child)));
    if(hasMedia(message)) throw new InputError('Draft media is not supported by this sender');
    try {
      await this.request('sendRichMessageDraft',{chat_id,draft_id,rich_message:message,...(can_stop!==undefined?{can_stop}:{})});
      return {ok:true,message_ids:[]};
    } catch(error) {
      if(!(error instanceof ApiError)||!error.unsupported) throw error;
      const ids:number[]=[]; await this.fallback(String(chat_id),message,{},ids);
      return {ok:true,message_ids:ids,fallback:true};
    }
  }
  async edit(chat:unknown,message_id:number,message:RichMessage):Promise<SendResult> {
    const chat_id=chatId(chat);positiveInteger(message_id,'message_id');singleMessage(message);
    try { const result=await this.request('editMessageText',{chat_id,message_id,rich_message:message}); return {ok:true,message_ids:[this.identifier(result)]}; }
    catch(error) {
      if(!(error instanceof ApiError)||!error.unsupported) throw error;
      const ids:number[]=[];await this.fallback(chat_id,message,{},ids);return {ok:true,message_ids:ids,fallback:true};
    }
  }
}

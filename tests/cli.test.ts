import {afterEach,expect,test} from 'bun:test';
const servers:ReturnType<typeof Bun.serve>[]=[];
afterEach(()=>servers.splice(0).forEach(server=>server.stop(true)));
async function cli(args:string[],input='',environment:Record<string,string>={}) {
 const child=Bun.spawn([process.execPath,'src/cli.ts',...args],{cwd:import.meta.dir+'/..',env:{PATH:process.env.PATH!,HOME:'/nonexistent-test-home',CLAUDE_CONFIG_DIR:'/nonexistent-test-home',...environment},stdin:'pipe',stdout:'pipe',stderr:'pipe'});
 child.stdin.write(input);child.stdin.end();
 const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);return {stdout,stderr,code};
}
test('preview from stdin',async()=>{const result=await cli(['preview','-'],'# Hi');expect(result.code).toBe(0);expect(JSON.parse(result.stdout)).toEqual({blocks:[{type:'heading',size:1,text:'Hi'}]});});
test('dry run needs no token and prints request shape',async()=>{
 const result=await cli(['send','--chat','42','--silent','--reply-to','3','--thread','9','--dry-run','-'],'**hello**');
 expect(result.code).toBe(0);const request=JSON.parse(result.stdout);expect(request.url).toContain('bot[REDACTED]');expect(request.body.disable_notification).toBe(true);expect(request.body.reply_parameters).toEqual({message_id:3});expect(request.body.message_thread_id).toBe(9);
});
for(const args of [[],['unknown'],['send'],['send','--chat','42','--unknown'],['send','--chat','42','--reply-to','x'],['serve'],['preview','--silent']]) test(`usage: ${args.join(' ')}`,async()=>expect((await cli(args,'text')).code).toBe(2));
test('JSON validation and passthrough',async()=>{
 const result=await cli(['send','--chat','42','--json','--dry-run'],'{"blocks":[{"type":"paragraph","text":"raw"}]}');expect(result.code).toBe(0);expect(JSON.parse(result.stdout).body.rich_message.blocks[0].text).toBe('raw');
 expect((await cli(['send','--chat','42','--json','--dry-run'],'bad')).code).toBe(2);
});
test('API failure exits 1 and success prints IDs',async()=>{
 let success=false; const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>Response.json(success?{ok:true,result:{message_id:19}}:{ok:false,error_code:403,description:'Forbidden'})});servers.push(server);
 const environment={TELEGRAM_API_BASE:server.url.origin,EXAMPLE_TOKEN:'123:FAKE'};
 const args=['send','--chat','42','--token-env','EXAMPLE_TOKEN'];
 expect((await cli(args,'hello',environment)).code).toBe(1);
 success=true;const result=await cli(args,'hello',environment);expect(result.code).toBe(0);expect(JSON.parse(result.stdout).message_ids).toEqual([19]);
});

import {it,expect,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
vi.mock('../server/pgadmin',()=>({listProfiles:vi.fn(),resolveConnection:vi.fn(async()=>({name:'fixture'}))}));
vi.mock('../server/queryRunner',()=>({runQuery:vi.fn(),runReadOnlyQuery:vi.fn()}));
import {ProxyService} from '../server/service';
import {runQuery} from '../server/queryRunner';
import {setSessionPassword,resolveEnvironment,passwordPromptReason,clearSessionPasswords} from '../server/environments';
it('records actual outcome when submitting CLI disconnects during an approved write',async()=>{
 let done!:(v:any)=>void;
 vi.mocked(runQuery).mockReturnValueOnce(new Promise(r=>done=r));
 const service=new ProxyService();
 const {tabId}=service.startPgsqlSubmission({profile:'fixture',database:'fixture',sql:'insert into t values (1)',description:'fixture',classification:'write'});
 const pending=service.approveTab(tabId,true);
 await Promise.resolve();await Promise.resolve();
 service.abandonPgsql(tabId);
 done({columns:[],rows:[],rowCount:1,command:'INSERT',durationMs:1});await pending;
 expect(service.snapshot().tabs[0].status).toBe('executed');
});
it('does not discard a correct password when SQL refers to a missing password column',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pd-review-env-'));
 process.env.PROXYDIABLO_ENVIRONMENTS=path.join(dir,'env.json');
 fs.writeFileSync(process.env.PROXYDIABLO_ENVIRONMENTS,JSON.stringify({environments:[{name:'fixture',host:'fixture.invalid',user:'fixture'}]}));
 setSessionPassword('fixture','fixture-secret');
 const reason=passwordPromptReason('fixture',Object.assign(new Error('column "password" does not exist'),{code:'42703'}));
 const conn=await resolveEnvironment('fixture','fixture');
 delete process.env.PROXYDIABLO_ENVIRONMENTS;clearSessionPasswords();fs.rmSync(dir,{recursive:true});
 expect({reason,password:conn?.password}).toEqual({reason:undefined,password:'fixture-secret'});
});
it('invalidates session credentials when an environment is retargeted',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pd-review-env-'));
 process.env.PROXYDIABLO_ENVIRONMENTS=path.join(dir,'env.json');
 const write=(host:string)=>fs.writeFileSync(process.env.PROXYDIABLO_ENVIRONMENTS!,JSON.stringify({environments:[{name:'fixture',host,user:'fixture'}]}));
 write('old.invalid');setSessionPassword('fixture','fixture-secret');write('new.invalid');
 const conn=await resolveEnvironment('fixture','fixture');
 delete process.env.PROXYDIABLO_ENVIRONMENTS;clearSessionPasswords();fs.rmSync(dir,{recursive:true});
 expect(conn?.password).toBeUndefined();
});
it('preserves a query failure after requester disconnect instead of reopening the password prompt',async()=>{
 let fail!:(e:Error)=>void;
 vi.mocked(runQuery).mockReturnValueOnce(new Promise((_,reject)=>fail=reject));
 const service=new ProxyService();
 const {tabId}=service.startPgsqlSubmission({profile:'fixture',database:'fixture',sql:'select 1',description:'fixture',classification:'read'});
 const pending=service.approveTab(tabId,false);
 await Promise.resolve();await Promise.resolve();
 service.abandonPgsql(tabId);
 fail(new Error('fixture failure'));await pending;
 expect(service.snapshot().tabs[0]).toMatchObject({status:'error',requesterDisconnected:true,error:'fixture failure'});
});
it('keeps a completed result when requester disconnects before release',async()=>{
 vi.mocked(runQuery).mockResolvedValueOnce({columns:[],rows:[],rowCount:1,command:'SELECT',durationMs:1});
 const service=new ProxyService();
 const {tabId}=service.startPgsqlSubmission({profile:'fixture',database:'fixture',sql:'select 1',description:'fixture',classification:'read'});
 await service.approveTab(tabId,false);service.abandonPgsql(tabId);
 expect(service.snapshot().tabs[0]).toMatchObject({status:'executed',requesterDisconnected:true,result:{rowCount:1}});
 await service.approveTab(tabId,false);
 expect(service.snapshot().tabs[0].status).toBe('executed');
});

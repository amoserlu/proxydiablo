import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { runQuery } from '../server/queryRunner';
let directory: string;
let context: tls.SecureContext;
beforeAll(() => {
  directory=fs.mkdtempSync(path.join(os.tmpdir(),'proxy-tls-test-'));
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-subj','/CN=fixture.invalid','-addext','subjectAltName=DNS:fixture.invalid','-keyout',path.join(directory,'key.pem'),'-out',path.join(directory,'cert.pem'),'-days','1'],{stdio:'ignore'});
  context=tls.createSecureContext({key:fs.readFileSync(path.join(directory,'key.pem')),cert:fs.readFileSync(path.join(directory,'cert.pem'))});
});
afterAll(() => fs.rmSync(directory,{recursive:true}));
async function attempt(trust: boolean, tlsServerName: string) {
  let received=false;
  const sockets=new Set<net.Socket>();
  const server=net.createServer(socket => {
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>undefined);socket.setTimeout(2000,()=>socket.destroy());
    socket.once('data',()=>{
      socket.write('S');const encrypted=new tls.TLSSocket(socket,{isServer:true,secureContext:context});encrypted.on('error',()=>undefined);let stage=0;
      encrypted.on('data',data=>{
        if(stage++===0){const auth=Buffer.alloc(9);auth[0]=82;auth.writeInt32BE(8,1);auth.writeInt32BE(3,5);encrypted.write(auth);}
        else if(stage===2) {received=data.toString().includes('SYNTHETIC_IAM_TOKEN');const body=Buffer.from('SFATAL\0C28P01\0Mfixture rejected\0\0');const h=Buffer.alloc(5);h[0]=69;h.writeInt32BE(body.length+4,1);encrypted.end(Buffer.concat([h,body]));}
      });
    });
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  let error: unknown;
  try {
    await runQuery({id:-1,name:'fixture',host:'127.0.0.1',port:(server.address() as net.AddressInfo).port,database:'fixture',user:'fixture',password:'SYNTHETIC_IAM_TOKEN',auth:'rds-iam',sslmode:'verify-full',tlsServerName,...(trust?{sslrootcert:path.join(directory,'cert.pem')}:{} )},'SELECT 1',true);
  } catch (failure) {error=failure;}
  finally {for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  return {received,error};
}
it('rejects an untrusted peer before sending the IAM token',async()=>{
  const result=await attempt(false,'fixture.invalid');expect(result.error).toBeTruthy();expect(result.received).toBe(false);
});
it('rejects a trusted certificate for the wrong host before sending the token',async()=>{
  const result=await attempt(true,'wrong.invalid');expect(result.error).toMatchObject({code:'ERR_TLS_CERT_ALTNAME_INVALID'});expect(result.received).toBe(false);
});
it('authenticates only after the trusted certificate matches the signing endpoint through a tunnel',async()=>{
  const result=await attempt(true,'fixture.invalid');expect(result.error).toMatchObject({code:'28P01'});expect(result.received).toBe(true);
});

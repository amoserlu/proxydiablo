import net from 'node:net';
import tls from 'node:tls';
import { Duplex } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { runMysqlQuery } from '../server/mysql';
let directory: string;
let context: tls.SecureContext;
beforeAll(() => {
  directory=fs.mkdtempSync(path.join(os.tmpdir(),'proxy-mysql-tls-test-'));
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-subj','/CN=fixture.invalid','-addext','subjectAltName=DNS:fixture.invalid','-keyout',path.join(directory,'key.pem'),'-out',path.join(directory,'cert.pem'),'-days','1'],{stdio:'ignore'});
  context=tls.createSecureContext({key:fs.readFileSync(path.join(directory,'key.pem')),cert:fs.readFileSync(path.join(directory,'cert.pem'))});
});
afterAll(() => fs.rmSync(directory,{recursive:true}));
const packet=(payload: Buffer,seq: number)=>{const h=Buffer.alloc(4);h.writeUIntLE(payload.length,0,3);h[3]=seq;return Buffer.concat([h,payload]);};
function frames(socket: net.Socket, onPacket:(data: Buffer, rest: Buffer)=>void | boolean) {
  let buffer=Buffer.alloc(0);
  const listener=(chunk:Buffer|string)=>{buffer=Buffer.concat([buffer,Buffer.from(chunk)]);while(buffer.length>=4){const size=buffer.readUIntLE(0,3);if(buffer.length<size+4)return;const data=buffer.subarray(4,size+4);buffer=buffer.subarray(size+4);if(onPacket(data,buffer)===false){buffer=Buffer.alloc(0);return;}}};
  socket.on('data',listener);return ()=>socket.off('data',listener);
}
async function attempt(trust:boolean,name:string,sslmode='verify-full') {
  let received=false,connections=0;
  const sockets=new Set<net.Socket>();
  const server=net.createServer(socket=>{
    connections++;sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>undefined);socket.setTimeout(2000,()=>socket.destroy());
    const flags=1|8|512|2048|8192|32768|524288;
    const fixed=Buffer.alloc(31);let p=0;fixed.writeUInt32LE(1,p);p+=4;fixed.fill(65,p,p+8);p+=8;fixed[p++]=0;fixed.writeUInt16LE(flags&65535,p);p+=2;fixed[p++]=45;fixed.writeUInt16LE(2,p);p+=2;fixed.writeUInt16LE(flags>>>16,p);p+=2;fixed[p]=21;
    socket.write(packet(Buffer.concat([Buffer.from([10]),Buffer.from('8.0-fixture\0'),fixed,Buffer.from('BBBBBBBBBBBB\0mysql_native_password\0')]),0));
    const detach=frames(socket,(_data,rest)=>{
      detach();
      // SSLRequest and ClientHello may share a TCP read. Feed the remaining
      // ciphertext through a duplex transport so the TLS engine sees every byte.
      const transport=new Duplex({read(){},write(chunk,encoding,callback){socket.write(chunk,encoding,callback);}});
      socket.on('data',chunk=>transport.push(chunk));socket.on('end',()=>transport.push(null));socket.on('close',()=>transport.destroy());
      const encrypted=new tls.TLSSocket(transport,{isServer:true,secureContext:context});
      if(rest.length)transport.push(rest);encrypted.on('error',()=>undefined);let stage=0;
      frames(encrypted,data=>{
        if(stage++===0)encrypted.write(packet(Buffer.concat([Buffer.from([254]),Buffer.from('mysql_clear_password\0\0')]),3));
        else if(stage===2){received=data.toString().includes('SYNTHETIC_IAM_TOKEN');encrypted.end(packet(Buffer.concat([Buffer.from([255,0x15,0x04]),Buffer.from('#28000fixture rejected')]),5));}
      });
      return false;
    });
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  let error:unknown;
  try {await runMysqlQuery({id:-1,name:'fixture',host:'127.0.0.1',port:(server.address() as net.AddressInfo).port,database:'fixture',user:'fixture',password:'SYNTHETIC_IAM_TOKEN',engine:'mysql',auth:'rds-iam',sslmode,tlsServerName:name,...(trust?{sslrootcert:path.join(directory,'cert.pem')}:{} )},'SELECT 1',[],true);}
  catch(failure){error=failure;}
  finally{for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  return {received,connections,error};
}
it('rejects non-TLS IAM before connecting or sending a token',async()=>{
  const result=await attempt(false,'fixture.invalid','disable');expect(result.error).toBeTruthy();expect(result.connections).toBe(0);expect(result.received).toBe(false);
});
it('does not send an IAM token to an untrusted MySQL TLS peer',async()=>{
  const result=await attempt(false,'fixture.invalid');expect(String(result.error)).toMatch(/certificate|self.signed/i);expect(result.received).toBe(false);
});
it('does not send an IAM token when a trusted certificate has the wrong hostname',async()=>{
  const result=await attempt(true,'other.invalid');expect(result.error).toMatchObject({code:'HANDSHAKE_SSL_ERROR'});expect(String(result.error)).toMatch(/hostname|altnames|certificate/i);expect(result.received).toBe(false);
});
it('verifies the real endpoint through a tunnel before sending the token',async()=>{
  const result=await attempt(true,'fixture.invalid');expect(result.error).toMatchObject({code:'ER_ACCESS_DENIED_ERROR'});expect(result.received).toBe(true);
});

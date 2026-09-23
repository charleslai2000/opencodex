import { createHmac, timingSafeEqual } from "node:crypto";
import { isLocalAttestationSecret } from "./local-management-attestation";
export const LOCAL_ROUTING_RELOAD_METHOD = "POST";
export const LOCAL_ROUTING_RELOAD_PATH = "/api/routing/reload";
export const LOCAL_ROUTING_RELOAD_CAPABILITY_VERSION = "v1";
export const LOCAL_ROUTING_RELOAD_EXPECTED_PID_HEADER = "x-opencodex-routing-reload-expected-pid";
export const LOCAL_ROUTING_RELOAD_NONCE_HEADER = "x-opencodex-routing-reload-nonce";
export const LOCAL_ROUTING_RELOAD_EXPIRES_AT_HEADER = "x-opencodex-routing-reload-expires-at";
export const LOCAL_ROUTING_RELOAD_CONFIG_HASH_HEADER = "x-opencodex-routing-reload-config-hash";
export const LOCAL_ROUTING_RELOAD_CAPABILITY_HEADER = "x-opencodex-routing-reload-capability";
export const LOCAL_ROUTING_RELOAD_CAPABILITY_TTL_MS = 10_000;
const B64 = /^[A-Za-z0-9_-]{43}$/;
function payload(nonce: string, method: string, path: string, pid: number, port: number, expires: number, hash: string): string | null {
 if (!B64.test(nonce)||! /^[a-f0-9]{64}$/.test(hash)||!((method===LOCAL_ROUTING_RELOAD_METHOD&&path===LOCAL_ROUTING_RELOAD_PATH)||(method==="GET"&&path==="/api/routing/reload/state"))||!Number.isSafeInteger(pid)||pid<=0||!Number.isInteger(port)||port<=0||port>65535||!Number.isSafeInteger(expires)||expires<=0)return null;
 return `opencodex-local-routing-reload-v1\n${nonce}\n${method}\n${path}\n${pid}\n${port}\n${expires}\n${hash}`;
}
export function createLocalRoutingReloadCapability(secret:string,nonce:string,method:string,path:string,pid:number,port:number,expires:number,hash:string):string|null {
 if(!isLocalAttestationSecret(secret))return null;const p=payload(nonce,method,path,pid,port,expires,hash);return p?createHmac("sha256",secret).update(p).digest("base64url"):null;
}
export function verifyLocalRoutingReloadCapability(secret:string,nonce:string|null,method:string,path:string,pid:number,port:number,expires:number,hash:string|null,cap:string|null,now=Date.now()):boolean {
 if(!nonce||!hash||!cap||!B64.test(cap)||!Number.isSafeInteger(now)||expires<=now||expires>now+LOCAL_ROUTING_RELOAD_CAPABILITY_TTL_MS)return false;
 const expected=createLocalRoutingReloadCapability(secret,nonce,method,path,pid,port,expires,hash);if(!expected)return false;const a=Buffer.from(expected),b=Buffer.from(cap);return a.length===b.length&&timingSafeEqual(a,b);
}

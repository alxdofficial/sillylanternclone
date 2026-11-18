import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { diagnosticError } from './diagnostics.mjs';

const cookieName = '__Host-story-studio';
const sessionLifetime = 60 * 60 * 24 * 7;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safeError = (status,code,message) => Object.assign(diagnosticError(code,message),{status});

export function createHostedAuth({url,key,encryptionKey,fetchImpl = fetch,clock = Date.now}) {
  const masterKey = Buffer.from(encryptionKey || '','base64url');
  if (masterKey.length !== 32) throw new Error('STORY_STUDIO_ENCRYPTION_KEY must contain 32 random bytes encoded as base64url.');
  const refreshes = new Map();
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || endpoint.pathname !== '/' || endpoint.search || endpoint.hash ||
      endpoint.username || endpoint.password || !key?.startsWith('sb_publishable_')) {
    throw new Error('Hosted mode requires a Supabase HTTPS origin and a publishable key.');
  }

  function encrypt(value,purpose) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm',masterKey,nonce);
    cipher.setAAD(Buffer.from(purpose));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    return Buffer.concat([nonce,cipher.getAuthTag(),ciphertext]).toString('base64url');
  }

  function decrypt(value,purpose) {
    const bytes = Buffer.from(value,'base64url');
    const cipher = createDecipheriv('aes-256-gcm',masterKey,bytes.subarray(0,12));
    cipher.setAAD(Buffer.from(purpose));
    cipher.setAuthTag(bytes.subarray(12,28));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8'));
  }

  async function request(path,{token,method = 'GET',payload,headers = {}} = {}) {
    try {
      const response = await fetchImpl(new URL(path,endpoint),{
        method,redirect:'error',signal:AbortSignal.timeout(7000),
        headers:{apikey:key,...(token ? {authorization:'Bearer ' + token} : {}),
          ...(payload === undefined ? {} : {'content-type':'application/json'}),...headers},
        body:payload === undefined ? undefined : JSON.stringify(payload)
      });
      if (!response.ok) {
        await response.body?.cancel();
        return {status:response.status};
      }
      return {status:response.status,data:response.status === 204 ? undefined : await response.json()};
    } catch {
      throw safeError(503,'AUTH_UNAVAILABLE','The sign-in service is temporarily unavailable.');
    }
  }

  function sessionFrom(data,deadline = clock() + sessionLifetime * 1000) {
    if (!uuid.test(data?.user?.id) || typeof data.user.email !== 'string' ||
        typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string' ||
        !Number.isFinite(data.expires_in)) {
      throw safeError(503,'AUTH_RESPONSE_INVALID','The sign-in service returned an incomplete session.');
    }
    return {userId:data.user.id,email:data.user.email,accessToken:data.access_token,refreshToken:data.refresh_token,
      expiresAt:clock() + data.expires_in * 1000,deadline};
  }

  function sessionCookie(res,value) {
    const token = value ? encrypt(value,'studio-session-v1') : '';
    if (token.length > 3750) throw safeError(503,'SESSION_TOO_LARGE','The sign-in session exceeds the browser limit.');
    const maxAge = value ? Math.max(1,Math.floor((value.deadline-clock())/1000)) : 0;
    res.setHeader('Set-Cookie',`${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
  }

  function readCookie(req) {
    const token = (req.headers.cookie || '').split(';').map(part=>part.trim()).find(part=>part.startsWith(cookieName + '='))?.slice(cookieName.length+1);
    if (!token || token.length > 3750) return null;
    try {
      const session = decrypt(token,'studio-session-v1');
      return session.deadline > clock() && uuid.test(session.userId) ? session : null;
    } catch { return null; }
  }

  async function entitlement(session) {
    const {status,data} = await request('/rest/v1/story_studio_accounts?select=enabled,can_bring_key&user_id=eq.' + session.userId,{
      token:session.accessToken
    });
    if (status === 401 || status === 403) return null;
    if (status !== 200) throw safeError(503,'ACCOUNT_LOOKUP_FAILED','Studio could not verify access to this beta.');
    return data[0]?.enabled ? {id:session.userId,email:session.email,canBringKey:data[0].can_bring_key === true} : null;
  }

  function renew(session) {
    const id = createHash('sha256').update(session.refreshToken).digest('base64url');
    const now = clock();
    for (const [key,value] of refreshes) if (value.expires < now) refreshes.delete(key);
    if (refreshes.has(id)) return refreshes.get(id).operation;
    if (refreshes.size >= 64) throw safeError(503,'AUTH_BUSY','Sign-in is busy. Try again shortly.');
    const operation = (async () => {
      const {status,data} = await request('/auth/v1/token?grant_type=refresh_token',{
        method:'POST',payload:{refresh_token:session.refreshToken}
      });
      if (status === 400 || status === 401 || status === 403) return null;
      if (status !== 200) throw safeError(503,'AUTH_REFRESH_FAILED','Studio could not refresh your sign-in.');
      const renewed = sessionFrom(data,session.deadline);
      return renewed.userId === session.userId ? renewed : null;
    })();
    const entry = {operation,expires:now+10_000};
    refreshes.set(id,entry);
    operation.catch(()=> { if (refreshes.get(id) === entry) refreshes.delete(id); });
    return operation;
  }

  return {
    request, encrypt, decrypt,
    async login(req,res,{email,password} = {}) {
      if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || email.length > 254 ||
          !password || password.length > 256) throw safeError(400,'INVALID_LOGIN','Enter your email and password.');
      const {status,data} = await request('/auth/v1/token?grant_type=password',{method:'POST',payload:{email:email.trim(),password}});
      if (status === 429) throw safeError(429,'LOGIN_LIMIT','Too many sign-in attempts. Try again shortly.');
      if (status === 400 || status === 401 || status === 403) throw safeError(401,'LOGIN_FAILED','Sign-in failed. Check your details and beta access.');
      if (status !== 200) throw safeError(503,'AUTH_UNAVAILABLE','The sign-in service is temporarily unavailable.');
      const session = sessionFrom(data);
      const account = await entitlement(session);
      if (!account) throw safeError(401,'LOGIN_FAILED','Sign-in failed. Check your details and beta access.');
      sessionCookie(res,session);
      return account;
    },
    async authenticate(req,res) {
      const previous = readCookie(req);
      if (!previous) return null;
      const session = previous.expiresAt <= clock()+15_000 ? await renew(previous) : previous;
      const account = session && await entitlement(session);
      if (!account) { sessionCookie(res,null); return null; }
      if (session !== previous) sessionCookie(res,session);
      return {...session,account};
    },
    async logout(req,res) {
      const session = readCookie(req);
      sessionCookie(res,null);
      if (session) await request('/auth/v1/logout?scope=local',{method:'POST',token:session.accessToken}).catch(()=>{});
    },
    cookieAccount(req) { return readCookie(req)?.userId; }
  };
}

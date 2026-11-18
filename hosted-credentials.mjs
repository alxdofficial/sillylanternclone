import { providerNames } from './public/models.js';
import { validKey } from './provider-credentials.mjs';
import { diagnosticError } from './diagnostics.mjs';

const providers = Object.keys(providerNames);
const problem = (status,code,message) => Object.assign(diagnosticError(code,message),{status});

export function createHostedCredentials(auth,{account,accessToken}) {
  const purpose = provider => `studio-provider-key-v1:${account.id}:${provider}`;
  const denied = () => problem(403,'BYOK_DISABLED','This account is not approved to use its own provider keys.');
  const unavailable = () => problem(503,'CREDENTIAL_STORE_UNAVAILABLE','Studio could not access your provider keys.');

  async function saved(onlyNames = false) {
    if (!account.canBringKey) return [];
    const projection = onlyNames ? 'provider' : 'provider,ciphertext';
    const {status,data} = await auth.request('/rest/v1/story_studio_provider_keys?select=' + projection,{token:accessToken});
    if (status !== 200 || !Array.isArray(data)) throw unavailable();
    return data;
  }

  return {
    async status() { return (await saved(true)).map(row=>row.provider); },
    async keys(requested) {
      if (requested.some(([,key])=>key !== undefined)) throw problem(400,'UNEXPECTED_PROVIDER_KEY','Add your provider key in Settings.');
      if (!account.canBringKey) return requested.map(()=>undefined);
      const keys = new Map((await saved()).map(row=>[row.provider,row.ciphertext]));
      return requested.map(([provider])=>{
        if (!keys.has(provider)) return undefined;
        try {
          const key = auth.decrypt(keys.get(provider),purpose(provider));
          if (!validKey(key)) throw unavailable();
          return key;
        } catch { throw unavailable(); }
      });
    },
    async update(changes) {
      if (!account.canBringKey) throw denied();
      if (!changes || typeof changes !== 'object' || Array.isArray(changes) ||
          Object.entries(changes).some(([provider,key])=>!providers.includes(provider) || (key !== null && !validKey(key)))) {
        throw problem(400,'INVALID_PROVIDER_KEYS','Enter a valid provider API key.');
      }
      if (Object.keys(changes).length) {
        const p_changes = Object.fromEntries(Object.entries(changes).map(([provider,key])=>
          [provider,key === null ? null : auth.encrypt(key,purpose(provider))]));
        const {status} = await auth.request('/rest/v1/rpc/story_studio_update_provider_keys',{
          token:accessToken,method:'POST',payload:{p_changes}
        });
        if (status === 401 || status === 403) throw denied();
        if (status !== 200 && status !== 204) throw unavailable();
      }
      return this.status();
    }
  };
}

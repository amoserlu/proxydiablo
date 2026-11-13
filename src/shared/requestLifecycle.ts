import type { ProxyTab } from './types.js';

/** Once execution starts, its input and outcome belong to this request forever. */
export function canEditRequest(tab: ProxyTab): boolean {
  return (tab.status === 'draft' || tab.status === 'waiting_user')
    && !(tab.proxyType === 'pgsql' && tab.requesterDisconnected);
}

export function canRunRequest(tab: ProxyTab): boolean {
  return canEditRequest(tab) && !(tab.proxyType === 'pgsql' && tab.passwordRequiredFor);
}

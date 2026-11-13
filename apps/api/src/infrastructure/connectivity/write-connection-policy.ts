import type { OpcUaConfig } from './connectivity.config';
import type { WriteSecurity } from './ports/connectivity-adapter.port';

/** Administrative network approval is distinct from cryptographic session security. */
export function canWriteOnConnection(config: OpcUaConfig, session: WriteSecurity): boolean {
  if (!config.writesEnabled) return false;
  if (session.secure) return true;
  return config.trustedNetworkWrites === true
    && !!config.trustedNetworkApproval?.trim()
    && !!config.trustedNetworkEndpoint
    && config.trustedNetworkEndpoint === config.endpoint
    && config.securityMode === 'None'
    && config.securityPolicy === 'None'
    && config.identity?.type === 'username'
    && !!config.identity.userName?.trim()
    && !!config.identity.password
    && session.identity === 'username'
    && session.securityMode === 'None';
}

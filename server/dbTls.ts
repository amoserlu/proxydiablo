import fs from 'node:fs';
import tls from 'node:tls';

export interface DatabaseTlsConfig {
  host?: string;
  sslmode?: string;
  sslrootcert?: string;
  tlsServerName?: string;
  auth?: 'password' | 'rds-iam';
}

/** Build TLS policy before connecting or sending credentials. IAM never downgrades. */
export function databaseTls(conn: DatabaseTlsConfig): false | (tls.ConnectionOptions & { verifyIdentity: boolean }) {
  const iam = conn.auth === 'rds-iam';
  const mode = conn.sslmode ?? (iam ? 'verify-full' : 'disable');
  if (iam && mode !== 'verify-full') throw new Error('IAM authentication requires sslmode=verify-full and a trusted database CA.');
  if (mode === 'disable') return false;
  if (!['allow', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(mode)) throw new Error('Unsupported database sslmode.');
  const verify = mode === 'verify-ca' || mode === 'verify-full';
  const identity = mode === 'verify-full';
  const name = conn.tlsServerName ?? conn.host ?? 'localhost';
  return {
    rejectUnauthorized: verify,
    verifyIdentity: identity,
    ...(conn.sslrootcert ? { ca: fs.readFileSync(conn.sslrootcert, 'utf8') } : {}),
    checkServerIdentity: identity ? (_host, cert) => tls.checkServerIdentity(name, cert) : () => undefined,
  };
}

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

/** A CA, a server certificate it signed (for `localhost` only), and a second CA that signed nothing. */
export interface Certificates {
  caPem: string;
  wrongCaPem: string;
  serverCrt: string;
  serverKey: string;
  /** Where the CAs are written, for the connection settings that take a file. */
  caPath: string;
  wrongCaPath: string;
}

const openssl = (cwd: string, ...args: string[]) =>
  execFileSync('openssl', args, { cwd, stdio: 'pipe' });

export function makeCertificates(): Certificates {
  const dir = mkdtempSync(join(tmpdir(), 'pgsketch-certs-'));
  const ca = (name: string) => {
    openssl(
      dir,
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      `${name}.key`,
      '-out',
      `${name}.crt`,
      '-subj',
      `/CN=${name}`,
      '-days',
      '2',
    );
  };
  ca('ca');
  ca('wrong-ca');
  openssl(
    dir,
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'server.key',
    '-out',
    'server.csr',
    '-subj',
    '/CN=localhost',
  );
  writeFileSync(join(dir, 'san.ext'), 'subjectAltName=DNS:localhost\n');
  openssl(
    dir,
    'x509',
    '-req',
    '-in',
    'server.csr',
    '-CA',
    'ca.crt',
    '-CAkey',
    'ca.key',
    '-CAcreateserial',
    '-out',
    'server.crt',
    '-days',
    '2',
    '-extfile',
    'san.ext',
  );
  const read = (name: string) => readFileSync(join(dir, name), 'utf8');
  return {
    caPem: read('ca.crt'),
    wrongCaPem: read('wrong-ca.crt'),
    serverCrt: read('server.crt'),
    serverKey: read('server.key'),
    caPath: join(dir, 'ca.crt'),
    wrongCaPath: join(dir, 'wrong-ca.crt'),
  };
}

export interface TestServer {
  version: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /** A superuser connection, for setting things up. */
  admin: Client;
  stop: () => Promise<void>;
}

/** A Postgres in a container, with SSL on when certificates are given. */
export async function startServer(
  version: string,
  certificates?: Certificates,
): Promise<TestServer> {
  let container = new PostgreSqlContainer(`postgres:${version}`);
  if (certificates) {
    // the key must belong to the postgres user and be private, so it is installed by the entrypoint
    container = container
      .withCopyContentToContainer([
        {
          content: certificates.serverCrt,
          target: '/certs/server.crt',
          mode: 0o644,
        },
        {
          content: certificates.serverKey,
          target: '/certs/server.key',
          mode: 0o644,
        },
      ])
      .withEntrypoint([
        'sh',
        '-c',
        'install -o postgres -g postgres -m 600 /certs/server.key /var/lib/postgresql/server.key && exec docker-entrypoint.sh "$@"',
        'entry',
      ])
      .withCommand([
        '-c',
        'ssl=on',
        '-c',
        'ssl_cert_file=/certs/server.crt',
        '-c',
        'ssl_key_file=/var/lib/postgresql/server.key',
        '-c',
        'fsync=off',
      ]);
  }
  const started = await container.start();
  const admin = new Client({ connectionString: started.getConnectionUri() });
  await admin.connect();
  return {
    version,
    host: started.getHost(),
    port: started.getMappedPort(5432),
    user: started.getUsername(),
    password: started.getPassword(),
    database: started.getDatabase(),
    admin,
    stop: async () => {
      await admin.end().catch(() => undefined);
      await started.stop();
    },
  };
}

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

/** A socket directory, or an address that is this machine. */
export const isLocalHost = (host: string): boolean =>
  host.startsWith('/') || LOCAL_HOSTS.includes(host.toLowerCase());

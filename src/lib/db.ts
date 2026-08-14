/**
 * Prisma client singleton.
 *
 * Two problems this solves:
 *
 *  1. **Next.js hot reload.** Each dev-server recompile re-evaluates modules;
 *     a naive `new PrismaClient()` at module scope leaks a connection pool per
 *     edit until Postgres refuses new connections. The instance is stashed on
 *     `globalThis` outside production.
 *
 *  2. **Import-time side effects.** The client is constructed on first *use*,
 *     not on import, so a unit test that transitively imports a service does
 *     not need `DATABASE_URL`.
 */

import { PrismaClient, Prisma } from '@prisma/client';

/**
 * Re-exported so services have one import for the client and its companion
 * namespace (`Prisma.JsonValue`, `Prisma.DbNull`, `Prisma.sql`, the generated
 * `*GetPayload` types). Model enums — `DraftStatus`, `SourceKind`, … — should
 * still be imported from `@prisma/client` directly.
 */
export { PrismaClient, Prisma };

const globalForPrisma = globalThis as unknown as {
  __researchToLinkedInPrisma?: PrismaClient;
};

function logLevels(): Prisma.LogLevel[] {
  if (process.env.NODE_ENV === 'production') return ['warn', 'error'];
  if (process.env.PRISMA_LOG_QUERIES === 'true') return ['query', 'warn', 'error'];
  return ['warn', 'error'];
}

/** Constructs (once) and returns the process-wide client. */
export function getPrisma(): PrismaClient {
  const existing = globalForPrisma.__researchToLinkedInPrisma;
  if (existing !== undefined) return existing;

  const client = new PrismaClient({ log: logLevels() });
  globalForPrisma.__researchToLinkedInPrisma = client;
  return client;
}

/**
 * The client every service should import.
 *
 * A Proxy so that construction is deferred to the first property access.
 * Methods are bound to the real client, so `prisma.$transaction(...)` and
 * `prisma.user.findMany()` behave exactly as if imported directly.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrisma();
    const value = Reflect.get(client, property, client) as unknown;
    return typeof value === 'function' ? value.bind(client) : value;
  },
  has(_target, property) {
    return Reflect.has(getPrisma(), property);
  },
});

/** Alias — the instruction across the codebase is "import the Prisma client from @/lib/db". */
export const db: PrismaClient = prisma;

/** Graceful shutdown for the worker process. Next.js does not need this. */
export async function disconnectPrisma(): Promise<void> {
  const existing = globalForPrisma.__researchToLinkedInPrisma;
  if (existing === undefined) return;
  globalForPrisma.__researchToLinkedInPrisma = undefined;
  await existing.$disconnect();
}

type PgPoolLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>
}

let pool: PgPoolLike | null = null

export async function getPool(): Promise<PgPoolLike | null> {
  if (pool) return pool
  if (!process.env.DATABASE_URL) return null

  try {
    const mod = await import('pg')
    const PgPool = (mod as any).Pool
    pool = new PgPool({
      connectionString: process.env.DATABASE_URL,
    })
    return pool
  } catch {
    return null
  }
}
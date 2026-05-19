import pg from "pg";

const connectionString = process.env.DATABASE_URL;

export const pool = connectionString
  ? new pg.Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX) || 10,
      idleTimeoutMillis: 30_000
    })
  : null;

if (pool) {
  pool.on("error", (err) => {
    console.error("Помилка з'єднання з Postgres:", err.message);
  });
}

function ensurePool() {
  if (!pool) {
    throw new Error("DATABASE_URL не задано — звернення до БД недоступне");
  }
  return pool;
}

/**
 * Конвертує іменовані параметри @name у позиційні $1..$N для pg.
 * Дозволяє переписати SQL з better-sqlite3 (@name) з мінімальними змінами.
 */
function bindNamed(sql, params) {
  if (!params || Array.isArray(params)) {
    return { text: sql, values: params || [] };
  }
  const order = [];
  const text = sql.replace(/@([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
    order.push(name);
    return `$${order.length}`;
  });
  const values = order.map((name) => params[name]);
  return { text, values };
}

export async function query(sql, params) {
  const { text, values } = bindNamed(sql, params);
  return ensurePool().query(text, values);
}

export async function one(sql, params) {
  const result = await query(sql, params);
  return result.rows[0] || null;
}

export async function all(sql, params) {
  const result = await query(sql, params);
  return result.rows;
}

export async function run(sql, params) {
  const result = await query(sql, params);
  return { rowCount: result.rowCount, rows: result.rows };
}

function wrapClient(client) {
  return {
    raw: client,
    query: (sql, params) => {
      const { text, values } = bindNamed(sql, params);
      return client.query(text, values);
    },
    one: async (sql, params) => {
      const { text, values } = bindNamed(sql, params);
      const res = await client.query(text, values);
      return res.rows[0] || null;
    },
    all: async (sql, params) => {
      const { text, values } = bindNamed(sql, params);
      const res = await client.query(text, values);
      return res.rows;
    },
    run: async (sql, params) => {
      const { text, values } = bindNamed(sql, params);
      const res = await client.query(text, values);
      return { rowCount: res.rowCount, rows: res.rows };
    }
  };
}

export async function withTransaction(fn) {
  const client = await ensurePool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(wrapClient(client));
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function shutdownDb() {
  if (pool) await pool.end();
}

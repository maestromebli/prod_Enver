import { all } from "../../db.js";

const queue = [];
let draining = false;
const MAX_CONCURRENT = 1;
let active = 0;

const JOB_TIMEOUT_MS = Number(process.env.B3D_CONVERSION_TIMEOUT_MS) || 180_000;

function enqueue(jobId) {
  const id = Number(jobId);
  if (!id || queue.includes(id)) return;
  queue.push(id);
  void drainQueue();
}

async function runJobWithTimeout(jobId, process3DConversionJob) {
  return Promise.race([
    process3DConversionJob(jobId),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Таймаут конвертації B3D")), JOB_TIMEOUT_MS);
    })
  ]);
}

async function drainQueue() {
  if (draining) return;
  draining = true;

  const { process3DConversionJob } = await import("./conversion-service.js");

  try {
    while (queue.length > 0 && active < MAX_CONCURRENT) {
      const jobId = queue.shift();
      active += 1;
      try {
        await runJobWithTimeout(jobId, process3DConversionJob);
      } catch (err) {
        console.warn(`[order-3d] job ${jobId} failed:`, err?.message || err);
      } finally {
        active -= 1;
      }
    }
  } finally {
    draining = false;
    if (queue.length > 0 && active < MAX_CONCURRENT) {
      void drainQueue();
    }
  }
}

/** Поставити job у чергу (замість setImmediate). */
export function schedule3DConversionJob(jobId) {
  enqueue(jobId);
}

/** Відновити pending jobs після рестарту сервера. */
export async function resumePending3DConversionJobs() {
  const rows = await all(
    `SELECT id FROM order_3d_conversion_jobs
     WHERE status = 'pending'
     ORDER BY id ASC
     LIMIT 50`
  );
  for (const row of rows) {
    enqueue(row.id);
  }
}

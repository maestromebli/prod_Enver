import { all, one, run } from "../db.js";

export async function getCncJobsForPosition(positionId) {
  const rows = await all(
    `SELECT cj.*, cp.part_name, cp.barcode_value, cp.block_code, cp.part_no
     FROM cnc_jobs cj
     LEFT JOIN constructive_parts cp ON cp.id = cj.part_id
     WHERE cj.position_id = $1
     ORDER BY cj.id`,
    [positionId]
  );
  return rows.map((r) => ({
    id: r.id,
    partId: r.part_id,
    partName: r.part_name,
    barcodeValue: r.barcode_value,
    blockCode: r.block_code,
    partNo: r.part_no,
    stage: r.stage,
    status: r.status,
    machineName: r.machine_name,
    startedAt: r.started_at,
    finishedAt: r.finished_at
  }));
}

export async function updateCncJobStatus(jobId, status, operatorId, { problemReason = "" } = {}) {
  const job = await one(`SELECT * FROM cnc_jobs WHERE id = $1`, [jobId]);
  if (!job) {
    const err = new Error("CNC job не знайдено");
    err.status = 404;
    throw err;
  }

  if (status === "in_progress") {
    await run(
      `UPDATE cnc_jobs SET status = $1, operator_id = $2, started_at = COALESCE(started_at, now()), updated_at = now() WHERE id = $3`,
      [status, operatorId, jobId]
    );
    if (job.part_id) {
      await run(`UPDATE constructive_parts SET cnc_status = 'in_progress' WHERE id = $1`, [
        job.part_id
      ]);
    }
  } else if (status === "done") {
    await run(
      `UPDATE cnc_jobs SET status = $1, finished_at = now(), updated_at = now() WHERE id = $2`,
      [status, jobId]
    );
    if (job.part_id) {
      await run(`UPDATE constructive_parts SET cnc_status = 'done' WHERE id = $1`, [job.part_id]);
    }
  } else if (status === "problem") {
    await run(`UPDATE cnc_jobs SET status = $1, updated_at = now() WHERE id = $2`, [status, jobId]);
    if (job.part_id) {
      await run(`UPDATE constructive_parts SET cnc_status = 'problem' WHERE id = $1`, [
        job.part_id
      ]);
    }
  } else {
    await run(`UPDATE cnc_jobs SET status = $1, updated_at = now() WHERE id = $2`, [status, jobId]);
  }

  void problemReason;
  return one(`SELECT * FROM cnc_jobs WHERE id = $1`, [jobId]);
}

import { config } from "../config.js";
import { all, one, run } from "../db.js";
import { recordHistory } from "../audit.js";
import { isPackageApprovedForCnc } from "../../../shared/production/constructive-package.js";
import { getPackageFiles } from "../constructive/constructive-package-service.js";
import { readStoredFile } from "../file-storage.js";

export function isGitlabConfigured() {
  return Boolean(config.gitlabBaseUrl && config.gitlabToken && config.gitlabProjectId);
}

function gitlabHeaders() {
  return {
    "PRIVATE-TOKEN": config.gitlabToken,
    "Content-Type": "application/json"
  };
}

async function gitlabRequest(method, path, body) {
  const url = `${config.gitlabBaseUrl.replace(/\/$/, "")}/api/v4${path}`;
  const res = await fetch(url, {
    method,
    headers: gitlabHeaders(),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!res.ok) {
    const err = new Error(data.message || data.error || `GitLab помилка ${res.status}`);
    err.status = res.status >= 400 && res.status < 500 ? 502 : 503;
    throw err;
  }
  return data;
}

/** Commit файлу в GitLab через API. */
export async function commitFileToGitlab({ filePath, contentBase64, commitMessage }) {
  if (!isGitlabConfigured()) {
    const err = new Error(
      "GitLab не налаштовано — задайте GITLAB_BASE_URL, GITLAB_TOKEN, GITLAB_PROJECT_ID"
    );
    err.status = 503;
    throw err;
  }

  const projectId = encodeURIComponent(config.gitlabProjectId);
  const branch = config.gitlabCncBranch || "main";
  const encodedPath = encodeURIComponent(filePath);

  const existing = await gitlabRequest(
    "GET",
    `/projects/${projectId}/repository/files/${encodedPath}?ref=${encodeURIComponent(branch)}`
  ).catch(() => null);

  const action = existing?.file_path ? "update" : "create";
  const result = await gitlabRequest("POST", `/projects/${projectId}/repository/commits`, {
    branch,
    commit_message: commitMessage || `ENVER: ${filePath}`,
    actions: [
      {
        action,
        file_path: filePath,
        content: contentBase64,
        encoding: "base64"
      }
    ]
  });

  return {
    commitSha: result.id || result.short_id || "",
    filePath,
    branch
  };
}

export async function sendPositionToGitlab(positionId, actor) {
  const position = await one(`SELECT * FROM positions WHERE id = $1`, [positionId]);
  if (!position) {
    const err = new Error("Позицію не знайдено");
    err.status = 404;
    throw err;
  }

  const pkg = await one(
    `SELECT * FROM constructive_packages WHERE position_id = $1 ORDER BY version DESC LIMIT 1`,
    [positionId]
  );
  if (!pkg || !isPackageApprovedForCnc(pkg.status)) {
    const err = new Error("Без підтвердження пакета конструктива відправка в GitLab заборонена");
    err.status = 403;
    throw err;
  }

  const files = await getPackageFiles(pkg.id);
  const cncFile =
    files.find((f) => f.kind === "cnc_file") || files.find((f) => f.kind === "project") || files[0];

  if (!cncFile) {
    const err = new Error("Немає ЧПК-файлу для відправки");
    err.status = 400;
    throw err;
  }

  const fileRow = await one(`SELECT * FROM constructive_package_files WHERE id = $1`, [cncFile.id]);
  const buffer = await readStoredFile(fileRow.storage_path);
  const orderCode = String(position.order_number || positionId).replace(/\s+/g, "");
  const gitPath = `${config.gitlabCncBasePath}/${orderCode}/${positionId}/${fileRow.original_name}`;

  let gitResult;
  try {
    gitResult = await commitFileToGitlab({
      filePath: gitPath,
      contentBase64: buffer.toString("base64"),
      commitMessage: `ENVER CNC: ${orderCode} / позиція ${positionId}`
    });
  } catch (err) {
    const e = new Error(err.message || "GitLab недоступний — спробуйте пізніше");
    e.status = 502;
    throw e;
  }

  await run(
    `UPDATE constructive_packages SET status = 'sent_to_gitlab', updated_at = now() WHERE id = $1`,
    [pkg.id]
  );

  const parts = await all(`SELECT id FROM constructive_parts WHERE package_id = $1`, [pkg.id]);
  for (const part of parts) {
    const existing = await one(`SELECT id FROM cnc_jobs WHERE part_id = $1`, [part.id]);
    if (existing) {
      await run(
        `UPDATE cnc_jobs SET status = 'sent_to_gitlab', gitlab_file_path = $1, gitlab_commit_sha = $2,
         gitlab_project_id = $3, updated_at = now() WHERE id = $4`,
        [gitPath, gitResult.commitSha, config.gitlabProjectId, existing.id]
      );
    } else {
      await run(
        `INSERT INTO cnc_jobs (order_id, position_id, package_id, part_id, stage, status,
         gitlab_file_path, gitlab_commit_sha, gitlab_project_id)
         VALUES ($1,$2,$3,$4,'cutting','sent_to_gitlab',$5,$6,$7)`,
        [
          position.order_id,
          positionId,
          pkg.id,
          part.id,
          gitPath,
          gitResult.commitSha,
          config.gitlabProjectId
        ]
      );
    }
  }

  await recordHistory({
    entityType: "position",
    entityId: positionId,
    action: "update",
    meta: {
      summary: `Відправлено в GitLab: ${gitPath} (${gitResult.commitSha?.slice(0, 8) || "—"})`,
      orderNumber: position.order_number,
      item: position.item
    },
    actor
  });

  return {
    commitSha: gitResult.commitSha,
    filePath: gitPath,
    branch: gitResult.branch,
    packageStatus: "sent_to_gitlab"
  };
}

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
    gitlabFilePath: r.gitlab_file_path,
    gitlabCommitSha: r.gitlab_commit_sha,
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

  const updates = { status };
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

  return one(`SELECT * FROM cnc_jobs WHERE id = $1`, [jobId]);
}

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CONVERTER_DIR = path.join(REPO_ROOT, "tools/b3d-converter");

/** @typedef {"READY" | "PARTIAL_READY" | "FAILED" | "NEED_MANUAL_CHECK" | "NEED_MANUAL_RESEARCH"} B3DConversionStatus */

/**
 * @typedef {Object} B3DConversionResult
 * @property {B3DConversionStatus} status
 * @property {string} [webModelStoragePath]
 * @property {string} [previewStoragePath]
 * @property {string} [reportStoragePath]
 * @property {string} [errorMessage]
 * @property {boolean} [isFallback]
 * @property {number} [confidence]
 */

/**
 * @typedef {Object} B3DConversionInput
 * @property {string} inputFullPath — абсолютний шлях до .b3d
 * @property {string} outputDir — директорія для .glb/.png/.json
 * @property {string} assetId — префікс імен файлів
 * @property {string} [storageBase] — відносний шлях uploads (orders/X/3d/...)
 */

function resolvePythonBin() {
  return process.env.B3D_CONVERTER_PYTHON || "python3";
}

function converterAvailable() {
  const workerPath = path.join(CONVERTER_DIR, "b3d_converter", "worker.py");
  return fs.existsSync(workerPath);
}

/**
 * @param {B3DConversionInput} input
 * @returns {Promise<B3DConversionResult>}
 */
export function runB3DConverter(input) {
  const glbFull = path.join(input.outputDir, `${input.assetId}.glb`);
  const reportFull = path.join(input.outputDir, `${input.assetId}.report.json`);
  const previewFull = path.join(input.outputDir, `${input.assetId}.preview.png`);

  const rel = (name) =>
    input.storageBase ? path.posix.join(input.storageBase, name) : null;

  if (!converterAvailable()) {
    return Promise.resolve({
      status: "NEED_MANUAL_CHECK",
      errorMessage:
        "Python b3d-converter не знайдено. Встановіть tools/b3d-converter (pip install -e .)."
    });
  }

  const args = [
    "-m",
    "b3d_converter.worker",
    "--input",
    input.inputFullPath,
    "--output",
    glbFull,
    "--report",
    reportFull,
    "--preview",
    previewFull
  ];

  return new Promise((resolve) => {
    const child = spawn(resolvePythonBin(), args, {
      cwd: CONVERTER_DIR,
      env: {
        ...process.env,
        PYTHONPATH: CONVERTER_DIR
      }
    });

    let stderr = "";
    let stdout = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      resolve({
        status: "FAILED",
        errorMessage: err.message || "Не вдалось запустити b3d-converter"
      });
    });

    child.on("close", (code) => {
      let workerStatus = "FAILED";
      let confidence = null;
      let isFallback = false;
      let glbSource = null;

      try {
        if (fs.existsSync(reportFull)) {
          const report = JSON.parse(fs.readFileSync(reportFull, "utf8"));
          workerStatus = report?.metadata?.worker_status || workerStatus;
          confidence = report?.metadata?.glb_mesh_confidence ?? null;
          isFallback = Boolean(report?.metadata?.glb_is_fallback);
          glbSource = report?.metadata?.glb_source || null;
        }
      } catch {
        /* ignore parse errors */
      }

      if (code !== 0) {
        resolve({
          status: "FAILED",
          reportStoragePath: rel(`${input.assetId}.report.json`),
          previewStoragePath: fs.existsSync(previewFull)
            ? rel(`${input.assetId}.preview.png`)
            : undefined,
          errorMessage: stderr || stdout || `B3D converter exited with code ${code}`
        });
        return;
      }

      const webRel = rel(`${input.assetId}.glb`);
      const previewRel = fs.existsSync(previewFull)
        ? rel(`${input.assetId}.preview.png`)
        : undefined;
      const reportRel = fs.existsSync(reportFull)
        ? rel(`${input.assetId}.report.json`)
        : undefined;

      if (workerStatus === "PARTIAL_READY" || workerStatus === "FALLBACK_READY") {
        resolve({
          status: "PARTIAL_READY",
          webModelStoragePath: webRel,
          previewStoragePath: previewRel,
          reportStoragePath: reportRel,
          isFallback: true,
          confidence,
          conversionSource: glbSource || "python_b3d_converter"
        });
        return;
      }

      if (workerStatus === "READY" && fs.existsSync(glbFull)) {
        resolve({
          status: "READY",
          webModelStoragePath: webRel,
          previewStoragePath: previewRel,
          reportStoragePath: reportRel,
          isFallback,
          confidence,
          conversionSource: glbSource || "python_b3d_converter"
        });
        return;
      }

      resolve({
        status: "NEED_MANUAL_RESEARCH",
        reportStoragePath: reportRel,
        previewStoragePath: previewRel,
        errorMessage:
          stderr ||
          stdout ||
          "Парсер знайшов дані, але не зміг зібрати надійну 3D-модель."
      });
    });
  });
}

export { converterAvailable, CONVERTER_DIR };

import { Router } from "express";
import {
  auditActor,
  requireAuth,
  requirePermission,
  requirePermissionOrAdmin,
  requirePositionAccess,
  requirePositionWrite
} from "../middleware/auth.js";
import { one } from "../db.js";
import {
  approvePackage,
  createConstructivePackage,
  getLatestPackage,
  getPackageDetail,
  getPackageFileForDownload,
  getPackageParts,
  listPackagesForPosition,
  parseConstructivePackage,
  rejectPackage,
  releasePackageToCnc,
  saveModelManifest,
  updatePartModelMapping,
  autoMapManifestNodes
} from "../constructive/constructive-package-service.js";
import {
  createProcurementFromPackage,
  getProcurementForPosition,
  updateProcurementStatus
} from "../constructive/procurement-service.js";
import { getFinanceSummaryForPosition } from "../constructive/finance-service.js";
import {
  getCncJobsForPosition,
  isGitlabConfigured,
  sendPositionToGitlab
} from "../integrations/gitlab.js";
import { detectPackageFileKind } from "../../../shared/production/constructive-package.js";
import { renderQrSvg, renderBarcodeSvg } from "../constructive/barcode.js";
import { renderPartLabelsHtml } from "../constructive/labels.js";
import { analyzeConstructivePackage } from "../constructive/constructive-package-ai.js";

const router = Router({ mergeParams: true });
router.use(requireAuth);

async function loadPosition(id) {
  return one(`SELECT * FROM positions WHERE id = $1`, [id]);
}

function decodeFilePayload(body) {
  const files = [];
  if (Array.isArray(body?.files)) {
    for (const f of body.files) {
      if (!f?.fileName || !f?.dataBase64) continue;
      files.push({
        originalName: f.fileName,
        mime: f.mime || "application/octet-stream",
        kind: f.kind || detectPackageFileKind(f.fileName),
        buffer: Buffer.from(String(f.dataBase64), "base64")
      });
    }
  } else if (body?.fileName && body?.dataBase64) {
    files.push({
      originalName: body.fileName,
      mime: body.mime || "application/octet-stream",
      kind: body.kind || detectPackageFileKind(body.fileName),
      buffer: Buffer.from(String(body.dataBase64), "base64")
    });
  }
  return files;
}

router.get("/", requirePositionAccess, async (req, res) => {
  const positionId = Number(req.params.id);
  const packages = await listPackagesForPosition(positionId);
  const latest = packages[0] || null;
  res.json({ packages, latest });
});

router.get("/latest", requirePositionAccess, async (req, res) => {
  const positionId = Number(req.params.id);
  const latest = await getLatestPackage(positionId);
  if (!latest) {
    res.json({ package: null });
    return;
  }
  res.json(await getPackageDetail(latest.id));
});

router.post("/", requirePositionWrite, async (req, res) => {
  const positionId = Number(req.params.id);
  const position = await loadPosition(positionId);
  if (!position) {
    res.status(404).json({ error: "Позицію не знайдено" });
    return;
  }

  const files = decodeFilePayload(req.body);
  if (!files.length) {
    res.status(400).json({ error: "Додайте хоча б один файл пакета" });
    return;
  }

  try {
    const result = await createConstructivePackage({
      positionId,
      positionRow: position,
      files,
      uploadedBy: auditActor(req)?.id,
      actor: auditActor(req)
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/:packageId/parse", requirePositionWrite, async (req, res) => {
  const packageId = Number(req.params.packageId);
  try {
    const detail = await parseConstructivePackage(packageId, auditActor(req));
    res.json(detail);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/:packageId/analyze-ai", requirePositionWrite, async (req, res) => {
  const packageId = Number(req.params.packageId);
  const positionId = Number(req.params.id);
  const position = await loadPosition(positionId);
  if (!position) {
    res.status(404).json({ error: "Позицію не знайдено" });
    return;
  }
  try {
    const result = await analyzeConstructivePackage(packageId, {
      orderNumber: position.order_number,
      item: position.item
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get("/:packageId", requirePositionAccess, async (req, res) => {
  const detail = await getPackageDetail(Number(req.params.packageId));
  if (!detail) {
    res.status(404).json({ error: "Пакет не знайдено" });
    return;
  }
  res.json(detail);
});

router.post(
  "/:packageId/approve",
  requirePermissionOrAdmin("canApproveConstructive"),
  async (req, res) => {
    const pkg = await approvePackage(Number(req.params.packageId), {
      role: req.user?.role,
      userId: req.user?.id,
      actor: auditActor(req)
    });
    res.json(pkg);
  }
);

router.post(
  "/:packageId/reject",
  requirePermissionOrAdmin("canReviewConstructive"),
  async (req, res) => {
    const pkg = await rejectPackage(
      Number(req.params.packageId),
      req.body?.reason || "",
      auditActor(req)
    );
    res.json(pkg);
  }
);

router.post(
  "/:packageId/procurement",
  requirePermissionOrAdmin("canManageProcurement"),
  async (req, res) => {
    try {
      const proc = await createProcurementFromPackage(
        Number(req.params.packageId),
        auditActor(req)
      );
      res.status(201).json(proc);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

router.post(
  "/:packageId/release-cnc",
  requirePermissionOrAdmin("canReleaseToCnc"),
  async (req, res) => {
    try {
      const pkg = await releasePackageToCnc(Number(req.params.packageId), auditActor(req));
      res.json(pkg);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

router.post(
  "/:packageId/model-mapping",
  requirePermissionOrAdmin("canReviewConstructive"),
  async (req, res) => {
    const packageId = Number(req.params.packageId);
    const { mappings } = req.body || {};
    if (Array.isArray(mappings)) {
      for (const m of mappings) {
        if (m.partId) {
          await updatePartModelMapping(m.partId, {
            modelNodeId: m.modelNodeId,
            modelMeshName: m.modelMeshName
          });
        }
      }
    }
    if (req.body?.manifest) {
      await saveModelManifest(packageId, req.body.manifest, req.body.glbFileId || null);
    }
    res.json(await getPackageDetail(packageId));
  }
);

router.get("/:packageId/files/:fileId", requirePositionAccess, async (req, res) => {
  const packageId = Number(req.params.packageId);
  const fileId = Number(req.params.fileId);
  try {
    const payload = await getPackageFileForDownload(packageId, fileId);
    if (!payload) {
      res.status(404).json({ error: "Файл не знайдено" });
      return;
    }
    res.setHeader("Content-Type", payload.row.mime || "application/octet-stream");
    const name = payload.row.original_name || "file";
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`
    );
    import("fs").then((fs) => fs.createReadStream(payload.fullPath).pipe(res));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;

/** Додаткові маршрути позиції (finance, gitlab, labels). */
export function registerConstructivePackagePositionRoutes(router) {
  router.get("/:id/finance", requirePermissionOrAdmin("canViewFinance"), async (req, res) => {
    const summary = await getFinanceSummaryForPosition(Number(req.params.id));
    res.json(summary);
  });

  router.get("/:id/procurement", requirePositionAccess, async (req, res) => {
    const proc = await getProcurementForPosition(Number(req.params.id));
    res.json(proc || null);
  });

  router.patch(
    "/:id/procurement/:requestId",
    requirePermissionOrAdmin("canManageProcurement"),
    async (req, res) => {
      const proc = await updateProcurementStatus(
        Number(req.params.requestId),
        req.body?.status,
        auditActor(req),
        { actualPrices: req.body?.actualPrices }
      );
      res.json(proc);
    }
  );

  router.post(
    "/:id/send-to-gitlab",
    requirePermissionOrAdmin("canSendToGitlab"),
    async (req, res) => {
      try {
        const result = await sendPositionToGitlab(Number(req.params.id), auditActor(req));
        res.json(result);
      } catch (err) {
        res.status(err.status || 502).json({ error: err.message });
      }
    }
  );

  router.get("/:id/gitlab-status", requirePositionAccess, async (_req, res) => {
    res.json({ configured: isGitlabConfigured() });
  });

  router.get("/:id/cnc-jobs", requirePositionAccess, async (req, res) => {
    const jobs = await getCncJobsForPosition(Number(req.params.id));
    res.json(jobs);
  });

  router.get("/:id/part-labels", requirePositionAccess, async (req, res) => {
    const positionId = Number(req.params.id);
    const position = await loadPosition(positionId);
    if (!position) {
      res.status(404).json({ error: "Позицію не знайдено" });
      return;
    }
    const latest = await getLatestPackage(positionId);
    if (!latest) {
      res.status(404).json({ error: "Немає пакета конструктива" });
      return;
    }
    const parts = await getPackageParts(latest.id);
    const html = await renderPartLabelsHtml({ position, parts });
    res.type("text/html").send(html);
  });
}

export { router as constructivePackageRouter };

/** Файли пакета без position id (для 3D viewer / scan). */
export const packageFilesRouter = Router();
packageFilesRouter.use(requireAuth, requirePositionAccess);
packageFilesRouter.get("/:packageId/files/:fileId", async (req, res) => {
  const packageId = Number(req.params.packageId);
  const fileId = Number(req.params.fileId);
  try {
    const payload = await getPackageFileForDownload(packageId, fileId);
    if (!payload) {
      res.status(404).json({ error: "Файл не знайдено" });
      return;
    }
    res.setHeader("Content-Type", payload.row.mime || "application/octet-stream");
    const name = payload.row.original_name || "file";
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`
    );
    const fs = await import("fs");
    fs.createReadStream(payload.fullPath).pipe(res);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * ENVER_3dscan — повний експорт моделі Bazis у хвіст .b3d (EN3DSC) + sidecar JSON.
 *
 * Порядок:
 * 1. У Базіс-Мебельщик збережіть .project і експортуйте .b3d (як для GibLab).
 * 2. Інструменти → Редактор скриптів → виконати цей файл (або хук після експорту).
 * 3. Оберіть .b3d — у файл допишеться ENVER_3dscan + *.enver-3dscan.json
 * 4. Завантажте .b3d і .project у Enver.
 *
 * Хук після GibLabExport:
 *   try {
 *     ENVER_AUTO_B3D_PATH = savedB3dPath;
 *     Execute(system.getFileName("enver-3dscan-export.js"));
 *   } catch (e) {}
 */

const fs = require("fs");

const EN3DSC_MAGIC = "EN3DSC";
const ENVER_3DSCAN_VERSION = 2;

function vec(v) {
  return [v.x, v.y, v.z];
}

function normVec(v) {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-9) return [0, 0, 1];
  return [v.x / len, v.y / len, v.z / len];
}

function panelCode(panel) {
  const code = String(panel.ArtPos || "").trim();
  if (code) return code;
  const name = String(panel.Name || "").trim();
  const m = name.match(/\b(\d{1,6})\b/);
  return m ? m[1] : name;
}

function tryGet(obj, path) {
  try {
    let cur = obj;
    for (const key of path) {
      if (cur == null) return null;
      cur = cur[key];
    }
    return cur;
  } catch {
    return null;
  }
}

function collectEdges(panel) {
  const mask = [false, false, false, false];
  let edgeCode = "";
  try {
    const butts = panel.Butts || panel.Edges || panel.EdgeList;
    if (butts && butts.Count) {
      for (let i = 0; i < Math.min(butts.Count, 4); i++) {
        const e = butts[i];
        if (e) mask[i] = true;
        const mat = String(e.MaterialName || e.Name || "").trim();
        if (mat && !edgeCode) edgeCode = mat;
      }
    }
  } catch {
    /* optional */
  }
  if (!mask.some(Boolean)) return { edgeMask: null, edgeCode };
  return { edgeMask: mask, edgeCode };
}

function collectContour(panel) {
  const pts = [];
  try {
    const contour = panel.Contour || panel.Contour2D;
    const list =
      contour && contour.Count != null ? contour : contour && contour.List ? contour.List : null;
    const count = list ? list.Count || 0 : 0;
    for (let i = 0; i < count && i < 500; i++) {
      const p = list[i];
      if (p && p.x != null && p.y != null) pts.push([Number(p.x), Number(p.y)]);
    }
  } catch {
    /* optional */
  }
  return pts.length ? pts : null;
}

function collectHoles(panel) {
  const holes = [];
  try {
    const drills = panel.Drills || panel.Holes || panel.Cutouts;
    const count = drills && drills.Count ? drills.Count : 0;
    for (let i = 0; i < count && i < 200; i++) {
      const h = drills[i];
      if (!h) continue;
      holes.push({
        kind: "hole",
        face: "panel",
        diameterMm: Number(h.Diameter || h.D || h.d) || null,
        xMm: Number(h.X || h.x) || null,
        yMm: Number(h.Y || h.y) || null,
        zMm: Number(h.Z || h.z) || null,
        depthMm: Number(h.Depth || h.DepthMax || h.dp) || null,
        name: String(h.Name || "")
      });
    }
  } catch {
    /* optional */
  }
  return holes;
}

function collectOperations(panel) {
  const codes = [];
  try {
    const ops = panel.Operations || panel.OpList;
    const count = ops && ops.Count ? ops.Count : 0;
    for (let i = 0; i < count; i++) {
      const op = ops[i];
      const c = String(op.Code || op.code || "").trim();
      if (c) codes.push(c);
    }
  } catch {
    /* optional */
  }
  return codes;
}

function productNameFromModel() {
  try {
    if (typeof Model !== "undefined" && Model && Model.Name) {
      return String(Model.Name).trim();
    }
  } catch {
    /* ignore */
  }
  return "";
}

function collectPanels(obj, out) {
  if (!obj) return;
  try {
    const panel = obj.AsPanel;
    if (panel && panel.Thickness > 0 && panel.GabMin && panel.GabMax) {
      out.push(panel);
      return;
    }
  } catch {
    /* not panel */
  }
  let list = obj;
  try {
    if (obj.List) list = obj.AsList();
  } catch {
    /* ignore */
  }
  const count = list.Count || 0;
  for (let i = 0; i < count; i++) {
    collectPanels(list[i], out);
  }
}

function exportEnver3dscanFromModel() {
  const panels = [];
  collectPanels(Model, panels);
  if (!panels.length) {
    alert("У моделі не знайдено панелей. Відкрийте проект меблів у Базіс.");
    return null;
  }

  const exported = [];
  const skipped = [];
  const materials = new Set();

  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i];
    const gmin = panel.GabMin;
    const gmax = panel.GabMax;
    const artPos = String(panel.ArtPos || "").trim();
    const name = String(panel.Name || "").trim();
    const code = panelCode(panel);

    if (!code) {
      skipped.push({ name: name || "Панель " + (i + 1), reason: "no_artpos" });
      continue;
    }

    const center = {
      x: (gmin.x + gmax.x) / 2,
      y: (gmin.y + gmax.y) / 2,
      z: (gmin.z + gmax.z) / 2
    };
    const gsize = panel.GSize || {
      x: Math.abs(gmax.x - gmin.x),
      y: Math.abs(gmax.y - gmin.y),
      z: Math.abs(gmax.z - gmin.z)
    };

    const material = String(panel.MaterialName || panel.Material || "").trim();
    if (material) materials.add(material);

    const { edgeMask, edgeCode } = collectEdges(panel);
    const holes = collectHoles(panel);
    const bazisOperations = collectOperations(panel);
    const contourMm = collectContour(panel);

    exported.push({
      code,
      partNo: code.replace(/^0+/, "") || code,
      name,
      artPos,
      blockCode: String(tryGet(panel, ["Block", "Name"]) || "").trim(),
      material,
      thicknessMm: Number(panel.Thickness) || null,
      lengthMm: Math.abs(gsize.x),
      widthMm: Math.abs(gsize.y),
      centerMm: vec(center),
      gabMinMm: vec(gmin),
      gabMaxMm: vec(gmax),
      sizeMm: [Math.abs(gsize.x), Math.abs(gsize.y), Math.abs(gsize.z)],
      axisX: normVec(panel.NToGlobal(AxisX)),
      axisY: normVec(panel.NToGlobal(AxisY)),
      axisZ: normVec(panel.NToGlobal(AxisZ)),
      edgeCode,
      edgeMask,
      holes,
      holeCount: holes.length,
      bazisOperations,
      contourMm,
      meshName: "panel-" + code,
      colorFactor: panel.TextureOrientation != null ? Number(panel.TextureOrientation) : null
    });
  }

  if (!exported.length) {
    alert(
      "Панелі без коду (ArtPos). Заповніть артикул/позицію деталей у Базіс." +
        (skipped.length ? "\nПропущено: " + skipped.length : "")
    );
    return null;
  }

  return {
    kind: "ENVER_3dscan",
    version: ENVER_3DSCAN_VERSION,
    source: "bazis",
    exportedAt: new Date().toISOString(),
    productName: productNameFromModel(),
    panels: exported,
    materials: [...materials].map((name) => ({ name })),
    hardware: [],
    skipped,
    meta: { exporter: "enver-3dscan-export.js", panelApi: "bazis_model" }
  };
}

function stripEnverTails(buf) {
  let base = buf;
  for (const magic of [EN3DSC_MAGIC, "ENVER3"]) {
    const idx = base.lastIndexOf(magic);
    if (idx >= 0) base = base.subarray(0, idx);
  }
  return base;
}

function appendEnver3dscanTail(buf, doc) {
  const json = Buffer.from(JSON.stringify(doc), "utf8");
  const tail = Buffer.alloc(14 + json.length);
  Buffer.from(EN3DSC_MAGIC, "ascii").copy(tail, 0);
  tail.writeUInt32LE(ENVER_3DSCAN_VERSION, 6);
  tail.writeUInt32LE(json.length, 10);
  json.copy(tail, 14);
  return Buffer.concat([stripEnverTails(buf), tail]);
}

function patchB3dAtPath(b3dPath, doc, options) {
  const silent = options && options.silent;
  let original;
  try {
    original = fs.readFileSync(b3dPath);
  } catch (e) {
    if (!silent) alert("Не вдалося прочитати файл: " + e.message);
    return false;
  }

  const patched = appendEnver3dscanTail(original, doc);
  try {
    fs.writeFileSync(b3dPath, patched);
  } catch (e) {
    if (!silent) alert("Не вдалося записати файл: " + e.message);
    return false;
  }

  const jsonSidecar = b3dPath.replace(/\.b3d$/i, "") + ".enver-3dscan.json";
  try {
    fs.writeFileSync(jsonSidecar, JSON.stringify(doc, null, 2), "utf8");
  } catch {
    /* optional */
  }

  if (!silent) {
    const holeTotal = doc.panels.reduce((s, p) => s + (p.holeCount || 0), 0);
    alert(
      "ENVER_3dscan додано: " +
        doc.panels.length +
        " панелей, отворів: " +
        holeTotal +
        ".\nФайл: " +
        system.getFileName(b3dPath) +
        "\nJSON: " +
        system.getFileName(jsonSidecar) +
        "\n\nЗавантажте .b3d + .project у Enver."
    );
  }
  return true;
}

function runAutoPatch(b3dPath) {
  const doc = exportEnver3dscanFromModel();
  if (!doc) return false;
  return patchB3dAtPath(b3dPath, doc, { silent: !!ENVER_AUTO_SILENT });
}

function main() {
  const path =
    typeof ENVER_AUTO_B3D_PATH === "string" && ENVER_AUTO_B3D_PATH
      ? ENVER_AUTO_B3D_PATH
      : system.askFileName("b3d");
  if (!path) return;
  runAutoPatch(path);
}

if (typeof ENVER_AUTO_B3D_PATH === "string" && ENVER_AUTO_B3D_PATH) {
  runAutoPatch(ENVER_AUTO_B3D_PATH);
} else {
  main();
}

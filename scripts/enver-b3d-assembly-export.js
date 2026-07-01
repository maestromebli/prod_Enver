/**
 * ENVER — експорт координат збірки в GibLab .b3d (хвіст ENVER3).
 *
 * Порядок роботи:
 * 1. У Базіс-Мебельщик збережіть .project і експортуйте .b3d для GibLab (як завжди).
 * 2. Завантажте .project + .b3d у Enver і натисніть «Розібрати» — сервер сам спробує
 *    витягти координати збірки з файлів і побудувати 3D (декодер bazis-b3d-decoder.js).
 * 3. Якщо 3D лишається «розкладкою» — у Базісі: Інструменти → Редактор скриптів →
 *    відкрити цей файл → Виконати (точні координати з живої моделі Model).
 * 4. Оберіть експортований .b3d — ENVER3 запишеться в файл; перезавантажте в Enver.
 *
 * Автозапуск після GibLab-експорту (в кінець GibLabExport_Vx.x.js):
 *   try {
 *     ENVER_AUTO_B3D_PATH = savedB3dPath; // шлях після export
 *     Execute(system.getFileName("enver-b3d-assembly-export.js"));
 *   } catch (e) {}
 *
 * Код деталі береться з ArtPos панелі (має збігатися з code у .project).
 */

const fs = require("fs");

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

/** Обхід дерева моделі — усі панелі з товщиною. */
function collectPanels(obj, out) {
  if (!obj) return;

  try {
    const panel = obj.AsPanel;
    if (panel && panel.Thickness > 0 && panel.GabMin && panel.GabMax) {
      out.push(panel);
      return;
    }
  } catch {
    /* не панель */
  }

  let list = obj;
  try {
    if (obj.List) list = obj.AsList();
  } catch {
    /* лист недоступний */
  }

  const count = list.Count || 0;
  for (let i = 0; i < count; i++) {
    collectPanels(list[i], out);
  }
}

function exportAssemblyFromModel() {
  const panels = [];
  collectPanels(Model, panels);

  if (!panels.length) {
    alert("У моделі не знайдено панелей. Відкрийте проект меблів у Базіс.");
    return null;
  }

  const exported = [];
  const skipped = [];

  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i];
    const gmin = panel.GabMin;
    const gmax = panel.GabMax;
    const artPos = String(panel.ArtPos || "").trim();
    const name = String(panel.Name || "").trim();
    const code = panelCode(panel);

    if (!code) {
      skipped.push({
        name: name || "Панель " + (i + 1),
        reason: "no_artpos"
      });
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

    exported.push({
      code,
      name,
      artPos,
      thicknessMm: Number(panel.Thickness) || null,
      centerMm: vec(center),
      sizeMm: [Math.abs(gsize.x), Math.abs(gsize.y), Math.abs(gsize.z)],
      axisX: normVec(panel.NToGlobal(AxisX)),
      axisY: normVec(panel.NToGlobal(AxisY)),
      axisZ: normVec(panel.NToGlobal(AxisZ))
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
    version: 1,
    source: "bazis",
    exportedAt: new Date().toISOString(),
    productName: productNameFromModel(),
    panels: exported,
    skipped
  };
}

function stripEnver3Tail(buf) {
  const magic = Buffer.from("ENVER3");
  const idx = buf.lastIndexOf(magic);
  if (idx < 0) return buf;
  return buf.subarray(0, idx);
}

function appendEnver3Tail(buf, assembly) {
  const json = Buffer.from(JSON.stringify(assembly), "utf8");
  const tail = Buffer.alloc(14 + json.length);
  Buffer.from("ENVER3").copy(tail, 0);
  tail.writeUInt32LE(1, 6);
  tail.writeUInt32LE(json.length, 10);
  json.copy(tail, 14);
  return Buffer.concat([stripEnver3Tail(buf), tail]);
}

function patchB3dFileAtPath(b3dPath, assembly, options) {
  const silent = options && options.silent;
  let original;
  try {
    original = fs.readFileSync(b3dPath);
  } catch (e) {
    if (!silent) alert("Не вдалося прочитати файл: " + e.message);
    return false;
  }

  const patched = appendEnver3Tail(original, assembly);
  try {
    fs.writeFileSync(b3dPath, patched);
  } catch (e) {
    if (!silent) alert("Не вдалося записати файл: " + e.message);
    return false;
  }

  const jsonSidecar = b3dPath.replace(/\.b3d$/i, "") + ".enver-assembly.json";
  try {
    fs.writeFileSync(jsonSidecar, JSON.stringify(assembly, null, 2), "utf8");
  } catch {
    /* sidecar необовʼязковий */
  }

  if (!silent) {
    const skippedNote =
      assembly.skipped && assembly.skipped.length
        ? "\nПропущено без ArtPos: " + assembly.skipped.length
        : "";
    alert(
      "ENVER3 додано: " +
        assembly.panels.length +
        " панелей." +
        skippedNote +
        "\nФайл: " +
        system.getFileName(b3dPath) +
        "\nJSON: " +
        system.getFileName(jsonSidecar) +
        "\n\nЗавантажте .b3d у Enver — ENVER3 підхопиться автоматично."
    );
  }
  return true;
}

function runAutoPatch(b3dPath) {
  const assembly = exportAssemblyFromModel();
  if (!assembly) return false;
  return patchB3dFileAtPath(b3dPath, assembly, { silent: !!ENVER_AUTO_SILENT });
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

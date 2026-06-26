import { pickXmlAttr, buildOperationThicknessMap } from "./project-text.js";

/** Спільне витягування вузлів мапінгу 3D з тексту (Project, B3D GibLab). */

function nodeKey(n) {
  return `${n.meshName || ""}|${n.partNo || ""}|${n.blockCode || ""}`;
}

export function uniqueManifestNodes(nodes = []) {
  const seen = new Set();
  const out = [];
  for (const n of nodes) {
    const key = nodeKey(n);
    if (!n.meshName && !n.partNo) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

export function pushBlockPartNode(nodes, blockCode, partNo, meshName, source) {
  const bc = String(blockCode || "").trim();
  const pn = String(partNo || "").trim();
  const mesh = String(meshName || "").trim() || (bc && pn ? `${bc}-${pn}` : pn);
  if (!mesh) return;
  nodes.push({
    meshName: mesh,
    nodeId: mesh,
    partNo: pn,
    blockCode: bc,
    source
  });
}

/** B1-21, Б1-21 тощо. */
export function extractBlockPartTokens(text, source = "text") {
  const nodes = [];
  const re = /(?:^|[^A-ZА-ЯІЇЄ0-9])([BВБ]\s*(\d+)\s*[-_.]\s*(\d+))(?:[^0-9]|$)/gi;
  let m;
  while ((m = re.exec(text))) {
    const blockCode = `B${m[2]}`;
    pushBlockPartNode(nodes, blockCode, m[3], m[1].replace(/\s+/g, ""), source);
  }
  return nodes;
}

export function collectPrintableStrings(buffer, maxBytes = 2_000_000) {
  const slice = buffer.subarray(0, Math.min(buffer.length, maxBytes));
  const results = new Set();
  for (const enc of ["utf8", "utf16le", "latin1"]) {
    let text = "";
    try {
      text = slice.toString(enc);
    } catch {
      continue;
    }
    const re = /[\x20-\x7E\u0400-\u04FFґєії]{3,160}/g;
    let m;
    while ((m = re.exec(text))) {
      const s = m[0].trim();
      if (s.length >= 3) results.add(s);
    }
  }
  return [...results];
}

export function manifestNodesFromStrings(strings = [], source = "text") {
  const nodes = [];
  for (const s of strings) {
    nodes.push(...extractBlockPartTokens(s, source));
    const numName = s.match(/^(\d{1,4})\s*[-–—.:]\s*(.{2,80})$/);
    if (numName) {
      pushBlockPartNode(nodes, "", numName[1], `${numName[1]}`, source);
      nodes.push({
        meshName: numName[2].trim(),
        nodeId: numName[2].trim(),
        partNo: numName[1],
        source
      });
    }
  }
  return uniqueManifestNodes(nodes);
}

/** Простий розбір XML-атрибутів деталей у .project. */
export function manifestNodesFromProjectXml(text, source = "project_xml") {
  const nodes = [];
  const parts = [];

  const thicknessByCode = buildOperationThicknessMap(text);
  const blockTags = ["Part", "Panel", "Item", "Detail", "Module", "Plate", "Element"];
  for (const tag of blockTags) {
    const re = new RegExp(`<${tag}([^>]*)\\/?>`, "gi");
    let m;
    while ((m = re.exec(text))) {
      const attrs = m[1] || "";
      const partNo =
        pickXmlAttr(attrs, [
          "code",
          "part.code",
          "Number",
          "Num",
          "PartNo",
          "PartNumber",
          "No",
          "Index"
        ]) ||
        pickXmlAttr(attrs, ["Id"]) ||
        "";
      const partName = pickXmlAttr(attrs, ["name", "Name", "Title", "Caption", "Label"]) || "";
      const blockCode = pickXmlAttr(attrs, ["Block", "BlockCode", "Cabinet", "Section"]) || "";
      const article = pickXmlAttr(attrs, ["Article", "Art"]) || "";
      if (!partNo && !partName && !article) continue;

      const mesh = partNo || article || (blockCode && partNo ? `${blockCode}-${partNo}` : partName);
      pushBlockPartNode(nodes, blockCode, partNo, mesh, source);
      if (partNo || partName) {
        const thickness =
          pickXmlAttr(attrs, ["dz", "Thickness", "Thick", "t"]) ||
          thicknessByCode.get(partNo) ||
          thicknessByCode.get(String(Number(partNo))) ||
          "";
        parts.push({
          blockCode,
          partNo: partNo || String(parts.length + 1),
          partName: partName || mesh,
          material: pickXmlAttr(attrs, ["Material", "Mat"]) || "",
          thickness: thickness || "",
          qty: Number(pickXmlAttr(attrs, ["count", "Count", "qty", "Qty"])) || 1,
          length: pickXmlAttr(attrs, ["dl", "Length", "L"]) || "",
          width: pickXmlAttr(attrs, ["dw", "Width", "W"]) || "",
          edgeCode: "",
          note: ""
        });
      }
    }
  }

  nodes.push(...extractBlockPartTokens(text, source));
  return {
    parts,
    manifestNodes: uniqueManifestNodes(nodes)
  };
}

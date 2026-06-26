/** Статуси 3D-активу замовлення. */
export const ORDER_3D_STATUSES = [
  "UPLOADED",
  "CONVERTING",
  "READY",
  "PARTIAL_READY",
  "FAILED",
  "NEED_MANUAL_CHECK",
  "NEED_MANUAL_RESEARCH"
];

export const ORDER_3D_STATUS_LABELS = {
  UPLOADED: "Завантажено",
  CONVERTING: "Обробка B3D",
  READY: "Готово",
  PARTIAL_READY: "Частково готово",
  FAILED: "Помилка",
  NEED_MANUAL_CHECK: "Потрібна додаткова дія",
  NEED_MANUAL_RESEARCH: "Потрібне дослідження"
};

/** Людські підписи джерела web-моделі з Bazis .b3d */
export const ORDER_3D_SOURCE_LABELS = {
  b3d_enver3_assembly: "3D-збірка Bazis (ENVER3 + .project у .b3d)",
  b3d_enver3_only: "3D-збірка Bazis (ENVER3 у .b3d)",
  project_panels: "Розкладка деталей з .project",
  b3d_xml_panels: "Панелі з XML у Bazis .b3d",
  embedded_glb: "Вбудований GLB у .b3d",
  embedded_raw_glb: "GLB-файл у контейнері .b3d",
  python_b3d_converter: "Python B3D-парсер (research)",
  constructive_package_glb: "GLB з пакета конструктива",
  panel_preview: "Fallback-панелі з евристики"
};

export const ORDER_3D_UPLOAD_EXT = [
  ".b3d",
  ".glb",
  ".gltf",
  ".obj",
  ".wrl",
  ".stl",
  ".jpg",
  ".jpeg",
  ".png"
];

export const ORDER_3D_MAX_BYTES = 120 * 1024 * 1024;

export function detectOrder3DFileType(fileName = "") {
  const lower = String(fileName).toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot) : "";
  if (ext === ".b3d") return "b3d";
  if (ext === ".glb") return "glb";
  if (ext === ".gltf") return "gltf";
  if (ext === ".obj") return "obj";
  if (ext === ".wrl") return "wrl";
  if (ext === ".stl") return "stl";
  if (ext === ".jpg" || ext === ".jpeg") return "jpg";
  if (ext === ".png") return "png";
  return "unknown";
}

export function isOrder3DUploadAllowed(fileName = "") {
  const lower = String(fileName).toLowerCase();
  return ORDER_3D_UPLOAD_EXT.some((ext) => lower.endsWith(ext));
}

function roleOf(user) {
  return user?.role || "";
}

function perm(user, key) {
  return Boolean(user?.permissions?.[key]);
}

/** Директор / адмін / начальник виробництва — оригінал .b3d. */
export function canViewOriginalB3D(user) {
  const role = roleOf(user);
  return role === "admin" || role === "production";
}

export function canUpload3DAsset(user) {
  const role = roleOf(user);
  if (role === "admin" || role === "production" || role === "manager") return true;
  return perm(user, "canWorkConstructorDesk") || perm(user, "canManageConstructorDesk");
}

export function canDelete3DAsset(user) {
  const role = roleOf(user);
  return role === "admin" || role === "production";
}

export function canRetry3DConversion(user) {
  return canUpload3DAsset(user) && roleOf(user) !== "manager";
}

export function canDownloadWebModel(user) {
  const role = roleOf(user);
  if (role === "admin" || role === "production") return true;
  return perm(user, "canWorkConstructorDesk") || perm(user, "canManageConstructorDesk");
}

export function canViewWebModel(user) {
  if (!user) return false;
  const role = roleOf(user);
  if (role === "operator") return perm(user, "canUseOperatorPanel");
  return (
    perm(user, "canEditOrders") ||
    perm(user, "canEditPositions") ||
    perm(user, "canWorkConstructorDesk") ||
    perm(user, "canManageConstructorDesk") ||
    perm(user, "canViewProductionFloor")
  );
}

export function conversionSourceLabel(source = "") {
  if (!source) return null;
  return ORDER_3D_SOURCE_LABELS[source] || source;
}

export function canViewB3DReport(user) {
  return canViewOriginalB3D(user);
}

export function canViewOrder3DTab(user) {
  return canViewWebModel(user) || canUpload3DAsset(user);
}

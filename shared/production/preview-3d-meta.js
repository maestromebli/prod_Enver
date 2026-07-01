/** Текст про часткову 3D-збірку (деталі без координат ENVER3). */
export function formatAssemblyMissingMessage({
  missingCodes = [],
  totalPanels = 0,
  assembledCount = 0
} = {}) {
  const missing = missingCodes.filter(Boolean);
  if (!missing.length) return null;

  const total = totalPanels > 0 ? totalPanels : assembledCount + missing.length;
  const assembled = assembledCount > 0 ? assembledCount : Math.max(0, total - missing.length);
  const codes = missing.slice(0, 10).join(", ");
  const suffix = missing.length > 10 ? ` (+${missing.length - 10})` : "";

  return `${assembled} з ${total} деталей у 3D-збірці — без координат: ${codes}${suffix}`;
}

export function formatEnver3SyncMessage(syncResult) {
  if (!syncResult) return null;
  if (syncResult.applied) {
    return `ENVER3 дописано в .b3d (${syncResult.panelCount || "?"} панелей)`;
  }
  if (syncResult.reason === "already_has_enver3") {
    return "ENVER3 уже є в .b3d";
  }
  if (syncResult.reason === "no_assembly_json") {
    return null;
  }
  if (syncResult.reason === "empty_assembly_json") {
    return "enver-assembly.json порожній або некоректний";
  }
  return null;
}

export function formatEnver3dscanSyncMessage(syncResult) {
  if (!syncResult) return null;
  if (syncResult.applied) {
    return `ENVER_3dscan дописано в .b3d (${syncResult.panelCount || "?"} панелей)`;
  }
  if (syncResult.reason === "already_has_enver_3dscan") {
    return "ENVER_3dscan уже є в .b3d";
  }
  if (
    syncResult.reason === "no_3dscan_json" ||
    syncResult.reason === "no_3dscan_source" ||
    syncResult.reason === "empty_3dscan_json" ||
    syncResult.reason === "empty_3dscan_derived"
  ) {
    return null;
  }
  return null;
}

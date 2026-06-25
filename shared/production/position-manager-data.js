/**
 * Дані менеджера по позиції — структура та перевірка повноти.
 */

export const MANAGER_FILE_KINDS = [
  "manager_photo",
  "manager_pdf",
  "manager_measurement",
  "manager_reference",
  "manager_appliance",
  "manager_other"
];

export const MANAGER_FILE_KIND_LABELS = {
  manager_photo: "Фото",
  manager_pdf: "PDF",
  manager_measurement: "Заміри",
  manager_reference: "Референс",
  manager_appliance: "Техніка",
  manager_other: "Інше"
};

export function defaultManagerDataJson() {
  return {
    delivery: {
      address: "",
      contactName: "",
      contactPhone: "",
      notes: ""
    },
    deadlines: {
      positionDeadline: "",
      measurementDate: "",
      installPreferredDate: ""
    },
    appliances: [],
    comments: {
      client: "",
      manager: "",
      technical: ""
    },
    sourceLinks: []
  };
}

export function parseManagerDataJson(raw) {
  const base = defaultManagerDataJson();
  if (!raw) return base;
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return base;
    }
  }
  if (!parsed || typeof parsed !== "object") return base;
  return {
    ...base,
    ...parsed,
    delivery: { ...base.delivery, ...(parsed.delivery || {}) },
    deadlines: { ...base.deadlines, ...(parsed.deadlines || {}) },
    comments: { ...base.comments, ...(parsed.comments || {}) },
    appliances: Array.isArray(parsed.appliances) ? parsed.appliances : base.appliances,
    sourceLinks: Array.isArray(parsed.sourceLinks) ? parsed.sourceLinks : base.sourceLinks
  };
}

/** Злиття колонок positions + JSON у єдиний об'єкт для API/UI. */
export function buildManagerDataFromRow(row = {}) {
  const json = parseManagerDataJson(row.manager_data_json ?? row.managerDataJson);
  return {
    delivery: {
      address: String(row.delivery_address ?? row.deliveryAddress ?? json.delivery.address ?? "").trim(),
      contactName: String(
        row.delivery_contact_name ?? row.deliveryContactName ?? json.delivery.contactName ?? ""
      ).trim(),
      contactPhone: String(
        row.delivery_contact_phone ?? row.deliveryContactPhone ?? json.delivery.contactPhone ?? ""
      ).trim(),
      notes: String(json.delivery.notes ?? "").trim()
    },
    deadlines: {
      positionDeadline: String(
        row.position_deadline ?? row.positionDeadline ?? json.deadlines.positionDeadline ?? ""
      ).trim(),
      measurementDate: String(
        row.measurement_date ?? row.measurementDate ?? json.deadlines.measurementDate ?? ""
      ).trim(),
      installPreferredDate: String(
        row.installation_preferred_date ??
          row.installationPreferredDate ??
          json.deadlines.installPreferredDate ??
          ""
      ).trim()
    },
    appliances: json.appliances,
    comments: { ...json.comments },
    sourceLinks: json.sourceLinks,
    completedAt: row.manager_data_completed_at ?? row.managerDataCompletedAt ?? null,
    completedBy: row.manager_data_completed_by ?? row.managerDataCompletedBy ?? null
  };
}

export function isManagerDataComplete(position, managerData = null, { managerFilesCount = 0 } = {}) {
  const data = managerData || buildManagerDataFromRow(position);
  const hasItem = Boolean(String(position?.item ?? "").trim());
  const hasAddress = Boolean(String(data.delivery?.address ?? "").trim());
  const hasDeadline = Boolean(
    String(data.deadlines?.positionDeadline ?? position?.positionDeadline ?? "").trim()
  );
  return hasItem && hasAddress && hasDeadline;
}

export function managerDataCompletionPercent(position, managerData = null, { managerFilesCount = 0 } = {}) {
  const data = managerData || buildManagerDataFromRow(position);
  let score = 0;
  const checks = [
    Boolean(String(position?.item ?? "").trim()),
    Boolean(String(data.delivery?.address ?? "").trim()),
    Boolean(String(data.deadlines?.positionDeadline ?? "").trim()),
    Boolean(String(data.delivery?.contactPhone ?? "").trim()),
    managerFilesCount > 0 || Boolean(String(data.comments?.client ?? "").trim())
  ];
  for (const ok of checks) if (ok) score += 1;
  return Math.round((score / checks.length) * 100);
}

export function isManagerFileKind(kind) {
  return MANAGER_FILE_KINDS.includes(kind);
}

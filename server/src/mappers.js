export function mapOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderNumber: row.order_number,
    object: row.object,
    client: row.client ?? "",
    manager: row.manager ?? "",
    defaultDeliveryAddress: row.default_delivery_address ?? "",
    startDate: row.start_date ?? "",
    planDate: row.plan_date ?? "",
    status: row.status ?? "",
    priority: row.priority ?? "",
    comment: row.comment ?? "",
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null
  };
}

export function mapPosition(row) {
  if (!row) return null;
  return {
    id: row.id,
    parentId: row.parent_id ?? null,
    orderId: row.order_id,
    orderNumber: row.order_number ?? "",
    object: row.object ?? "",
    item: row.item ?? "",
    itemType: row.item_type ?? "",
    manager: row.manager ?? "",
    constructor: row.constructor_name ?? "",
    hasConstructiveFile: Boolean(row.has_constructive_file),
    constructiveFileName: row.constructive_file_name ?? "",
    constructiveFileCount: Number(row.constructive_file_count) || 0,
    hasConstructivePackage: Boolean(row.has_constructive_package),
    constructivePackageId: row.constructive_package_id ?? null,
    constructivePackageVersion: Number(row.constructive_package_version) || 0,
    constructivePackageStatus: row.constructive_package_status ?? "",
    constructivePartsCount: Number(row.constructive_parts_count) || 0,
    unmappedPartsCount: Number(row.unmapped_parts_count) || 0,
    hasProcurementSource: Boolean(row.has_procurement_source),
    hasProcurementRequest: Boolean(row.has_procurement_request),
    procurementRequestStatus: row.procurement_request_status ?? "",
    cuttingStatus: row.cutting_status ?? "",
    edgingStatus: row.edging_status ?? "",
    drillingStatus: row.drilling_status ?? "",
    assemblyStatus: row.assembly_status ?? "",
    packagingStatus: row.packaging_status ?? "",
    assemblyResponsible: row.assembly_responsible ?? "",
    readyDate: row.ready_date ?? "",
    installDate: row.install_date ?? "",
    installEndDate: row.install_end_date ?? "",
    installTimeStart: row.install_time_start ?? "",
    installTimeEnd: row.install_time_end ?? "",
    installResponsible: row.install_responsible ?? "",
    positionStatus: row.position_status ?? "",
    progress: row.progress ?? 0,
    currentStage: row.current_stage ?? "",
    overdueDays: row.overdue_days ?? 0,
    problem: row.problem ?? "",
    note: row.note ?? "",
    material: row.material ?? "",
    deliveryAddress: row.delivery_address ?? "",
    deliveryContactName: row.delivery_contact_name ?? "",
    deliveryContactPhone: row.delivery_contact_phone ?? "",
    positionDeadline: row.position_deadline ?? "",
    measurementDate: row.measurement_date ?? "",
    installationPreferredDate: row.installation_preferred_date ?? "",
    managerDataCompletedAt: row.manager_data_completed_at ?? null,
    managerFilesCount: Number(row.manager_files_count) || 0,
    constructorUserId: row.constructor_user_id ?? null,
    constructorUserName: row.constructor_user_name ?? "",
    constructorDueAt: row.constructor_due_at ?? null,
    constructorAssignedAt: row.constructor_assigned_at ?? null,
    constructorEstimatedHours:
      row.constructor_estimated_hours != null ? Number(row.constructor_estimated_hours) : null,
    createdAt: row.created_at ?? null
  };
}

function ownString(body, key, fallback = "") {
  if (!body || !Object.hasOwn(body, key)) return fallback;
  const value = body[key];
  return typeof value === "string" ? value.trim() : fallback;
}

export function orderToDb(body) {
  return {
    order_number: body.orderNumber?.trim() ?? "",
    object: body.object?.trim() ?? "",
    client: body.client?.trim() ?? "",
    manager: body.manager?.trim() ?? "",
    start_date: body.startDate?.trim() ?? "",
    plan_date: body.planDate?.trim() ?? "",
    status: body.status?.trim() ?? "",
    priority: body.priority?.trim() ?? "",
    comment: body.comment?.trim() ?? "",
    default_delivery_address:
      body.defaultDeliveryAddress?.trim() ?? body.clientAddress?.trim() ?? ""
  };
}

export function positionToDb(body) {
  return {
    parent_id: body.parentId ? Number(body.parentId) : null,
    order_id: body.orderId ? Number(body.orderId) : null,
    order_number: body.orderNumber?.trim() ?? "",
    object: body.object?.trim() ?? "",
    item: body.item?.trim() ?? "",
    item_type: body.itemType?.trim() ?? "",
    manager: body.manager?.trim() ?? "",
    constructor_name: ownString(body, "constructor"),
    has_constructive_file: Boolean(body.hasConstructiveFile),
    cutting_status: body.cuttingStatus?.trim() ?? "Не розпочато",
    edging_status: body.edgingStatus?.trim() ?? "Не розпочато",
    drilling_status: body.drillingStatus?.trim() ?? "Не розпочато",
    assembly_status: body.assemblyStatus?.trim() ?? "Не розпочато",
    packaging_status: body.packagingStatus?.trim() ?? "Не потрібно",
    assembly_responsible: body.assemblyResponsible?.trim() ?? "",
    ready_date: body.readyDate?.trim() ?? "",
    install_date: body.installDate?.trim() ?? "",
    install_end_date: body.installEndDate?.trim() ?? "",
    install_time_start: body.installTimeStart?.trim() ?? "",
    install_time_end: body.installTimeEnd?.trim() ?? "",
    install_responsible: body.installResponsible?.trim() ?? "",
    position_status: body.positionStatus?.trim() ?? "",
    progress: Number(body.progress) || 0,
    overdue_days: Number(body.overdueDays) || 0,
    problem: body.problem?.trim() ?? "",
    note: body.note?.trim() ?? ""
  };
}

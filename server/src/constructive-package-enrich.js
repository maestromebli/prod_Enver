/** SQL subqueries для godmode / positions list — останній пакет конструктива. */

export const PACKAGE_STATUS_SUBQUERY = `(SELECT cp.status FROM constructive_packages cp
  WHERE cp.position_id = p.id
  ORDER BY cp.version DESC LIMIT 1) AS constructive_package_status`;

export const PACKAGE_ID_SUBQUERY = `(SELECT cp.id FROM constructive_packages cp
  WHERE cp.position_id = p.id
  ORDER BY cp.version DESC LIMIT 1) AS constructive_package_id`;

export const PACKAGE_VERSION_SUBQUERY = `(SELECT cp.version FROM constructive_packages cp
  WHERE cp.position_id = p.id
  ORDER BY cp.version DESC LIMIT 1) AS constructive_package_version`;

export const HAS_CONSTRUCTIVE_PACKAGE_SUBQUERY = `(SELECT EXISTS(
  SELECT 1 FROM constructive_packages cp WHERE cp.position_id = p.id
)) AS has_constructive_package`;

export const UNMAPPED_PARTS_SUBQUERY = `(SELECT COUNT(*)::int FROM constructive_parts pt
  JOIN constructive_packages cp ON cp.id = pt.package_id
  WHERE cp.position_id = p.id AND cp.version = (
    SELECT MAX(version) FROM constructive_packages WHERE position_id = p.id
  ) AND trim(pt.model_node_id) = '' AND trim(pt.model_mesh_name) = '') AS unmapped_parts_count`;

export const PACKAGE_PARTS_COUNT_SUBQUERY = `(SELECT COUNT(*)::int FROM constructive_parts pt
  JOIN constructive_packages cp ON cp.id = pt.package_id
  WHERE cp.position_id = p.id AND cp.version = (
    SELECT MAX(version) FROM constructive_packages WHERE position_id = p.id
  )) AS constructive_parts_count`;

const LATEST_PACKAGE_ID_SUBQUERY = `(SELECT cp.id FROM constructive_packages cp
  WHERE cp.position_id = p.id ORDER BY cp.version DESC LIMIT 1)`;

export const HAS_PROCUREMENT_SOURCE_SUBQUERY = `(SELECT (
  EXISTS (
    SELECT 1 FROM constructive_package_files cpf
    WHERE cpf.package_id = ${LATEST_PACKAGE_ID_SUBQUERY} AND cpf.kind = 'spec_xls'
  ) AND (
    EXISTS (
      SELECT 1 FROM constructive_materials cm
      WHERE cm.package_id = ${LATEST_PACKAGE_ID_SUBQUERY}
        AND COALESCE(cm.source, '') != 'cnc'
    ) OR EXISTS (
      SELECT 1 FROM constructive_hardware ch
      WHERE ch.package_id = ${LATEST_PACKAGE_ID_SUBQUERY}
    )
  )
)) AS has_procurement_source`;

export const HAS_PROCUREMENT_REQUEST_SUBQUERY = `(SELECT EXISTS(
  SELECT 1 FROM procurement_requests pr
  WHERE pr.position_id = p.id AND pr.status NOT IN ('cancelled','rejected')
)) AS has_procurement_request`;

export const PROCUREMENT_REQUEST_STATUS_SUBQUERY = `(SELECT pr.status FROM procurement_requests pr
  WHERE pr.position_id = p.id AND pr.status NOT IN ('cancelled','rejected')
  ORDER BY pr.id DESC LIMIT 1) AS procurement_request_status`;

export function packageGodmodeContextFromRow(row) {
  const status = row.constructive_package_status ?? row.constructivePackageStatus ?? "";
  const procStatus = row.procurement_request_status ?? row.procurementRequestStatus ?? "";
  return {
    hasConstructivePackage: Boolean(
      row.has_constructive_package ?? row.hasConstructivePackage ?? status
    ),
    packageStatus: status || null,
    packageId: row.constructive_package_id ?? row.constructivePackageId ?? null,
    unmappedPartsCount: Number(row.unmapped_parts_count ?? row.unmappedPartsCount) || 0,
    constructivePartsCount: Number(row.constructive_parts_count ?? row.constructivePartsCount) || 0,
    hasProcurementSource: Boolean(row.has_procurement_source ?? row.hasProcurementSource),
    hasProcurementRequest: Boolean(row.has_procurement_request ?? row.hasProcurementRequest),
    procurementStatus: procStatus || null
  };
}

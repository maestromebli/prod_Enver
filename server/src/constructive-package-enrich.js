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

export function packageGodmodeContextFromRow(row) {
  const status = row.constructive_package_status ?? row.constructivePackageStatus ?? "";
  return {
    hasConstructivePackage: Boolean(
      row.has_constructive_package ?? row.hasConstructivePackage ?? status
    ),
    packageStatus: status || null,
    packageId: row.constructive_package_id ?? row.constructivePackageId ?? null,
    unmappedPartsCount: Number(row.unmapped_parts_count ?? row.unmappedPartsCount) || 0,
    constructivePartsCount: Number(row.constructive_parts_count ?? row.constructivePartsCount) || 0
  };
}

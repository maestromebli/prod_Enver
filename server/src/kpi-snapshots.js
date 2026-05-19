import { db } from "./db.js";

export function computeKpiSnapshot() {
  const orders = db.prepare("SELECT status FROM orders").all();
  const positions = db
    .prepare(
      `SELECT position_status, progress, overdue_days, install_date, constructor_name, assembly_responsible
       FROM positions`
    )
    .all();

  return {
    activeOrders: orders.filter((o) => o.status !== "Завершено").length,
    inProduction: positions.filter((p) => p.position_status === "У виробництві").length,
    inWork: positions.filter((p) => p.progress > 0 && p.progress < 100).length,
    overdueCount: positions.filter((p) => p.overdue_days > 0).length,
    readyInstall: positions.filter((p) => p.position_status === "Готово до встановлення").length,
    installs: positions.filter((p) => p.install_date).length,
    constructors: new Set(positions.map((p) => p.constructor_name).filter(Boolean)).size,
    assemblers: new Set(positions.map((p) => p.assembly_responsible).filter(Boolean)).size
  };
}

export function recordTodaySnapshot() {
  const today = new Date().toISOString().slice(0, 10);
  const k = computeKpiSnapshot();
  db.prepare(
    `INSERT INTO kpi_snapshots (
      snapshot_date, active_orders, in_production, in_work, overdue_count, ready_install, installs
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(snapshot_date) DO UPDATE SET
      active_orders = excluded.active_orders,
      in_production = excluded.in_production,
      in_work = excluded.in_work,
      overdue_count = excluded.overdue_count,
      ready_install = excluded.ready_install,
      installs = excluded.installs`
  ).run(
    today,
    k.activeOrders,
    k.inProduction,
    k.inWork,
    k.overdueCount,
    k.readyInstall,
    k.installs
  );
}

export function getKpiTrends(days = 14) {
  const limit = Math.min(90, Math.max(7, days));
  const rows = db
    .prepare(
      `SELECT snapshot_date, active_orders, in_production, in_work, overdue_count, ready_install, installs
       FROM kpi_snapshots ORDER BY snapshot_date DESC LIMIT ?`
    )
    .all(limit)
    .reverse();

  return rows.map((r) => ({
    date: r.snapshot_date,
    activeOrders: r.active_orders,
    inProduction: r.in_production,
    inWork: r.in_work,
    overdueCount: r.overdue_count,
    readyInstall: r.ready_install,
    installs: r.installs
  }));
}

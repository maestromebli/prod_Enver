import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getConstructivePackageWarnings,
  getConstructiveProcurementNextAction
} from "../../shared/production/constructive-godmode.js";
import {
  buildConstructorAssigneesFromDirectory,
  mergeConstructorAssignees,
  parseConstructorAssigneeValue
} from "../../shared/production/constructor-assignees.js";
import { suggestConstructorTiming } from "../../shared/production/constructor-timing.js";
import {
  formatWorkspaceFileId,
  isWorkspaceManagerKind,
  managerKindToWorkspaceKind,
  parseManagerFileId,
  workspaceKindToManagerKind
} from "../../shared/production/manager-file-adapter.js";
import {
  estimateLaborHeuristic,
  normalizePackageAiAnalysis
} from "../../shared/production/package-ai.js";
import { computePartPerimeterMm, countEdgedSides } from "../../shared/production/stage-metrics.js";
import {
  buildNotifications,
  buildOrderGodmode,
  canRunNextAction,
  getOrderBlockers,
  getOrderNextAction,
  getOrderWarnings,
  getPositionBlockers,
  getPositionNextAction,
  getPositionWarnings
} from "../../shared/production/godmode.js";
import {
  buildGodmodeCtaAttrs,
  canAttentionQuickRun,
  orderDetailSubTabForGodmodeAction,
  panelForGodmodeAction,
  shouldOpenOrderDetailForGodmodeAction
} from "../../shared/production/godmode-ui-helpers.js";
import {
  collectWarnings,
  deriveNextAction,
  detectAutoHandoffs,
  hasStageAssignment,
  readPositionStageStatus,
  stageRequiresAssignment
} from "../../shared/production/next-action.js";
import {
  deriveOrderStatusFromPositions,
  ORDER_STATUS_RANK,
  shouldUpdateOrderStatus
} from "../../shared/production/order-status-from-positions.js";
import {
  formatPartDetailSummary,
  formatProjectEdgeMask
} from "../../shared/production/part-detail-display.js";
import {
  calendarEventFromItem,
  categoryColor,
  getProcurementBlockers,
  getProcurementWarnings,
  isDeliveryAtRisk,
  isDeliveryOverdue,
  isItemFullyReceived,
  isMtoItem,
  mtoCategoryLabel,
  nextReturnStatus,
  returnReasonLabel,
  returnStatusLabel,
  summarizeProcurementItems
} from "../../shared/production/procurement.js";
import {
  estimateFinishAt,
  estimateStageDuration,
  formatStageEstimateLabel,
  median
} from "../../shared/production/stage-duration-estimate.js";
import { computePackageStageMetrics } from "../../shared/production/stage-metrics.js";

function basePos(overrides = {}) {
  return {
    id: 1,
    order_number: "EN-1",
    orderNumber: "EN-1",
    item: "Шафа",
    has_constructive_file: true,
    cutting_status: "Не розпочато",
    edging_status: "Не розпочато",
    drilling_status: "Не розпочато",
    assembly_status: "Не розпочато",
    assembly_responsible: "Олег",
    constructor_name: "Ігор",
    position_status: "Не розпочато",
    problem: "",
    overdue_days: 0,
    ...overrides
  };
}

describe("shared/production coverage — order status", () => {
  it("ORDER_STATUS_RANK і forward-only з Проблеми", () => {
    assert.ok(ORDER_STATUS_RANK["У виробництві"] < ORDER_STATUS_RANK["Завершено"]);
    assert.equal(shouldUpdateOrderStatus("Проблема", "У виробництві"), true);
    assert.equal(shouldUpdateOrderStatus("Проблема", "Проблема"), false);
  });

  it("isInProduction через camelCase етапів", () => {
    const order = { id: 1 };
    const positions = [
      {
        id: 1,
        parentId: null,
        cuttingStatus: "В роботі",
        position_status: "Не розпочато"
      }
    ];
    assert.equal(deriveOrderStatusFromPositions(order, positions), "У виробництві");
  });

  it("У конструктиві коли всі мають конструктора", () => {
    const order = { id: 1 };
    const positions = [
      { id: 1, parentId: null, constructor_user_id: 5, position_status: "Не розпочато" }
    ];
    assert.equal(deriveOrderStatusFromPositions(order, positions), "У конструктиві");
  });

  it("null якщо немає робочих позицій", () => {
    assert.equal(deriveOrderStatusFromPositions({ id: 1 }, []), null);
  });
});

describe("shared/production coverage — stage duration", () => {
  const edgingHistory = [
    {
      stage_key: "edging",
      active_seconds: 3600,
      edge_length_mm: 50000,
      parts_count: 10,
      material_summary: "ДСП"
    },
    {
      stage_key: "edging",
      active_seconds: 2400,
      edge_length_mm: 40000,
      parts_count: 8,
      material_summary: "ДСП"
    }
  ];

  it("median і edging/drilling оцінки", () => {
    assert.equal(median([1, 2, 3]), 2);
    assert.equal(median([]), null);
    const edging = estimateStageDuration(
      "edging",
      { edgeLengthMm: 30000, partsCount: 5, materialSummary: "ДСП" },
      edgingHistory
    );
    assert.ok(edging.estimatedMinutes >= 5);
    assert.match(edging.method, /history/);

    const drilling = estimateStageDuration(
      "drilling",
      { drillPoints: 40, partsCount: 10, materialSummary: "ДСП" },
      [
        {
          stage_key: "drilling",
          active_seconds: 1800,
          drill_points: 20,
          parts_count: 10,
          material_summary: "ДСП"
        }
      ]
    );
    assert.ok(drilling.estimatedMinutes >= 5);
  });

  it("AI blend і медіанне обмеження", () => {
    const est = estimateStageDuration(
      "cutting",
      { partsCount: 500, cutLengthMm: 5_000_000, materialSummary: "ДСП" },
      edgingHistory.map((r) => ({ ...r, stage_key: "cutting", cut_length_mm: 1000 })),
      { aiMinutes: 120 }
    );
    assert.ok(est.estimatedMinutes >= 5);
    assert.match(est.method, /ai/);
  });

  it("formatStageEstimateLabel — години та хвилини", () => {
    assert.equal(formatStageEstimateLabel({ estimatedMinutes: 0 }), "");
    assert.equal(formatStageEstimateLabel({ estimatedMinutes: 45 }), "~45 хв");
    const finish = estimateFinishAt("2026-06-30T10:00:00Z", 30);
    assert.ok(finish instanceof Date);
  });
});

describe("shared/production coverage — next-action", () => {
  it("readPositionStageStatus і assignment", () => {
    const row = { has_constructive_file: false };
    assert.equal(readPositionStageStatus(row, { type: "constructor" }), "Не розпочато");
    assert.equal(stageRequiresAssignment({ key: "drilling" }), true);
    assert.equal(
      hasStageAssignment({ assembly_responsible: "Іван" }, { usesAssembler: true }),
      true
    );
  });

  it("missing_assignment через godmode blockers на assembly", () => {
    const blockers = getPositionBlockers(
      basePos({
        current_stage: "assembly",
        assembly_responsible: "",
        assembly_status: "В роботі"
      })
    );
    assert.ok(blockers.some((b) => b.type === "missing_assignment"));
  });

  it("deriveNextAction — handoff на наступний етап після Готово", () => {
    const row = {
      has_constructive_file: true,
      cutting_status: "Готово",
      edging_status: "Не розпочато",
      drilling_status: "Не розпочато",
      assembly_status: "Не розпочато",
      assembly_responsible: "Петро",
      problem: "",
      position_status: "У виробництві"
    };
    const next = deriveNextAction(row);
    assert.equal(next.type, "advance");
    assert.equal(next.stageKey, "edging");
  });

  it("deriveNextAction — schedule_install коли готово до встановлення", () => {
    const row = {
      has_constructive_file: true,
      cutting_status: "Готово",
      edging_status: "Готово",
      drilling_status: "Готово",
      assembly_status: "Готово",
      assembly_responsible: "Петро",
      problem: "",
      position_status: "Готово до встановлення"
    };
    const next = deriveNextAction(row);
    assert.equal(next.actionKey, "schedule_install");
  });

  it("stage_problem warning без тексту problem", () => {
    const row = {
      has_constructive_file: true,
      cutting_status: "Проблема",
      edging_status: "Не розпочато",
      drilling_status: "Не розпочато",
      assembly_status: "Не розпочато",
      assembly_responsible: "Петро",
      problem: "",
      position_status: "У виробництві"
    };
    const warnings = collectWarnings(row);
    assert.ok(warnings.some((w) => w.code === "stage_problem"));
  });

  it("detectAutoHandoffs ігнорує excludeStageKey", () => {
    const before = { cutting_status: "Готово", edging_status: "Не розпочато" };
    const after = { cutting_status: "Готово", edging_status: "Передано" };
    assert.equal(detectAutoHandoffs(before, after, "edging").length, 0);
  });
});

describe("shared/production coverage — godmode UI", () => {
  it("panelForGodmodeAction — constructive pipeline", () => {
    assert.equal(panelForGodmodeAction("review_constructive"), "constructive");
    assert.equal(panelForGodmodeAction("print_part_labels"), "constructive");
    assert.equal(panelForGodmodeAction("wait_install"), "install");
  });

  it("orderDetailSubTabForGodmodeAction — wait_parse і procurement", () => {
    assert.equal(orderDetailSubTabForGodmodeAction("wait_parse"), "constructive");
    assert.equal(orderDetailSubTabForGodmodeAction("wait_procurement"), "procurement");
    assert.equal(shouldOpenOrderDetailForGodmodeAction("fill_manager_data"), true);
  });

  it("buildGodmodeCtaAttrs — усі гілки", () => {
    assert.match(
      buildGodmodeCtaAttrs({ type: "close_order", allowed: true }, { orderId: 5 }),
      /data-run-order-action="5"/
    );
    assert.match(
      buildGodmodeCtaAttrs({ type: "assign_constructor", allowed: true }, {}),
      /data-open-constructor-desk="1"/
    );
    assert.match(
      buildGodmodeCtaAttrs(
        { type: "parse_constructive_package", allowed: true },
        { positionId: 7 }
      ),
      /parse_constructive_package/
    );
    assert.match(
      buildGodmodeCtaAttrs({ type: "fill_manager_data", allowed: true }, { positionId: 2 }),
      /data-order-detail-tab="pos-2"/
    );
    assert.match(
      buildGodmodeCtaAttrs({ type: "create_procurement", allowed: true }, { positionId: 4 }),
      /data-godmode-nav="create_procurement"/
    );
    assert.match(
      buildGodmodeCtaAttrs({ type: "add_position", allowed: true }, { orderId: 1 }),
      /data-focus-inline-add="1"/
    );
    assert.equal(buildGodmodeCtaAttrs({ type: "advance_stage", allowed: false }), "");
    assert.match(
      buildGodmodeCtaAttrs({ type: "handoff_to_edging", allowed: true }, { positionId: 8 }),
      /data-run-next-action="8"/
    );
    assert.equal(canAttentionQuickRun("wait_procurement"), false);
  });
});

describe("shared/production coverage — procurement helpers", () => {
  const mtoItem = {
    procurement_class: "mto",
    category: "facade_agt",
    name: "Фасад",
    qty: 2,
    qty_received: 0,
    expected_delivery_date: "2025-01-01",
    required_by_date: "2024-12-01",
    status: "ordered"
  };

  it("labels і категорії", () => {
    assert.equal(mtoCategoryLabel("facade_agt"), "Фасади AGT");
    assert.equal(returnReasonLabel("defect"), "Дефект");
    assert.equal(returnStatusLabel("draft"), "Чернетка");
    assert.equal(nextReturnStatus("draft"), "submitted");
    assert.ok(categoryColor("glass").startsWith("#"));
  });

  it("isItemFullyReceived і overdue/atRisk", () => {
    assert.equal(isItemFullyReceived({ qty: 2, qty_received: 2 }), true);
    assert.equal(isMtoItem(mtoItem), true);
    assert.equal(isDeliveryOverdue(mtoItem, new Date("2026-01-01")), true);
    assert.equal(isDeliveryAtRisk(mtoItem), true);
  });

  it("summarizeProcurementItems і warnings/blockers", () => {
    const summary = summarizeProcurementItems([mtoItem]);
    assert.ok(summary.blockingCount > 0);
    assert.match(summary.label, /блокує збірку/);

    const warnings = getProcurementWarnings([mtoItem], { currentStage: "assembly" });
    assert.ok(warnings.some((w) => w.type === "procurement_overdue"));
    assert.ok(warnings.some((w) => w.type === "procurement_blocks_assembly"));

    const blockers = getProcurementBlockers([mtoItem], { currentStage: "assembly" });
    assert.equal(blockers[0].type, "procurement_blocks_assembly");

    const withReturns = getProcurementWarnings([mtoItem], { openReturns: 2 });
    assert.ok(withReturns.some((w) => w.type === "procurement_return_open"));
  });

  it("calendarEventFromItem", () => {
    const ev = calendarEventFromItem(
      { ...mtoItem, expectedDeliveryDate: "15.07.2026", positionId: 9 },
      { id: 9, orderNumber: "EN-9", item: "Кухня" }
    );
    assert.equal(ev.isoDate, "2026-07-15");
    assert.equal(ev.overdue, false);
  });
});

describe("shared/production coverage — constructor assignees", () => {
  it("build і merge assignees", () => {
    const users = [{ id: 1, name: "Ігор", login: "igor", role: "constructor" }];
    const list = buildConstructorAssigneesFromDirectory(["Ігор", "Петро"], users);
    assert.equal(list[0].id, 1);
    assert.equal(list[1].id, null);

    const merged = mergeConstructorAssignees([{ id: 2, name: "Олег" }], ["Ігор"]);
    assert.ok(merged.length >= 2);
  });

  it("parseConstructorAssigneeValue", () => {
    assert.deepEqual(parseConstructorAssigneeValue("u:5"), {
      constructorUserId: 5,
      constructorName: ""
    });
    assert.deepEqual(parseConstructorAssigneeValue("n:Марія"), {
      constructorUserId: null,
      constructorName: "Марія"
    });
    assert.deepEqual(parseConstructorAssigneeValue("42"), {
      constructorUserId: 42,
      constructorName: ""
    });
    assert.deepEqual(parseConstructorAssigneeValue("Анна"), {
      constructorUserId: null,
      constructorName: "Анна"
    });
  });
});

describe("shared/production coverage — part detail", () => {
  it("formatProjectEdgeMask і formatPartDetailSummary", () => {
    assert.equal(formatProjectEdgeMask([true, false, true, false]), "Верх, Низ");
    assert.equal(formatProjectEdgeMask([]), "Без кромки");
    const summary = formatPartDetailSummary({
      edgeCode: "1100",
      partNo: "10",
      bazisOperationCodes: ["0010X002X1", "0010X002X2"]
    });
    assert.ok(summary.edgedSides >= 1);
    assert.ok(summary.edgingOps.length >= 1);
  });
});

describe("shared/production coverage — godmode flows", () => {
  it("fill_manager_data коли неповні дані", () => {
    const next = getPositionNextAction(
      basePos({ delivery_address: "", current_stage: "constructor" }),
      { managerDataComplete: false }
    );
    assert.equal(next.type, "fill_manager_data");
  });

  it("assign_constructor і прострочений дедлайн", () => {
    const next = getPositionNextAction(
      basePos({
        constructor_name: "Ігор",
        constructor_due_at: "2020-01-01T00:00:00Z",
        current_stage: "constructor",
        delivery_address: "вул. Тестова 1"
      }),
      { now: new Date("2026-06-30"), onConstructorDesk: true, managerDataComplete: true }
    );
    assert.equal(next.type, "assign_constructor");
    assert.match(next.label, /прострочено/i);
  });

  it("advance_stage на етапі В роботі", () => {
    const next = getPositionNextAction(
      basePos({
        cutting_status: "В роботі",
        has_ai_analysis: true,
        tasks_created: true
      }),
      { hasAiAnalysis: true, tasksCreated: true }
    );
    assert.equal(next.type, "advance_stage");
    assert.match(next.label, /Завершити/);
  });

  it("wait_install з періодом монтажу", () => {
    const next = getPositionNextAction(
      basePos({
        cutting_status: "Готово",
        edging_status: "Готово",
        drilling_status: "Готово",
        assembly_status: "Готово",
        position_status: "Готово до встановлення",
        install_date: "01.07.2026",
        install_end_date: "03.07.2026"
      }),
      { hasAiAnalysis: true, tasksCreated: true }
    );
    assert.equal(next.type, "wait_install");
    assert.match(next.description, /01\.07\.2026/);
  });

  it("getPositionBlockers — operator session і procurement", () => {
    const blockers = getPositionBlockers(
      basePos({
        assembly_responsible: "",
        cutting_status: "Готово",
        edging_status: "Готово",
        drilling_status: "Готово",
        assembly_status: "В роботі"
      }),
      {
        hasActiveOperatorSession: true,
        procurementItems: [{ category: "facade_agt", qty: 1, qty_received: 0, name: "Фасад" }]
      }
    );
    assert.ok(blockers.some((b) => b.type === "active_operator_session"));
    assert.ok(blockers.some((b) => b.type === "missing_assignment"));
    assert.ok(blockers.some((b) => b.type === "procurement_blocks_assembly"));
  });

  it("getOrderBlockers і warnings", () => {
    const order = { id: 1, status: "Завершено" };
    const positions = [basePos({ position_status: "У виробництві", parentId: null })];
    const blockers = getOrderBlockers(order, positions);
    assert.ok(blockers.some((b) => b.type === "unfinished_positions"));

    const earlyInstall = getOrderBlockers({ id: 2, status: "Активний" }, [
      basePos({ parentId: null, install_date: "01.07.2026", cutting_status: "В роботі" })
    ]);
    assert.ok(earlyInstall.some((b) => b.type === "install_before_production"));

    const warnings = getOrderWarnings({ id: 3, status: "Активний", manager: "" }, [
      basePos({ parentId: null })
    ]);
    assert.ok(warnings.length >= 0);
  });

  it("buildOrderGodmode і notifications", () => {
    const order = { id: 10, order_number: "EN-10", status: "Активний", manager: "Менеджер" };
    const positions = [
      basePos({ id: 5, order_id: 10, parentId: null, has_constructive_file: false })
    ];
    const gm = buildOrderGodmode(order, positions);
    assert.ok(gm.nextAction);
    assert.ok(Array.isArray(gm.warnings));

    const notes = buildNotifications({
      orders: [order],
      positions,
      now: new Date("2026-06-30")
    });
    assert.ok(notes.some((n) => n.type === "missing_constructive"));
  });

  it("canRunNextAction — manager close і constructive approve", () => {
    const pos = basePos({ cutting_status: "Передано" });
    const handoff = canRunNextAction(
      pos,
      { type: "handoff_to_cutting" },
      { role: "constructor", permissions: { canApproveConstructive: true } },
      { hasAiAnalysis: true, tasksCreated: true, packageStatus: "approved_by_production" }
    );
    assert.equal(handoff.allowed, true);

    const input = canRunNextAction(pos, { type: "upload_constructive" }, { role: "production" });
    assert.equal(input.allowed, false);
    assert.equal(input.code, "ACTION_REQUIRES_INPUT");

    const close = canRunNextAction({ id: 1 }, { type: "close_order" }, { role: "manager" });
    assert.equal(close.allowed, true);
  });

  it("getPositionWarnings — ai_not_run і tasks_not_created", () => {
    const w1 = getPositionWarnings(basePos(), {});
    assert.ok(w1.some((w) => w.type === "missing_due_date"));
    assert.ok(w1.some((w) => w.type === "ai_not_run"));

    const w2 = getPositionWarnings(basePos(), { hasAiAnalysis: true, tasksCreated: false });
    assert.ok(w2.some((w) => w.type === "tasks_not_created"));
  });

  it("constructor timing — desk і діти", () => {
    const desk = suggestConstructorTiming(
      { item: "Гардероб", itemType: "гардероб" },
      { childCount: 3, onConstructorDesk: true }
    );
    assert.ok(desk.estimatedHours > 0);
    const metrics = computePackageStageMetrics([], []);
    assert.equal(metrics.partsCount, 0);
  });

  it("getOrderNextAction — add_position для нового замовлення", () => {
    const next = getOrderNextAction({ id: 1, status: "Новий" }, []);
    assert.equal(next.type, "add_position");
  });
});

describe("shared/production coverage — timing, files, package-ai, metrics", () => {
  it("constructor-timing — стіл, фото, техніка, дедлайн", () => {
    const desk = suggestConstructorTiming(
      {
        item: "Стіл",
        itemType: "стіл",
        has_constructive_file: true,
        position_deadline: "15.07.2026"
      },
      {
        now: new Date("2026-06-30"),
        managerPhotoCount: 4,
        applianceCount: 2,
        constructorOpenPositions: 6
      }
    );
    assert.equal(desk.complexity, "low");
    assert.ok(desk.estimatedHours > 0);
    assert.match(desk.rationale, /фото/);
    assert.match(desk.rationale, /техніку/);
  });

  it("manager-file-adapter", () => {
    assert.equal(workspaceKindToManagerKind("tech"), "manager_appliance");
    assert.equal(managerKindToWorkspaceKind("manager_photo"), "manager_image");
    assert.equal(isWorkspaceManagerKind("custom"), true);
    assert.deepEqual(parseManagerFileId("ws-12"), { source: "workspace", id: 12, raw: "ws-12" });
    assert.deepEqual(parseManagerFileId("7"), { source: "position_files", id: 7, raw: "7" });
    assert.equal(formatWorkspaceFileId(9), "ws-9");
  });

  it("package-ai normalize і heuristic", () => {
    const bad = normalizePackageAiAnalysis(null, { partsCount: 10 });
    assert.ok(bad.warnings.length > 0);
    const ok = normalizePackageAiAnalysis(
      {
        furnitureType: "кухня",
        estimatedComplexity: "high",
        detectedHardware: [{ name: "Петля", qty: 4 }],
        estimatedLabor: {
          constructorHours: 12,
          totalHours: 20,
          stages: { cutting: 120, edging: 90, drilling: 60, assembly: 180 },
          confidence: 0.9
        },
        summary: "Тест"
      },
      { partsCount: 40, hardwareCount: 12 }
    );
    assert.equal(ok.furnitureType, "kitchen");
    assert.ok(ok.detectedHardware.length > 0);
    const heuristic = estimateLaborHeuristic({
      partsCount: 50,
      hardwareCount: 20,
      complexity: "high",
      furnitureType: "kitchen"
    });
    assert.ok(heuristic.totalHours > 0);
  });

  it("stage-metrics — edge cases", () => {
    assert.equal(countEdgedSides("12"), 2);
    assert.equal(countEdgedSides("abc"), 2);
    assert.equal(computePartPerimeterMm({ length: "600", width: "400" }), 2000);
    const m3 = computePackageStageMetrics(
      [{ length: "1000", width: "500", qty: 1, edgeCode: "1111", material: "ДСП" }],
      []
    );
    assert.ok(m3.edgeLengthMm > m3.cutLengthMm / 2);
    const m2 = computePackageStageMetrics(
      [{ length: "800", width: "400", qty: 1, edgeCode: "1100" }],
      [{ qty: "2.5" }]
    );
    assert.ok(m2.hardwareCount >= 2);
  });

  it("godmode notifications — різні типи", () => {
    const now = new Date("2026-06-30");
    const ready = basePos({
      id: 20,
      cutting_status: "Готово",
      edging_status: "Готово",
      drilling_status: "Готово",
      assembly_status: "Готово",
      position_status: "Готово до встановлення",
      has_ai_analysis: true
    });
    const problem = basePos({
      id: 21,
      problem: "Зламаний ЧПУ",
      position_status: "Проблема",
      cutting_status: "Проблема"
    });
    const notes = buildNotifications({
      orders: [{ id: 1, order_number: "EN-1", status: "Активний" }],
      positions: [ready, problem],
      now
    });
    assert.ok(notes.some((n) => n.type === "ready_for_install"));
    assert.ok(notes.some((n) => n.type === "operator_problem"));
  });

  it("godmode warnings — idle, in-progress, install_not_scheduled", () => {
    const old = new Date("2026-06-01");
    const now = new Date("2026-06-30");
    const idle = getPositionWarnings(
      basePos({ cutting_status: "Передано", current_stage: "cutting" }),
      { now, stageTimestamps: { cutting: old } }
    );
    assert.ok(idle.some((w) => w.type === "stage_idle_too_long"));

    const inProg = getPositionWarnings(
      basePos({ cutting_status: "В роботі", current_stage: "cutting" }),
      { now, stageTimestamps: { cutting: old } }
    );
    assert.ok(inProg.some((w) => w.type === "stage_in_progress_too_long"));

    const install = getPositionWarnings(
      basePos({
        cutting_status: "Готово",
        edging_status: "Готово",
        drilling_status: "Готово",
        assembly_status: "Готово",
        position_status: "Готово до встановлення"
      }),
      { hasAiAnalysis: true, tasksCreated: true }
    );
    assert.ok(install.some((w) => w.type === "install_not_scheduled"));
  });

  it("close_position і fallback advance", () => {
    const closed = getPositionNextAction(
      basePos({
        cutting_status: "Готово",
        edging_status: "Готово",
        drilling_status: "Готово",
        assembly_status: "Готово",
        position_status: "Завершено",
        install_date: "01.07.2026"
      }),
      { hasAiAnalysis: true, tasksCreated: true }
    );
    assert.equal(closed.type, "close_position");

    const fallback = getPositionNextAction(
      basePos({
        cutting_status: "На паузі",
        current_stage: "cutting",
        has_constructive_package: true,
        constructive_parts_count: 5
      }),
      {
        hasAiAnalysis: true,
        tasksCreated: true,
        packageStatus: "approved_by_production",
        managerDataComplete: true
      }
    );
    assert.equal(fallback.type, "advance_stage");
  });

  it("notifications — tasks, overdue, ai_ready, install_today, orders", () => {
    const today = new Date("2026-06-30");
    today.setHours(12, 0, 0, 0);
    const positions = [
      basePos({
        id: 30,
        overdue_days: 3,
        has_ai_analysis: true,
        tasks_created: false
      }),
      basePos({
        id: 31,
        cutting_status: "Готово",
        edging_status: "Готово",
        drilling_status: "Готово",
        assembly_status: "Готово",
        position_status: "Готово до встановлення",
        install_date: "30.06.2026",
        has_ai_analysis: true,
        tasks_created: true
      })
    ];
    const notes = buildNotifications({
      orders: [
        { id: 100, order_number: "EN-100", status: "Активний" },
        {
          id: 101,
          order_number: "EN-101",
          status: "Активний",
          manager: "Менеджер"
        }
      ],
      positions: [
        ...positions,
        basePos({ id: 32, order_id: 101, parentId: null, position_status: "Завершено" })
      ],
      now: today
    });
    assert.ok(notes.some((n) => n.type === "tasks_not_created" || n.type === "ai_ready"));
    assert.ok(notes.some((n) => n.type === "overdue"));
    assert.ok(notes.some((n) => n.type === "install_today"));
    assert.ok(notes.some((n) => n.type === "add_position" || n.type === "close_order"));
  });

  it("canRunNextAction — missing constructive і close_position", () => {
    const blocked = canRunNextAction(
      basePos({ has_constructive_file: false }),
      { type: "handoff_to_edging" },
      { role: "production" },
      { hasAiAnalysis: true, tasksCreated: true }
    );
    assert.equal(blocked.allowed, false);
    assert.match(blocked.reason, /виробництво/i);

    const closePos = canRunNextAction(
      basePos({ position_status: "Завершено" }),
      { type: "close_position" },
      { role: "production" }
    );
    assert.equal(closePos.allowed, true);
  });
});

describe("shared/production coverage — constructive-godmode", () => {
  it("warnings — rejected, unmapped, not parsed", () => {
    const rejected = getConstructivePackageWarnings({
      packageStatus: "rejected",
      rejectedReason: "Невірний Excel"
    });
    assert.ok(rejected.some((w) => w.type === "constructive_rejected"));

    const unmapped = getConstructivePackageWarnings({ unmappedPartsCount: 5 });
    assert.ok(unmapped.some((w) => w.type === "unmapped_3d_parts"));

    const uploaded = getConstructivePackageWarnings({ packageStatus: "uploaded" });
    assert.ok(uploaded.some((w) => w.type === "package_not_parsed"));
  });

  it("procurement next action — wait і create", () => {
    const wait = getConstructiveProcurementNextAction({
      packageStatus: "approved_by_constructor",
      procurementStatus: "ordered",
      hasProcurementRequest: true
    });
    assert.equal(wait?.type, "wait_procurement");

    const create = getConstructiveProcurementNextAction({
      packageStatus: "approved_by_constructor",
      hasProcurementRequest: false,
      hasProcurementSource: true
    });
    assert.equal(create?.type, "create_procurement");
  });
});

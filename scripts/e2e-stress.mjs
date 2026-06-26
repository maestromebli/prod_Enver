#!/usr/bin/env node
/**
 * Стрес-тест E2E: повний цикл до архіву + перевірка 3D-простору.
 * Запуск: node scripts/e2e-stress.mjs
 *   E2E_RUNS=100 node scripts/e2e-stress.mjs
 */
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.E2E_BASE || "http://localhost:3000/api";
const RUNS = Math.max(1, Number(process.env.E2E_RUNS) || 100);
const SKIP_AI = process.env.E2E_SKIP_AI === "1";

const SCENARIOS = ["pdf", "package", "single-root", "package-3d"];

const STAGES = ["cutting", "edging", "drilling", "assembly"];
const HANDOFF_AFTER = {
  cutting: "handoff_to_edging",
  edging: "handoff_to_drilling",
  drilling: "handoff_to_assembly",
  assembly: "ready_for_install"
};

let sessions = null;

function minimalGlbBuffer() {
  const json = JSON.stringify({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "B1-21" }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0 },
            indices: 1
          }
        ]
      }
    ],
    accessors: [
      {
        componentType: 5126,
        count: 3,
        type: "VEC3",
        bufferView: 0,
        max: [1, 1, 1],
        min: [0, 0, 0]
      },
      { componentType: 5123, count: 3, type: "SCALAR", bufferView: 1 }
    ],
    bufferViews: [
      { buffer: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 6 }
    ],
    buffers: [{ byteLength: 42 }]
  });
  const jsonPad = json + " ".repeat((4 - (json.length % 4)) % 4);
  const jsonChunk = Buffer.from(jsonPad);
  const bin = Buffer.alloc(42);
  const parts = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0]
  ];
  let o = 0;
  for (const [x, y, z] of parts) {
    bin.writeFloatLE(x, o);
    bin.writeFloatLE(y, o + 4);
    bin.writeFloatLE(z, o + 8);
    o += 12;
  }
  bin.writeUInt16LE(0, 36);
  bin.writeUInt16LE(1, 38);
  bin.writeUInt16LE(2, 40);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  const total = 12 + 8 + jsonChunk.length + 8 + bin.length;
  header.writeUInt32LE(total, 8);
  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, bin]);
}

async function api(token, method, urlPath, body) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body != null ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || data?.message || text;
    throw new Error(`${method} ${urlPath} → ${res.status}: ${msg}`);
  }
  return data?.data ?? data;
}

async function apiRaw(token, urlPath) {
  const res = await fetch(`${BASE}${urlPath}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  return { status: res.status, buffer: await res.arrayBuffer() };
}

async function login(login, password) {
  const r = await api(null, "POST", "/auth/login", { login, password });
  return { token: r.token, user: r.user };
}

async function ensureUser(adminToken, spec) {
  const users = await api(adminToken, "GET", "/users");
  const existing = users.find((u) => u.login.toLowerCase() === spec.login.toLowerCase());
  if (existing) return existing;
  return api(adminToken, "POST", "/users", { ...spec, active: true });
}

async function initSessions() {
  const admin = await login("admin", "admin");
  await ensureUser(admin.token, {
    name: "Тест Менеджер",
    login: "e2e_manager",
    password: "test123",
    role: "manager"
  });
  await ensureUser(admin.token, {
    name: "Тест Начальник",
    login: "e2e_production",
    password: "test123",
    role: "production"
  });

  const users = await api(admin.token, "GET", "/users");
  const cuttingOp = users.find((u) => u.login === "Cutting");
  if (cuttingOp) {
    await api(admin.token, "PUT", `/users/${cuttingOp.id}`, {
      password: "test123",
      stages: STAGES
    });
  } else {
    await ensureUser(admin.token, {
      name: "E2E Оператор",
      login: "e2e_operator",
      password: "test123",
      role: "operator",
      stages: STAGES
    });
  }

  return {
    admin: admin.token,
    manager: (await login("e2e_manager", "test123")).token,
    production: (await login("e2e_production", "test123")).token,
    operator: (await login("Cutting", "test123").catch(() => login("e2e_operator", "test123")))
      .token,
    operatorUser: (await login("Cutting", "test123").catch(() => login("e2e_operator", "test123")))
      .user,
    constructorName: await pickConstructorName(admin.token)
  };
}

async function pickConstructorName(token) {
  const list = await api(token, "GET", "/constructor-desk/constructors");
  const name = list?.[0]?.name;
  if (!name) throw new Error("Довідник «Конструктори» порожній");
  return name;
}

function godmodeNext(e) {
  return e?.godmode?.nextAction || e?.nextAction;
}

async function tryRunNext(token, posId, actionType) {
  try {
    await api(token, "POST", `/positions/${posId}/run-next-action`, { actionType });
    return true;
  } catch {
    return false;
  }
}

async function operatorStage(opToken, opUser, posId, stageKey) {
  const pos = await api(opToken, "GET", `/positions/${posId}`);
  const field = {
    cutting: "cuttingStatus",
    edging: "edgingStatus",
    drilling: "drillingStatus",
    assembly: "assemblyStatus"
  }[stageKey];
  const st = pos[field];
  if (st === "Готово" || st === "Не потрібно") return;

  if (st === "Передано" || st === "Не розпочато") {
    await api(opToken, "POST", "/operator/start", {
      userId: opUser.id,
      positionId: posId,
      stageKey
    });
  }
  await api(opToken, "POST", "/operator/finish", {
    userId: opUser.id,
    positionId: posId,
    stageKey
  });
}

async function completeProduction(prodToken, opToken, opUser, posId) {
  for (const stage of STAGES) {
    if (stage === "assembly") {
      const p = await api(prodToken, "GET", `/positions/${posId}`);
      if (!p.assemblyResponsible?.trim()) {
        await api(prodToken, "PUT", `/positions/${posId}`, {
          item: p.item,
          assemblyResponsible: "Олег"
        });
      }
    }
    await operatorStage(opToken, opUser, posId, stage);
    const handoff = HANDOFF_AFTER[stage];
    if (handoff) await tryRunNext(prodToken, posId, handoff);
  }

  await tryRunNext(prodToken, posId, "ready_for_install");

  await api(prodToken, "PATCH", `/positions/${posId}/install`, {
    installDate: "25.07.2026",
    installEndDate: "25.07.2026",
    installResponsible: "Монтажник Тест"
  });

  const p = await api(prodToken, "GET", `/positions/${posId}`);
  await api(prodToken, "PUT", `/positions/${posId}`, {
    item: p.item,
    positionStatus: "Завершено"
  });
}

async function verify3d(token, positionId, packageId, glbFileId, _parts = []) {
  const errors = [];

  const paths = [
    `/positions/${positionId}/constructive-packages/${packageId}/files/${glbFileId}`,
    `/constructive/packages/${packageId}/files/${glbFileId}`
  ];

  for (const p of paths) {
    const { status, buffer } = await apiRaw(token, p);
    if (status !== 200) {
      errors.push(`3D download ${p} → ${status}`);
      continue;
    }
    if (buffer.byteLength < 12) {
      errors.push(`3D file too small (${p})`);
      continue;
    }
    const magic = new DataView(buffer).getUint32(0, true);
    if (magic !== 0x46546c67) errors.push(`Invalid GLB magic on ${p}`);
  }

  const detail = await api(
    token,
    "GET",
    `/positions/${positionId}/constructive-packages/${packageId}`
  );
  const unmapped = (detail.parts || []).filter((p) => !p.modelNodeId && !p.modelMeshName);
  if (unmapped.length && detail.parts?.length) {
    const part = unmapped[0];
    await api(
      token,
      "POST",
      `/positions/${positionId}/constructive-packages/${packageId}/model-mapping`,
      {
        mappings: [{ partId: part.id, modelMeshName: "B1-21", modelNodeId: "B1-21" }]
      }
    );
    const after = await api(
      token,
      "GET",
      `/positions/${positionId}/constructive-packages/${packageId}`
    );
    const mapped = after.parts?.find((x) => x.id === part.id);
    if (!mapped?.modelMeshName) errors.push("model-mapping не збережено");
  }

  const partWithBarcode = (detail.parts || []).find((p) => p.barcodeValue);
  if (partWithBarcode) {
    try {
      await api(token, "GET", `/parts/scan/${encodeURIComponent(partWithBarcode.barcodeValue)}`);
    } catch (err) {
      errors.push(`scan 3D: ${err.message}`);
    }
  }

  return errors;
}

async function setupConstructivePdf(manager, production, workPosId) {
  const pdf = Buffer.from("%PDF-1.4 E2E constructive\n%%EOF");
  await api(manager, "POST", `/positions/${workPosId}/constructive-file`, {
    fileName: "e2e.pdf",
    mime: "application/pdf",
    dataBase64: pdf.toString("base64")
  });
  if (!SKIP_AI) {
    try {
      await api(manager, "POST", `/ai/analyze-constructive/${workPosId}`, {});
    } catch {
      await api(manager, "POST", `/positions/${workPosId}/create-tasks`, {
        stages: STAGES
      });
    }
  } else {
    await api(manager, "POST", `/positions/${workPosId}/create-tasks`, { stages: STAGES });
  }
  await tryRunNext(production, workPosId, "handoff_to_cutting");
}

async function setupConstructivePackage(manager, production, workPosId, { withGlb = false } = {}) {
  const files = [
    {
      fileName: "spec.pdf",
      mime: "application/pdf",
      dataBase64: Buffer.from("%PDF-1.4 package spec\n%%EOF").toString("base64")
    }
  ];
  if (withGlb) {
    files.push({
      fileName: "model.glb",
      mime: "model/gltf-binary",
      kind: "glb_model",
      dataBase64: minimalGlbBuffer().toString("base64")
    });
  }

  const created = await api(manager, "POST", `/positions/${workPosId}/constructive-packages`, {
    files
  });
  const pkgId = created.package?.id;
  if (!pkgId) throw new Error("Пакет не створено");

  await api(manager, "POST", `/positions/${workPosId}/constructive-packages/${pkgId}/parse`, {});
  await api(
    production,
    "POST",
    `/positions/${workPosId}/constructive-packages/${pkgId}/approve`,
    {}
  );
  await api(
    production,
    "POST",
    `/positions/${workPosId}/constructive-packages/${pkgId}/release-cnc`,
    {}
  );
  await tryRunNext(production, workPosId, "handoff_to_cutting");

  return { packageId: pkgId, glbFileId: created.files?.find((f) => f.kind === "glb_model")?.id };
}

async function runScenario(scenario, runIndex) {
  const { manager, production, operator, operatorUser } = sessions;
  const orderNum = `STRESS-${runIndex}-${Date.now().toString().slice(-5)}`;
  const isSingle = scenario === "single-root";
  const isPackage = scenario === "package" || scenario === "package-3d";
  const withGlb = scenario === "package-3d";

  const order = await api(manager, "POST", "/orders", {
    orderNumber: orderNum,
    object: `Об'єкт ${runIndex}`,
    client: "Stress Client",
    manager: "Тест Менеджер",
    planDate: "30.07.2026",
    priority: "Середній",
    status: "Новий",
    subItems: isSingle ? [] : [`Виріб ${runIndex}`],
    createRootPosition: isSingle
  });

  const workPos =
    order.workPositions?.[0] ||
    order.positions?.find((p) => p.parentId) ||
    order.positions?.find((p) => !p.parentId);
  if (!workPos?.id) throw new Error("Немає робочої позиції");

  await api(manager, "PUT", `/positions/${workPos.id}/manager-data`, {
    delivery: {
      address: `вул. Stress ${runIndex}`,
      contactName: "Тест",
      contactPhone: "+380000000000"
    },
    deadlines: { positionDeadline: "20.07.2026" },
    markComplete: true
  });

  await api(production, "PUT", `/constructor-desk/positions/${workPos.id}/assign`, {
    constructorName: sessions.constructorName,
    constructorDueAt: "2026-07-10T12:00:00.000Z"
  });

  let pkgMeta = null;
  if (isPackage || scenario === "single-root") {
    pkgMeta = await setupConstructivePackage(manager, production, workPos.id, { withGlb });
  } else {
    await setupConstructivePdf(manager, production, workPos.id);
  }

  if (pkgMeta?.glbFileId) {
    const errs = await verify3d(production, workPos.id, pkgMeta.packageId, pkgMeta.glbFileId);
    if (errs.length) throw new Error(errs.join("; "));
  }

  await completeProduction(production, operator, operatorUser, workPos.id);

  const orderBefore = await api(production, "GET", `/orders/${order.id}`);
  const next = godmodeNext(orderBefore);
  if (next?.type !== "close_order") {
    const wp = orderBefore.workPositions?.[0];
    throw new Error(`Очікував close_order, отримано ${next?.type} (pos=${wp?.positionStatus})`);
  }

  const closed = await api(production, "POST", `/orders/${order.id}/run-next-action`, {
    actionType: "close_order"
  });
  if (closed.status !== "Завершено") throw new Error(`Замовлення не в архіві: ${closed.status}`);

  return { orderNum, orderId: order.id, positionId: workPos.id, scenario };
}

async function main() {
  console.log(`Стрес E2E: ${RUNS} прогонів · ${SCENARIOS.length} сценарії`);
  sessions = await initSessions();

  const errors = [];
  const t0 = Date.now();
  let ok = 0;

  for (let i = 1; i <= RUNS; i++) {
    const scenario = SCENARIOS[(i - 1) % SCENARIOS.length];
    try {
      const r = await runScenario(scenario, i);
      ok++;
      if (i % 10 === 0 || i === 1) {
        console.log(`  ✓ ${i}/${RUNS} [${scenario}] ${r.orderNum} → архів`);
      }
    } catch (err) {
      errors.push({ run: i, scenario, message: err.message });
      console.error(`  ✗ ${i}/${RUNS} [${scenario}] ${err.message}`);
    }
  }

  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("\n" + "═".repeat(50));
  console.log(`Готово: ${ok}/${RUNS} успішних за ${sec}s`);
  if (errors.length) {
    console.log(`Помилок: ${errors.length}`);
    const byMsg = new Map();
    for (const e of errors) {
      byMsg.set(e.message, (byMsg.get(e.message) || 0) + 1);
    }
    console.log("Топ помилок:");
    [...byMsg.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([msg, n]) => console.log(`  [${n}×] ${msg}`));
    process.exit(1);
  }
  console.log("Усі прогони пройшли.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Прохідка E2E: менеджер → головний конструктор → начальник виробництва → оператор ЧПУ.
 * Використовує ті самі API, що й веб-інтерфейс.
 */
const BASE = process.env.E2E_BASE || "http://localhost:3000/api";
const ORDER_NUM = `TEST-E2E-${Date.now().toString().slice(-6)}`;

const log = (role, step, detail = "") =>
  console.log(`\n[${role}] ${step}${detail ? `\n    → ${detail}` : ""}`);

async function api(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
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
    throw new Error(`${method} ${path} → ${res.status}: ${msg}`);
  }
  return data?.data ?? data;
}

async function login(login, password) {
  const r = await api(null, "POST", "/auth/login", { login, password });
  return { token: r.token, user: r.user };
}

async function ensureUser(adminToken, { name, login, password, role, stages = [] }) {
  const users = await api(adminToken, "GET", "/users");
  const existing = users.find((u) => u.login.toLowerCase() === login.toLowerCase());
  if (existing) return existing;
  return api(adminToken, "POST", "/users", { name, login, password, role, stages, active: true });
}

function godmodeNext(entity) {
  return entity?.godmode?.nextAction || entity?.nextAction;
}

async function main() {
  console.log("═".repeat(60));
  console.log(`E2E прохідка · замовлення ${ORDER_NUM}`);
  console.log("═".repeat(60));

  // ── Підготовка користувачів ──
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
  const cuttingOp = (await api(admin.token, "GET", "/users")).find((u) => u.login === "Cutting");

  const manager = await login("e2e_manager", "test123");
  const production = await login("e2e_production", "test123");

  let opSession = null;
  if (cuttingOp) {
    await api(admin.token, "PUT", `/users/${cuttingOp.id}`, {
      password: "test123",
      stages: ["cutting"]
    });
    opSession = await login("Cutting", "test123");
  }
  if (!opSession) {
    await ensureUser(admin.token, {
      name: "Оператор Порізки",
      login: "e2e_cutting",
      password: "test123",
      role: "operator",
      stages: ["cutting"]
    });
    opSession = await login("e2e_cutting", "test123");
  }

  // ═══════════════════════════════════════
  // 1. МЕНЕДЖЕР — вкладка «Замовлення»
  // ═══════════════════════════════════════
  log("МЕНЕДЖЕР", "1. Створення замовлення", `Замовлення → «+ Нове замовлення» → ${ORDER_NUM}`);

  const order = await api(manager.token, "POST", "/orders", {
    orderNumber: ORDER_NUM,
    object: "Квартира вул. Тестова 1",
    client: "Клієнт Тестовий",
    manager: "Тест Менеджер",
    planDate: "15.07.2026",
    priority: "Середній",
    status: "Новий",
    subItems: ["Кухня тест"],
    createRootPosition: false
  });

  const workPos =
    order.workPositions?.[0] || order.positions?.find((p) => p.parentId) || order.positions?.[0];
  if (!workPos?.id) throw new Error("Робочу позицію не створено");
  log(
    "МЕНЕДЖЕР",
    "   Замовлення створено",
    `id=${order.id}, позиція #${workPos.id} «${workPos.item}»`
  );

  log(
    "МЕНЕДЖЕР",
    "2. Заповнення даних позиції",
    "Картка замовлення → вкладка позиції → адреса, дедлайн"
  );

  await api(manager.token, "PUT", `/positions/${workPos.id}/manager-data`, {
    delivery: {
      address: "м. Київ, вул. Тестова 1, кв. 42",
      contactName: "Іван Тест",
      contactPhone: "+380501234567"
    },
    deadlines: { positionDeadline: "10.07.2026" },
    comments: { manager: "E2E тестовий прохід" },
    markComplete: true
  });

  let pos = await api(manager.token, "GET", `/positions/${workPos.id}`);
  let next = godmodeNext(pos);
  log("МЕНЕДЖЕР", "   Дані збережено", `nextAction: ${next?.type} — ${next?.label}`);

  // ═══════════════════════════════════════
  // 2. ГОЛОВНИЙ КОНСТРУКТОР (production)
  // ═══════════════════════════════════════
  log(
    "ГОЛ. КОНСТРУКТОР",
    "3. Призначення конструктора",
    "Вкладка «Конструктори» або CTA «Призначити»"
  );

  await api(production.token, "PUT", `/constructor-desk/positions/${workPos.id}/assign`, {
    constructorName: "Ігор",
    constructorDueAt: "2026-07-05T12:00:00.000Z",
    constructorEstimatedHours: 4,
    assignmentComment: "E2E: призначено головним конструктором"
  });

  pos = await api(production.token, "GET", `/positions/${workPos.id}`);
  next = godmodeNext(pos);
  log(
    "ГОЛ. КОНСТРУКТОР",
    "   Конструктора призначено",
    `nextAction: ${next?.type} — ${next?.label}`
  );

  // ═══════════════════════════════════════
  // 3. КОНСТРУКТОР (менеджер / стіл конструктора)
  // ═══════════════════════════════════════
  log("КОНСТРУКТОР", "4. Завантаження конструктива", "Стіл конструктора → завантажити PDF/B3D");

  const pdfContent = Buffer.from("%PDF-1.4 E2E test constructive\n%%EOF");
  await api(manager.token, "POST", `/positions/${workPos.id}/constructive-file`, {
    fileName: "e2e-kuhnia.pdf",
    mime: "application/pdf",
    dataBase64: pdfContent.toString("base64")
  });

  pos = await api(manager.token, "GET", `/positions/${workPos.id}`);
  next = godmodeNext(pos);
  log(
    "КОНСТРУКТОР",
    "   Файл завантажено",
    `hasConstructive=${pos.hasConstructiveFile}, next: ${next?.type}`
  );

  log(
    "КОНСТРУКТОР",
    "5. ШІ-аналіз конструктива",
    "Позиція → вкладка «Конструктив» → «Запустити ШІ-аналіз»"
  );

  try {
    const ai = await api(manager.token, "POST", `/ai/analyze-constructive/${workPos.id}`, {});
    log(
      "КОНСТРУКТОР",
      "   ШІ-аналіз виконано",
      `summary: ${(ai.summary || ai.recommendations || "").toString().slice(0, 80)}…`
    );
  } catch (err) {
    log("КОНСТРУКТОР", "   ШІ-аналіз пропущено", err.message);
  }

  pos = await api(manager.token, "GET", `/positions/${workPos.id}`);
  next = godmodeNext(pos);
  log("КОНСТРУКТОР", "   Стан після аналізу", `nextAction: ${next?.type} — ${next?.label}`);

  if (next?.type === "create_tasks_from_ai" || next?.type === "create_tasks") {
    log("КОНСТРУКТОР", "6. Створення задач з ШІ", "Обрати етапи → «Створити задачі»");
    await api(manager.token, "POST", `/positions/${workPos.id}/create-tasks`, {
      stages: ["cutting", "edging", "drilling", "assembly"]
    });
    pos = await api(manager.token, "GET", `/positions/${workPos.id}`);
    next = godmodeNext(pos);
    log("КОНСТРУКТОР", "   Задачі створено", `cutting=${pos.cuttingStatus}, next: ${next?.type}`);
  }

  // ═══════════════════════════════════════
  // 4. НАЧАЛЬНИК ВИРОБНИЦТВА
  // ═══════════════════════════════════════
  log("НАЧ. ВИРОБНИЦТВА", "7. Передача на порізку", "CTA «Передати на порізку» або «Цех зараз»");

  pos = await api(production.token, "GET", `/positions/${workPos.id}`);
  next = godmodeNext(pos);

  if (next?.type === "handoff_to_cutting") {
    await api(production.token, "POST", `/positions/${workPos.id}/run-next-action`, {
      actionType: "handoff_to_cutting"
    });
    pos = await api(production.token, "GET", `/positions/${workPos.id}`);
    log("НАЧ. ВИРОБНИЦТВА", "   Передано на порізку", `cuttingStatus=${pos.cuttingStatus}`);
  } else {
    log("НАЧ. ВИРОБНИЦТВА", "   Пропуск handoff", `поточна дія: ${next?.type}`);
    if (pos.cuttingStatus === "Не розпочато") {
      await api(production.token, "PATCH", `/positions/${workPos.id}/stage/cutting`, {
        status: "Передано"
      });
      pos = await api(production.token, "GET", `/positions/${workPos.id}`);
      log(
        "НАЧ. ВИРОБНИЦТВА",
        "   Порізку встановлено вручну",
        `cuttingStatus=${pos.cuttingStatus}`
      );
    }
  }

  // ═══════════════════════════════════════
  // 5. ОПЕРАТОР ЧПУ (порізка)
  // ═══════════════════════════════════════
  log("ОПЕРАТОР ЧПУ", "8. Черга порізки", "operator.html → етап «Порізка»");

  const queue = await api(opSession.token, "GET", "/operator/queue/cutting");
  const inQueue = queue.queue?.some((p) => p.id === workPos.id);
  log("ОПЕРАТОР ЧПУ", "   Позиція в черзі", inQueue ? "ТАК" : "НІ (можливо ще не синхронізовано)");

  log("ОПЕРАТОР ЧПУ", "9. Почати роботу", "Кнопка «Почати» на картці завдання");
  await api(opSession.token, "POST", "/operator/start", {
    userId: opSession.user.id,
    positionId: workPos.id,
    stageKey: "cutting"
  });
  pos = await api(opSession.token, "GET", `/positions/${workPos.id}`);
  log("ОПЕРАТОР ЧПУ", "   В роботі", `cuttingStatus=${pos.cuttingStatus}`);

  log("ОПЕРАТОР ЧПУ", "10. Завершити порізку", "Кнопка «Закінчив»");
  await api(opSession.token, "POST", "/operator/finish", {
    userId: opSession.user.id,
    positionId: workPos.id,
    stageKey: "cutting"
  });
  pos = await api(opSession.token, "GET", `/positions/${workPos.id}`);
  log(
    "ОПЕРАТОР ЧПУ",
    "   Порізка готова",
    `cuttingStatus=${pos.cuttingStatus}, progress=${pos.progress}%`
  );

  // ═══════════════════════════════════════
  // 6. НАЧАЛЬНИК — передача на крайкування
  // ═══════════════════════════════════════
  log("НАЧ. ВИРОБНИЦТВА", "11. Передача на крайкування", "CTA «Передати на крайкування»");
  pos = await api(production.token, "GET", `/positions/${workPos.id}`);
  next = godmodeNext(pos);
  if (next?.type === "handoff_to_edging") {
    await api(production.token, "POST", `/positions/${workPos.id}/run-next-action`, {
      actionType: "handoff_to_edging"
    });
    pos = await api(production.token, "GET", `/positions/${workPos.id}`);
    log("НАЧ. ВИРОБНИЦТВА", "   Передано на крайкування", `edgingStatus=${pos.edgingStatus}`);
  }

  // ── Підсумок ──
  const finalOrder = await api(production.token, "GET", `/orders/${order.id}`);
  const finalPos =
    finalOrder.workPositions?.[0] || finalOrder.positions?.find((p) => p.id === workPos.id);

  console.log("\n" + "═".repeat(60));
  console.log("ПІДСУМОК E2E");
  console.log("═".repeat(60));
  console.log(`Замовлення:  ${ORDER_NUM} (id=${order.id})`);
  console.log(`Позиція:     #${workPos.id} «${workPos.item}»`);
  console.log(`Статус:      ${finalPos?.positionStatus}`);
  console.log(`Прогрес:     ${finalPos?.progress}%`);
  console.log(`Етапи:`);
  console.log(`  Конструктив: ${finalPos?.hasConstructiveFile ? "✓" : "—"}`);
  console.log(`  Порізка:     ${finalPos?.cuttingStatus}`);
  console.log(`  Крайка:      ${finalPos?.edgingStatus}`);
  console.log(`  Присадка:    ${finalPos?.drillingStatus}`);
  console.log(`  Збірка:      ${finalPos?.assemblyStatus}`);
  console.log(`\nВідкрити: http://localhost:3000/ → Замовлення → ${ORDER_NUM}`);
  console.log(`Оператор: http://localhost:3000/operator.html`);
  console.log("═".repeat(60));
}

main().catch((err) => {
  console.error("\n❌ E2E помилка:", err.message);
  process.exit(1);
});

const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || "admin";

export function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export async function apiLogin(request, login, password) {
  const res = await request.post("/api/auth/login", { data: { login, password } });
  const body = await res.json();
  if (!res.ok() || !body?.data?.token) {
    throw new Error(`login failed: ${JSON.stringify(body)}`);
  }
  return { token: body.data.token, user: body.data.user };
}

export async function loginAdmin(request) {
  return apiLogin(request, "admin", adminPassword);
}

export async function createOperatorUser(request, adminToken, login) {
  const res = await request.post("/api/users", {
    headers: authHeaders(adminToken),
    data: {
      name: "E2E Operator",
      login,
      password: "e2e-op-pass",
      role: "operator",
      stages: ["cutting"],
      active: true
    }
  });
  const body = await res.json();
  if (!res.ok()) throw new Error(`create user: ${JSON.stringify(body)}`);
  return body.data ?? body;
}

export async function deleteUser(request, adminToken, userId) {
  if (!userId) return;
  await request.delete(`/api/users/${userId}`, { headers: authHeaders(adminToken) });
}

const MINIMAL_PDF_B64 = Buffer.from("%PDF-1.0\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF").toString(
  "base64"
);

export async function createOrderWithPackage(request, adminToken, orderNumber) {
  const orderRes = await request.post("/api/orders", {
    headers: authHeaders(adminToken),
    data: {
      orderNumber,
      object: "E2E",
      client: "CI",
      manager: "Admin",
      status: "Передано"
    }
  });
  const orderBody = await orderRes.json();
  assertOk(orderRes, orderBody);

  const listRes = await request.get("/api/positions", { headers: authHeaders(adminToken) });
  const listBody = await listRes.json();
  const position = (listBody.data ?? listBody).find(
    (p) => p.orderNumber === orderNumber && !p.parentId
  );
  if (!position?.id) throw new Error("position not found");

  const uploadRes = await request.post(`/api/positions/${position.id}/constructive-packages`, {
    headers: authHeaders(adminToken),
    data: {
      fileName: "spec.pdf",
      dataBase64: MINIMAL_PDF_B64,
      mime: "application/pdf",
      kind: "assembly_pdf"
    }
  });
  const uploadBody = await uploadRes.json();
  assertOk(uploadRes, uploadBody);
  const detail = uploadBody.data ?? uploadBody;
  return {
    orderId: orderBody.data?.id ?? orderBody.id,
    positionId: position.id,
    packageId: detail.package?.id ?? detail.id,
    fileId: detail.files?.[0]?.id
  };
}

function assertOk(res, body) {
  if (res.ok()) return;
  throw new Error(`HTTP ${res.status()}: ${JSON.stringify(body)}`);
}

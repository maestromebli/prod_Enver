export class EnverClient {
  constructor({ baseUrl, token, agentId, version }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.agentId = agentId;
    this.version = version;
  }

  headers() {
    return {
      "Content-Type": "application/json",
      "X-Agent-Token": this.token,
      "X-Agent-Id": this.agentId
    };
  }

  async request(path, options = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: { ...this.headers(), ...options.headers }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data;
  }

  sync(folders) {
    return this.request("/api/folder-agent/sync", {
      method: "POST",
      body: JSON.stringify({ folders })
    });
  }

  heartbeat(rootPath, payload = {}) {
    return this.request("/api/folder-agent/heartbeat", {
      method: "POST",
      body: JSON.stringify({ version: this.version, rootPath, payload })
    });
  }

  getCommands() {
    return this.request("/api/folder-agent/commands");
  }

  ackCommand(id, ok = true, error = "") {
    return this.request(`/api/folder-agent/commands/${id}/ack`, {
      method: "POST",
      body: JSON.stringify({ ok, error })
    });
  }
}

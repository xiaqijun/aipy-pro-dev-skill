// --- Cytoscape init ---
const cy = cytoscape({
  container: document.getElementById("cy-container"),
  style: [
    { selector: "node", style: { "background-color": "#34a853", "label": "data(label)", "color": "#e0e0e0", "font-size": "10px", "text-valign": "bottom", "text-halign": "center", "text-margin-y": 6, "width": 24, "height": 24, "border-width": 2, "border-color": "#1a1d23" } },
    { selector: 'node[type="gateway"]', style: { "background-color": "#e8710a", width: 30, height: 30, "font-size": "11px" } },
    { selector: 'node[type="router"]', style: { "background-color": "#e8710a", width: 36, height: 36, "font-size": "11px", "font-weight": "bold" } },
    { selector: 'node[type="switch"]', style: { "background-color": "#1a73e8", width: 32, height: 32 } },
    { selector: 'node[type="firewall"]', style: { "background-color": "#ea4335", width: 32, height: 32, "shape": "rectangle" } },
    { selector: "edge", style: { "width": 1.5, "line-color": "#555", "target-arrow-color": "#555", "target-arrow-shape": "triangle", "curve-style": "bezier", "label": "data(label)", "font-size": "8px", "color": "#666" } },
    { selector: 'edge[type="l3_route"]', style: { "line-color": "#e8710a", "target-arrow-color": "#e8710a", "width": 2 } },
    { selector: 'edge[type="vlan_boundary"]', style: { "line-color": "#fbbc04", "target-arrow-color": "#fbbc04", "line-style": "dashed", "width": 2 } },
    { selector: 'edge[type="nat_boundary"]', style: { "line-color": "#ea4335", "target-arrow-color": "#ea4335", "line-style": "dashed", "width": 2, "arrow-scale": 1.5 } },
  ],
  layout: { name: "cose", animate: true, nodeRepulsion: () => 8000, idealEdgeLength: () => 120 },
});

// --- Toolbar controls ---
document.getElementById("layout-select").addEventListener("change", e => cy.layout({ name: e.target.value, animate: true }).run());
document.getElementById("btn-fit").addEventListener("click", () => cy.fit(undefined, 50));
document.getElementById("btn-export-png").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = cy.png({ full: true, bg: "#1a1d23" });
  a.download = `topology-${Date.now()}.png`;
  a.click();
});

// --- Detail panel ---
const detailPanel = document.getElementById("detail-panel");
const detailContent = document.getElementById("detail-content");
const detailTitle = document.getElementById("detail-title");
cy.on("tap", "node", evt => {
  const data = evt.target.data();
  detailPanel.classList.remove("hidden");
  detailTitle.textContent = data.label || data.id;
  detailContent.innerHTML = "";
  for (const [label, value] of [
    ["IP", data.id], ["MAC", data.mac || "N/A"], ["角色", `${data.type || "unknown"} (${Math.round((data.roleConfidence || 0) * 100)}%)`],
    ["OS", data.os || "N/A"], ["厂商", data.vendor || "N/A"], ["主机名", data.hostname || "N/A"],
    ["开放端口", (data.ports || []).map(p => p.port + "/" + p.service).join(", ") || "N/A"],
  ]) {
    const row = document.createElement("div"); row.className = "detail-row";
    const lbl = document.createElement("span"); lbl.className = "detail-label"; lbl.textContent = label;
    const val = document.createElement("span"); val.className = "detail-value"; val.textContent = value;
    row.appendChild(lbl); row.appendChild(val);
    detailContent.appendChild(row);
  }
});
cy.on("tap", evt => { if (evt.target === cy) detailPanel.classList.add("hidden"); });
document.getElementById("btn-close-detail").addEventListener("click", () => detailPanel.classList.add("hidden"));

// --- Scan trigger ---
document.getElementById("btn-scan").addEventListener("click", async () => {
  const btn = document.getElementById("btn-scan");
  btn.disabled = true;
  btn.textContent = "扫描中...";
  document.getElementById("scan-status").textContent = "开始扫描...";
  try {
    const subnet = document.getElementById("subnet-input").value.trim() || null;
    const resp = await fetch("/api/scan/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subnet ? { startSubnet: subnet } : {}),
    });
    const { scanId } = await resp.json();
    pollScanProgress(scanId);
  } catch (e) {
    document.getElementById("scan-status").textContent = "启动扫描失败: " + e.message;
    btn.disabled = false;
    btn.textContent = "开始扫描";
  }
});

// --- Poll scan progress ---
function pollScanProgress(scanId) {
  const btn = document.getElementById("btn-scan");
  const statusEl = document.getElementById("scan-status");
  const statsEl = document.getElementById("scan-stats");

  const poll = async () => {
    try {
      const resp = await fetch(`/api/scan/${scanId}/progress`);
      if (!resp.ok) { setTimeout(poll, 1000); return; }
      const state = await resp.json();

      if (state.status === "running") {
        const phase = state.phases.find(p => p.status === "running");
        statusEl.textContent = `扫描中: ${phase?.name || state.phase} (${phase?.done || 0}/${phase?.total || "?"})`;
        statsEl.textContent = `已发现 ${state.intermediate?.hostsFound || 0} 台主机`;
        setTimeout(poll, 1000);
      } else if (state.status === "done") {
        statusEl.textContent = "扫描完成";
        btn.disabled = false;
        btn.textContent = "重新扫描";
        loadTopology(scanId);
      } else if (state.status === "cancelled") {
        statusEl.textContent = "扫描已取消";
        btn.disabled = false;
        btn.textContent = "开始扫描";
      } else if (state.status === "error") {
        statusEl.textContent = "扫描出错: " + (state.error || "unknown");
        btn.disabled = false;
        btn.textContent = "开始扫描";
      } else {
        setTimeout(poll, 1000);
      }
    } catch { setTimeout(poll, 2000); }
  };
  poll();
}

// --- Load topology ---
async function loadTopology(scanId) {
  const poll = async () => {
    try {
      const resp = await fetch(`/api/topology/${scanId}`);
      if (!resp.ok) { setTimeout(poll, 2000); return; }
      renderTopology(await resp.json());
    } catch { setTimeout(poll, 2000); }
  };
  poll();
}

function renderTopology(data) {
  const elements = [];
  for (const node of data.topology.nodes) {
    elements.push({ group: "nodes", data: { id: node.id, label: node.hostname || node.id, type: node.type, mac: node.mac, os: node.os, vendor: node.vendor, hostname: node.hostname, ports: node.ports, subnet: node.subnet, roleConfidence: node.roleConfidence } });
  }
  for (const edge of data.topology.edges) {
    elements.push({ group: "edges", data: { id: `${edge.source}_${edge.target}_${edge.type}`, source: edge.source, target: edge.target, type: edge.type, label: edge.label || "", confidence: edge.confidence } });
  }
  for (const b of (data.boundaries || [])) {
    if (b.type === "vlan" && b.gatewayId) {
      const other = data.topology.nodes.find(n => n.mac === b.gatewayMac && n.id !== b.gatewayId);
      if (other) elements.push({ group: "edges", data: { id: `boundary_${b.gatewayId}_${other.id}`, source: b.gatewayId, target: other.id, type: "vlan_boundary", label: `VLAN ${b.vlanId || ""}` } });
    }
  }
  cy.json({ elements });
  cy.layout({ name: "cose", animate: true }).run();
  cy.fit(undefined, 80);

  const stats = data.statistics || {};
  document.getElementById("scan-status").textContent = "扫描完成";
  document.getElementById("scan-stats").textContent = `${stats.hostsFound} 主机 · ${stats.routers || 0} 路由 · ${stats.switches || 0} 交换 · ${stats.edgesFound} 连接`;
}

// --- Startup: try loading latest scan ---
(async () => {
  try {
    const resp = await fetch("/api/latest-scan");
    if (resp.ok) {
      const { scanId } = await resp.json();
      loadTopology(scanId);
      return;
    }
  } catch {}
  document.getElementById("scan-status").textContent = "就绪 — 点击「开始扫描」";
})();

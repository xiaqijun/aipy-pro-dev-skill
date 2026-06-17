const scanId = new URLSearchParams(location.search).get("scanId");

const cy = cytoscape({
  container: document.getElementById("cy-container"),
  style: [
    {
      selector: "node",
      style: { "background-color": "#34a853", "label": "data(label)", "color": "#e0e0e0", "font-size": "10px", "text-valign": "bottom", "text-halign": "center", "text-margin-y": 6, "width": 24, "height": 24, "border-width": 2, "border-color": "#1a1d23" },
    },
    { selector: 'node[type="gateway"]', style: { "background-color": "#e8710a", width: 32, height: 32, "font-size": "11px" } },
    { selector: 'node[type="switch"]', style: { "background-color": "#1a73e8", width: 28, height: 28 } },
    {
      selector: "edge",
      style: { "width": 1.5, "line-color": "#555", "target-arrow-color": "#555", "target-arrow-shape": "triangle", "curve-style": "bezier", "label": "data(label)", "font-size": "8px", "color": "#666" },
    },
    { selector: 'edge[type="l3_route"]', style: { "line-color": "#e8710a", "target-arrow-color": "#e8710a", "width": 2 } },
  ],
  layout: { name: "cose", animate: true, nodeRepulsion: () => 8000, idealEdgeLength: () => 120 },
});

document.getElementById("layout-select").addEventListener("change", (e) => {
  cy.layout({ name: e.target.value, animate: true }).run();
});
document.getElementById("btn-fit").addEventListener("click", () => cy.fit(undefined, 50));

document.getElementById("btn-export-png").addEventListener("click", () => {
  const dataUrl = cy.png({ full: true, bg: "#1a1d23" });
  const a = document.createElement("a");
  a.href = dataUrl; a.download = `topology-${scanId || "export"}.png`; a.click();
});

const detailPanel = document.getElementById("detail-panel");
const detailContent = document.getElementById("detail-content");
const detailTitle = document.getElementById("detail-title");

cy.on("tap", "node", (evt) => {
  const node = evt.target; const data = node.data();
  detailPanel.classList.remove("hidden");
  detailTitle.textContent = data.label || data.id;
  detailContent.innerHTML = ""; // clear — use textContent for safe data display
  const fields = [
    ["IP", data.id],
    ["MAC", data.mac || "N/A"],
    ["类型", data.type || "unknown"],
    ["OS", data.os || "N/A"],
    ["厂商", data.vendor || "N/A"],
    ["主机名", data.hostname || "N/A"],
    ["开放端口", (data.ports || []).map(p => p.port + "/" + p.service).join(", ") || "N/A"],
  ];
  for (const [label, value] of fields) {
    const row = document.createElement("div");
    row.className = "detail-row";
    const lbl = document.createElement("span");
    lbl.className = "detail-label";
    lbl.textContent = label;
    const val = document.createElement("span");
    val.className = "detail-value";
    val.textContent = value;
    row.appendChild(lbl);
    row.appendChild(val);
    detailContent.appendChild(row);
  }
});

cy.on("tap", (evt) => { if (evt.target === cy) detailPanel.classList.add("hidden"); });
document.getElementById("btn-close-detail").addEventListener("click", () => detailPanel.classList.add("hidden"));

async function loadTopology() {
  if (!scanId) { document.getElementById("scan-status").textContent = "无扫描 ID — 请从 full_scan 启动"; return; }
  document.getElementById("scan-status").textContent = "加载中...";
  const poll = async () => {
    try {
      const resp = await fetch(`/api/topology/${scanId}`);
      if (!resp.ok) { setTimeout(poll, 2000); return; }
      const data = await resp.json();
      renderTopology(data);
    } catch { setTimeout(poll, 2000); }
  };
  poll();
}

function renderTopology(data) {
  const elements = [];
  for (const node of data.topology.nodes) {
    elements.push({ group: "nodes", data: { id: node.id, label: node.hostname || node.id, type: node.type, mac: node.mac, os: node.os, vendor: node.vendor, hostname: node.hostname, ports: node.ports, subnet: node.subnet } });
  }
  for (const edge of data.topology.edges) {
    elements.push({ group: "edges", data: { id: `${edge.source}_${edge.target}_${edge.type}`, source: edge.source, target: edge.target, type: edge.type, label: edge.label || "", confidence: edge.confidence } });
  }
  cy.json({ elements });
  cy.layout({ name: "cose", animate: true }).run();
  cy.fit(undefined, 80);

  const stats = data.statistics || {};
  document.getElementById("scan-status").textContent = "扫描完成";
  document.getElementById("scan-stats").textContent = `${stats.hostsFound} 主机 · ${stats.routers || 0} 路由 · ${stats.switches || 0} 交换 · ${stats.edgesFound} 连接`;
}

loadTopology();

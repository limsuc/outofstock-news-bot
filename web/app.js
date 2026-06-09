const STORAGE_KEY = "outofstock-report-manager-v1";
const divider = "━━━━━━━━━━━━━━";

let store = loadStore();

const $ = (selector) => document.querySelector(selector);
const today = () => new Date().toISOString().slice(0, 10);
const id = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function loadStore() {
  const fallback = {
    partners: [],
    mappings: [],
    prescriptionItems: [],
    stockoutItems: [],
    reports: [],
    settlementMonth: "",
  };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return fallback;
  }
}

function saveStore() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clean(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").trim().replace(/\s+/g, " ");
}

function normalizeProduct(value) {
  return clean(value).normalize("NFKC").toUpperCase().replace(/[^0-9A-Z가-힣]/g, "");
}

function productStem(value) {
  return clean(value)
    .normalize("NFKC")
    .toUpperCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)*\s*(?:MG|ML|G|MCG|UG|IU|%|정|캡슐|T|C|B|관|병|포)?/g, "")
    .replace(/(?:PTP|일반|다회용|일회용|신형|구형|서방|장용)/g, "")
    .replace(/[^A-Z가-힣]/g, "");
}

function getPartner(partnerId) {
  return store.partners.find((partner) => partner.id === partnerId);
}

function getMapping(hospitalName) {
  return store.mappings.find((mapping) => mapping.hospitalName === hospitalName);
}

function getPartnerForHospital(hospitalName) {
  const mapping = getMapping(hospitalName);
  return mapping ? getPartner(mapping.partnerId) : null;
}

function switchView(viewId) {
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.remove("active"));
  $(`#${viewId}`).classList.add("active");
  document.querySelector(`[data-view="${viewId}"]`)?.classList.add("active");
}

function render() {
  const unmapped = getUnmappedHospitals();
  const todayReports = store.reports.filter((report) => report.date === $("#reportDate").value);

  $("#statPartners").textContent = store.partners.length;
  $("#statMappings").textContent = store.mappings.length;
  $("#statItems").textContent = store.prescriptionItems.length;
  $("#statStockouts").textContent = store.stockoutItems.length;
  $("#statUnmapped").textContent = unmapped.length;
  $("#statReports").textContent = todayReports.length;
  $("#todayBadge").textContent = today();
  $("#settlementMonthBadge").textContent = store.settlementMonth ? `최근 정산월 ${store.settlementMonth}` : "업로드 전";

  renderPartnerSelect();
  renderMappings();
  renderItems();
  renderStockouts();
  renderReports();
  renderHistory();
  renderUnmapped();
}

function renderPartnerSelect() {
  const select = $("#partnerSelect");
  const current = select.value;
  select.innerHTML = `<option value="">사업자 선택</option>`;
  for (const partner of store.partners) {
    const option = document.createElement("option");
    option.value = partner.id;
    option.textContent = `${partner.name}${partner.phone ? ` / ${partner.phone}` : ""}`;
    select.appendChild(option);
  }
  select.value = current;
}

function renderMappings() {
  const query = clean($("#masterSearch").value).toLowerCase();
  const rows = store.mappings.filter((mapping) => {
    const partner = getPartner(mapping.partnerId);
    const text = [mapping.hospitalName, mapping.memo, partner?.name, partner?.phone, partner?.contact].join(" ").toLowerCase();
    return !query || text.includes(query);
  });

  $("#mappingTable").innerHTML = rows.length
    ? rows
        .map((mapping) => {
          const partner = getPartner(mapping.partnerId) || {};
          return `
            <tr>
              <td>${escapeHtml(mapping.hospitalName)}</td>
              <td>${escapeHtml(partner.name || "")}</td>
              <td>${escapeHtml(partner.phone || "")}</td>
              <td>${escapeHtml(partner.contact || "")}</td>
              <td>${escapeHtml(mapping.memo || partner.memo || "")}</td>
              <td><button class="ghost-button" data-delete-mapping="${mapping.id}">삭제</button></td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="6">등록된 병의원 연결이 없습니다.</td></tr>`;
}

function renderItems() {
  const query = clean($("#itemSearch").value).toLowerCase();
  const rows = store.prescriptionItems.filter((item) => {
    const partner = getPartnerForHospital(item.hospitalName);
    const text = [item.month, item.hospitalName, item.productName, item.makerName, partner?.name].join(" ").toLowerCase();
    return !query || text.includes(query);
  });

  $("#itemTable").innerHTML = rows.length
    ? rows
        .map((item) => {
          const partner = getPartnerForHospital(item.hospitalName);
          return `
            <tr>
              <td>${escapeHtml(item.month)}</td>
              <td>${escapeHtml(item.hospitalName)}</td>
              <td>${escapeHtml(item.productName)}</td>
              <td>${escapeHtml(item.makerName)}</td>
              <td>${partner ? escapeHtml(partner.name) : '<span class="empty-state">미연결</span>'}</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="5">정산현황을 업로드하면 품목이 표시됩니다.</td></tr>`;
}

function renderStockouts() {
  $("#stockoutTable").innerHTML = store.stockoutItems.length
    ? store.stockoutItems
        .map(
          (item) => `
            <tr>
              <td>${escapeHtml(item.productName)}</td>
              <td>${escapeHtml(item.expectedDate || "-")}</td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="2">품절 PDF를 업로드하거나 수동 입력해 주세요.</td></tr>`;
}

function renderReports() {
  const grid = $("#reportGrid");
  const date = $("#reportDate").value;
  const reports = store.reports.filter((report) => report.date === date);

  if (!reports.length) {
    grid.innerHTML = `<section class="panel empty-state">아직 생성된 리포트가 없습니다. 매칭 실행을 눌러주세요.</section>`;
    return;
  }

  const template = $("#reportCardTemplate");
  grid.innerHTML = "";
  for (const report of reports) {
    const node = template.content.firstElementChild.cloneNode(true);
    if (report.status === "done") node.classList.add("done");
    node.querySelector("h3").textContent = report.partnerName;
    node.querySelector("p").textContent = report.phone ? `연락처 ${report.phone}` : "연락처 없음";
    node.querySelector(".report-count").textContent = `${report.items.length}건`;
    node.querySelector("pre").textContent = report.message;
    node.querySelector(".copy-button").dataset.reportId = report.id;
    node.querySelector(".print-button").dataset.reportId = report.id;
    node.querySelector(".done-button").dataset.reportId = report.id;
    node.querySelector(".done-button").textContent = report.status === "done" ? "발송완료됨" : "발송완료";
    grid.appendChild(node);
  }
}

function renderHistory() {
  const reports = [...store.reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  $("#historyList").innerHTML = reports.length
    ? reports
        .map(
          (report) => `
            <article class="history-item">
              <div class="panel-heading">
                <div>
                  <h3>${escapeHtml(report.date)} / ${escapeHtml(report.partnerName)}</h3>
                  <p class="muted">${report.status === "done" ? "발송완료" : "미발송"} · ${escapeHtml(report.phone || "연락처 없음")}</p>
                </div>
                <span class="badge">${report.items.length}건</span>
              </div>
              <pre>${escapeHtml(report.message)}</pre>
            </article>
          `,
        )
        .join("")
    : `<section class="panel empty-state">저장된 리포트 이력이 없습니다.</section>`;
}

function getUnmappedHospitals() {
  const hospitals = new Set(store.prescriptionItems.map((item) => item.hospitalName));
  return [...hospitals].filter((hospital) => !getMapping(hospital)).sort();
}

function renderUnmapped() {
  const unmapped = getUnmappedHospitals();
  const box = $("#unmappedChips");
  if (!unmapped.length) {
    box.className = "chip-list empty-state";
    box.textContent = store.prescriptionItems.length ? "미연결 병의원이 없습니다." : "정산현황을 업로드하면 표시됩니다.";
    return;
  }
  box.className = "chip-list";
  box.innerHTML = unmapped
    .map((hospital) => `<button class="chip" data-hospital="${escapeHtml(hospital)}">${escapeHtml(hospital)}</button>`)
    .join("");
}

async function readFileText(file) {
  const buffer = await file.arrayBuffer();
  for (const encoding of ["utf-8", "euc-kr"]) {
    try {
      return new TextDecoder(encoding).decode(buffer);
    } catch {
      // Try next encoding.
    }
  }
  return new TextDecoder().decode(buffer);
}

function rowsFromHtml(text) {
  const doc = new DOMParser().parseFromString(text, "text/html");
  return [...doc.querySelectorAll("tr")].map((tr) =>
    [...tr.querySelectorAll("td,th")].map((cell) => clean(cell.textContent)),
  );
}

async function rowsFromWorkbook(file) {
  if (!window.XLSX) {
    throw new Error("엑셀 파서 로딩에 실패했습니다. 인터넷 연결을 확인해 주세요.");
  }
  const buffer = await file.arrayBuffer();
  const workbook = window.XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }).map((row) => row.map(clean));
}

function findHeader(rows) {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.includes("병의원명") && row.includes("제품명")) {
      const headers = Object.fromEntries(row.map((name, pos) => [name, pos]));
      return { index, headers };
    }
  }
  throw new Error("정산현황 파일에서 병의원명/제품명 헤더를 찾지 못했습니다.");
}

function parsePrescriptionRows(rows) {
  const { index, headers } = findHeader(rows);
  const get = (row, name) => clean(row[headers[name]]);
  let month = "";
  const items = [];

  for (const row of rows.slice(index + 1)) {
    const hospitalName = get(row, "병의원명");
    const productName = get(row, "제품명");
    const rowMonth = get(row, "정산월");
    if (rowMonth && !month) month = rowMonth;
    if (!hospitalName || !productName || hospitalName.includes("계")) continue;
    items.push({
      id: id(),
      month: rowMonth || month || today().slice(0, 7),
      hospitalName,
      productName,
      makerName: get(row, "제약사명"),
      insuranceCode: get(row, "보험코드"),
    });
  }
  return { month: month || today().slice(0, 7), items };
}

async function parseSettlementFile(file) {
  const lower = file.name.toLowerCase();
  const rows = lower.endsWith(".xlsx") ? await rowsFromWorkbook(file) : rowsFromHtml(await readFileText(file));
  return parsePrescriptionRows(rows);
}

async function parsePdfStockouts(file) {
  const pdfjsLib = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.min.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.worker.min.mjs";
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const stockouts = [];
  const stopRe = /(기본|기존|추가|프로모션|기간|대상|수수료|요율|전략|지급|신규|매출|처방시)/;

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const text = await page.getTextContent();
    const fragments = text.items
      .map((item) => ({ text: clean(item.str), x: item.transform[4], y: item.transform[5] }))
      .filter((item) => item.text && item.y > 0)
      .sort((a, b) => b.y - a.y || a.x - b.x);

    const rows = [];
    for (const fragment of fragments) {
      const last = rows[rows.length - 1];
      if (!last || Math.abs(last[0].y - fragment.y) > 3) rows.push([fragment]);
      else last.push(fragment);
    }

    let started = false;
    for (const row of rows) {
      const combined = row.map((item) => item.text).join(" ");
      if (combined.includes("제약사명") && (combined.includes("제품명") || combined.includes("출하"))) {
        started = true;
        continue;
      }
      if (!started) continue;
      const productName = row.filter((item) => item.x >= 55 && item.x < 335).map((item) => item.text).join(" ").trim();
      const expectedDate = row.filter((item) => item.x >= 335).map((item) => item.text).join(" ").trim();
      if (!productName) continue;
      if (stopRe.test(`${productName} ${expectedDate}`)) break;
      if (["제품명", "내용", "출하 예정일"].includes(productName)) continue;
      stockouts.push({ id: id(), productName, expectedDate: expectedDate || "-" });
    }
  }
  return dedupeStockouts(stockouts);
}

function dedupeStockouts(items) {
  const map = new Map();
  for (const item of items) {
    const key = normalizeProduct(item.productName);
    if (key && !map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

function parseManualStockouts(text) {
  return dedupeStockouts(
    text
      .split(/\r?\n/)
      .map((line) => clean(line))
      .filter(Boolean)
      .map((line) => {
        const [productName, expectedDate] = line.split("|").map(clean);
        return { id: id(), productName, expectedDate: expectedDate || "-" };
      })
      .filter((item) => item.productName),
  );
}

function findMatches() {
  const stockoutIndex = store.stockoutItems.map((item) => ({
    item,
    full: normalizeProduct(item.productName),
    stem: productStem(item.productName),
  }));
  const matches = [];

  for (const prescription of store.prescriptionItems) {
    const partner = getPartnerForHospital(prescription.hospitalName);
    if (!partner) continue;
    const full = normalizeProduct(prescription.productName);
    const stem = productStem(prescription.productName);
    if (full.length < 4 && stem.length < 4) continue;

    for (const stockout of stockoutIndex) {
      let matchType = "";
      if (full.length >= 4 && stockout.full.includes(full)) matchType = "정확/포함";
      else if (stem.length >= 4 && stockout.stem.includes(stem)) matchType = "제품명 기준";
      if (!matchType) continue;
      matches.push({ prescription, partner, stockout: stockout.item, matchType });
      break;
    }
  }
  return matches;
}

function makeMessage(date, partner, matches) {
  if (!matches.length) {
    return `✅ [${date} / 품절 확인]\n\n${partner.name} 관련 거래처 품목 중\n현재 품절 리스트와 매칭된 품목은 없습니다.`;
  }
  const circled = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
  const lines = [
    `🚨 [${date} / 품절 알림]`,
    "",
    `${partner.name} 관련 품절 매칭 품목: 총 ${matches.length}개`,
    "",
    divider,
  ];
  matches.forEach((match, index) => {
    lines.push(
      `${circled[index] || `${index + 1}.`} ${match.prescription.hospitalName}`,
      `- 품목명: ${match.stockout.productName}`,
      `- 출하예정일: ${match.stockout.expectedDate || "-"}`,
      `- 매칭 기준: ${match.matchType}`,
      "",
    );
  });
  lines.push(divider, "", "거래처별 재고 및 대체 가능 여부 확인 부탁드립니다.");
  return lines.join("\n");
}

function generateReports() {
  const date = $("#reportDate").value || today();
  const matches = findMatches();
  const grouped = new Map();

  for (const partner of store.partners) grouped.set(partner.id, []);
  for (const match of matches) {
    grouped.get(match.partner.id)?.push(match);
  }

  store.reports = store.reports.filter((report) => report.date !== date);
  for (const partner of store.partners) {
    const items = grouped.get(partner.id) || [];
    store.reports.push({
      id: id(),
      date,
      partnerId: partner.id,
      partnerName: partner.name,
      phone: partner.phone,
      status: "ready",
      createdAt: new Date().toISOString(),
      items: items.map((match) => ({
        hospitalName: match.prescription.hospitalName,
        productName: match.stockout.productName,
        expectedDate: match.stockout.expectedDate,
        matchType: match.matchType,
      })),
      message: makeMessage(date, partner, items),
    });
  }
  saveStore();
  render();
  switchView("reports");
}

function printReport(report) {
  const win = window.open("", "_blank", "width=760,height=900");
  win.document.write(`
    <html lang="ko">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(report.partnerName)} 품절 리포트</title>
        <style>
          body { font-family: "Malgun Gothic", Arial, sans-serif; padding: 32px; line-height: 1.6; }
          pre { white-space: pre-wrap; font: inherit; }
        </style>
      </head>
      <body><pre>${escapeHtml(report.message)}</pre></body>
    </html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

document.querySelectorAll(".nav-button").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document.querySelectorAll("[data-view-jump]").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.viewJump));
});

$("#quickGenerateButton").addEventListener("click", generateReports);
$("#generateReportsButton").addEventListener("click", generateReports);
$("#saveButton").addEventListener("click", () => {
  saveStore();
  alert("현재 데이터가 브라우저에 저장되었습니다.");
});
$("#resetDemoButton").addEventListener("click", () => location.reload());
$("#masterSearch").addEventListener("input", renderMappings);
$("#itemSearch").addEventListener("input", renderItems);

$("#partnerForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
  const existing = store.partners.find((partner) => partner.name === clean(payload.name));
  const partner = {
    id: existing?.id || id(),
    name: clean(payload.name),
    phone: clean(payload.phone),
    contact: clean(payload.contact),
    memo: clean(payload.memo),
  };
  store.partners = existing
    ? store.partners.map((item) => (item.id === existing.id ? partner : item))
    : [...store.partners, partner];
  event.currentTarget.reset();
  saveStore();
  render();
});

$("#mappingForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
  const hospitalName = clean(payload.hospitalName);
  const mapping = {
    id: store.mappings.find((item) => item.hospitalName === hospitalName)?.id || id(),
    hospitalName,
    partnerId: payload.partnerId,
    memo: clean(payload.memo),
  };
  store.mappings = store.mappings.filter((item) => item.hospitalName !== hospitalName).concat(mapping);
  event.currentTarget.reset();
  saveStore();
  render();
});

$("#mappingTable").addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete-mapping]");
  if (!button) return;
  store.mappings = store.mappings.filter((mapping) => mapping.id !== button.dataset.deleteMapping);
  saveStore();
  render();
});

$("#unmappedChips").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-hospital]");
  if (!chip) return;
  switchView("master");
  $("#hospitalInput").value = chip.dataset.hospital;
  $("#hospitalInput").focus();
});

$("#settlementForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = $("#settlementFile").files[0];
  if (!file) return alert("정산현황 파일을 선택해 주세요.");
  try {
    const parsed = await parseSettlementFile(file);
    store.settlementMonth = parsed.month;
    store.prescriptionItems = parsed.items;
    saveStore();
    $("#settlementResult").classList.remove("hidden");
    $("#settlementResult").textContent = `${parsed.month} 정산현황 저장 완료: 품목 ${parsed.items.length}개`;
    render();
  } catch (error) {
    alert(error.message);
  }
});

$("#stockoutPdfForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = $("#stockoutPdfFile").files[0];
  if (!file) return alert("품절 PDF를 선택해 주세요.");
  try {
    store.stockoutItems = await parsePdfStockouts(file);
    saveStore();
    render();
    alert(`품절 품목 ${store.stockoutItems.length}개를 추출했습니다.`);
  } catch (error) {
    alert(`PDF 추출 실패: ${error.message}`);
  }
});

$("#manualStockoutButton").addEventListener("click", () => {
  const items = parseManualStockouts($("#manualStockoutText").value);
  if (!items.length) return alert("수동 입력할 품절 품목이 없습니다.");
  store.stockoutItems = items;
  saveStore();
  render();
});

$("#clearStockoutButton").addEventListener("click", () => {
  if (!confirm("현재 품절 목록을 비울까요?")) return;
  store.stockoutItems = [];
  saveStore();
  render();
});

$("#reportGrid").addEventListener("click", async (event) => {
  const copyButton = event.target.closest(".copy-button");
  const printButton = event.target.closest(".print-button");
  const doneButton = event.target.closest(".done-button");
  const reportId = copyButton?.dataset.reportId || printButton?.dataset.reportId || doneButton?.dataset.reportId;
  if (!reportId) return;
  const report = store.reports.find((item) => item.id === reportId);
  if (!report) return;
  if (copyButton) {
    await navigator.clipboard.writeText(report.message);
    copyButton.textContent = "복사완료";
    setTimeout(() => (copyButton.textContent = "복사"), 1200);
  }
  if (printButton) printReport(report);
  if (doneButton) {
    report.status = "done";
    report.sentAt = new Date().toISOString();
    saveStore();
    render();
  }
});

$("#exportButton").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `품절매칭_백업_${today()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
});

$("#importFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  store = JSON.parse(await file.text());
  saveStore();
  render();
});

$("#clearReportsButton").addEventListener("click", () => {
  if (!confirm("리포트 이력을 모두 삭제할까요?")) return;
  store.reports = [];
  saveStore();
  render();
});

$("#reportDate").value = today();
render();

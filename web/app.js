const STORAGE_KEY = "outofstock-master-match-v2";
const divider = "━━━━━━━━━━━━━━";

let store = loadStore();

const $ = (selector) => document.querySelector(selector);
const today = () => new Date().toISOString().slice(0, 10);
const id = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function loadStore() {
  const fallback = {
    masterItems: [],
    stockoutItems: [],
    results: [],
    history: [],
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

function clean(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").trim().replace(/\s+/g, " ");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function extractStrengthTokens(value) {
  const text = clean(value).normalize("NFKC").toUpperCase();
  const tokens = [];
  const strengthRe = /(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)*)\s*(MG|ML|G|MCG|UG|IU|%|정|캡슐|T|C|B|관|병|포)?/g;
  let match;
  while ((match = strengthRe.exec(text))) {
    const number = match[1];
    const unit = match[2] || "";
    tokens.push(unit ? `${number}${unit}` : number);
  }
  return [...new Set(tokens)];
}

function strengthsCompatible(masterName, stockoutName) {
  const masterTokens = extractStrengthTokens(masterName);
  if (!masterTokens.length) return true;

  const stockoutTokens = extractStrengthTokens(stockoutName);
  if (!stockoutTokens.length) return false;

  return masterTokens.every((token) => stockoutTokens.includes(token));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function switchView(viewId) {
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.remove("active"));
  $(`#${viewId}`).classList.add("active");
  document.querySelector(`[data-view="${viewId}"]`)?.classList.add("active");
}

function render() {
  const partners = unique(store.masterItems.map((item) => item.partnerName));
  const hospitals = unique(store.masterItems.map((item) => item.hospitalName));
  const matchCount = store.results.reduce((sum, result) => sum + result.items.length, 0);

  $("#statPartners").textContent = partners.length;
  $("#statMasterItems").textContent = store.masterItems.length;
  $("#statHospitals").textContent = hospitals.length;
  $("#statStockouts").textContent = store.stockoutItems.length;
  $("#statMatches").textContent = matchCount;
  $("#statMatchedPartners").textContent = store.results.length;

  renderMasterTable();
  renderStockoutTable();
  renderResults();
  renderHistory();
  updateWorkflowState();
}

function setStepState(stepId, statusId, text, disabled = false) {
  const card = $(`#${stepId}`);
  const badge = $(`#${statusId}`);
  card?.classList.toggle("locked", disabled);
  card?.classList.toggle("completed", text.includes("완료"));
  if (badge) badge.textContent = text;
}

function updateWorkflowState() {
  const hasMaster = store.masterItems.length > 0;
  const hasStockout = store.stockoutItems.length > 0;
  const hasResults = store.results.length > 0;

  setStepState("stepMaster", "masterStatus", hasMaster ? `${store.masterItems.length}개 완료` : "대기");
  setStepState("stepStockout", "stockoutStatus", hasStockout ? `${store.stockoutItems.length}개 완료` : "마스터 필요", !hasMaster);
  setStepState("stepMatch", "matchStatus", hasResults ? "매칭 완료" : hasMaster && hasStockout ? "실행 가능" : "자료 필요", !(hasMaster && hasStockout));
  setStepState("stepResult", "resultStatus", hasResults ? `${store.results.length}명 완료` : "대기", !hasResults);

  $("#stockoutPdfForm button").disabled = !hasMaster;
  $("#stockoutPdfFile").disabled = !hasMaster;
  $("#runMatchTopButton").disabled = !(hasMaster && hasStockout);
  $("#runMatchButton").disabled = !(hasMaster && hasStockout);
}

function renderMasterTable() {
  const query = clean($("#masterSearch").value).toLowerCase();
  const rows = store.masterItems.filter((item) => {
    const text = [
      item.partnerName,
      item.phone,
      item.hospitalName,
      item.productName,
      item.contactName,
      item.memo,
    ].join(" ").toLowerCase();
    return !query || text.includes(query);
  });

  $("#masterTable").innerHTML = rows.length
    ? rows
        .map(
          (item) => `
            <tr>
              <td>${escapeHtml(item.partnerName)}</td>
              <td>${escapeHtml(item.phone || "")}</td>
              <td>${escapeHtml(item.hospitalName)}</td>
              <td>${escapeHtml(item.productName)}</td>
              <td>${escapeHtml(item.contactName || "")}</td>
              <td>${escapeHtml(item.memo || "")}</td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="6">거래처 마스터 엑셀을 업로드해 주세요.</td></tr>`;
}

function renderStockoutTable() {
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
    : `<tr><td colspan="2">품절 PDF를 업로드하거나 붙여넣기로 입력해 주세요.</td></tr>`;
}

function renderResults() {
  const grid = $("#resultGrid");
  if (!store.results.length) {
    grid.innerHTML = `<section class="panel empty-state">아직 품절 매칭 결과가 없습니다. 마스터와 품절 리스트를 올린 뒤 매칭 실행을 눌러주세요.</section>`;
    return;
  }

  const template = $("#resultCardTemplate");
  grid.innerHTML = "";
  for (const result of store.results) {
    const node = template.content.firstElementChild.cloneNode(true);
    if (result.status === "done") node.classList.add("done");
    node.querySelector("h3").textContent = result.partnerName;
    node.querySelector("p").textContent = result.phone ? `연락처 ${result.phone}` : "연락처 없음";
    node.querySelector(".report-count").textContent = `${result.items.length}건`;
    node.querySelector(".message-preview").innerHTML = messageToHtml(result.message);
    node.querySelector(".copy-button").dataset.resultId = result.id;
    node.querySelector(".print-button").dataset.resultId = result.id;
    node.querySelector(".done-button").dataset.resultId = result.id;
    node.querySelector(".done-button").textContent = result.status === "done" ? "전달완료됨" : "전달완료";
    grid.appendChild(node);
  }
}

function renderHistory() {
  $("#historyList").innerHTML = store.history.length
    ? [...store.history]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(
          (entry) => `
            <article class="history-item">
              <div class="panel-heading">
                <div>
                  <h3>${escapeHtml(entry.date)} / ${escapeHtml(entry.partnerName)}</h3>
                  <p class="muted">${entry.items.length}건 · ${entry.status === "done" ? "전달완료" : "생성됨"}</p>
                </div>
                <span class="badge">${escapeHtml(entry.phone || "연락처 없음")}</span>
              </div>
              <div class="message-preview">${messageToHtml(entry.message)}</div>
            </article>
          `,
        )
        .join("")
    : `<section class="panel empty-state">저장된 매칭 이력이 없습니다.</section>`;
}

async function readFileAsText(file) {
  const buffer = await file.arrayBuffer();
  for (const encoding of ["utf-8", "euc-kr"]) {
    try {
      return new TextDecoder(encoding).decode(buffer);
    } catch {
      // Try next.
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

function rowsFromCsv(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(",").map(clean))
    .filter((row) => row.some(Boolean));
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

function findHeader(rows, requiredHeaders) {
  for (let index = 0; index < rows.length; index += 1) {
    const normalized = rows[index].map(clean);
    const ok = requiredHeaders.every((header) => normalized.includes(header));
    if (ok) return { index, headers: Object.fromEntries(normalized.map((name, pos) => [name, pos])) };
  }
  throw new Error(`필수 컬럼을 찾지 못했습니다: ${requiredHeaders.join(", ")}`);
}

function findHeaderGroups(rows, headerGroups) {
  for (let index = 0; index < rows.length; index += 1) {
    const normalized = rows[index].map(clean);
    const ok = headerGroups.every((group) => group.some((header) => normalized.includes(header)));
    if (ok) return { index, headers: Object.fromEntries(normalized.map((name, pos) => [name, pos])) };
  }
  throw new Error("필수 컬럼을 찾지 못했습니다: 사업자명, 병의원명, 제품명");
}

function getCell(row, headers, names) {
  for (const name of names) {
    const index = headers[name];
    if (index !== undefined && index < row.length) return clean(row[index]);
  }
  return "";
}

async function parseMasterFile(file) {
  const lower = file.name.toLowerCase();
  let rows;
  if (lower.endsWith(".csv")) rows = rowsFromCsv(await readFileAsText(file));
  else if (lower.endsWith(".xlsx")) rows = await rowsFromWorkbook(file);
  else {
    try {
      rows = await rowsFromWorkbook(file);
    } catch {
      rows = rowsFromHtml(await readFileAsText(file));
    }
  }

  const { index, headers } = findHeaderGroups(rows, [
    ["사업자명", "사업자"],
    ["병의원명", "거래처명"],
    ["제품명", "품목", "품목명"],
  ]);
  const items = [];
  const seen = new Set();

  for (const row of rows.slice(index + 1)) {
    const partnerName = getCell(row, headers, ["사업자명", "사업자"]);
    const hospitalName = getCell(row, headers, ["병의원명", "거래처명"]);
    const productName = getCell(row, headers, ["제품명", "품목", "품목명"]);
    if (!partnerName || !hospitalName || !productName) continue;
    const item = {
      id: id(),
      partnerName,
      hospitalName,
      productName,
      phone: getCell(row, headers, ["연락처", "핸드폰", "휴대폰", "전화번호"]),
      contactName: getCell(row, headers, ["담당자명", "담당자"]),
      memo: getCell(row, headers, ["메모", "비고"]),
    };
    const key = [item.partnerName, item.hospitalName, item.productName].map(clean).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  if (!items.length) throw new Error("거래처 마스터에서 유효한 데이터를 찾지 못했습니다.");
  return items;
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

    const groupedRows = [];
    for (const fragment of fragments) {
      const last = groupedRows[groupedRows.length - 1];
      if (!last || Math.abs(last[0].y - fragment.y) > 3) groupedRows.push([fragment]);
      else last.push(fragment);
    }

    let started = false;
    for (const row of groupedRows) {
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

  for (const master of store.masterItems) {
    const full = normalizeProduct(master.productName);
    const stem = productStem(master.productName);
    if (full.length < 4 && stem.length < 4) continue;

    for (const stockout of stockoutIndex) {
      let matchType = "";
      if (full.length >= 4 && stockout.full.includes(full)) matchType = "정확/포함";
      else if (stem.length >= 4 && stockout.stem.includes(stem) && strengthsCompatible(master.productName, stockout.item.productName)) {
        matchType = extractStrengthTokens(master.productName).length ? "제품명+용량 기준" : "제품명 기준";
      }
      if (!matchType) continue;
      matches.push({ master, stockout: stockout.item, matchType });
      break;
    }
  }
  return matches;
}

function buildMessage(date, partnerName, phone, matches) {
  const circled = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
  const lines = [
    "🚨서원파마에서 품절 안내 드립니다. 대표님.",
    "",
    `[${date} / ${partnerName} 품절 알림]`,
    `${partnerName} 관련 품절 품목: 총 ${matches.length}개`,
    "",
    divider,
  ];

  matches.forEach((match, index) => {
    lines.push(
      `${circled[index] || `${index + 1}.`} ${match.master.hospitalName}`,
      `- 품목명: ${match.stockout.productName}`,
      `- 출하예정일: ${match.stockout.expectedDate || "-"}`,
      "",
    );
  });

  lines.push(divider, "", "거래처별 재고 및 대체 가능 여부 확인 부탁드립니다.");
  return lines.join("\n");
}

function messageToHtml(text) {
  return String(text)
    .split("\n")
    .map((line) => {
      const escaped = escapeHtml(line);
      if (/^\[\d{4}-\d{2}-\d{2} \/ .+ 품절 알림\]$/.test(line)) return `<strong>${escaped}</strong>`;
      return escaped || "&nbsp;";
    })
    .join("<br>");
}

function runMatch() {
  if (!store.masterItems.length) {
    alert("먼저 거래처 마스터 엑셀을 업로드해 주세요.");
    return;
  }
  if (!store.stockoutItems.length) {
    alert("품절 PDF를 업로드하거나 품절 리스트를 입력해 주세요.");
    return;
  }

  const date = $("#matchDate").value || today();
  const matches = findMatches();
  const grouped = new Map();

  for (const match of matches) {
    const key = match.master.partnerName;
    if (!grouped.has(key)) {
      grouped.set(key, {
        partnerName: match.master.partnerName,
        phone: match.master.phone,
        matches: [],
      });
    }
    grouped.get(key).matches.push(match);
  }

  store.results = [...grouped.values()]
    .map((group) => ({
      id: id(),
      date,
      partnerName: group.partnerName,
      phone: group.phone,
      status: "ready",
      createdAt: new Date().toISOString(),
      items: group.matches.map((match) => ({
        hospitalName: match.master.hospitalName,
        productName: match.stockout.productName,
        registeredProductName: match.master.productName,
        expectedDate: match.stockout.expectedDate,
        matchType: match.matchType,
      })),
      message: buildMessage(date, group.partnerName, group.phone, group.matches),
    }))
    .sort((a, b) => a.partnerName.localeCompare(b.partnerName, "ko"));

  store.history.push(...store.results.map((result) => ({ ...result })));
  saveStore();
  render();
  switchView("results");
}

function printText(title, text) {
  const win = window.open("", "_blank", "width=760,height=900");
  win.document.write(`
    <html lang="ko">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: "Malgun Gothic", Arial, sans-serif; padding: 32px; line-height: 1.6; }
          .message-preview { white-space: pre-wrap; font: inherit; }
        </style>
      </head>
      <body><div class="message-preview">${messageToHtml(text)}</div></body>
    </html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

async function copyMessage(text) {
  const html = `<div style="white-space: pre-wrap; font-family: Malgun Gothic, Arial, sans-serif; line-height: 1.58;">${messageToHtml(text)}</div>`;
  if (navigator.clipboard?.write && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return;
    } catch {
      // Some browsers or paste targets only accept plain text.
    }
  }
  await navigator.clipboard.writeText(text);
}

function downloadTemplate() {
  const csv = "\ufeff사업자명,연락처,담당자명,병의원명,제품명,메모\n에스팜,010-0000-0000,김대표,수이비인후과,브로나제장용정,\n에스팜,010-0000-0000,김대표,박영준내과,페북트정40mg,\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "거래처마스터_양식.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

document.querySelectorAll(".nav-button").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document.querySelectorAll("[data-view-jump]").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.viewJump));
});

$("#matchDate").value = today();
$("#runMatchTopButton").addEventListener("click", runMatch);
$("#runMatchButton").addEventListener("click", runMatch);
$("#saveButton").addEventListener("click", () => {
  saveStore();
  alert("현재 데이터가 브라우저에 저장되었습니다.");
});
$("#downloadTemplateButton").addEventListener("click", downloadTemplate);
$("#masterSearch").addEventListener("input", renderMasterTable);

$("#masterUploadForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = $("#masterFile").files[0];
  if (!file) return alert("거래처 마스터 엑셀 파일을 선택해 주세요.");
  try {
    const items = await parseMasterFile(file);
    store.masterItems = items;
    store.results = [];
    saveStore();
    $("#masterUploadResult").classList.remove("hidden");
    $("#masterUploadResult").textContent = `거래처 마스터 반영 완료: ${items.length}개 품목`;
    render();
  } catch (error) {
    alert(error.message);
  }
});

async function handlePdfUpload(input) {
  const file = input.files[0];
  if (!file) return alert("품절 PDF 파일을 선택해 주세요.");
  try {
    store.stockoutItems = await parsePdfStockouts(file);
    store.results = [];
    saveStore();
    $("#stockoutUploadResult").classList.remove("hidden");
    $("#stockoutUploadResult").textContent = `품절 리스트 추출 완료: ${store.stockoutItems.length}개`;
    render();
    switchView("dashboard");
  } catch (error) {
    alert(`PDF 추출 실패: ${error.message}`);
  }
}

$("#stockoutPdfForm").addEventListener("submit", (event) => {
  event.preventDefault();
  handlePdfUpload($("#stockoutPdfFile"));
});

$("#stockoutPdfFormSecondary").addEventListener("submit", (event) => {
  event.preventDefault();
  handlePdfUpload($("#stockoutPdfFileSecondary"));
});

$("#manualStockoutButton").addEventListener("click", () => {
  const items = parseManualStockouts($("#manualStockoutText").value);
  if (!items.length) return alert("품절 품목을 입력해 주세요.");
  store.stockoutItems = items;
  store.results = [];
  saveStore();
  render();
  switchView("dashboard");
});

$("#clearStockoutButton").addEventListener("click", () => {
  if (!confirm("현재 품절 리스트를 비울까요?")) return;
  store.stockoutItems = [];
  store.results = [];
  saveStore();
  render();
});

$("#resultGrid").addEventListener("click", async (event) => {
  const copyButton = event.target.closest(".copy-button");
  const printButton = event.target.closest(".print-button");
  const doneButton = event.target.closest(".done-button");
  const resultId = copyButton?.dataset.resultId || printButton?.dataset.resultId || doneButton?.dataset.resultId;
  if (!resultId) return;
  const result = store.results.find((item) => item.id === resultId);
  if (!result) return;
  if (copyButton) {
    await copyMessage(result.message);
    copyButton.textContent = "복사완료";
    setTimeout(() => (copyButton.textContent = "복사"), 1200);
  }
  if (printButton) printText(`${result.partnerName} 품절 리포트`, result.message);
  if (doneButton) {
    result.status = "done";
    const history = store.history.find((entry) => entry.id === result.id);
    if (history) history.status = "done";
    saveStore();
    render();
  }
});

$("#copyAllButton").addEventListener("click", async () => {
  const text = store.results.map((result) => result.message).join("\n\n");
  if (!text) return alert("복사할 매칭 결과가 없습니다.");
  await copyMessage(text);
  alert("전체 결과를 복사했습니다.");
});

$("#printAllButton").addEventListener("click", () => {
  const text = store.results.map((result) => result.message).join("\n\n");
  if (!text) return alert("출력할 매칭 결과가 없습니다.");
  printText("사업자별 품절 매칭 전체 결과", text);
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

$("#clearHistoryButton").addEventListener("click", () => {
  if (!confirm("매칭 이력을 모두 비울까요?")) return;
  store.history = [];
  saveStore();
  render();
});

render();

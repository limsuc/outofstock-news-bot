const STORAGE_KEY = "outofstock-master-match-v2";
const RELEASE_NOTICE_HIDE_UNTIL_KEY = "outofstock-release-notice-hide-until-v1";
const STOCKOUT_DRIVE_FILE_ID = "15dOI-2gYbOLEett8Jfu4OWilAytZdM26";
const STOCKOUT_DRIVE_VIEW_URL = `https://drive.google.com/file/d/${STOCKOUT_DRIVE_FILE_ID}/view?pli=1`;
const STOCKOUT_DRIVE_DOWNLOAD_URL = `https://drive.google.com/uc?export=download&id=${STOCKOUT_DRIVE_FILE_ID}`;
const STOCKOUT_PROXY_PATH = "/api/stockout-pdf";
const LOCAL_STOCKOUT_PROXY_URL = "http://127.0.0.1:8765/api/stockout-pdf";
const divider = "━━━━━━━━━━━━━━";

let store = loadStore();
let resultCategoryFilter = "all";

const $ = (selector) => document.querySelector(selector);
const today = () => new Date().toISOString().slice(0, 10);
const id = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function loadStore() {
  const fallback = {
    masterItems: [],
    rateItems: [],
    stockoutItems: [],
    stockoutWarnings: [],
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

function normalizeCompany(value) {
  return clean(value)
    .normalize("NFKC")
    .toUpperCase()
    .replace(/(?:주식회사|\(주\)|㈜|제약|약품|바이오|팜|PHARM|BIO|CO|LTD|INC)/g, "")
    .replace(/[^0-9A-Z가-힣]/g, "");
}

function productStem(value) {
  return clean(value)
    .normalize("NFKC")
    .toUpperCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)*\s*(?:MG|ML|G|MCG|UG|IU|%|정|캡슐|T|C|B|관|병|포)?/g, "")
    .replace(/(?:PTP|일반|다회용|일회용|신형|구형)/g, "")
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

function formulationCompatible(masterName, noticeName) {
  const master = clean(masterName).normalize("NFKC").toUpperCase();
  const notice = clean(noticeName).normalize("NFKC").toUpperCase();
  return ["서방", "장용"].every((word) => master.includes(word) === notice.includes(word));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function itemCategory(item) {
  return item.category || "품절";
}

function categoryDetailLabel(category) {
  if (category === "정산중단") return "정산중단일";
  if (category === "요율변경") return "적용시점";
  if (category === "프로모션") return "내용";
  return "출하예정일";
}

function itemDetail(item) {
  if (itemCategory(item) === "요율변경") {
    const rate = [item.previousRate, item.nextRate].filter(Boolean).join(" → ");
    return [rate, item.expectedDate].filter(Boolean).join(" / ") || "-";
  }
  if (itemCategory(item) === "프로모션") return item.note || item.expectedDate || "-";
  return item.expectedDate || "-";
}

function noticeDetail(item) {
  if (itemCategory(item) === "프로모션") return item.note || item.expectedDate || "-";
  return item.expectedDate || "-";
}

function companyCompatible(left, right) {
  const a = normalizeCompany(left);
  const b = normalizeCompany(right);
  return a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a));
}

function productCompatible(left, right) {
  const a = normalizeProduct(left);
  const b = normalizeProduct(right);
  const aStem = productStem(left);
  const bStem = productStem(right);
  return (
    (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) ||
    (aStem.length >= 3 && bStem.length >= 3 && (aStem.includes(bStem) || bStem.includes(aStem)))
  );
}

function rateCompanyMatches(item, rateItems = store.rateItems || []) {
  return rateItems.filter(
    (rate) => rate.company && productCompatible(rate.productName, item.productName) && strengthsCompatible(rate.productName, item.productName),
  );
}

function reconcileStockoutCompanies(items, rateItems = store.rateItems || []) {
  if (!rateItems.length) return items;
  return items.map((item) => {
    if (itemCategory(item) === "프로모션" || !item.productName) return item;
    const matches = rateCompanyMatches(item, rateItems);
    const companies = unique(matches.map((match) => match.company));
    if (companies.length !== 1 || (item.company && companyCompatible(item.company, companies[0]))) return item;
    return {
      ...item,
      company: companies[0],
      correctionNote: `요율표 기준 제약사 자동 보정: ${item.company || "빈칸"} → ${companies[0]}`,
    };
  });
}

function validateStockoutItems(items, masterItems = store.masterItems || [], rateItems = store.rateItems || []) {
  const warnings = [];
  items.forEach((item, index) => {
    const category = itemCategory(item);
    const detail = noticeDetail(item);
    const label = `${index + 1}. ${item.company || "제약사 없음"} / ${item.productName || "품목명 없음"}`;
    if (item.correctionNote) warnings.push(`${label}: ${item.correctionNote}`);
    if (!item.company) warnings.push(`${label}: 제약사명이 비어 있습니다.`);
    if (!item.productName || /^(제품명|내용|공지사항|유통현황)$/.test(clean(item.productName))) {
      warnings.push(`${label}: 품목명이 의심됩니다.`);
    }
    if (category === "프로모션" && (!detail || detail === "-")) warnings.push(`${label}: 프로모션 내용이 비어 있습니다.`);
    if (category === "요율변경" && (!item.previousRate || !item.nextRate)) warnings.push(`${label}: 변경 전/후 요율이 비어 있습니다.`);
    if (["품절", "정산중단"].includes(category) && (!detail || detail === "-")) warnings.push(`${label}: 기준일/예정일이 비어 있습니다.`);

    if (/(입고\s*예정|출하\s*예정|정산중단|적용시점|변경\s*후|변경전|\d{1,2}\s*월|\d{1,2}\s*일|미정|예정)/.test(clean(item.productName))) {
      warnings.push(`${label}: 품목명 칸에 날짜/비고 문구가 섞인 것 같습니다. PDF 표 좌우 추출을 확인해 주세요.`);
    }
    if (
      ["품절", "정산중단"].includes(category) &&
      /(정|캡슐|서방|장용|주사|시럽|액|연고|크림|패취|MG|ML|MCG|IU)/i.test(clean(detail)) &&
      !/(월|일|미정|예정|초|중순|말|입고|출하|정산|수수료|%)/.test(clean(detail))
    ) {
      warnings.push(`${label}: 기준일/예정일 칸이 품목명처럼 보입니다. PDF 표 좌우 추출을 확인해 주세요.`);
    }
    if (/\d+\s*(MG|ML|MCG|IU)|서방정|장용정|캡슐|정\s*\d|정$/i.test(clean(item.company))) {
      warnings.push(`${label}: 제약사명 칸이 품목명처럼 보입니다. PDF 표 좌우 추출을 확인해 주세요.`);
    }

    if (item.company && category !== "프로모션") {
      const rateMatches = rateCompanyMatches(item, rateItems);
      const masterMatches = masterItems.filter(
        (master) => master.company && productCompatible(master.productName, item.productName) && strengthsCompatible(master.productName, item.productName),
      );
      const productMatches = rateMatches.length ? rateMatches : masterMatches;
      const expectedCompanies = unique(productMatches.map((master) => master.company));
      if (expectedCompanies.length && !expectedCompanies.some((company) => companyCompatible(company, item.company))) {
        const source = rateMatches.length ? "요율표" : "마스터";
        warnings.push(`${label}: ${source} 기준 품목 제약사는 ${expectedCompanies.slice(0, 3).join(", ")}입니다. PDF 표 좌우 매칭이 틀렸을 수 있습니다.`);
      }
    }
  });
  return warnings;
}

function warningGroups(warnings = store.stockoutWarnings || [], items = store.stockoutItems || []) {
  return warnings.reduce(
    (groups, warning) => {
      const index = Number(String(warning).split(".")[0]) - 1;
      const category = itemCategory(items[index] || {});
      if (category === "프로모션") groups.promotion.push(warning);
      else groups.stockout.push(warning);
      return groups;
    },
    { stockout: [], promotion: [] },
  );
}

function warningSummaryText() {
  const groups = warningGroups();
  return [
    groups.stockout.length ? `품절품목 오류 ${groups.stockout.length}건` : "",
    groups.promotion.length ? `프로모션 오류 ${groups.promotion.length}건` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function switchView(viewId) {
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.remove("active"));
  $(`#${viewId}`).classList.add("active");
  document.querySelector(`[data-view="${viewId}"]`)?.classList.add("active");
}

function hideReleaseNotice() {
  $("#releaseNoticeModal")?.classList.add("hidden");
}

function showReleaseNoticeIfNeeded() {
  const modal = $("#releaseNoticeModal");
  if (!modal) return;
  const hideUntil = Number(localStorage.getItem(RELEASE_NOTICE_HIDE_UNTIL_KEY) || 0);
  if (hideUntil > Date.now()) return;
  modal.classList.remove("hidden");
}

function snoozeReleaseNotice() {
  const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
  localStorage.setItem(RELEASE_NOTICE_HIDE_UNTIL_KEY, String(Date.now() + oneWeekMs));
  hideReleaseNotice();
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
  const hasWarnings = store.stockoutWarnings?.length > 0;
  const warningText = warningSummaryText();

  setStepState("stepMaster", "masterStatus", hasMaster ? `${store.masterItems.length}개 완료` : "대기");
  setStepState("stepStockout", "stockoutStatus", hasWarnings ? warningText : hasStockout ? `${store.stockoutItems.length}개 완료` : "마스터 필요", !hasMaster);
  setStepState("stepMatch", "matchStatus", hasWarnings ? "공지 확인 필요" : hasResults ? "매칭 완료" : hasMaster && hasStockout ? "실행 가능" : "자료 필요", !(hasMaster && hasStockout));
  setStepState("stepResult", "resultStatus", hasResults ? `${store.results.length}명 완료` : "대기", !hasResults);

  document.querySelectorAll("#stockoutPdfForm button, #stockoutPdfFormSecondary button").forEach((button) => {
    button.disabled = !hasMaster;
  });
  $("#stockoutPdfFile").disabled = !hasMaster;
  $("#stockoutPdfFileSecondary").disabled = !hasMaster;
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
  const warningIndexes = new Set((store.stockoutWarnings || []).map((warning) => Number(warning.split(".")[0]) - 1));
  $("#stockoutTable").innerHTML = store.stockoutItems.length
    ? store.stockoutItems
        .map((item, index) => {
          const warning = warningIndexes.has(index);
          return `
            <tr class="${warning ? "warning-row" : ""}">
              <td><span class="category-badge">${escapeHtml(itemCategory(item))}</span></td>
              <td>${escapeHtml(item.company || "-")}</td>
              <td>${escapeHtml(item.productName)}</td>
              <td>${escapeHtml(itemDetail(item))}</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="4">공지 PDF를 업로드하거나 붙여넣기로 입력해 주세요.</td></tr>`;
}

function renderResults() {
  const grid = $("#resultGrid");
  if (!store.results.length) {
    grid.innerHTML = `<section class="panel empty-state">아직 공지 매칭 결과가 없습니다. 마스터와 공지 리스트를 올린 뒤 매칭 실행을 눌러주세요.</section>`;
    renderResultFilterButtons();
    return;
  }

  const template = $("#resultCardTemplate");
  grid.innerHTML = "";
  renderResultFilterButtons();
  if (store.stockoutWarnings?.length) {
    const groups = warningGroups();
    const warningSection = (title, warnings) =>
      warnings.length
        ? `<div class="warning-group">
            <h4>${title} ${warnings.length}건</h4>
            <ul>${warnings.slice(0, 8).map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>
          </div>`
        : "";
    grid.insertAdjacentHTML(
      "beforeend",
      `<section class="panel warning-panel">
        <h3>공지 리스트 확인 필요</h3>
        <p class="muted">매칭 결과는 출력했습니다. 아래 항목만 확인해 주세요.</p>
        ${warningSection("품절품목 오류", groups.stockout)}
        ${warningSection("프로모션 오류", groups.promotion)}
      </section>`,
    );
  }
  for (const result of store.results) {
    const filteredItems = filteredResultItems(result);
    if (!filteredItems.length) continue;
    const node = template.content.firstElementChild.cloneNode(true);
    if (result.status === "done") node.classList.add("done");
    node.querySelector("h3").textContent = result.partnerName;
    node.querySelector("p").textContent = result.phone ? `연락처 ${result.phone}` : "연락처 없음";
    node.querySelector(".report-count").textContent = `${filteredItems.length}건`;
    node.querySelector(".message-preview").innerHTML = messageToHtml(buildResultMessage(result, filteredItems));
    node.querySelector(".partner-copy-button").dataset.resultId = result.id;
    node.querySelector(".phone-copy-button").dataset.resultId = result.id;
    node.querySelector(".copy-button").dataset.resultId = result.id;
    node.querySelector(".image-button").dataset.resultId = result.id;
    node.querySelector(".print-button").dataset.resultId = result.id;
    node.querySelector(".done-button").dataset.resultId = result.id;
    node.querySelector(".done-button").textContent = result.status === "done" ? "전달완료됨" : "전달완료";
    grid.appendChild(node);
  }
  if (!grid.children.length) {
    const label = resultFilterLabel();
    grid.innerHTML = `<section class="panel empty-state">${label}가 없습니다.</section>`;
  }
}

function renderResultFilterButtons() {
  document.querySelectorAll("[data-result-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.resultFilter === resultCategoryFilter);
  });
}

function filteredResultItems(result) {
  if (resultCategoryFilter === "all") return result.items;
  if (resultCategoryFilter === "정산요율") {
    return result.items.filter((item) => ["정산중단", "요율변경"].includes(itemCategory(item)));
  }
  return result.items.filter((item) => itemCategory(item) === resultCategoryFilter);
}

function resultFilterLabel() {
  if (resultCategoryFilter === "all") return "매칭 결과";
  if (resultCategoryFilter === "정산요율") return "정산중단/요율변경 매칭 결과";
  return `${resultCategoryFilter} 매칭 결과`;
}

function categoriesForResultMessage(items) {
  const categories = ["품절", "정산중단", "요율변경", "프로모션"];
  return categories.filter((category) => items.some((item) => itemCategory(item) === category));
}

function resultMessageIntro(categories) {
  if (categories.length === 1) {
    if (categories[0] === "품절") return "🚨서원파마에서 품절 안내 드립니다. 대표님.";
    if (categories[0] === "프로모션") return "🚨서원파마에서 프로모션 안내 드립니다. 대표님.";
    if (categories[0] === "정산중단") return "🚨서원파마에서 정산중단 안내 드립니다. 대표님.";
    if (categories[0] === "요율변경") return "🚨서원파마에서 요율변경 안내 드립니다. 대표님.";
  }
  if (categories.length && categories.every((category) => ["정산중단", "요율변경"].includes(category))) {
    return "🚨서원파마에서 정산중단/요율변경 안내 드립니다. 대표님.";
  }
  return "🚨서원파마에서 품절/정산중단/요율변경/프로모션 안내 드립니다. 대표님.";
}

function buildResultMessage(result, items = filteredResultItems(result)) {
  const circled = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
  const categories = categoriesForResultMessage(items);
  const categoryCounts = categories.map((category) => `${category} ${items.filter((item) => itemCategory(item) === category).length}개`).join(", ");
  const lines = [
    resultMessageIntro(categories),
    "",
    `[${result.date} / ${result.partnerName} 공지 알림]`,
    `${result.partnerName} 관련 공지 품목: 총 ${items.length}개${categoryCounts ? ` (${categoryCounts})` : ""}`,
    "",
    divider,
  ];

  for (const category of categories) {
    const categoryItems = items.filter((item) => itemCategory(item) === category);
    lines.push(`[${category}]`);
    if (category === "프로모션") {
      const groups = new Map();
      for (const item of categoryItems) {
        const label = `${item.company || "해당 제약사"} 프로모션`;
        const key = [item.company, label].map(clean).join("|");
        if (!groups.has(key)) groups.set(key, { company: item.company, label, items: [] });
        groups.get(key).items.push(item);
      }
      [...groups.values()].forEach((group, index) => {
        lines.push(
          `${circled[index] || `${index + 1}.`} ${group.label || `${group.company || "해당 제약사"} 프로모션`}`,
          `- 제약사명: ${group.company || "-"}`,
          "- 프로모션 품목:",
        );
        group.items.forEach((item, itemIndex) => {
          lines.push(`  ${itemIndex + 1}. ${item.productName} - ${noticeDetail(item)}`);
        });
        lines.push("");
      });
      continue;
    }
    categoryItems.forEach((item, index) => {
      lines.push(
        `${circled[index] || `${index + 1}.`} ${item.hospitalName}`,
        `- 제약사명: ${item.company || "-"}`,
        `- 품목명: ${item.productName}`,
      );
      if (category === "요율변경") {
        lines.push(`- 변경요율: ${item.previousRate || "-"} → ${item.nextRate || "-"}`);
      }
      lines.push(`- ${categoryDetailLabel(category)}: ${noticeDetail(item)}`);
      if (item.note && item.note !== item.expectedDate) lines.push(`- 비고: ${item.note}`);
      lines.push("");
    });
  }

  lines.push(divider, "", "거래처별 품목 확인 부탁드립니다.");
  return lines.join("\n");
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

async function rowsFromWorkbook(file, preferredSheetNames = []) {
  if (!window.XLSX) {
    throw new Error("엑셀 파서 로딩에 실패했습니다. 인터넷 연결을 확인해 주세요.");
  }
  const buffer = await file.arrayBuffer();
  const workbook = window.XLSX.read(buffer, { type: "array" });
  const preferred = workbook.SheetNames.find((name) => preferredSheetNames.some((keyword) => name.includes(keyword)));
  const sheet = workbook.Sheets[preferred || workbook.SheetNames[0]];
  return window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }).map((row) => row.map(clean));
}

async function workbookSheets(file) {
  if (!window.XLSX) {
    throw new Error("엑셀 파서 로딩에 실패했습니다. 인터넷 연결을 확인해 주세요.");
  }
  const buffer = await file.arrayBuffer();
  const workbook = window.XLSX.read(buffer, { type: "array" });
  return workbook.SheetNames.map((name) => ({
    name,
    rows: window.XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: false }).map((row) => row.map(clean)),
  }));
}

function findHeader(rows, requiredHeaders) {
  for (let index = 0; index < rows.length; index += 1) {
    const normalized = rows[index].map(clean);
    const ok = requiredHeaders.every((header) => normalized.includes(header));
    if (ok) return { index, headers: Object.fromEntries(normalized.map((name, pos) => [name, pos])) };
  }
  throw new Error(`필수 컬럼을 찾지 못했습니다: ${requiredHeaders.join(", ")}`);
}

function findHeaderGroups(rows, headerGroups, errorMessage = "필수 컬럼을 찾지 못했습니다: 사업자명, 병의원명, 제품명") {
  for (let index = 0; index < rows.length; index += 1) {
    const normalized = rows[index].map(clean);
    const ok = headerGroups.every((group) => group.some((header) => normalized.includes(header)));
    if (ok) return { index, headers: Object.fromEntries(normalized.map((name, pos) => [name, pos])) };
  }
  throw new Error(errorMessage);
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
      company: getCell(row, headers, ["제약사명", "제약사", "회사명", "업체명", "메이커", "제조사"]),
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

async function parseRateFile(file) {
  const lower = file.name.toLowerCase();
  let rows;
  if (lower.endsWith(".csv")) rows = rowsFromCsv(await readFileAsText(file));
  else if (lower.endsWith(".xlsx")) {
    const sheets = await workbookSheets(file);
    const matched = sheets
      .map((sheet) => {
        try {
          return {
            ...sheet,
            header: findHeaderGroups(sheet.rows, [
              ["제약회사", "제약사명", "제약사", "회사명"],
              ["제품명", "품목명", "품목"],
            ]),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => (b.name.includes("수수료") ? 1 : 0) - (a.name.includes("수수료") ? 1 : 0))[0];
    if (!matched) throw new Error("요율표에서 필수 컬럼을 찾지 못했습니다: 제약회사, 제품명");
    rows = matched.rows;
  }
  else {
    try {
      const sheets = await workbookSheets(file);
      const matched = sheets.find((sheet) => {
        try {
          findHeaderGroups(sheet.rows, [
            ["제약회사", "제약사명", "제약사", "회사명"],
            ["제품명", "품목명", "품목"],
          ]);
          return true;
        } catch {
          return false;
        }
      });
      rows = matched?.rows || (await rowsFromWorkbook(file, ["수수료", "요율"]));
    } catch {
      rows = rowsFromHtml(await readFileAsText(file));
    }
  }

  const { index, headers } = findHeaderGroups(rows, [
    ["제약회사", "제약사명", "제약사", "회사명"],
    ["제품명", "품목명", "품목"],
  ], "요율표에서 필수 컬럼을 찾지 못했습니다: 제약회사, 제품명");
  const items = [];
  const seen = new Set();

  for (const row of rows.slice(index + 1)) {
    const company = getCell(row, headers, ["제약회사", "제약사명", "제약사", "회사명"]);
    const productName = getCell(row, headers, ["제품명", "품목명", "품목"]);
    if (!company || !productName) continue;
    const key = [company, productName].map(clean).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ company, productName });
  }
  if (!items.length) throw new Error("요율표에서 제약회사와 제품명 데이터를 찾지 못했습니다.");
  return items;
}

async function parsePdfStockouts(file) {
  const pdfjsLib = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.min.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.worker.min.mjs";
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pageFragments = [];

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const text = await page.getTextContent();
    pageFragments.push(
      text.items.map((item) => ({
        text: clean(item.str),
        x: item.transform[4],
        y: item.transform[5],
      })),
    );
  }

  if (!window.StockoutPdfParser) throw new Error("PDF 형식 분석기를 불러오지 못했습니다.");
  const parsed = window.StockoutPdfParser.parsePages(pageFragments);
  const items = dedupeStockouts(parsed.items.map((item) => ({ id: id(), ...item })));
  if (!items.length) throw new Error("품절 품목을 찾지 못했습니다. PDF 형식을 확인해 주세요.");
  return { items, layoutLabel: parsed.layoutLabel };
}

function dedupeStockouts(items) {
  const map = new Map();
  for (const item of items) {
    const key = `${itemCategory(item)}|${normalizeProduct(item.productName)}`;
    if (!key || !item.productName) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
      continue;
    }

    const merged = {
      ...existing,
      company: existing.company || item.company || "",
      expectedDate: noticeDetail(existing) === "-" ? noticeDetail(item) : existing.expectedDate,
      note: existing.note || item.note || "",
      previousRate: existing.previousRate || item.previousRate || "",
      nextRate: existing.nextRate || item.nextRate || "",
    };
    if (itemCategory(item) === "프로모션") merged.expectedDate = merged.note || item.note || item.expectedDate || merged.expectedDate || "-";
    map.set(key, merged);
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
        const parts = line.split("|").map(clean);
        if (parts.length >= 4) {
          const [category, company, productName, expectedDate] = parts;
          return { id: id(), category: category || "품절", company, productName, expectedDate: expectedDate || "-" };
        }
        if (parts.length >= 3) {
          const [company, productName, expectedDate] = parts;
          return { id: id(), category: "품절", company, productName, expectedDate: expectedDate || "-" };
        }
        const [productName, expectedDate] = parts;
        return { id: id(), category: "품절", company: "", productName, expectedDate: expectedDate || "-" };
      })
      .filter((item) => item.productName),
  );
}

function findMatches() {
  const stockoutIndex = store.stockoutItems.map((item) => ({
    item,
    full: normalizeProduct(item.productName),
    stem: productStem(item.productName),
    company: normalizeCompany(item.company),
  }));
  const promotionItems = stockoutIndex.filter((stockout) => itemCategory(stockout.item) === "프로모션" && stockout.company.length >= 2);
  const matches = [];
  const masterByPartner = new Map();

  for (const master of store.masterItems) {
    if (!masterByPartner.has(master.partnerName)) masterByPartner.set(master.partnerName, []);
    masterByPartner.get(master.partnerName).push(master);
  }

  for (const [partnerName, masters] of masterByPartner) {
    const partnerCompanies = new Map();
    for (const master of masters) {
      const company = normalizeCompany(master.company);
      if (company.length >= 2 && !partnerCompanies.has(company)) partnerCompanies.set(company, master);
    }

    for (const stockout of promotionItems) {
      const matchedCompany = [...partnerCompanies.keys()].find(
        (company) => stockout.company.includes(company) || company.includes(stockout.company),
      );
      if (!matchedCompany) continue;
      matches.push({
        master: partnerCompanies.get(matchedCompany) || masters[0],
        stockout: stockout.item,
        matchType: "제약사 기준",
        hospitalNames: [],
      });
    }

    if (partnerCompanies.size) continue;

    const seenProductPromoKeys = new Set();
    for (const master of masters) {
      const full = normalizeProduct(master.productName);
      const stem = productStem(master.productName);
      if (full.length < 4 && stem.length < 4) continue;

      for (const stockout of promotionItems) {
        let matchType = "";
        if (full.length >= 4 && stockout.full.includes(full)) matchType = "정확/포함";
        else if (
          stem.length >= 4 &&
          stockout.stem.includes(stem) &&
          formulationCompatible(master.productName, stockout.item.productName) &&
          strengthsCompatible(master.productName, stockout.item.productName)
        ) {
          matchType = extractStrengthTokens(master.productName).length ? "제품명+용량 기준" : "제품명 기준";
        }
        if (!matchType) continue;
        const key = [partnerName, stockout.item.company, stockout.item.productName].map(clean).join("|");
        if (seenProductPromoKeys.has(key)) continue;
        seenProductPromoKeys.add(key);
        matches.push({ master, stockout: stockout.item, matchType, hospitalNames: [master.hospitalName] });
      }
    }
  }

  for (const master of store.masterItems) {
    const full = normalizeProduct(master.productName);
    const stem = productStem(master.productName);
    if (full.length < 4 && stem.length < 4) continue;

    for (const stockout of stockoutIndex) {
      let matchType = "";
      const category = itemCategory(stockout.item);
      if (category === "프로모션") continue;
      if (full.length >= 4 && stockout.full.includes(full)) matchType = "정확/포함";
      else if (
        stem.length >= 4 &&
        stockout.stem.includes(stem) &&
        formulationCompatible(master.productName, stockout.item.productName) &&
        strengthsCompatible(master.productName, stockout.item.productName)
      ) {
        matchType = extractStrengthTokens(master.productName).length ? "제품명+용량 기준" : "제품명 기준";
      }
      if (!matchType) continue;
      matches.push({ master, stockout: stockout.item, matchType, hospitalNames: [master.hospitalName] });
      break;
    }
  }
  return matches;
}

function matchHospitalLabel(match) {
  const names = unique(match.hospitalNames || [match.master.hospitalName]);
  if (names.length <= 1) return names[0] || match.master.hospitalName;
  return `${names[0]} 외 ${names.length - 1}곳`;
}

function matchDisplayLabel(match) {
  if (itemCategory(match.stockout) === "프로모션") {
    return `${match.stockout.company || "해당 제약사"} 프로모션`;
  }
  return matchHospitalLabel(match);
}

function buildMessage(date, partnerName, phone, matches) {
  const circled = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
  const categories = ["품절", "정산중단", "요율변경", "프로모션"];
  const categoryCounts = categories
    .map((category) => {
      const count = matches.filter((match) => itemCategory(match.stockout) === category).length;
      return count ? `${category} ${count}개` : "";
    })
    .filter(Boolean)
    .join(", ");
  const lines = [
    "🚨서원파마에서 품절/정산중단/요율변경/프로모션 안내 드립니다. 대표님.",
    "",
    `[${date} / ${partnerName} 공지 알림]`,
    `${partnerName} 관련 공지 품목: 총 ${matches.length}개${categoryCounts ? ` (${categoryCounts})` : ""}`,
    "",
    divider,
  ];

  for (const category of categories) {
    const categoryMatches = matches.filter((match) => itemCategory(match.stockout) === category);
    if (!categoryMatches.length) continue;
    lines.push(`[${category}]`);
    if (category === "프로모션") {
      const groups = new Map();
      for (const match of categoryMatches) {
        const label = matchDisplayLabel(match);
        const company = match.stockout.company || "";
        const key = [company, label].map(clean).join("|");
        if (!groups.has(key)) groups.set(key, { company, label, matches: [] });
        groups.get(key).matches.push(match);
      }
      [...groups.values()].forEach((group, index) => {
        lines.push(
          `${circled[index] || `${index + 1}.`} ${group.label || `${group.company || "해당 제약사"} 프로모션`}`,
          `- 제약사명: ${group.company || "-"}`,
          "- 프로모션 품목:",
        );
        group.matches.forEach((match, matchIndex) => {
          lines.push(`  ${matchIndex + 1}. ${match.stockout.productName} - ${noticeDetail(match.stockout)}`);
        });
        lines.push("");
      });
      continue;
    }
    categoryMatches.forEach((match, index) => {
      lines.push(
        `${circled[index] || `${index + 1}.`} ${matchDisplayLabel(match)}`,
        `- 제약사명: ${match.stockout.company || "-"}`,
        `- 품목명: ${match.stockout.productName}`,
      );
      if (category === "요율변경") {
        lines.push(`- 변경요율: ${match.stockout.previousRate || "-"} → ${match.stockout.nextRate || "-"}`);
      }
      lines.push(`- ${categoryDetailLabel(category)}: ${noticeDetail(match.stockout)}`);
      if (match.stockout.note && match.stockout.note !== match.stockout.expectedDate) lines.push(`- 비고: ${match.stockout.note}`);
      lines.push("");
    });
  }

  lines.push(divider, "", "거래처별 품목 확인 부탁드립니다.");
  return lines.join("\n");
}

function messageToHtml(text) {
  return String(text)
    .split("\n")
    .map((line) => {
      const escaped = escapeHtml(line);
      if (/^\[\d{4}-\d{2}-\d{2} \/ .+ (품절|공지) 알림\]$/.test(line) || /^\[(품절|정산중단|요율변경|프로모션)\]$/.test(line)) {
        return `<strong>${escaped}</strong>`;
      }
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
    alert("공지 PDF를 업로드하거나 공지 리스트를 입력해 주세요.");
    return;
  }

  store.stockoutItems = reconcileStockoutCompanies(store.stockoutItems, store.rateItems);
  store.stockoutWarnings = validateStockoutItems(store.stockoutItems, store.masterItems, store.rateItems);
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
        hospitalName: matchDisplayLabel(match),
        company: match.stockout.company || "",
        productName: match.stockout.productName,
        registeredProductName: match.master.productName,
        expectedDate: match.stockout.expectedDate,
        category: itemCategory(match.stockout),
        previousRate: match.stockout.previousRate || "",
        nextRate: match.stockout.nextRate || "",
        note: match.stockout.note || "",
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

function loadPromotionSampleData() {
  const hasData = store.masterItems.length || store.stockoutItems.length || store.results.length;
  if (hasData && !confirm("현재 로컬 데이터를 예시 데이터로 바꿔서 테스트할까요? 필요하면 먼저 백업 다운로드를 해주세요.")) return;

  store.masterItems = [
    {
      id: id(),
      partnerName: "서원테스트약국",
      phone: "010-0000-0000",
      contactName: "테스트대표",
      hospitalName: "일산마두정형외과",
      productName: "기존처방품목A",
      company: "테라젠이텍스",
      memo: "제약사 기준 프로모션 확인",
    },
    {
      id: id(),
      partnerName: "서원테스트약국",
      phone: "010-0000-0000",
      contactName: "테스트대표",
      hospitalName: "편한허리신경외과의원",
      productName: "기존처방품목B",
      company: "테라젠이텍스",
      memo: "병의원 관계없이 사업자 제약사 기준 공지",
    },
    {
      id: id(),
      partnerName: "기존방식테스트",
      phone: "010-1111-1111",
      contactName: "테스트담당",
      hospitalName: "제품명매칭의원",
      productName: "아클펜정",
      company: "",
      memo: "제약사명 없는 기존 마스터",
    },
  ];
  store.stockoutItems = [
    {
      id: id(),
      category: "프로모션",
      company: "테라젠이텍스",
      productName: "아클펜정",
      expectedDate: "신규 병의원 대상 처방 시 프로모션 적용",
      note: "신규 병의원 대상 처방 시 프로모션 적용",
    },
    {
      id: id(),
      category: "프로모션",
      company: "테라젠이텍스",
      productName: "넥스온정 20mg, 40mg",
      expectedDate: "월 매출 기준 프로모션 적용",
      note: "월 매출 기준 프로모션 적용",
    },
    {
      id: id(),
      category: "품절",
      company: "테라젠이텍스",
      productName: "아클펜정",
      expectedDate: "미정",
      note: "",
    },
  ];
  store.results = [];
  store.history = [];
  resultCategoryFilter = "프로모션";
  saveStore();
  render();
  runMatch();
  alert("프로모션 예시 데이터를 넣고 매칭을 실행했습니다. 프로모션만 결과를 확인해 주세요.");
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

function canvasTextLines(ctx, text, maxWidth) {
  if (!text) return [""];
  const chars = Array.from(text);
  const lines = [];
  let line = "";
  for (const char of chars) {
    const next = `${line}${char}`;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = char;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function resultImageBlob(result, text = result.message) {
  if (document.fonts?.ready) await document.fonts.ready;

  const width = 900;
  const scale = 2;
  const padding = 44;
  const lineHeight = 31;
  const contentWidth = width - padding * 2;
  const fontFamily = '"Malgun Gothic", "Segoe UI", Arial, sans-serif';
  const headerRe = /^\[\d{4}-\d{2}-\d{2} \/ .+ (품절|공지) 알림\]$/;
  const categoryRe = /^\[(품절|정산중단|요율변경|프로모션)\]$/;

  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  const rows = [];

  for (const rawLine of text.split("\n")) {
    if (!rawLine) {
      rows.push({ type: "space", height: 15 });
      continue;
    }
    if (rawLine.includes("━")) {
      rows.push({ type: "divider", height: 24 });
      continue;
    }
    const bold = headerRe.test(rawLine) || categoryRe.test(rawLine) || rawLine.startsWith("🚨");
    measureCtx.font = `${bold ? "700" : "400"} 23px ${fontFamily}`;
    for (const line of canvasTextLines(measureCtx, rawLine, contentWidth)) {
      rows.push({ type: "text", text: line, bold, height: lineHeight });
    }
  }

  const height = Math.max(360, padding * 2 + 18 + rows.reduce((sum, row) => sum + row.height, 0));
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#176b87";
  ctx.fillRect(0, 0, width, 12);
  ctx.strokeStyle = "#dbe2ea";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);

  let y = padding + 8;
  for (const row of rows) {
    if (row.type === "space") {
      y += row.height;
      continue;
    }
    if (row.type === "divider") {
      ctx.strokeStyle = "#cfd8e3";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(padding, y + 10);
      ctx.lineTo(width - padding, y + 10);
      ctx.stroke();
      y += row.height;
      continue;
    }
    ctx.font = `${row.bold ? "700" : "400"} 23px ${fontFamily}`;
    ctx.fillStyle = row.bold ? "#102938" : "#1f2933";
    ctx.fillText(row.text, padding, y + 24);
    y += row.height;
  }

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.96));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function copyResultImage(result) {
  const blob = await resultImageBlob(result, buildResultMessage(result));
  if (!blob) throw new Error("PNG 이미지를 만들 수 없습니다.");
  const filename = `${result.partnerName}_공지알림_${result.date}.png`.replace(/[\\/:*?"<>|]/g, "_");

  if (navigator.clipboard?.write && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      return "copied";
    } catch {
      // Fall back to a PNG download when image clipboard is blocked.
    }
  }

  downloadBlob(blob, filename);
  return "downloaded";
}

function downloadTemplate() {
  const csv = "\ufeff사업자명,연락처,담당자명,병의원명,제품명,제약사명,메모\n에스팜,010-0000-0000,김대표,수이비인후과,브로나제장용정,마더스제약,\n에스팜,010-0000-0000,김대표,박영준내과,페북트정40mg,경보제약,\n";
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

document.querySelectorAll("[data-result-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    resultCategoryFilter = button.dataset.resultFilter;
    renderResults();
  });
});

$("#matchDate").value = today();
$("#releaseNoticeCloseIcon")?.addEventListener("click", hideReleaseNotice);
$("#releaseNoticeCloseButton")?.addEventListener("click", hideReleaseNotice);
$("#releaseNoticeSnoozeButton")?.addEventListener("click", snoozeReleaseNotice);
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
    store.stockoutWarnings = validateStockoutItems(store.stockoutItems, store.masterItems, store.rateItems);
    store.results = [];
    saveStore();
    $("#masterUploadResult").classList.remove("hidden");
    $("#masterUploadResult").textContent = `거래처 마스터 반영 완료: ${items.length}개 품목`;
    render();
  } catch (error) {
    alert(error.message);
  }
});

$("#rateUploadForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = $("#rateFile").files[0];
  if (!file) return alert("요율표 엑셀 파일을 선택해 주세요.");
  try {
    const items = await parseRateFile(file);
    store.rateItems = items;
    store.stockoutItems = reconcileStockoutCompanies(store.stockoutItems, store.rateItems);
    store.stockoutWarnings = validateStockoutItems(store.stockoutItems, store.masterItems, store.rateItems);
    store.results = [];
    saveStore();
    $("#rateUploadResult").classList.remove("hidden");
    $("#rateUploadResult").textContent = `요율표 반영 완료: ${items.length}개 품목 · 제약사-품목 오류 검사 강화`;
    render();
  } catch (error) {
    alert(error.message);
  }
});

async function handlePdfUpload(input) {
  const file = input.files[0];
  if (!file) return alert("공지 PDF 파일을 선택해 주세요.");
  try {
    const parsed = await parsePdfStockouts(file);
    applyParsedStockouts(parsed);
  } catch (error) {
    alert(`PDF 추출 실패: ${error.message}`);
  }
}

function applyParsedStockouts(parsed) {
  store.stockoutItems = reconcileStockoutCompanies(parsed.items, store.rateItems);
  store.stockoutWarnings = validateStockoutItems(store.stockoutItems, store.masterItems, store.rateItems);
  store.results = [];
  saveStore();
  $("#stockoutUploadResult").classList.remove("hidden");
  $("#stockoutUploadResult").textContent = store.stockoutWarnings.length
    ? `공지 리스트 추출 완료: ${store.stockoutItems.length}개 · ${parsed.layoutLabel} · ${warningSummaryText()}`
    : `공지 리스트 추출 완료: ${store.stockoutItems.length}개 · ${parsed.layoutLabel}`;
  if (store.stockoutWarnings.length) {
    const groups = warningGroups();
    const lines = [
      groups.stockout.length ? `[품절품목 오류]\n${groups.stockout.slice(0, 5).join("\n")}` : "",
      groups.promotion.length ? `[프로모션 오류]\n${groups.promotion.slice(0, 5).join("\n")}` : "",
    ].filter(Boolean);
    alert(`PDF 추출 결과에 확인이 필요한 항목이 있습니다.\n확인을 눌러도 오류 내용은 매칭결과에서 확인할 수 있습니다.\n\n${lines.join("\n\n")}`);
  }
  render();
  switchView("dashboard");
}

async function loadStockoutPdfFromDrive(button) {
  if (!store.masterItems.length) {
    alert("먼저 거래처 마스터 엑셀을 업로드해 주세요.");
    return;
  }
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "불러오는 중";
  try {
    const blob = await fetchStockoutPdfBlob();
    if (!blob.size) throw new Error("빈 파일입니다.");
    const file = new File([blob], "서원파마_품절리스트.pdf", { type: "application/pdf" });
    const parsed = await parsePdfStockouts(file);
    applyParsedStockouts(parsed);
  } catch (error) {
    window.open(STOCKOUT_DRIVE_VIEW_URL, "_blank", "noopener");
    alert(`자동 불러오기에 실패했습니다.\n로컬에서 자동 불러오기를 쓰려면 터미널에서 python web_app.py를 실행한 뒤 http://127.0.0.1:8765 로 접속해 주세요.\n열린 Google Drive 화면에서 내려받아 직접 업로드할 수도 있습니다.\n\n상세: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function fetchStockoutPdfBlob() {
  const urls = stockoutPdfUrls();
  let lastError;
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url} 응답 오류: ${response.status}`);
      const blob = await response.blob();
      if (!blob.size) throw new Error(`${url} 빈 파일`);
      return blob;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("PDF를 불러오지 못했습니다.");
}

function stockoutPdfUrls() {
  const urls = [];
  if (location.protocol === "http:" || location.protocol === "https:") {
    urls.push(STOCKOUT_PROXY_PATH);
  }
  if (location.protocol === "file:" || location.hostname === "127.0.0.1" || location.hostname === "localhost") {
    urls.push(LOCAL_STOCKOUT_PROXY_URL);
  }
  urls.push(STOCKOUT_DRIVE_DOWNLOAD_URL);
  return [...new Set(urls)];
}

$("#stockoutPdfForm").addEventListener("submit", (event) => {
  event.preventDefault();
  handlePdfUpload($("#stockoutPdfFile"));
});

$("#stockoutPdfFormSecondary").addEventListener("submit", (event) => {
  event.preventDefault();
  handlePdfUpload($("#stockoutPdfFileSecondary"));
});

$("#stockoutDriveButton").addEventListener("click", (event) => {
  loadStockoutPdfFromDrive(event.currentTarget);
});

$("#stockoutDriveButtonSecondary").addEventListener("click", (event) => {
  loadStockoutPdfFromDrive(event.currentTarget);
});

$("#loadPromotionSampleButton").addEventListener("click", loadPromotionSampleData);

$("#manualStockoutButton").addEventListener("click", () => {
  const items = parseManualStockouts($("#manualStockoutText").value);
  if (!items.length) return alert("공지 품목을 입력해 주세요.");
  store.stockoutItems = items;
  store.stockoutItems = reconcileStockoutCompanies(store.stockoutItems, store.rateItems);
  store.stockoutWarnings = validateStockoutItems(store.stockoutItems, store.masterItems, store.rateItems);
  store.results = [];
  saveStore();
  render();
  switchView("dashboard");
});

$("#clearStockoutButton").addEventListener("click", () => {
  if (!confirm("현재 공지 리스트를 비울까요?")) return;
  store.stockoutItems = [];
  store.stockoutWarnings = [];
  store.results = [];
  saveStore();
  render();
});

$("#resultGrid").addEventListener("click", async (event) => {
  const partnerCopyButton = event.target.closest(".partner-copy-button");
  const phoneCopyButton = event.target.closest(".phone-copy-button");
  const copyButton = event.target.closest(".copy-button");
  const imageButton = event.target.closest(".image-button");
  const printButton = event.target.closest(".print-button");
  const doneButton = event.target.closest(".done-button");
  const resultId =
    partnerCopyButton?.dataset.resultId ||
    phoneCopyButton?.dataset.resultId ||
    copyButton?.dataset.resultId ||
    imageButton?.dataset.resultId ||
    printButton?.dataset.resultId ||
    doneButton?.dataset.resultId;
  if (!resultId) return;
  const result = store.results.find((item) => item.id === resultId);
  if (!result) return;
  if (partnerCopyButton) {
    await copyMessage(result.partnerName);
    partnerCopyButton.textContent = "복사완료";
    setTimeout(() => (partnerCopyButton.textContent = "사업자명복사"), 1200);
  }
  if (phoneCopyButton) {
    if (!result.phone) return alert("등록된 연락처가 없습니다.");
    await copyMessage(result.phone);
    phoneCopyButton.textContent = "복사완료";
    setTimeout(() => (phoneCopyButton.textContent = "연락처복사"), 1200);
  }
  if (copyButton) {
    await copyMessage(buildResultMessage(result));
    copyButton.textContent = "복사완료";
    setTimeout(() => (copyButton.textContent = "전체복사"), 1200);
  }
  if (imageButton) {
    imageButton.disabled = true;
    imageButton.textContent = "이미지 생성중";
    try {
      const action = await copyResultImage(result);
      imageButton.textContent = action === "copied" ? "이미지복사완료" : "이미지저장완료";
    } catch (error) {
      alert(`이미지 생성 실패: ${error.message}`);
      imageButton.textContent = "카톡용 이미지";
    } finally {
      setTimeout(() => {
        imageButton.disabled = false;
        imageButton.textContent = "카톡용 이미지";
      }, 1600);
    }
  }
  if (printButton) printText(`${result.partnerName} 공지 리포트`, buildResultMessage(result));
  if (doneButton) {
    result.status = "done";
    const history = store.history.find((entry) => entry.id === result.id);
    if (history) history.status = "done";
    saveStore();
    render();
  }
});

$("#copyAllButton").addEventListener("click", async () => {
  const text = store.results
    .map((result) => {
      const items = filteredResultItems(result);
      return items.length ? buildResultMessage(result, items) : "";
    })
    .filter(Boolean)
    .join("\n\n");
  if (!text) return alert("복사할 매칭 결과가 없습니다.");
  await copyMessage(text);
  alert("전체 결과를 복사했습니다.");
});

$("#printAllButton").addEventListener("click", () => {
  const text = store.results
    .map((result) => {
      const items = filteredResultItems(result);
      return items.length ? buildResultMessage(result, items) : "";
    })
    .filter(Boolean)
    .join("\n\n");
  if (!text) return alert("출력할 매칭 결과가 없습니다.");
  printText("사업자별 공지 매칭 전체 결과", text);
});

$("#exportButton").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `공지매칭_백업_${today()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
});

$("#importFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  store = JSON.parse(await file.text());
  store.stockoutItems = reconcileStockoutCompanies(store.stockoutItems || [], store.rateItems || []);
  store.stockoutWarnings = validateStockoutItems(store.stockoutItems || [], store.masterItems || [], store.rateItems || []);
  saveStore();
  render();
});

$("#clearHistoryButton").addEventListener("click", () => {
  if (!confirm("매칭 이력을 모두 비울까요?")) return;
  store.history = [];
  saveStore();
  render();
});

store.stockoutItems = reconcileStockoutCompanies(store.stockoutItems || [], store.rateItems || []);
store.stockoutWarnings = validateStockoutItems(store.stockoutItems || [], store.masterItems || [], store.rateItems || []);
render();
showReleaseNoticeIfNeeded();

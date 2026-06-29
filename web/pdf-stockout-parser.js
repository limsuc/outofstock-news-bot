(function registerStockoutPdfParser(root, factory) {
  const parser = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = parser;
  root.StockoutPdfParser = parser;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const LEGACY_STOP_RE = /(기본|기존|추가|프로모션|기간|대상|수수료|요율|전략|지급|신규|매출|처방시)/;
  const RELEASE_RE = /(입고\s*완료|품절\s*해제)/;

  function cleanText(value) {
    return String(value ?? "").replace(/\u00a0/g, " ").trim().replace(/\s+/g, " ");
  }

  function groupFragments(fragments) {
    const rows = [];
    const sorted = fragments
      .map((item) => ({ text: cleanText(item.text), x: Number(item.x), y: Number(item.y) }))
      .filter((item) => item.text && Number.isFinite(item.x) && Number.isFinite(item.y) && item.y > 0)
      .sort((a, b) => b.y - a.y || a.x - b.x);

    for (const fragment of sorted) {
      const last = rows[rows.length - 1];
      if (!last || Math.abs(last[0].y - fragment.y) > 3) rows.push([fragment]);
      else last.push(fragment);
    }
    return rows;
  }

  function columnText(row, minX, maxX = Infinity) {
    return row
      .filter((item) => item.x >= minX && item.x < maxX)
      .map((item) => item.text)
      .join(" ")
      .trim();
  }

  function distributionRow(row) {
    return {
      company: columnText(row, 0, 90),
      productName: columnText(row, 90, 285),
      expectedDate: columnText(row, 285, 380),
      note: columnText(row, 380),
    };
  }

  function detectLayout(pages) {
    let distributionRows = 0;
    let legacyHeaders = 0;

    for (const rows of pages) {
      for (const row of rows) {
        const combined = row.map((item) => item.text).join(" ");
        if (combined.includes("입고 예정일") || (combined.includes("제품명") && combined.includes("비고"))) {
          distributionRows += 5;
        }
        if (combined.includes("제약사명") && (combined.includes("출하") || combined.includes("제품명"))) {
          legacyHeaders += 1;
        }

        const parsed = distributionRow(row);
        if (parsed.company && parsed.productName && parsed.expectedDate) distributionRows += 1;
      }
    }

    return distributionRows >= 3 && distributionRows > legacyHeaders * 2 ? "distribution" : "legacy";
  }

  function parseDistributionPages(pages) {
    const items = [];
    for (const rows of pages) {
      let currentCompany = "";
      const pendingCompanyItems = [];

      for (const row of rows) {
        const parsed = distributionRow(row);
        const combined = `${parsed.company} ${parsed.productName} ${parsed.expectedDate} ${parsed.note}`;
        if (/제약사명|제품명|입고\s*예정일|공지사항|유통현황/.test(combined)) continue;

        if (parsed.company) {
          if (!currentCompany) {
            pendingCompanyItems.forEach((item) => {
              item.company = parsed.company;
            });
            pendingCompanyItems.length = 0;
          }
          currentCompany = parsed.company;
        }

        if (!parsed.productName || !parsed.expectedDate) continue;
        if (RELEASE_RE.test(`${parsed.expectedDate} ${parsed.note}`)) continue;

        const item = {
          company: parsed.company || currentCompany,
          productName: parsed.productName,
          expectedDate: parsed.expectedDate || "-",
        };
        items.push(item);
        if (!item.company) pendingCompanyItems.push(item);
      }
    }
    return items;
  }

  function parseLegacyPages(pages) {
    const items = [];
    for (const rows of pages) {
      let started = false;
      let currentCompany = "";
      const pendingCompanyItems = [];

      for (const row of rows) {
        const combined = row.map((item) => item.text).join(" ");
        if (combined.includes("제약사명") && (combined.includes("제품명") || combined.includes("출하"))) {
          started = true;
          continue;
        }
        if (!started) continue;

        const company = columnText(row, 0, 70);
        const productName = columnText(row, 70, 335);
        const expectedDate = columnText(row, 335);
        if (LEGACY_STOP_RE.test(`${productName} ${expectedDate}`)) break;
        if (["제품명", "내용", "출하 예정일"].includes(productName)) continue;

        if (company) {
          if (!currentCompany) {
            pendingCompanyItems.forEach((item) => {
              item.company = company;
            });
            pendingCompanyItems.length = 0;
          }
          currentCompany = company;
        }

        if (!productName) continue;

        const item = {
          company: company || currentCompany,
          productName,
          expectedDate: expectedDate || "-",
        };
        items.push(item);
        if (!item.company) pendingCompanyItems.push(item);
      }
    }
    return items;
  }

  function parsePages(pageFragments) {
    const pages = pageFragments.map(groupFragments);
    const layout = detectLayout(pages);
    const items = layout === "distribution" ? parseDistributionPages(pages) : parseLegacyPages(pages);
    return {
      layout,
      layoutLabel: layout === "distribution" ? "제약사별 유통현황 형식" : "기존 품절리스트 형식",
      items,
    };
  }

  return {
    detectLayout,
    groupFragments,
    parseDistributionPages,
    parseLegacyPages,
    parsePages,
  };
});

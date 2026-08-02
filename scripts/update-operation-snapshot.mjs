const OPERATION_API_URL = "https://apis.data.go.kr/B554035/oprt-schd-info-v2/get-oprt-schd-info-v2";
const OPERATION_API_SERVICE_KEY = process.env.OPERATION_API_SERVICE_KEY || "4063f2c2047eaf451ca47bba11369c953e228d145a62d2be87ad7af1d0f3960f";
const API_PAGE_SIZE = 1000;

function getTodayKstParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function getTodayKstCompact() {
  const parts = getTodayKstParts();
  return `${parts.year}${parts.month}${parts.day}`;
}

function getTodayKstDashed() {
  const parts = getTodayKstParts();
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function fetchOperationApiRows() {
  const allRows = [];
  let pageNo = 1;
  let totalCount = Infinity;

  while (allRows.length < totalCount) {
    const params = new URLSearchParams({
      serviceKey: OPERATION_API_SERVICE_KEY,
      pageNo: String(pageNo),
      numOfRows: String(API_PAGE_SIZE),
      dataType: "JSON",
      rlvtYmd: getTodayKstCompact()
    });

    const response = await fetch(`${OPERATION_API_URL}?${params.toString()}`, {
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`운항 API 조회 실패 (${response.status})`);
    }

    const payload = await response.json();
    const header = payload?.response?.header;
    if (String(header?.resultCode ?? "") !== "200") {
      throw new Error(header?.resultMsg || "운항 API 응답이 정상이 아닙니다.");
    }

    const body = payload?.response?.body ?? {};
    totalCount = Number(body.totalCount ?? 0);
    const items = Array.isArray(body?.items?.item)
      ? body.items.item
      : body?.items?.item
        ? [body.items.item]
        : [];

    allRows.push(...items);
    if (!items.length || items.length < API_PAGE_SIZE) break;
    pageNo += 1;
  }

  return allRows;
}

async function main() {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const fetchedAt = new Date().toISOString();
  const observedDate = getTodayKstDashed();
  const items = await fetchOperationApiRows();

  const payload = {
    source: "B554035/oprt-schd-info-v2/get-oprt-schd-info-v2",
    observedDate,
    fetchedAt,
    itemCount: items.length,
    items
  };

  const targetDir = join(process.cwd(), "data");
  await mkdir(targetDir, { recursive: true });
  await writeFile(
    join(targetDir, "operation-snapshot.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );

  console.log(`operation snapshot updated: ${observedDate} (${items.length} rows)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

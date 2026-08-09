const OPERATION_API_URL = "https://apis.data.go.kr/B554035/oprt-schd-info-v2/get-oprt-schd-info-v2";
const OPERATION_API_SERVICE_KEY = process.env.OPERATION_API_SERVICE_KEY || "4063f2c2047eaf451ca47bba11369c953e228d145a62d2be87ad7af1d0f3960f";
const API_PAGE_SIZE = 1000;
const API_REQUEST_TIMEOUT_MS = 20000;
const API_MAX_ATTEMPTS = 4;
const API_RETRY_DELAYS_MS = [1000, 3000, 7000];

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(url, contextLabel) {
  let lastError = null;

  for (let attempt = 1; attempt <= API_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json"
        },
        signal: controller.signal
      });

      if (!response.ok) {
        const preview = await response.text().catch(() => "");
        throw new Error(
          `운항 API 조회 실패 (${response.status})${preview ? `: ${preview.slice(0, 180)}` : ""}`
        );
      }

      const rawText = await response.text();
      try {
        return JSON.parse(rawText);
      } catch {
        throw new Error(`운항 API JSON 파싱 실패: ${rawText.slice(0, 180)}`);
      }
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[snapshot] ${contextLabel} 시도 ${attempt}/${API_MAX_ATTEMPTS} 실패: ${message}`);
      if (attempt < API_MAX_ATTEMPTS) {
        await sleep(API_RETRY_DELAYS_MS[attempt - 1] ?? API_RETRY_DELAYS_MS.at(-1) ?? 1000);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${contextLabel} 실패`);
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

    const payload = await fetchJsonWithRetry(
      `${OPERATION_API_URL}?${params.toString()}`,
      `운항 API page ${pageNo}`
    );
    const header = payload?.response?.header;
    if (String(header?.resultCode ?? "") !== "200") {
      throw new Error(header?.resultMsg || "운항 API 응답이 정상 상태가 아닙니다.");
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

async function readExistingSnapshot(targetPath) {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(targetPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function main() {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const fetchedAt = new Date().toISOString();
  const observedDate = getTodayKstDashed();
  const targetDir = join(process.cwd(), "data");
  const targetPath = join(targetDir, "operation-snapshot.json");

  let items;
  try {
    items = await fetchOperationApiRows();
  } catch (error) {
    const existingSnapshot = await readExistingSnapshot(targetPath);
    if (!existingSnapshot) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[snapshot] 최신 데이터 갱신 실패. 기존 스냅샷 유지: ${message}`);
    console.log(
      `operation snapshot kept: ${existingSnapshot.observedDate || "unknown"} (${existingSnapshot.itemCount ?? existingSnapshot.items?.length ?? 0} rows)`
    );
    return;
  }

  const payload = {
    source: "B554035/oprt-schd-info-v2/get-oprt-schd-info-v2",
    observedDate,
    fetchedAt,
    itemCount: items.length,
    items
  };

  await mkdir(targetDir, { recursive: true });
  await writeFile(
    targetPath,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );

  console.log(`operation snapshot updated: ${observedDate} (${items.length} rows)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

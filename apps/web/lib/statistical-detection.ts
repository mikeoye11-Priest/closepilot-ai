/**
 * ClosePilot Statistical Detection Engine
 *
 * Separate from the rule engine — handles mathematical anomaly detection:
 * Z-Score outliers, Benford's Law, trend breaks, variance analysis, seasonality.
 */

import type { StatisticalFinding } from "@/lib/types/finding";
import type { EngineFile } from "@/lib/rule-engine";

export type StatisticalDetectionSettings = {
  approvalLimits?: number[];
};

const DEFAULT_APPROVAL_LIMITS = [1000, 5000, 10000, 25000];

// ─── Z-Score outlier detection ────────────────────────────────────────────────

export function detectOutliersZScore(
  rows: Record<string, string>[],
  amountKeys: string[],
  nameKeys: string[],
  zThreshold = 2.5
): { outliers: { value: number; name: string; zScore: number }[]; mean: number; stdDev: number; count: number } {
  const values = rows.map((r) => ({ value: Math.abs(resolveNum(r, amountKeys) ?? 0), name: resolveStr(r, nameKeys) })).filter((v) => v.value !== 0);
  if (values.length < 5) return { outliers: [], mean: 0, stdDev: 0, count: values.length };

  const nums = values.map((v) => v.value);
  const mean = nums.reduce((s, v) => s + v, 0) / nums.length;
  const variance = nums.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / nums.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return { outliers: [], mean, stdDev, count: values.length };

  const outliers = values
    .map((v) => ({ ...v, zScore: Math.abs((v.value - mean) / stdDev) }))
    .filter((v) => v.zScore > zThreshold)
    .sort((a, b) => b.zScore - a.zScore);
  return { outliers, mean, stdDev, count: values.length };
}

export function detectOutliersMAD(
  rows: Record<string, string>[],
  amountKeys: string[],
  nameKeys: string[],
  threshold = 3.5
): { outliers: { value: number; name: string; modifiedZScore: number }[]; median: number; mad: number; count: number } {
  const values = rows.map((r) => ({ value: Math.abs(resolveNum(r, amountKeys) ?? 0), name: resolveStr(r, nameKeys) })).filter((v) => v.value !== 0);
  if (values.length < 8) return { outliers: [], median: 0, mad: 0, count: values.length };

  const nums = values.map((v) => v.value).sort((a, b) => a - b);
  const medianValue = median(nums);
  const absoluteDeviations = nums.map((value) => Math.abs(value - medianValue)).sort((a, b) => a - b);
  const mad = median(absoluteDeviations);
  if (mad === 0) return { outliers: [], median: medianValue, mad, count: values.length };

  const outliers = values
    .map((v) => ({ ...v, modifiedZScore: Math.abs((0.6745 * (v.value - medianValue)) / mad) }))
    .filter((v) => v.modifiedZScore > threshold)
    .sort((a, b) => b.modifiedZScore - a.modifiedZScore);
  return { outliers, median: medianValue, mad, count: values.length };
}

// ─── Benford's Law analysis ───────────────────────────────────────────────────

const BENFORD_EXPECTED: Record<number, number> = { 1: 30.1, 2: 17.6, 3: 12.5, 4: 9.7, 5: 7.9, 6: 6.7, 7: 5.8, 8: 5.1, 9: 4.6 };

export function runBenfordAnalysis(
  rows: Record<string, string>[],
  amountKeys: string[]
): { digit: number; expected: number; actual: number; deviation: number; suspicious: boolean }[] {
  const amounts = rows.map((r) => Math.abs(resolveNum(r, amountKeys) ?? 0)).filter((v) => v >= 10);
  if (amounts.length < 50) return [];

  const digitCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
  amounts.forEach((v) => {
    const firstDigit = Number(String(v).replace(/[^0-9]/g, "")[0]);
    if (firstDigit >= 1 && firstDigit <= 9) digitCounts[firstDigit]++;
  });

  return Object.entries(BENFORD_EXPECTED).map(([digit, expected]) => {
    const d = Number(digit);
    const actual = (digitCounts[d] / amounts.length) * 100;
    const deviation = Math.abs(actual - expected);
    return { digit: d, expected, actual: Math.round(actual * 10) / 10, deviation: Math.round(deviation * 10) / 10, suspicious: deviation > 5 };
  });
}

// ─── Trend break detection ────────────────────────────────────────────────────

export function detectTrendBreak(
  values: number[],
  breakThreshold = 0.5
): { index: number; direction: "spike" | "drop"; magnitude: number } | null {
  if (values.length < 3) return null;

  const avg = values.slice(0, -1).reduce((s, v) => s + v, 0) / (values.length - 1);
  const last = values[values.length - 1];
  if (avg === 0) return null;

  const change = (last - avg) / Math.abs(avg);
  if (Math.abs(change) > breakThreshold) {
    return { index: values.length - 1, direction: change > 0 ? "spike" : "drop", magnitude: Math.round(Math.abs(change) * 100) };
  }
  return null;
}

// ─── Variance analysis ────────────────────────────────────────────────────────

export function calculateVariance(values: number[]): {
  mean: number; stdDev: number; cv: number; min: number; max: number; range: number;
} {
  if (values.length === 0) return { mean: 0, stdDev: 0, cv: 0, min: 0, max: 0, range: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { mean, stdDev, cv: mean !== 0 ? stdDev / Math.abs(mean) : 0, min, max, range: max - min };
}

// ─── Seasonality detection ────────────────────────────────────────────────────

export function detectSeasonality(
  values: number[],
  expectedPeriod = 12
): { isPresent: boolean; peakIndex: number; troughIndex: number; amplitude: number } {
  if (values.length < expectedPeriod) return { isPresent: false, peakIndex: 0, troughIndex: 0, amplitude: 0 };
  const max = Math.max(...values); const min = Math.min(...values);
  const amplitude = max - min;
  const avgAmplitude = (max + min) / 2;
  const isPresent = avgAmplitude > 0 && (amplitude / avgAmplitude) > 0.3;
  return { isPresent, peakIndex: values.indexOf(max), troughIndex: values.indexOf(min), amplitude };
}

// ─── Full statistical analysis on a set of files ─────────────────────────────

export function runStatisticalAnalysis(files: EngineFile[], settings: StatisticalDetectionSettings = {}): StatisticalFinding[] {
  const findings: StatisticalFinding[] = [];
  const parsed = files.filter((f) => f.isParsed);
  const approvalLimits = settings.approvalLimits?.length ? settings.approvalLimits : DEFAULT_APPROVAL_LIMITS;

  parsed.forEach((file) => {
    const rows = file.rows;
    const ft = file.upload.fileType;
    const amountKeys = ["amount","balance","outstanding","invoice_amount","net_amount","total"];
    const nameKeys   = ["customer","supplier","vendor","account_name","description"];

    // Z-score outlier analysis. This is the core V1 statistical check:
    // show the mean, standard deviation and top z-score so reviewers can verify the maths.
    if (rows.length >= 10) {
      const z = detectOutliersZScore(rows, amountKeys, nameKeys, 3.0);
      const outliers = z.outliers;
      if (outliers.length > 0) {
        findings.push({
          ruleId: "STAT_ZSCORE",
          category: "controls",
          score: Math.min(outliers[0].zScore / 5, 1),
          confidence: z.count >= 30 ? 0.8 : 0.65,
          title: `${outliers.length} statistical outlier${outliers.length > 1 ? "s" : ""} detected in ${file.upload.fileName}`,
          finding: `Z-score analysis identified ${outliers.length} transaction(s) significantly above normal range. Top outlier: ${outliers[0].name} at ${fc(outliers[0].value)} (z-score: ${outliers[0].zScore.toFixed(1)}).`,
          calculation: `Z-score = (amount - mean) / standard deviation. Rows tested: ${z.count}. Mean: ${fc(z.mean)}. Std dev: ${fc(z.stdDev)}. Threshold: 3.0. Top z-score: ${outliers[0].zScore.toFixed(2)}.`,
          sourceFile: file.upload.fileName,
          severity: outliers[0].zScore > 4 ? "high" : "medium",
        });
      }

      const mad = detectOutliersMAD(rows, amountKeys, nameKeys, 3.5);
      if (mad.outliers.length > 0 && mad.outliers[0].modifiedZScore > 5) {
        findings.push({
          ruleId: "STAT_MAD_OUTLIER",
          category: "controls",
          score: Math.min(mad.outliers[0].modifiedZScore / 8, 1),
          confidence: mad.count >= 30 ? 0.75 : 0.6,
          title: `${mad.outliers.length} robust statistical outlier${mad.outliers.length > 1 ? "s" : ""} detected in ${file.upload.fileName}`,
          finding: `Median absolute deviation analysis identified ${mad.outliers.length} transaction(s) unusually distant from the median. Top outlier: ${mad.outliers[0].name} at ${fc(mad.outliers[0].value)} (modified z-score: ${mad.outliers[0].modifiedZScore.toFixed(1)}).`,
          calculation: `Modified z-score = 0.6745 x (amount - median) / MAD. Rows tested: ${mad.count}. Median: ${fc(mad.median)}. MAD: ${fc(mad.mad)}. Threshold: 3.5. Top modified z-score: ${mad.outliers[0].modifiedZScore.toFixed(2)}.`,
          sourceFile: file.upload.fileName,
          severity: mad.outliers[0].modifiedZScore > 7 ? "high" : "medium",
        });
      }
    }

    // Benford's Law analysis
    if (rows.length >= 50 && (ft === "aged_creditors" || ft === "aged_debtors" || ft === "trial_balance")) {
      const benford = runBenfordAnalysis(rows, amountKeys);
      const suspicious = benford.filter((b) => b.suspicious);
      const mad = benford.reduce((sum, item) => sum + item.deviation, 0) / Math.max(benford.length, 1);
      if (suspicious.length >= 2 && mad > 2.2) {
        const maxDev = Math.max(...suspicious.map((b) => b.deviation));
        findings.push({
          ruleId: "STAT_BENFORD",
          category: "controls",
          score: Math.min(maxDev / 20, 1),
          confidence: rows.length >= 100 ? 0.65 : 0.5,
          title: `Benford's Law deviation detected in ${file.upload.fileName}`,
          finding: `Leading digit frequency analysis found ${suspicious.length} digit(s) deviating more than 5pp from expected Benford distribution. This is an indicator, not proof of fraud, and should be investigated with source documents.`,
          calculation: `Mean absolute deviation: ${mad.toFixed(1)}pp. Digits deviating: ${suspicious.map((b) => `${b.digit}: expected ${b.expected}%, actual ${b.actual}% (delta ${b.deviation}pp)`).join("; ")}.`,
          sourceFile: file.upload.fileName,
          severity: suspicious.length >= 3 ? "high" : "medium",
        });
      }
    }

    // Round number concentration
    if (rows.length >= 20) {
      const roundCount = rows.filter((r) => {
        const v = Math.abs(resolveNum(r, amountKeys) ?? 0);
        return v > 0 && v % 1000 === 0;
      }).length;
      const pct = (roundCount / rows.length) * 100;
      if (pct > 30) {
        findings.push({
          ruleId: "STAT_ROUND_NUMBERS",
          category: "controls",
          score: Math.min(pct / 100, 1),
          confidence: 0.6,
          title: `${Math.round(pct)}% round-number amounts in ${file.upload.fileName}`,
          finding: `${roundCount} of ${rows.length} transactions (${Math.round(pct)}%) are exact multiples of £1,000. Naturally-occurring financial data rarely exceeds 10-15%.`,
          calculation: `Round number count: ${roundCount}/${rows.length} = ${Math.round(pct)}%. Benford-expected rate: ~10-15%.`,
          sourceFile: file.upload.fileName,
          severity: pct > 50 ? "high" : "medium",
        });
      }
    }

    // Variance analysis — high CV flags wide dispersion, but stays low severity
    // unless a separate z-score finding identifies specific outliers.
    if (rows.length >= 5) {
      const values = rows.map((r) => Math.abs(resolveNum(r, amountKeys) ?? 0)).filter((v) => v > 0);
      if (values.length >= 5) {
        const stats = calculateVariance(values);
        if (stats.cv > 3) {
          findings.push({
            ruleId: "STAT_HIGH_VARIANCE",
            category: "controls",
            score: Math.min(stats.cv / 10, 1),
            confidence: 0.4,
            title: `High variance in transaction amounts in ${file.upload.fileName}`,
            finding: `Coefficient of variation (CV) is ${stats.cv.toFixed(1)} — highly variable amount distribution. Range: ${fc(stats.min)} to ${fc(stats.max)}.`,
            calculation: `Mean: ${fc(stats.mean)}, Std Dev: ${fc(stats.stdDev)}, CV: ${stats.cv.toFixed(2)}, Range: ${fc(stats.range)}.`,
            sourceFile: file.upload.fileName,
            severity: "low",
          });
        }
      }
    }

    // Month-end clustering: a real date distribution test, not a keyword check.
    if (rows.length >= 20) {
      const datedRows = rows
        .map((r) => parseDate(resolveStr(r, ["date","invoice_date","transaction_date","posting_date","entry_date","created_date"])))
        .filter(Boolean) as Date[];
      if (datedRows.length >= 20) {
        const monthEnd = datedRows.filter((d) => d.getDate() >= 28).length;
        const pct = (monthEnd / datedRows.length) * 100;
        if (pct >= 35) {
          findings.push({
            ruleId: "STAT_MONTH_END_CLUSTER",
            category: "controls",
            score: Math.min(pct / 70, 1),
            confidence: 0.65,
            title: `${Math.round(pct)}% of dated transactions posted in the last four days of the month`,
            finding: `${monthEnd} of ${datedRows.length} dated transactions fall on days 28-31. That concentration can indicate cut-off pressure, batching, or window-dressing and should be reconciled to source activity.`,
            calculation: `Month-end cluster = ${monthEnd}/${datedRows.length} = ${pct.toFixed(1)}%. Review threshold: 35%.`,
            sourceFile: file.upload.fileName,
            severity: pct >= 50 ? "high" : "medium",
          });
        }
      }
    }

    // Repeated same amount by party: useful for standing order, duplicate or estimate patterns.
    if (rows.length >= 10) {
      const groups = new Map<string, { name: string; value: number; count: number }>();
      rows.forEach((row) => {
        const value = Math.abs(resolveNum(row, amountKeys) ?? 0);
        const name = resolveStr(row, nameKeys);
        if (!value || name === "Unknown") return;
        const key = `${name.toLowerCase()}|${value.toFixed(2)}`;
        const current = groups.get(key) ?? { name, value, count: 0 };
        current.count += 1;
        groups.set(key, current);
      });
      const repeated = [...groups.values()].filter((item) => item.count >= 3).sort((a, b) => b.count - a.count || b.value - a.value);
      if (repeated.length) {
        const top = repeated[0];
        findings.push({
          ruleId: "STAT_REPEATED_AMOUNT_CLUSTER",
          category: ft === "aged_debtors" ? "ar" : "controls",
          score: Math.min(top.count / 10, 1),
          confidence: 0.7,
          title: `${repeated.length} repeated amount cluster${repeated.length > 1 ? "s" : ""} detected`,
          finding: `${top.name} has ${top.count} entries with the same amount (${fc(top.value)}). Repeated amounts may be valid standing charges, but they can also reveal duplicate entry or estimated accrual patterns.`,
          calculation: `Grouped by party + exact amount. Top cluster: ${top.name}, ${top.count} x ${fc(top.value)}.`,
          sourceFile: file.upload.fileName,
          severity: top.value * top.count > 50000 ? "high" : "medium",
        });
      }
    }

    // Threshold clustering — default limits can be replaced by tenant approval limits.
    approvalLimits.forEach((limit) => {
      const window = limit * 0.05; // within 5% of threshold
      const clustered = rows.filter((r) => {
        const v = Math.abs(resolveNum(r, amountKeys) ?? 0);
        return v > limit - window && v < limit;
      });
      if (clustered.length >= 3) {
        findings.push({
          ruleId: `STAT_CLUSTER_${limit}`,
          category: "controls",
          score: 0.6,
          confidence: 0.5,
          title: `${clustered.length} transactions clustered just below £${(limit/1000).toFixed(0)}k approval limit`,
          finding: `${clustered.length} transactions are within 5% below the £${limit.toLocaleString()} threshold — possible deliberate structuring to avoid approval requirements.`,
          calculation: `${clustered.length} amounts between £${fc(limit - window)} and £${fc(limit)}.`,
          sourceFile: file.upload.fileName,
          severity: limit >= 10000 ? "high" : "medium",
        });
      }
    });
  });

  findings.push(...runFinancialAnalytics(parsed));

  return findings;
}

// ─── Convert StatisticalFinding to Finding for the main pipeline ──────────────

export function convertStatisticalFindings(
  statFindings: StatisticalFinding[],
  tenantId: string,
  companyId: string
) {
  return statFindings.map((sf, index) => ({
    id: `stat_${sf.ruleId}_${slug(sf.sourceFile)}_${index}`,
    tenantId,
    companyId,
    severity: sf.severity as "low" | "medium" | "high" | "critical",
    category: sf.category as "controls" | "ar" | "ap" | "vat" | "month_end" | "cashflow" | "data_quality",
    title: sf.title,
    description: sf.finding,
    expectedImpact: `Confidence: ${Math.round(sf.confidence * 100)}% — statistical anomaly score: ${Math.round(sf.score * 100)}`,
    status: "open" as const,
    confidence: sf.confidence >= 0.7 ? "high" : sf.confidence >= 0.5 ? "medium" : "low" as "high" | "medium" | "low",
    evidenceStrength: sf.ruleId.startsWith("STAT_ANALYTICS") ? "deterministic" as const : sf.confidence >= 0.7 ? "indicator" as const : "advisory" as const,
    evidence: {
      sourceFile: sf.sourceFile,
      accountCode: "Statistical analysis",
      period: new Date().toISOString().slice(0, 10),
      calculation: sf.calculation,
    }
  }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveStr(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) { if (row[k]) return row[k].trim(); } return "Unknown";
}

function resolveNum(row: Record<string, string>, keys: string[]): number | null {
  const raw = resolveStr(row, keys);
  if (!raw || raw === "Unknown") return null;
  const cleaned = raw.replace(/[£$€,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function runFinancialAnalytics(files: EngineFile[]): StatisticalFinding[] {
  const findings: StatisticalFinding[] = [];
  const bs = files.find((f) => f.upload.fileType === "balance_sheet");
  const pl = files.find((f) => f.upload.fileType === "profit_loss");
  const ar = files.find((f) => f.upload.fileType === "aged_debtors");
  const ap = files.find((f) => f.upload.fileType === "aged_creditors");

  const bsRows = bs?.rows ?? [];
  const plRows = pl?.rows ?? [];
  const revenue = Math.abs(sumMatching(plRows, [/revenue|turnover|sales|income/i], [/gross profit|total/i]));
  const cogs = Math.abs(sumMatching(plRows, [/cogs|cost of sales|direct cost|direct materials|direct labour/i], [/gross profit|total/i]));
  const ebit = sumProfitLoss(plRows);
  const depreciationAmortisation = Math.abs(sumMatching(plRows, [/depreciation|amorti[sz]ation/i], [/accumulated/i]));
  const ebitda = ebit + depreciationAmortisation;
  const interest = Math.abs(sumMatching(plRows, [/interest|finance charge|finance cost|loan interest|bank charges/i]));
  const cash = Math.abs(sumMatching(bsRows, [/cash|bank/i], [/overdraft/i]));
  const borrowings = Math.abs(sumMatching(bsRows, [/loan|borrowing|debt|overdraft|debenture|note payable/i]));
  const assets = totalLine(bsRows, [/^total assets?$/i]) ?? Math.abs(sumMatching(bsRows, [/asset|cash|bank|debtor|receivable|stock|inventory|prepayment/i], [/liabilit|equity/i]));
  const liabilities = totalLine(bsRows, [/^total liabilities?$/i]) ?? Math.abs(sumMatching(bsRows, [/liabilit|creditor|payable|loan|borrowing|accrual|vat payable/i], [/asset|equity/i]));
  const equity = totalLine(bsRows, [/^total equity$/i, /^shareholders'? funds?$/i, /^capital and reserves?$/i]) ?? Math.abs(sumMatching(bsRows, [/equity|share capital|retained earnings|capital and reserve/i], [/total liabilities/i]));
  const currentAssets = Math.abs(sumMatching(bsRows, [/current assets?|cash|bank|debtor|receivable|stock|inventory|prepayment/i], [/fixed asset|liabilit|equity/i]));
  const inventory = Math.abs(sumMatching(bsRows, [/stock|inventory/i]));
  const currentLiabilities = Math.abs(sumMatching(bsRows, [/current liabilit|creditor|payable|accrual|vat payable|overdraft/i], [/long term|non-current|asset/i]));
  const arTotal = ar?.rows.reduce((sum, row) => sum + Math.abs(resolveNum(row, ["amount","balance","outstanding","total_outstanding","net_balance"]) ?? 0), 0) ?? 0;
  const apTotal = ap?.rows.reduce((sum, row) => sum + Math.abs(resolveNum(row, ["amount","balance","outstanding","invoice_amount","net_amount","total"]) ?? 0), 0) ?? 0;

  if (bs && currentAssets > 0 && currentLiabilities > 0) {
    const currentRatio = currentAssets / currentLiabilities;
    const quickRatio = (currentAssets - inventory) / currentLiabilities;
    if (currentRatio < 1.25) {
      findings.push(analyticsFinding("STAT_ANALYTICS_CURRENT_RATIO", "cashflow", currentRatio < 1 ? "high" : "medium", "Current ratio below target", `Current ratio is ${currentRatio.toFixed(2)}x against a 1.25x review threshold.`, `Current assets ${fc(currentAssets)} / current liabilities ${fc(currentLiabilities)} = ${currentRatio.toFixed(2)}x.`, bs.upload.fileName, Math.min(1, (1.25 - currentRatio) / 1.25)));
    }
    if (quickRatio < 0.8) {
      findings.push(analyticsFinding("STAT_ANALYTICS_QUICK_RATIO", "cashflow", quickRatio < 0.5 ? "high" : "medium", "Quick ratio below target", `Quick ratio is ${quickRatio.toFixed(2)}x after excluding inventory.`, `(Current assets ${fc(currentAssets)} - inventory ${fc(inventory)}) / current liabilities ${fc(currentLiabilities)} = ${quickRatio.toFixed(2)}x.`, bs.upload.fileName, Math.min(1, (0.8 - quickRatio) / 0.8)));
    }
  }

  if (bs && liabilities > 0 && equity > 0) {
    const debtToEquity = liabilities / equity;
    if (debtToEquity > 2) {
      findings.push(analyticsFinding("STAT_ANALYTICS_DEBT_EQUITY", "cashflow", debtToEquity > 4 ? "high" : "medium", "Debt-to-equity above review threshold", `Debt-to-equity is ${debtToEquity.toFixed(2)}x against a 2.0x review threshold.`, `Total liabilities ${fc(liabilities)} / equity ${fc(equity)} = ${debtToEquity.toFixed(2)}x.`, bs.upload.fileName, Math.min(1, debtToEquity / 5)));
    }
  }

  if (pl && revenue > 0) {
    const grossMargin = (revenue - cogs) / revenue;
    const ebitdaMargin = ebitda / revenue;
    if (grossMargin < 0.2) {
      findings.push(analyticsFinding("STAT_ANALYTICS_GROSS_MARGIN", "month_end", grossMargin < 0.1 ? "high" : "medium", "Gross margin below analytics threshold", `Gross margin is ${(grossMargin * 100).toFixed(1)}% against a 20% review threshold.`, `(Revenue ${fc(revenue)} - COGS ${fc(cogs)}) / revenue ${fc(revenue)} = ${(grossMargin * 100).toFixed(1)}%.`, pl.upload.fileName, Math.min(1, (0.2 - grossMargin) / 0.2), 0.92));
    }
    if (ebitdaMargin < 0.1) {
      findings.push(analyticsFinding("STAT_ANALYTICS_EBITDA_MARGIN", "month_end", ebitdaMargin < 0 ? "high" : "medium", "EBITDA margin below analytics threshold", `EBITDA margin is ${(ebitdaMargin * 100).toFixed(1)}% against a 10% review threshold.`, `EBIT ${signedFc(ebit)} + depreciation/amortisation ${fc(depreciationAmortisation)} = EBITDA ${signedFc(ebitda)}. EBITDA ${signedFc(ebitda)} / revenue ${fc(revenue)} = ${(ebitdaMargin * 100).toFixed(1)}%.`, pl.upload.fileName, Math.min(1, (0.1 - ebitdaMargin) / 0.2), 0.9));
    }
    if (arTotal > 0) {
      const dso = (arTotal / revenue) * 365;
      if (dso > 60) {
        findings.push(analyticsFinding("STAT_ANALYTICS_DSO", "cashflow", dso > 120 ? "high" : "medium", "DSO above collection threshold", `Days sales outstanding is ${Math.round(dso)} days against a 60-day review threshold.`, `AR ${fc(arTotal)} / revenue ${fc(revenue)} x 365 = ${Math.round(dso)} days.`, ar?.upload.fileName ?? pl.upload.fileName, Math.min(1, dso / 180), 0.9));
      }
      const arToRevenue = arTotal / revenue;
      if (arToRevenue > 0.25) {
        findings.push(analyticsFinding("STAT_ANALYTICS_REVENUE_QUALITY", "ar", arToRevenue > 0.4 ? "high" : "medium", "Revenue quality review triggered by AR balance", `AR represents ${(arToRevenue * 100).toFixed(1)}% of revenue, indicating collection or revenue-quality pressure.`, `AR ${fc(arTotal)} / revenue ${fc(revenue)} = ${(arToRevenue * 100).toFixed(1)}%. Review threshold: 25%.`, ar?.upload.fileName ?? pl.upload.fileName, Math.min(1, arToRevenue / 0.5), 0.86));
      }
    }
    if (apTotal > 0 && cogs > 0) {
      const dpo = (apTotal / cogs) * 365;
      if (dpo > 75) {
        findings.push(analyticsFinding("STAT_ANALYTICS_DPO", "cashflow", dpo > 120 ? "high" : "medium", "DPO above supplier-risk threshold", `Days payable outstanding is ${Math.round(dpo)} days against a 75-day review threshold.`, `AP ${fc(apTotal)} / COGS ${fc(cogs)} x 365 = ${Math.round(dpo)} days.`, ap?.upload.fileName ?? pl.upload.fileName, Math.min(1, dpo / 180), 0.88));
      }
    }
    if (inventory > 0 && cogs > 0) {
      const inventoryDays = (inventory / cogs) * 365;
      if (inventoryDays > 90) {
        findings.push(analyticsFinding("STAT_ANALYTICS_INVENTORY_DAYS", "cashflow", inventoryDays > 180 ? "high" : "medium", "Inventory days above working-capital threshold", `Inventory days are ${Math.round(inventoryDays)} against a 90-day review threshold.`, `Inventory ${fc(inventory)} / COGS ${fc(cogs)} x 365 = ${Math.round(inventoryDays)} days.`, bs?.upload.fileName ?? pl.upload.fileName, Math.min(1, inventoryDays / 240), 0.88));
      }
      if (arTotal > 0 && apTotal > 0) {
        const dso = (arTotal / revenue) * 365;
        const dpo = (apTotal / cogs) * 365;
        const cashConversionCycle = dso + inventoryDays - dpo;
        if (cashConversionCycle > 90) {
          findings.push(analyticsFinding("STAT_ANALYTICS_CASH_CONVERSION_CYCLE", "cashflow", cashConversionCycle > 150 ? "high" : "medium", "Cash conversion cycle above working-capital threshold", `Cash conversion cycle is ${Math.round(cashConversionCycle)} days against a 90-day review threshold.`, `DSO ${Math.round(dso)} + inventory days ${Math.round(inventoryDays)} - DPO ${Math.round(dpo)} = ${Math.round(cashConversionCycle)} days.`, pl.upload.fileName, Math.min(1, cashConversionCycle / 180), 0.86));
      }
      }
    }
  }

  if (pl && interest > 0) {
    const cover = ebit / interest;
    if (cover < 2) {
      findings.push(analyticsFinding("STAT_ANALYTICS_INTEREST_COVER", "cashflow", cover < 1 ? "high" : "medium", "Interest cover below covenant comfort level", `Interest cover is ${cover.toFixed(2)}x against a 2.0x review threshold.`, `EBIT ${signedFc(ebit)} / interest ${fc(interest)} = ${cover.toFixed(2)}x.`, pl.upload.fileName, Math.min(1, (2 - cover) / 2), 0.92));
    }
  }

  if (bs && pl && assets > 0) {
    const roa = ebit / assets;
    if (roa < 0.05) {
      findings.push(analyticsFinding("STAT_ANALYTICS_ROA", "month_end", roa < 0 ? "high" : "medium", "Return on assets below analytics threshold", `Return on assets is ${(roa * 100).toFixed(1)}% against a 5% review threshold.`, `EBIT ${signedFc(ebit)} / assets ${fc(assets)} = ${(roa * 100).toFixed(1)}%.`, pl.upload.fileName, Math.min(1, (0.05 - roa) / 0.1), 0.9));
    }
  }

  if (bs && pl && borrowings > 0 && ebitda > 0) {
    const netDebt = Math.max(0, borrowings - cash);
    const netDebtRatio = netDebt / ebitda;
    if (netDebtRatio > 3) {
      findings.push(analyticsFinding("STAT_ANALYTICS_NET_DEBT_RATIO", "cashflow", netDebtRatio > 5 ? "high" : "medium", "Net debt ratio above leverage threshold", `Net debt to EBITDA is ${netDebtRatio.toFixed(2)}x against a 3.0x review threshold.`, `(Borrowings ${fc(borrowings)} - cash ${fc(cash)}) / EBITDA ${signedFc(ebitda)} = ${netDebtRatio.toFixed(2)}x.`, bs.upload.fileName, Math.min(1, netDebtRatio / 6), 0.88));
    }
  }

  if (ar && arTotal > 0) {
    const concentration = partyConcentration(ar.rows, ["customer","account_name","name"], ["amount","balance","outstanding","total_outstanding","net_balance"]);
    if (concentration.topParty && concentration.topShare > 0.25) {
      findings.push(analyticsFinding("STAT_ANALYTICS_CUSTOMER_CONCENTRATION", "ar", concentration.topShare > 0.4 ? "high" : "medium", "Customer concentration above analytics threshold", `${concentration.topParty} represents ${(concentration.topShare * 100).toFixed(1)}% of AR, creating collection concentration risk.`, `${concentration.topParty} AR ${fc(concentration.topValue)} / total AR ${fc(arTotal)} = ${(concentration.topShare * 100).toFixed(1)}%. Review threshold: 25%.`, ar.upload.fileName, Math.min(1, concentration.topShare / 0.5), 0.9));
    }
  }

  return findings;
}

function analyticsFinding(ruleId: string, category: string, severity: "low" | "medium" | "high" | "critical", title: string, finding: string, calculation: string, sourceFile: string, score: number, confidence = 0.9): StatisticalFinding {
  return { ruleId, category, severity, title, finding, calculation, sourceFile, score: Math.max(0, Math.min(1, score)), confidence };
}

function sumMatching(rows: Record<string, string>[], include: RegExp[], exclude: RegExp[] = []): number {
  return rows
    .filter((row) => {
      const text = Object.values(row).join(" ");
      return include.some((pattern) => pattern.test(text)) && !exclude.some((pattern) => pattern.test(text));
    })
    .reduce((sum, row) => sum + (resolveNum(row, ["amount","balance","net","closing_balance","movement","debit","credit"]) ?? 0), 0);
}

function sumProfitLoss(rows: Record<string, string>[]): number {
  return rows
    .filter((row) => !/gross profit|operating profit|ebitda|ebit|net profit|profit before tax|total/i.test(Object.values(row).join(" ")))
    .reduce((sum, row) => sum + (resolveNum(row, ["amount","balance","net","movement"]) ?? 0), 0);
}

function totalLine(rows: Record<string, string>[], patterns: RegExp[]): number | null {
  const row = rows.find((item) => {
    const label = Object.entries(item)
      .filter(([key, value]) => !["amount","balance","net","movement","debit","credit"].includes(key) && !/^-?[£$,\d\s().]+$/.test(value.trim()))
      .map(([, value]) => value)
      .join(" ")
      .trim();
    return patterns.some((pattern) => pattern.test(label));
  });
  return row ? Math.abs(resolveNum(row, ["amount","balance","net","movement"]) ?? 0) : null;
}

function partyConcentration(rows: Record<string, string>[], nameKeys: string[], amountKeys: string[]) {
  const parties = new Map<string, number>();
  rows.forEach((row) => {
    const name = resolveStr(row, nameKeys);
    const value = Math.abs(resolveNum(row, amountKeys) ?? 0);
    if (!value || name === "Unknown") return;
    parties.set(name, (parties.get(name) ?? 0) + value);
  });
  const entries = [...parties.entries()].sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  const [topParty, topValue = 0] = entries[0] ?? ["", 0];
  return { topParty, topValue, topShare: total > 0 ? topValue / total : 0 };
}

function median(values: number[]) {
  if (!values.length) return 0;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

function parseDate(raw: string): Date | null {
  if (!raw || raw === "Unknown") return null;
  const clean = raw.trim().replace(/[/.]/g, "-");
  const direct = new Date(clean);
  if (!Number.isNaN(direct.getTime())) return direct;
  const parts = clean.split("-").map(Number);
  if (parts.length !== 3 || parts.some((item) => !Number.isFinite(item))) return null;
  const [a, b, c] = parts;
  const d = a > 1900 ? new Date(a, b - 1, c) : new Date(c, b - 1, a);
  return Number.isNaN(d.getTime()) ? null : d;
}

function signedFc(v: number): string { return `${v < 0 ? "-" : ""}${fc(v)}`; }
function fc(v: number): string { return `£${Math.round(Math.abs(v)).toLocaleString()}`; }
function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40); }

/**
 * Rule Analytics — tracks execution stats for every rule across uploads.
 * Answers: which rules fire, which are dead, what are the hit rates?
 */

import type { AssuranceRule } from "@/lib/types/rule";
import type { EngineFile } from "@/lib/rule-engine";
import { executeRule } from "@/lib/rule-engine";
import { ALL_RULES } from "@/lib/rules/index";

export interface RuleExecutionStat {
  ruleId: string;
  ruleName: string;
  layer: number;
  category: string;
  severity: string;
  fileType: string;
  executions: number;   // number of file-runs
  hits: number;         // number of times it triggered
  hitRate: number;      // hits / executions * 100
  lastHit: string | null;
  totalMatchCount: number;
  totalMatchValue: number;
}

export interface RuleAnalyticsReport {
  totalRules: number;
  rulesExecuted: number;
  rulesTriggered: number;
  rulesDead: number;         // executed but never triggered
  rulesNotRun: number;       // not run (no matching file type)
  overallHitRate: number;
  byLayer: Record<number, { executed: number; triggered: number; hitRate: number }>;
  stats: RuleExecutionStat[];
  generatedAt: string;
}

// Run all rules and return both findings AND analytics
export function runRulesWithAnalytics(
  rules: AssuranceRule[],
  files: EngineFile[]
): { findings: ReturnType<typeof executeRule> extends { triggered: boolean } ? never : object[]; analytics: RuleAnalyticsReport } {
  const statsMap = new Map<string, RuleExecutionStat>();
  const findings: object[] = [];

  // Initialise stats for all rules
  rules.forEach((rule) => {
    statsMap.set(rule.id, {
      ruleId:         rule.id,
      ruleName:       rule.name,
      layer:          rule.layer,
      category:       rule.category,
      severity:       rule.severity,
      fileType:       rule.fileType,
      executions:     0,
      hits:           0,
      hitRate:        0,
      lastHit:        null,
      totalMatchCount: 0,
      totalMatchValue: 0,
    });
  });

  // Execute every rule against matching files
  rules.forEach((rule) => {
    const targets = rule.fileType === "any"
      ? files.filter((f) => f.isParsed)
      : files.filter((f) => f.upload.fileType === rule.fileType && f.isParsed);

    targets.forEach((file) => {
      if (rule.minRows && file.rows.length < rule.minRows) return;

      const stat = statsMap.get(rule.id)!;
      stat.executions++;

      const result = executeRule(rule, file);

      if (result.triggered) {
        stat.hits++;
        stat.lastHit = new Date().toISOString().slice(0, 10);
        stat.totalMatchCount += result.matchCount;
        stat.totalMatchValue += result.matchTotal;

        // Build finding
        findings.push({
          id: `eng_${rule.id}_${file.upload.id}`,
          tenantId: file.upload.tenantId,
          companyId: file.upload.companyId,
          severity: rule.severity,
          category: rule.category,
          title: interpolate(rule.message, { count: String(result.matchCount), total: fc(result.matchTotal), names: result.matchNames.join(" / ") || "Multiple", file: file.upload.fileName }),
          description: interpolate(rule.detail ?? rule.description, { count: String(result.matchCount), total: fc(result.matchTotal), names: result.matchNames.join(" / ") || "Multiple" }),
          expectedImpact: interpolate(rule.impact ?? "", { count: String(result.matchCount), total: fc(result.matchTotal) }),
          status: "open",
          confidence: rule.confidence,
          ruleId: rule.id,
          evidence: {
            sourceFile: file.upload.fileName,
            accountCode: result.matchNames.join(" / ") || "Multiple",
            period: file.upload.uploadedAt,
            calculation: result.evidence,
          }
        });
      }
    });

    // Compute hit rate
    const stat = statsMap.get(rule.id)!;
    stat.hitRate = stat.executions > 0 ? Math.round((stat.hits / stat.executions) * 100 * 10) / 10 : 0;
  });

  const stats = [...statsMap.values()];
  const executed  = stats.filter((s) => s.executions > 0);
  const triggered = stats.filter((s) => s.hits > 0);
  const dead      = executed.filter((s) => s.hits === 0);
  const notRun    = stats.filter((s) => s.executions === 0);

  // Per-layer aggregates
  const byLayer: Record<number, { executed: number; triggered: number; hitRate: number }> = {};
  for (let layer = 1; layer <= 8; layer++) {
    const layerStats = executed.filter((s) => s.layer === layer);
    const layerTriggered = triggered.filter((s) => s.layer === layer);
    byLayer[layer] = {
      executed: layerStats.length,
      triggered: layerTriggered.length,
      hitRate: layerStats.length > 0 ? Math.round((layerTriggered.length / layerStats.length) * 100) : 0,
    };
  }

  return {
    findings: findings as never,
    analytics: {
      totalRules: rules.length,
      rulesExecuted:  executed.length,
      rulesTriggered: triggered.length,
      rulesDead:      dead.length,
      rulesNotRun:    notRun.length,
      overallHitRate: executed.length > 0 ? Math.round((triggered.length / executed.length) * 100 * 10) / 10 : 0,
      byLayer,
      stats,
      generatedAt: new Date().toISOString(),
    }
  };
}

// Convenience: run all rules with analytics
export function analyseWithCoverage(files: EngineFile[]) {
  return runRulesWithAnalytics(ALL_RULES, files);
}

function interpolate(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => ctx[k] ?? k);
}

function fc(v: number): string { return `£${Math.round(Math.abs(v)).toLocaleString()}`; }

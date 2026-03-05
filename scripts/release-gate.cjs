#!/usr/bin/env node
const fs = require("fs");

const REPORT_PATH = "test_results/agent_certification_report.md";
const QUALITY_GATE_REPORT_PATH = "test_results/quality-gate-report.json";
const MAX_REPORT_AGE_HOURS = 24;

function checkReleaseGate() {
  console.log("🔒 Checking release gate...\n");
  
  if (!fs.existsSync(REPORT_PATH)) {
    return {
      passed: false,
      reason: `Certification report not found at ${REPORT_PATH}. Run 'npm run agent:certify' first.`,
    };
  }

  if (!fs.existsSync(QUALITY_GATE_REPORT_PATH)) {
    return {
      passed: false,
      reason: `Quality gate report not found at ${QUALITY_GATE_REPORT_PATH}. Run 'npm run quality:gate' first.`,
    };
  }

  let qualityReportStatus = "unknown";
  try {
    const qualityReport = JSON.parse(fs.readFileSync(QUALITY_GATE_REPORT_PATH, "utf-8"));
    qualityReportStatus = qualityReport?.status || "unknown";
    if (qualityReportStatus !== "passed") {
      return {
        passed: false,
        reason: `Quality gate report indicates failure (${qualityReportStatus}).`,
      };
    }
  } catch {
    return {
      passed: false,
      reason: `Quality gate report is invalid JSON: ${QUALITY_GATE_REPORT_PATH}.`,
    };
  }
  
  const stats = fs.statSync(REPORT_PATH);
  const ageHours = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60);
  
  if (ageHours > MAX_REPORT_AGE_HOURS) {
    return {
      passed: false,
      reason: `Certification report is ${ageHours.toFixed(1)} hours old (max: ${MAX_REPORT_AGE_HOURS}h). Run 'npm run agent:certify' again.`,
    };
  }
  
  const content = fs.readFileSync(REPORT_PATH, "utf-8");
  
  if (content.includes("Status**: ✅ PASSED")) {
    return {
      passed: true,
      reason: "Agent certification passed. Release gate open.",
    };
  }
  
  if (content.includes("Status**: ❌ FAILED")) {
    return {
      passed: false,
      reason: "Agent certification failed. Fix issues and run 'npm run agent:certify' again.",
    };
  }
  
  return {
    passed: false,
    reason: "Could not determine certification status from report.",
  };
}

function main() {
  const result = checkReleaseGate();
  
  if (result.passed) {
    console.log("✅ " + result.reason);
    console.log("\n🚀 Release gate: OPEN");
    process.exit(0);
  } else {
    console.log("❌ " + result.reason);
    console.log("\n🛑 Release gate: BLOCKED");
    process.exit(1);
  }
}

main();

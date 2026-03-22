import { collectDoctorReport, type DoctorReport } from './doctor-report.js';

const SECTION_ORDER = ['Runtime', 'Dependencies', 'Daemon', 'Paths'] as const;

export interface RunDoctorDependencies {
  collectDoctorReport: () => Promise<DoctorReport>;
  log: (message: string) => void;
  setExitCode: (code: number) => void;
}

export async function runDoctor(
  dependencies: RunDoctorDependencies = createRunDoctorDependencies(),
): Promise<number> {
  const report = await dependencies.collectDoctorReport();
  for (const line of renderDoctorReport(report)) {
    dependencies.log(line);
  }

  dependencies.setExitCode(report.exitCode);
  return report.exitCode;
}

export function renderDoctorReport(report: DoctorReport): string[] {
  const lines = [`[agentune] Doctor summary: ${report.summary}`];

  for (const section of SECTION_ORDER) {
    const checks = report.checks.filter((check) => check.section === section);
    if (checks.length === 0) {
      continue;
    }

    lines.push(`[agentune] ${section}`);
    for (const check of checks) {
      lines.push(`[agentune]   ${check.status.padEnd(4)} ${check.name}: ${check.detail}`);
    }
  }

  return lines;
}

function createRunDoctorDependencies(): RunDoctorDependencies {
  return {
    collectDoctorReport,
    log: (message) => {
      console.error(message);
    },
    setExitCode: (code) => {
      process.exitCode = code;
    },
  };
}

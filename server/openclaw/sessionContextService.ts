import type { OpenClawWorkspaceContext } from "@shared/openclawWorkspaceContext";
import type { OpenClawRepositorySnapshot } from "@shared/openclawRepositorySnapshot";
import { repositorySnapshotService } from "./repositorySnapshotService";

export interface OpenClawSessionContextRecord {
  runId: string;
  workspaceContext: OpenClawWorkspaceContext;
  repositorySnapshot: OpenClawRepositorySnapshot;
  createdAt: number;
  updatedAt: number;
}

const MAX_CONTEXT_RECORDS = 1000;

class OpenClawSessionContextService {
  private readonly records = new Map<string, OpenClawSessionContextRecord>();

  remember(
    runId: string,
    workspaceContext: OpenClawWorkspaceContext,
  ): OpenClawSessionContextRecord {
    const now = Date.now();
    const existing = this.records.get(runId);
    const shouldRefreshSnapshot =
      !existing ||
      existing.workspaceContext.repositoryPath !== workspaceContext.repositoryPath ||
      existing.workspaceContext.selectedFolder !== workspaceContext.selectedFolder ||
      existing.workspaceContext.branch !== workspaceContext.branch;
    const repositorySnapshot =
      shouldRefreshSnapshot
        ? repositorySnapshotService.capture(workspaceContext)
        : existing.repositorySnapshot;
    const record: OpenClawSessionContextRecord = {
      runId,
      workspaceContext,
      repositorySnapshot,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    this.records.set(runId, record);
    this.trim();
    return record;
  }

  get(runId?: string): OpenClawSessionContextRecord | undefined {
    if (!runId) return undefined;
    return this.records.get(runId);
  }

  resolveWorkspaceContext(runId?: string): OpenClawWorkspaceContext | undefined {
    return this.get(runId)?.workspaceContext;
  }

  resolveRepositorySnapshot(
    runId?: string,
  ): OpenClawRepositorySnapshot | undefined {
    return this.get(runId)?.repositorySnapshot;
  }

  clear(): void {
    this.records.clear();
  }

  private trim(): void {
    if (this.records.size <= MAX_CONTEXT_RECORDS) return;
    const overflow = this.records.size - MAX_CONTEXT_RECORDS;
    const ordered = Array.from(this.records.values()).sort(
      (left, right) => left.updatedAt - right.updatedAt,
    );
    for (let index = 0; index < overflow; index += 1) {
      this.records.delete(ordered[index].runId);
    }
  }
}

export const openclawSessionContextService =
  new OpenClawSessionContextService();

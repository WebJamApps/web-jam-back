export type OperationStatus = 'in_progress' | 'completed' | 'failed';

export interface BackupOperation {
  name: string;
  type: string;
  status: OperationStatus;
  startedAt: string;
  finishedAt?: string | null;
  progress?: string | null;
  result?: unknown;
  error?: string | null;
}

const operations = new Map<string, BackupOperation>();

export function recordOperation(op: Partial<BackupOperation> & { name: string }): BackupOperation {
  const existing = operations.get(op.name) || {
    name: op.name,
    type: op.type || 'backup',
    status: 'in_progress' as OperationStatus,
    startedAt: op.startedAt || new Date().toISOString(),
    finishedAt: null,
    progress: op.progress || 'starting',
    result: null,
    error: null,
  };
  const updated: BackupOperation = {
    ...existing,
    ...op,
  };
  operations.set(op.name, updated);
  return updated;
}

export function updateOperation(name: string, update: Partial<BackupOperation>): BackupOperation | undefined {
  const op = operations.get(name);
  if (!op) return undefined;
  const updated: BackupOperation = {
    ...op,
    ...update,
  };
  operations.set(name, updated);
  return updated;
}

export function getOperation(name: string): BackupOperation | undefined {
  return operations.get(name);
}

export function listOperations(): BackupOperation[] {
  return Array.from(operations.values());
}

export function resetOperations(): void {
  operations.clear();
}

export default {
  recordOperation,
  updateOperation,
  getOperation,
  listOperations,
  resetOperations,
};

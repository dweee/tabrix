import { logger } from '../logging/logger';

const mkeMemoryTraceLogger = logger.child('mke-memory-trace');

export interface AsyncBrowserObjectWriteJob {
  traceId: string;
  toolName: string;
  run(): void;
}

export class BoundedAsyncBrowserObjectWriteQueue {
  private queue: AsyncBrowserObjectWriteJob[] = [];
  private scheduled = false;
  private running = false;
  private flushResolvers: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  public enqueue(job: AsyncBrowserObjectWriteJob): void {
    if (this.limit <= 0) {
      mkeMemoryTraceLogger.warn('async browser object write dropped because queue is disabled', {
        traceId: job.traceId,
        toolName: job.toolName,
      });
      return;
    }
    if (this.queue.length >= this.limit) {
      const dropped = this.queue.shift();
      mkeMemoryTraceLogger.warn('async browser object write queue full; dropping oldest job', {
        droppedTraceId: dropped?.traceId ?? null,
        droppedToolName: dropped?.toolName ?? null,
        traceId: job.traceId,
        toolName: job.toolName,
        queueLimit: this.limit,
      });
    }
    this.queue.push(job);
    this.schedule();
  }

  public flush(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => {
      this.flushResolvers.push(resolve);
    });
  }

  public discardPending(): void {
    this.queue = [];
    this.resolveFlushersIfIdle();
  }

  private schedule(): void {
    if (this.scheduled || this.running) return;
    this.scheduled = true;
    setImmediate(() => this.runQueuedJobs());
  }

  private runQueuedJobs(): void {
    this.scheduled = false;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift();
        if (!job) continue;
        try {
          job.run();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          mkeMemoryTraceLogger.warn('async browser object write failed', {
            traceId: job.traceId,
            toolName: job.toolName,
            errorMessage: message,
          });
        }
      }
    } finally {
      this.running = false;
      this.resolveFlushersIfIdle();
      if (this.queue.length > 0) this.schedule();
    }
  }

  private isIdle(): boolean {
    return this.queue.length === 0 && !this.scheduled && !this.running;
  }

  private resolveFlushersIfIdle(): void {
    if (!this.isIdle()) return;
    const resolvers = this.flushResolvers.splice(0);
    for (const resolve of resolvers) resolve();
  }
}

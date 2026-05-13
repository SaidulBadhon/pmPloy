type Listener<T> = (value: T) => void;

/**
 * Minimal in-process pub/sub keyed by string topic. Used for streaming
 * deployment log lines to SSE subscribers.
 */
export class PubSub<T> {
  private listeners = new Map<string, Set<Listener<T>>>();

  subscribe(topic: string, fn: Listener<T>): () => void {
    let set = this.listeners.get(topic);
    if (!set) {
      set = new Set();
      this.listeners.set(topic, set);
    }
    set.add(fn);
    return () => {
      set?.delete(fn);
      if (set?.size === 0) this.listeners.delete(topic);
    };
  }

  publish(topic: string, value: T): void {
    const set = this.listeners.get(topic);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(value);
      } catch {
        // listener errors must not affect other subscribers
      }
    }
  }

  count(topic: string): number {
    return this.listeners.get(topic)?.size ?? 0;
  }
}

export type DeployLogEvent =
  | { type: "log"; line: string }
  | { type: "status"; status: string }
  | { type: "done" };

export const deployBus = new PubSub<DeployLogEvent>();

export function deployTopic(deploymentId: string): string {
  return `deploy:${deploymentId}`;
}

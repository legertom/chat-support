import { useEffect, useState } from "react";
import {
  fetchThreads,
  fetchThread,
  createThread,
  type ThreadListItem,
  type ThreadDetailResponse,
} from "@/components/api-client";

export function useThreads() {
  const [threads, setThreads] = useState<ThreadListItem[]>([]);
  const [threadDetail, setThreadDetail] = useState<ThreadDetailResponse | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadsScope, setThreadsScope] = useState<"all" | "mine">("all");
  const [threadsCursor, setThreadsCursor] = useState<string | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingThreadDetail, setLoadingThreadDetail] = useState(false);

  useEffect(() => {
    void loadThreads();
  }, [threadsScope]);

  useEffect(() => {
    if (!selectedThreadId) {
      setThreadDetail(null);
      return;
    }
    void loadThreadDetail();
  }, [selectedThreadId]);

  async function loadThreads() {
    try {
      setLoadingThreads(true);
      const response = await fetchThreads(threadsScope);
      setThreads(response.items);
      setThreadsCursor(response.nextCursor);

      if (response.items.length === 0) {
        setSelectedThreadId(null);
        return;
      }

      setSelectedThreadId((current) => {
        if (current && response.items.some((thread) => thread.id === current)) {
          return current;
        }
        return response.items[0].id;
      });
    } catch (error) {
      console.error("Failed to load threads:", error);
      throw error;
    } finally {
      setLoadingThreads(false);
    }
  }

  async function loadThreadDetail() {
    if (!selectedThreadId) {
      return;
    }

    try {
      setLoadingThreadDetail(true);
      const detail = await fetchThread(selectedThreadId);
      setThreadDetail(detail);
    } catch (error) {
      console.error("Failed to load thread detail:", error);
      throw error;
    } finally {
      setLoadingThreadDetail(false);
    }
  }

  async function createNewThread(visibility: "org" | "private" = "org"): Promise<string> {
    const response = await createThread(visibility);
    await loadThreads();
    return response.thread.id;
  }

  async function loadMoreThreads() {
    if (!threadsCursor) {
      return;
    }

    try {
      const response = await fetchThreads(threadsScope, threadsCursor);
      setThreads((current) => [...current, ...response.items]);
      setThreadsCursor(response.nextCursor);
    } catch (error) {
      console.error("Failed to load more threads:", error);
      throw error;
    }
  }

  function selectThread(threadId: string) {
    setSelectedThreadId(threadId);
  }

  return {
    threads,
    threadDetail,
    selectedThreadId,
    selectThread,
    createThread: createNewThread,
    loadThreads,
    loadThreadDetail,
    loadMoreThreads,
    threadsScope,
    setThreadsScope,
    hasMore: threadsCursor !== null,
    loadingThreads,
    loadingThreadDetail,
  };
}

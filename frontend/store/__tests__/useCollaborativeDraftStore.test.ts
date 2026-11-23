import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCollaborativeDraftStore } from "../useCollaborativeDraftStore";

function resetStore() {
  useCollaborativeDraftStore.setState({
    draftId: null,
    fields: {},
    presence: {},
    conflicts: [],
    pendingChanges: [],
    isConnected: false,
    isSaving: false,
    lastSyncedAt: null,
  });
}

describe("useCollaborativeDraftStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    act(() => {
      resetStore();
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      resetStore();
    });
    localStorage.clear();
    vi.useRealTimers();
  });

  it("initializes a draft with versioned fields", () => {
    const { result } = renderHook(() => useCollaborativeDraftStore());

    act(() => {
      result.current.initDraft("draft-1", { title: "Old title", price: "100" });
    });

    expect(result.current.draftId).toBe("draft-1");
    expect(result.current.fields.title).toEqual({
      key: "title",
      value: "Old title",
      lastEditedBy: null,
      lastEditedAt: null,
      version: 0,
    });
    expect(Object.keys(result.current.fields)).toEqual(["title", "price"]);
    expect(result.current.lastSyncedAt).toBeTypeOf("number");
  });

  it("tracks local edits and queues at most one change per field", () => {
    const { result } = renderHook(() => useCollaborativeDraftStore());

    act(() => {
      result.current.initDraft("draft-1", { title: "Old title" });
      result.current.setFieldValue("title", "New title", "user-1");
      result.current.setFieldValue("title", "Newest title", "user-1");
    });

    expect(result.current.fields.title.value).toBe("Newest title");
    expect(result.current.fields.title.lastEditedBy).toBe("user-1");
    expect(result.current.fields.title.version).toBe(2);
    expect(result.current.pendingChanges).toHaveLength(1);
    expect(result.current.pendingChanges[0]).toEqual(
      expect.objectContaining({
        field: "title",
        value: "Newest title",
        localVersion: 2,
      }),
    );
  });

  it("applies a newer remote change and drops the pending change", () => {
    const { result } = renderHook(() => useCollaborativeDraftStore());

    act(() => {
      result.current.initDraft("draft-1", { title: "Old title" });
      result.current.setFieldValue("title", "Local title", "user-1");
      result.current.applyRemoteChange("title", "Remote title", 5, "user-2");
    });

    expect(result.current.fields.title.value).toBe("Remote title");
    expect(result.current.fields.title.version).toBe(5);
    expect(result.current.conflicts).toHaveLength(0);
    expect(result.current.pendingChanges).toHaveLength(0);
  });

  it("records a conflict for concurrent edits and does not duplicate it", () => {
    const { result } = renderHook(() => useCollaborativeDraftStore());

    act(() => {
      result.current.initDraft("draft-1", { title: "Old title" });
      result.current.setFieldValue("title", "Local title", "user-1");
      result.current.applyRemoteChange("title", "Remote title", 1, "user-2");
    });

    expect(result.current.fields.title.value).toBe("Local title");
    expect(result.current.conflicts).toHaveLength(1);
    expect(result.current.conflicts[0]).toEqual(
      expect.objectContaining({
        field: "title",
        localValue: "Local title",
        remoteValue: "Remote title",
        localVersion: 1,
        remoteVersion: 1,
        remoteUserId: "user-2",
        resolution: null,
      }),
    );

    act(() => {
      result.current.applyRemoteChange("title", "Another remote title", 1, "user-2");
    });
    expect(result.current.conflicts).toHaveLength(1);
  });

  it("resolves a conflict with the remote value", () => {
    const { result } = renderHook(() => useCollaborativeDraftStore());

    act(() => {
      result.current.initDraft("draft-1", { title: "Old title" });
      result.current.setFieldValue("title", "Local title", "user-1");
      result.current.applyRemoteChange("title", "Remote title", 1, "user-2");
    });
    act(() => {
      result.current.resolveConflict("title", "remote");
    });

    expect(result.current.fields.title.value).toBe("Remote title");
    expect(result.current.fields.title.version).toBe(2);
    expect(result.current.conflicts[0].resolution).toBe("remote");
    expect(result.current.conflicts[0].resolvedAt).toBeTypeOf("number");
  });

  it("resolves a conflict with the local value", () => {
    const { result } = renderHook(() => useCollaborativeDraftStore());

    act(() => {
      result.current.initDraft("draft-1", { title: "Old title" });
      result.current.setFieldValue("title", "Local title", "user-1");
      result.current.applyRemoteChange("title", "Remote title", 1, "user-2");
    });
    act(() => {
      result.current.resolveConflict("title", "local");
    });

    expect(result.current.fields.title.value).toBe("Local title");
    expect(result.current.conflicts[0].resolution).toBe("local");
  });

  it("tracks presence, focus, and presence removal", () => {
    const { result } = renderHook(() => useCollaborativeDraftStore());

    act(() => {
      result.current.updatePresence({
        userId: "user-1",
        userName: "Alice",
        focusedField: "title",
        lastSeenAt: 1,
        color: "#000000",
      });
    });

    expect(result.current.presence["user-1"].userName).toBe("Alice");
    const color = result.current.presence["user-1"].color;

    act(() => {
      result.current.setFocus("price", "user-1", "Alice");
    });

    expect(result.current.presence["user-1"].focusedField).toBe("price");
    expect(result.current.presence["user-1"].color).toBe(color);
    expect(result.current.presence["user-1"].lastSeenAt).toBeTypeOf("number");

    act(() => {
      result.current.removePresence("user-1");
    });
    expect(result.current.presence["user-1"]).toBeUndefined();
  });

  it("flushes pending changes and marks the draft saved", () => {
    const { result } = renderHook(() => useCollaborativeDraftStore());

    act(() => {
      result.current.initDraft("draft-1", { title: "Old title" });
      result.current.setConnected(true);
      result.current.setFieldValue("title", "Local title", "user-1");
    });

    expect(result.current.isConnected).toBe(true);

    let changes: ReturnType<typeof result.current.flushPendingChanges>;
    act(() => {
      changes = result.current.flushPendingChanges();
    });

    expect(changes!).toHaveLength(1);
    expect(result.current.pendingChanges).toHaveLength(0);

    act(() => {
      result.current.markSaved();
    });

    expect(result.current.isSaving).toBe(false);
    expect(result.current.lastSyncedAt).toBeTypeOf("number");
  });

  it("ignores conflicts and presence removals for unknown entries", () => {
    const { result } = renderHook(() => useCollaborativeDraftStore());

    act(() => {
      result.current.resolveConflict("missing", "local");
      result.current.removePresence("ghost");
    });

    expect(result.current.conflicts).toHaveLength(0);
    expect(result.current.presence).toEqual({});
  });

  it("does not read or write localStorage when initialized", () => {
    localStorage.setItem(
      "shelterflex-collaborative-draft-storage",
      "{corrupt",
    );

    const { result } = renderHook(() => useCollaborativeDraftStore());

    act(() => {
      result.current.initDraft("draft-2", { title: "Fresh title" });
    });

    expect(result.current.draftId).toBe("draft-2");
    expect(result.current.fields.title.value).toBe("Fresh title");
    expect(localStorage.getItem("shelterflex-collaborative-draft-storage")).toBe(
      "{corrupt",
    );
  });
});

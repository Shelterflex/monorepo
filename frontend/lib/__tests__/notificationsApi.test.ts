import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../apiClient", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

import { apiGet, apiPost } from "../apiClient";
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "../notificationsApi";

const getMock = vi.mocked(apiGet);
const postMock = vi.mocked(apiPost);

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
});

describe("fetchNotifications", () => {
  it("GETs the notifications list without a query string when no filters are given", async () => {
    getMock.mockResolvedValueOnce({ success: true, data: { items: [], nextCursor: null } });

    const result = await fetchNotifications();

    expect(getMock).toHaveBeenCalledWith("/api/v1/notifications");
    expect(result).toEqual({ success: true, data: { items: [], nextCursor: null } });
  });

  it("serialises every filter into the query string", async () => {
    getMock.mockResolvedValueOnce({ success: true, data: { items: [], nextCursor: null } });

    await fetchNotifications({ cursor: "c1", limit: 20, category: "deal", read: false });

    expect(getMock).toHaveBeenCalledWith("/api/v1/notifications?cursor=c1&limit=20&category=deal&read=false");
  });

  it("serialises read=true into the query string", async () => {
    getMock.mockResolvedValueOnce({ success: true, data: { items: [], nextCursor: null } });

    await fetchNotifications({ read: true });

    expect(getMock).toHaveBeenCalledWith("/api/v1/notifications?read=true");
  });

  it("propagates request failures", async () => {
    getMock.mockRejectedValueOnce(new Error("500"));
    await expect(fetchNotifications()).rejects.toThrow("500");
  });
});

describe("markNotificationRead", () => {
  it("POSTs an empty body to the item's read endpoint", async () => {
    postMock.mockResolvedValueOnce({ success: true });

    await expect(markNotificationRead("n-1")).resolves.toEqual({ success: true });
    expect(postMock).toHaveBeenCalledWith("/api/v1/notifications/n-1/read", {});
  });

  it("propagates request failures", async () => {
    postMock.mockRejectedValueOnce(new Error("404"));
    await expect(markNotificationRead("missing")).rejects.toThrow("404");
  });
});

describe("markAllNotificationsRead", () => {
  it("POSTs an empty body to the read-all endpoint", async () => {
    postMock.mockResolvedValueOnce({ success: true });

    await markAllNotificationsRead();

    expect(postMock).toHaveBeenCalledWith("/api/v1/notifications/read-all", {});
  });
});

describe("fetchUnreadCount", () => {
  it("GETs the unread count and returns the parsed payload", async () => {
    getMock.mockResolvedValueOnce({ success: true, data: { unread: 3 } });

    await expect(fetchUnreadCount()).resolves.toEqual({ success: true, data: { unread: 3 } });
    expect(getMock).toHaveBeenCalledWith("/api/v1/notifications/unread-count");
  });
});

"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Search,
  Send,
  Paperclip,
  MoreVertical,
  Clock,
  ImageIcon,
  File,
  ChevronLeft,
  MessageSquareOff,
  MessageCircle,
  Lock,
  AlertCircle,
  Loader2,
  RefreshCw,
  X,
  Upload,
  Download,
  Users,
  ArrowDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  ErrorState,
  ListRowSkeleton,
  LoadingState,
} from "@/components/ui/data-state";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import useAuthStore from "@/store/useAuthStore";
import { sanitizeText } from "@/lib/sanitize";
import { formatDate } from "@/lib/date";
import {
  fetchConversations,
  fetchMessages,
  sendMessage,
  markConversationRead,
  requestAttachmentUploadUrl,
  uploadAttachmentToPresignedUrl,
  validateFileForUpload,
} from "@/lib/api/messaging";
import type {
  ConversationWithLastMessage,
  Message as ApiMessage,
  MessageAttachment,
  AttachmentUploadResult,
} from "@/lib/types/messaging";
import { handleError } from "@/lib/toast";
import { isNetworkError } from "@/lib/errors";

type LocalMessage = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
  status: "sending" | "sent" | "failed";
  attachment: MessageAttachment | null;
  isOptimistic?: boolean;
};

type UploadState = {
  file: File;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
  result?: AttachmentUploadResult;
};

function generateIdempotencyKey(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(date);
}

function apiMessageToLocal(_msg: ApiMessage): LocalMessage {
  return {
    id: _msg.id,
    senderId: _msg.senderId,
    body: _msg.body,
    createdAt: _msg.createdAt,
    status: "sent",
    attachment: _msg.attachment,
  };
}

function getParticipantName(conv: ConversationWithLastMessage, currentUserId: string): string {
  const other = conv.participants.find(p => p.userId !== currentUserId);
  return other?.userId ?? "Unknown";
}

function getParticipantInitials(name: string): string {
  return name.charAt(0).toUpperCase();
}

export default function MessagesPage() {
  const { isAuthenticated, user } = useAuthStore();
  const currentUserId = user?.id ?? "";
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const newMessage = selectedConversationId !== null ? drafts[selectedConversationId] || "" : "";
  const setNewMessage = (val: string) => {
    if (selectedConversationId !== null) {
      setDrafts(prev => ({ ...prev, [selectedConversationId]: val }));
    }
  };

  const [conversations, setConversations] = useState<ConversationWithLastMessage[]>([]);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const selectedConversationIdRef = useRef(selectedConversationId);
  selectedConversationIdRef.current = selectedConversationId;
  const [isSending, setIsSending] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);

  const [hasMoreConversations, setHasMoreConversations] = useState(false);
  const [conversationCursor, setConversationCursor] = useState<string | null>(null);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageContainerRef = useRef<HTMLDivElement>(null);
  const conversationContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const idempotencyKeyRef = useRef<string>(generateIdempotencyKey());
  const searchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const prependHeightRef = useRef<number | null>(null);
  const shouldAutoScrollRef = useRef(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom();
    }
  }, [messages, isAtBottom, scrollToBottom]);

  const handleDebouncedSearch = useCallback((value: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (value.trim()) {
      setIsSearching(true);
    }
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(value.trim());
      if (!value.trim()) setIsSearching(false);
    }, 300);
  }, []);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  // Bumped by the error state's retry so the effect below re-runs.
  const [conversationsReloadToken, setConversationsReloadToken] = useState(0);
  const retryConversations = useCallback(
    () => setConversationsReloadToken((token) => token + 1),
    [],
  );

  useEffect(() => {
    if (!isAuthenticated) return;

    const loadConversations = async () => {
      setIsLoadingConversations(true);
      setConversationsError(null);
      try {
        const result = await fetchConversations(undefined, 50, debouncedSearch || undefined);
        setConversations(result.items);
        setConversationCursor(result.nextCursor);
        setHasMoreConversations(result.nextCursor !== null);
        if (result.items.length > 0 && !selectedConversationId) {
          setSelectedConversationId(result.items[0].id);
        }
      } catch (err) {
        setConversationsError((err as Error).message || "Failed to load conversations");
      } finally {
        setIsLoadingConversations(false);
        setIsSearching(false);
      }
    };

    loadConversations();
  }, [isAuthenticated, debouncedSearch, conversationsReloadToken]);

  const loadMoreConversations = useCallback(async () => {
    if (!hasMoreConversations || !conversationCursor || isLoadingConversations) return;
    setIsLoadingConversations(true);
    try {
      const result = await fetchConversations(conversationCursor, 50, debouncedSearch || undefined);
      setConversations(prev => [...prev, ...result.items]);
      setConversationCursor(result.nextCursor);
      setHasMoreConversations(result.nextCursor !== null);
    } catch {
    } finally {
      setIsLoadingConversations(false);
    }
  }, [hasMoreConversations, conversationCursor, isLoadingConversations, debouncedSearch]);

  useEffect(() => {
    if (!selectedConversationId || !isAuthenticated) return;

    const loadMessages = async () => {
      setIsLoadingMessages(true);
      setMessagesError(null);
      setHasMoreMessages(false);
      setMessageCursor(null);
      setIsAtBottom(true);
      setShowJumpToLatest(false);
      try {
        const result = await fetchMessages(selectedConversationId, undefined, 50);
        setMessages(result.items.map(m => apiMessageToLocal(m)));
        setMessageCursor(result.nextCursor);
        setHasMoreMessages(result.nextCursor !== null);
        await markConversationRead(selectedConversationId);
        setConversations(prev =>
          prev.map(c =>
            c.id === selectedConversationId ? { ...c, unreadCount: 0 } : c,
          ),
        );
      } catch (err) {
        setMessagesError((err as Error).message || "Failed to load messages");
      } finally {
        setIsLoadingMessages(false);
      }
    };

    loadMessages();

    const pollInterval = setInterval(async () => {
      try {
        const result = await fetchMessages(selectedConversationId, undefined, 50);
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const newMsgs = result.items
            .filter(m => !existingIds.has(m.id))
            .map(m => apiMessageToLocal(m));
          return newMsgs.length > 0 ? [...prev, ...newMsgs] : prev;
        });
      } catch {
      }
    }, 5000);

    pollTimerRef.current = pollInterval;

    const handleVisibility = () => {
      if (document.hidden && pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      } else if (!document.hidden && selectedConversationId) {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        const interval = setInterval(async () => {
          try {
            const result = await fetchMessages(selectedConversationId, undefined, 50);
            setMessages(prev => {
              const existingIds = new Set(prev.map(m => m.id));
              const newMsgs = result.items
                .filter(m => !existingIds.has(m.id))
                .map(m => apiMessageToLocal(m));
              return newMsgs.length > 0 ? [...prev, ...newMsgs] : prev;
            });
          } catch {
          }
        }, 5000);
        pollTimerRef.current = interval;
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [selectedConversationId, isAuthenticated, currentUserId]);

  const loadOlderMessages = useCallback(async () => {
    if (!hasMoreMessages || !messageCursor || !selectedConversationId || isLoadingMoreMessages) return;
    setIsLoadingMoreMessages(true);
    try {
      const container = messageContainerRef.current;
      const prevScrollHeight = container?.scrollHeight ?? 0;

      const result = await fetchMessages(selectedConversationId, messageCursor, 50);
      const olderMessages = result.items.map(m => apiMessageToLocal(m));
      setMessages(prev => [...olderMessages, ...prev]);
      setMessageCursor(result.nextCursor);
      setHasMoreMessages(result.nextCursor !== null);

      requestAnimationFrame(() => {
        if (container) {
          const newScrollHeight = container.scrollHeight;
          const heightDiff = newScrollHeight - prevScrollHeight;
          container.scrollTop += heightDiff;
        }
      });
    } catch {
    } finally {
      setIsLoadingMoreMessages(false);
    }
  }, [hasMoreMessages, messageCursor, selectedConversationId, isLoadingMoreMessages]);

  const handleConversationScroll = useCallback(() => {
    const container = conversationContainerRef.current;
    if (!container) return;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
    if (atBottom) {
      loadMoreConversations();
    }
  }, [loadMoreConversations]);

  const handleMessageScroll = useCallback(() => {
    const container = messageContainerRef.current;
    if (!container) return;

    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
    setIsAtBottom(atBottom);
    setShowJumpToLatest(!atBottom);

    if (container.scrollTop < 100 && hasMoreMessages && !isLoadingMoreMessages) {
      loadOlderMessages();
    }
  }, [hasMoreMessages, isLoadingMoreMessages, loadOlderMessages]);

  const handleSelectConversation = useCallback((id: string) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setSelectedConversationId(id);
    setMessages([]);
    setIsLoadingMessages(true);
    setMessagesError(null);
  }, []);

  const handleJumpToLatest = useCallback(() => {
    scrollToBottom("instant");
    setIsAtBottom(true);
    setShowJumpToLatest(false);
  }, [scrollToBottom]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validation = validateFileForUpload(file);
    if (!validation.valid) {
      setUploadState({ file, progress: 0, status: "error", error: validation.error });
      return;
    }

    setUploadState({ file, progress: 0, status: "pending" });
    const controller = new AbortController();
    uploadAbortRef.current = controller;

    try {
      const { uploadUrl, storageKey } = await requestAttachmentUploadUrl(file.type, file.size, file.name);
      setUploadState(prev => prev && prev.file === file ? { ...prev, status: "uploading", progress: 0 } : prev);

      await uploadAttachmentToPresignedUrl(uploadUrl, file, (percent) => {
        setUploadState(prev => prev && prev.file === file ? { ...prev, progress: percent } : prev);
      }, controller.signal);

      const fileType: "image" | "document" = file.type.startsWith("image/") ? "image" : "document";
      setUploadState({
        file, progress: 100, status: "done",
        result: { storageKey, contentType: file.type, sizeBytes: file.size, type: fileType, name: file.name, url: uploadUrl.split("?")[0] },
      });
    } catch (err) {
      if ((err as Error).message === "Upload cancelled") { setUploadState(null); return; }
      setUploadState(prev => prev && prev.file === file ? { ...prev, status: "error", error: (err as Error).message || "Upload failed" } : prev);
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleCancelUpload = useCallback(() => {
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    setUploadState(null);
  }, []);

  const handleRemoveAttachment = useCallback(() => {
    setUploadState(null);
  }, []);

  const getFileSizeDisplay = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleSendMessage = useCallback(async () => {
    const text = sanitizeText(newMessage).trim();
    if ((!text && !uploadState) || isSending || !selectedConversationId) return;

    let attachment: MessageAttachment | undefined;
    if (uploadState?.status === "done" && uploadState.result) {
      attachment = {
        type: uploadState.result.type,
        name: uploadState.result.name,
        storageKey: uploadState.result.storageKey,
        contentType: uploadState.result.contentType,
        sizeBytes: uploadState.result.sizeBytes,
      };
    }

    const optimisticMsg: LocalMessage = {
      id: `optimistic-${Date.now()}`,
      senderId: currentUserId,
      body: text || (attachment ? `Sent a ${attachment.type}` : ""),
      createdAt: new Date().toISOString(),
      status: "sending",
      attachment: attachment ?? null,
      isOptimistic: true,
    };

    setMessages(prev => [...prev, optimisticMsg]);
    setDrafts(prev => {
      const convId = selectedConversationIdRef.current;
      if (convId === null) return prev;
      return { ...prev, [convId]: "" };
    });
    setUploadState(null);
    setComposerError(null);
    setIsSending(true);
    setIsAtBottom(true);

    const key = idempotencyKeyRef.current;
    idempotencyKeyRef.current = generateIdempotencyKey();

    try {
      const sent = await sendMessage(selectedConversationId, text || "sent", key, attachment);
      setMessages(prev =>
        prev.map(m => m.id === optimisticMsg.id ? { ...apiMessageToLocal(sent), status: "sent" as const } : m),
      );
      setConversations(prev => prev.map(c => ({
        ...c,
        lastMessage: c.id === selectedConversationId ? { text: text || (attachment ? `Sent a ${attachment.type}` : ""), senderId: currentUserId, createdAt: new Date().toISOString() } : c.lastMessage,
        updatedAt: new Date().toISOString(),
      })));
    } catch (error) {
      setMessages(prev =>
        prev.map(m => m.id === optimisticMsg.id ? { ...m, status: "failed" as const } : m),
      );
      const errorMessage = isNetworkError(error)
        ? "You appear to be offline. Your message is still unsent."
        : "Your message could not be sent. Please try again."
      setComposerError(errorMessage);
      handleError(error, errorMessage);
    } finally {
      setIsSending(false);
    }
  }, [newMessage, isSending, selectedConversationId, currentUserId, uploadState]);

  const handleRetry = useCallback(async (failedMsg: LocalMessage) => {
    if (isSending || !selectedConversationId) return;

    setMessages(prev => prev.map(m => m.id === failedMsg.id ? { ...m, status: "sending" } : m));
    setComposerError(null);
    setIsSending(true);

    const key = generateIdempotencyKey();

    try {
      const sent = await sendMessage(
        selectedConversationId,
        failedMsg.body,
        key,
        failedMsg.attachment ?? undefined,
      );
      setMessages(prev =>
        prev.map(m => m.id === failedMsg.id ? { ...apiMessageToLocal(sent), status: "sent" as const } : m),
      );
    } catch (error) {
      setMessages(prev =>
        prev.map(m => m.id === failedMsg.id ? { ...m, status: "failed" as const } : m),
      );
      const errorMessage = isNetworkError(error)
        ? "You appear to be offline. Retry will resume when your connection returns."
        : "Message retry failed. Please try again."
      setComposerError(errorMessage);
      handleError(error, errorMessage);
    } finally {
      setIsSending(false);
    }
  }, [isSending, selectedConversationId, currentUserId]);

  const selectedConv = conversations.find(c => c.id === selectedConversationId);
  const hasSearchResults = conversations.length > 0;
  const showNoResults = !isLoadingConversations && !conversationsError && debouncedSearch && !hasSearchResults;
  const showNoConversations = !isLoadingConversations && !conversationsError && !debouncedSearch && !hasSearchResults;

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background pt-20">
        <div className="mx-auto max-w-md border-3 border-foreground bg-card p-8 shadow-[6px_6px_0px_0px_rgba(26,26,26,1)] text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center border-3 border-foreground bg-muted">
            <Lock className="h-10 w-10 text-muted-foreground" />
          </div>
          <h1 className="font-mono text-2xl font-black mb-3">Sign In Required</h1>
          <p className="text-muted-foreground mb-6">
            You need to be signed in to access your messages.
          </p>
          <div className="flex flex-col gap-3">
            <Link href="/login">
              <Button className="w-full border-3 border-foreground bg-primary py-6 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                Sign In
              </Button>
            </Link>
            <Link href="/signup">
              <Button variant="outline" className="w-full border-3 border-foreground bg-transparent py-6 font-bold shadow-[3px_3px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-px hover:translate-y-px hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]">
                Create Account
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background pt-20">
      {/* Conversations Sidebar */}
      <aside className={`w-full border-r-3 border-foreground bg-card md:w-80 lg:w-96 ${selectedConversationId ? "hidden md:block" : "block"}`}>
        <div className="border-b-3 border-foreground p-4">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-2xl font-bold">Messages</h1>
            <Link href="/dashboard/user">
              <Button variant="outline" size="icon" className="border-3 border-foreground bg-transparent">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search conversations..."
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                handleDebouncedSearch(e.target.value);
              }}
              className="border-3 border-foreground pl-10 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
            />
          </div>
        </div>

        <div
          ref={conversationContainerRef}
          onScroll={handleConversationScroll}
          className="h-[calc(100vh-180px)] overflow-y-auto"
        >
          {isLoadingConversations && conversations.length === 0 ? (
            <LoadingState label="Loading conversations" className="space-y-3 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <ListRowSkeleton key={i} />
              ))}
            </LoadingState>
          ) : conversationsError ? (
            <ErrorState
              className="m-4"
              title="Couldn't load your conversations"
              description={conversationsError}
              onRetry={retryConversations}
            />
          ) : showNoResults ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <div className="flex h-16 w-16 items-center justify-center border-3 border-foreground bg-muted">
                <Search className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="mt-4 font-bold">No results found</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                No conversations match &ldquo;{debouncedSearch}&rdquo;. Try a different search term.
              </p>
            </div>
          ) : showNoConversations ? (
            <EmptyState
              className="m-4 border-0"
              icon={MessageSquareOff}
              title="No conversations yet"
              description="Message a landlord from any listing and the thread will show up here."
              action={{ label: "Browse properties", href: "/properties" }}
            />
          ) : (
            <>
              {conversations.map((conv) => {
                const otherName = getParticipantName(conv, currentUserId);
                return (
                  <button
                    key={conv.id}
                    aria-label={`Select conversation with ${otherName}`}
                    onClick={() => handleSelectConversation(conv.id)}
                    className={`w-full border-b-3 border-foreground p-4 text-left transition-colors ${
                      selectedConversationId === conv.id ? "bg-muted" : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex gap-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center border-3 border-foreground bg-accent font-bold">
                        {getParticipantInitials(otherName)}
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <div className="flex items-center justify-between">
                          <h3 className="font-bold truncate">{otherName}</h3>
                          <span className="text-xs text-muted-foreground shrink-0 ml-2">
                            {conv.lastMessage ? formatTimestamp(conv.lastMessage.createdAt) : ""}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-sm text-muted-foreground">
                          {conv.lastMessage?.text ?? "No messages yet"}
                        </p>
                      </div>
                      {conv.unreadCount > 0 && (
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center border-2 border-foreground bg-primary text-xs font-bold">
                          {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
              {hasMoreConversations && (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
            </>
          )}
        </div>
      </aside>

      {/* Chat Area */}
      {selectedConv ? (
        <main className={`flex flex-1 flex-col ${selectedConversationId ? "block" : "hidden md:block"}`}>
          {/* Chat Header */}
          <div className="flex items-center justify-between border-b-3 border-foreground bg-card p-3 md:p-4">
            <div className="flex items-center gap-2 md:gap-4">
              <button
                onClick={() => setSelectedConversationId(null)}
                aria-label="Back to conversations"
                className="flex h-10 w-10 items-center justify-center border-3 border-foreground bg-muted md:hidden"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="flex h-10 w-10 items-center justify-center border-3 border-foreground bg-accent text-sm font-bold md:h-12 md:w-12 md:text-base">
                {getParticipantInitials(getParticipantName(selectedConv, currentUserId))}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-bold md:text-base">
                  {getParticipantName(selectedConv, currentUserId)}
                </h2>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="h-3 w-3" />
                  <span className="truncate">{selectedConv.participants.length} participant{selectedConv.participants.length !== 1 ? "s" : ""}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 md:gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="border-3 border-foreground bg-transparent shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="border-3 border-foreground">
                  <DropdownMenuItem>View Profile</DropdownMenuItem>
                  <DropdownMenuItem>Block User</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive">Report</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Messages Thread */}
          <div
            ref={messageContainerRef}
            onScroll={handleMessageScroll}
            className="relative flex-1 overflow-y-auto bg-muted/30 p-6"
            role="log"
            aria-live="polite"
            aria-label="Message thread"
          >
            <div className="mx-auto max-w-3xl space-y-4">
              {isLoadingMessages ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : messagesError ? (
                <div className="flex flex-col items-center py-12 text-center">
                  <AlertCircle className="h-8 w-8 text-destructive mb-2" />
                  <p className="text-sm text-destructive">{messagesError}</p>
                  {selectedConversationId && (
                    <Button variant="outline" size="sm" onClick={() => handleSelectConversation(selectedConversationId)} className="mt-4 border-2 border-foreground">
                      <RefreshCw className="mr-1 h-3 w-3" /> Retry
                    </Button>
                  )}
                </div>
              ) : messages.filter(m => !m.isOptimistic || m.status === "sending" || m.status === "failed").length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <MessageCircle className="h-12 w-12 text-muted-foreground" />
                  <p className="mt-4 font-bold">No messages yet</p>
                  <p className="text-sm text-muted-foreground">Send a message to start the conversation.</p>
                </div>
              ) : (
                <>
                  {isLoadingMoreMessages && (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  {hasMoreMessages && !isLoadingMoreMessages && (
                    <div className="flex justify-center py-2">
                      <button
                        onClick={loadOlderMessages}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Load older messages
                      </button>
                    </div>
                  )}
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.senderId === currentUserId ? "justify-end" : "justify-start"}`}
                      aria-label={`Message from ${message.senderId === currentUserId ? "you" : "other"}: ${sanitizeText(message.body).slice(0, 50)}`}
                    >
                      <div className={`max-w-md border-3 border-foreground p-4 ${
                        message.senderId === currentUserId
                          ? "bg-primary shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                          : "bg-card shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]"
                      }`}>
                        <p className="text-sm break-words">{sanitizeText(message.body)}</p>
                        {message.attachment && (
                          <div className="mt-2 flex items-center gap-2 border-2 border-foreground bg-muted/50 p-2">
                            {message.attachment.type === "image" ? (
                              <ImageIcon className="h-4 w-4 shrink-0" />
                            ) : (
                              <File className="h-4 w-4 shrink-0" />
                            )}
                            <span className="text-xs truncate">{message.attachment.name}</span>
                            <Download className="h-3 w-3 shrink-0 ml-auto text-muted-foreground" />
                          </div>
                        )}
                        <div className="mt-2 flex items-center justify-end gap-1">
                          <span className="text-xs text-muted-foreground">
                            {formatTimestamp(message.createdAt)}
                          </span>
                          {message.senderId === currentUserId && (
                            <>
                              {message.status === "sending" && <Clock className="h-3 w-3 text-muted-foreground animate-pulse" />}
                              {message.status === "sent" && <Clock className="h-3 w-3 text-muted-foreground" />}
                              {message.status === "failed" && <AlertCircle className="h-3 w-3 text-destructive" />}
                            </>
                          )}
                        </div>
                        {message.status === "failed" && message.senderId === currentUserId && (
                          <div className="mt-2 flex justify-end">
                            <Button variant="outline" size="sm" onClick={() => handleRetry(message)} disabled={isSending}
                              className="border-2 border-destructive text-destructive text-xs font-bold">
                              <RefreshCw className="mr-1 h-3 w-3" /> Retry
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Jump to latest button */}
            {showJumpToLatest && (
              <div className="sticky bottom-4 flex justify-center">
                <Button
                  onClick={handleJumpToLatest}
                  variant="outline"
                  size="sm"
                  className="border-3 border-foreground bg-card shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)]"
                  aria-label="Jump to latest messages"
                >
                  <ArrowDown className="mr-1 h-3 w-3" /> Jump to latest
                </Button>
              </div>
            )}
          </div>

          {/* Attachment Preview */}
          {uploadState && (
            <div className="border-t-3 border-foreground bg-card px-3 md:px-4 py-2">
              <div className="mx-auto flex max-w-3xl items-center gap-3 border-2 border-foreground bg-muted/30 p-2">
                {uploadState.status === "error" ? (
                  <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
                ) : uploadState.status === "done" ? (
                  uploadState.result?.type === "image" ? <ImageIcon className="h-5 w-5 shrink-0 text-secondary" /> : <File className="h-5 w-5 shrink-0 text-secondary" />
                ) : (
                  <Upload className="h-5 w-5 shrink-0 text-muted-foreground animate-pulse" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">{uploadState.file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {uploadState.status === "uploading" && `Uploading... ${uploadState.progress}%`}
                    {uploadState.status === "pending" && "Ready to upload"}
                    {uploadState.status === "done" && `${getFileSizeDisplay(uploadState.file.size)} - Ready to send`}
                    {uploadState.status === "error" && (uploadState.error || "Upload failed")}
                  </p>
                  {uploadState.status === "uploading" && (
                    <div className="mt-1 h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-secondary transition-all duration-200 rounded-full" style={{ width: `${uploadState.progress}%` }} />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {uploadState.status === "uploading" && (
                    <Button variant="outline" size="icon" onClick={handleCancelUpload} className="h-7 w-7 border-2 border-foreground" aria-label="Cancel upload">
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                  {(uploadState.status === "error" || uploadState.status === "done") && (
                    <Button variant="outline" size="icon" onClick={handleRemoveAttachment} className="h-7 w-7 border-2 border-foreground" aria-label="Remove attachment">
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Message Input */}
          <div className="border-t-3 border-foreground bg-card p-3 md:p-4">
            {composerError && (
              <div className="mx-auto mb-3 flex max-w-3xl items-start gap-2 border-2 border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{composerError}</span>
              </div>
            )}
            <div className="mx-auto flex max-w-3xl gap-2 md:gap-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                className="hidden"
                onChange={handleFileSelect}
                aria-label="Attach file"
              />
              <Button
                variant="outline" size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadState?.status === "uploading"}
                className="hidden border-3 border-foreground bg-transparent shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] sm:flex"
                aria-label="Attach file"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Input
                placeholder="Type your message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                disabled={isSending}
                className="flex-1 border-3 border-foreground py-4 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] md:py-6"
              />
              <Button
                onClick={handleSendMessage}
                disabled={(!newMessage.trim() && !uploadState) || isSending}
                aria-label={isSending ? "Sending message" : "Send message"}
                className="border-3 border-foreground bg-primary px-4 font-bold shadow-[4px_4px_0px_0px_rgba(26,26,26,1)] transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] disabled:opacity-50 md:px-6"
              >
                {isSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
              </Button>
            </div>
          </div>
        </main>
      ) : (
        <main className="flex flex-1 items-center justify-center bg-muted/30">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center border-3 border-foreground bg-muted">
              <MessageCircle className="h-10 w-10 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-bold">Select a conversation</h2>
            <p className="mt-2 text-muted-foreground">Choose a conversation from the list to start messaging</p>
          </div>
        </main>
      )}
    </div>
  );
}

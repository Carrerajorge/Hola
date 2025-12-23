import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface SourceMetadata {
  provider: 'gmail';
  accountId?: string;
  accountEmail?: string;
  mailbox: string;
  messageId: string;
  threadId: string;
  labels: string[];
  permalink: string;
}

export interface EmailSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  fromEmail: string;
  to: string;
  date: string;
  snippet: string;
  labels: string[];
  isUnread: boolean;
  source?: SourceMetadata;
}

export interface EmailMessage {
  id: string;
  from: string;
  fromEmail: string;
  to: string;
  date: string;
  subject: string;
  body: string;
  snippet: string;
  source?: SourceMetadata;
}

export interface EmailThread {
  id: string;
  subject: string;
  messages: EmailMessage[];
  labels: string[];
}

interface GmailConnectionStatus {
  connected: boolean;
  email?: string;
  error?: string;
}

interface EmailsResponse {
  emails: EmailSummary[];
  nextPageToken?: string;
}

interface UseGmailEmailsOptions {
  action?: "search" | "unread" | "recent" | "thread";
  maxResults?: number;
  enabled?: boolean;
}

interface ReplyParams {
  threadId: string;
  to: string;
  subject: string;
  body: string;
}

export function useGmailConnection() {
  const query = useQuery<GmailConnectionStatus>({
    queryKey: ["gmail", "connection"],
    queryFn: async () => {
      const res = await fetch("/api/integrations/google/gmail/status");
      const data = await res.json();
      return {
        connected: data.connected ?? false,
        email: data.email,
        error: data.error
      };
    },
    staleTime: 60 * 1000,
    retry: 1
  });

  return {
    isConnected: query.data?.connected ?? false,
    email: query.data?.email ?? "",
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.data?.error || (query.error as Error)?.message,
    refetch: query.refetch
  };
}

export function useGmailEmails(
  searchQuery: string = "",
  options: UseGmailEmailsOptions = {}
) {
  const { action = "recent", maxResults = 20, enabled = true } = options;
  const queryClient = useQueryClient();

  const query = useQuery<EmailsResponse>({
    queryKey: ["gmail", "emails", searchQuery, action],
    queryFn: async () => {
      let queryParam = searchQuery;
      if (action === "unread") {
        queryParam = "is:unread " + queryParam;
      }

      const url = `/api/integrations/google/gmail/search?q=${encodeURIComponent(queryParam)}&maxResults=${maxResults}`;
      const res = await fetch(url);
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const errorMessage = errorData.error || "Error al cargar correos";
        
        // Handle specific permission errors
        if (errorMessage.includes("Insufficient Permission") || res.status === 403) {
          throw new Error("INSUFFICIENT_SCOPE: El conector de Gmail no tiene los permisos necesarios para leer correos. Es necesario reconectar con permisos completos.");
        }
        
        throw new Error(errorMessage);
      }
      
      const data = await res.json();
      return {
        emails: data.emails || [],
        nextPageToken: data.nextPageToken
      };
    },
    enabled,
    staleTime: 30 * 1000,
    retry: 1
  });

  const loadMoreMutation = useMutation({
    mutationFn: async (pageToken: string) => {
      let queryParam = searchQuery;
      if (action === "unread") {
        queryParam = "is:unread " + queryParam;
      }

      const url = `/api/integrations/google/gmail/search?q=${encodeURIComponent(queryParam)}&maxResults=${maxResults}&pageToken=${encodeURIComponent(pageToken)}`;
      const res = await fetch(url);
      
      if (!res.ok) {
        throw new Error("Error al cargar más correos");
      }
      
      return res.json();
    },
    onSuccess: (newData) => {
      queryClient.setQueryData<EmailsResponse>(
        ["gmail", "emails", searchQuery, action],
        (old) => ({
          emails: [...(old?.emails || []), ...(newData.emails || [])],
          nextPageToken: newData.nextPageToken
        })
      );
    }
  });

  return {
    emails: query.data?.emails ?? [],
    nextPageToken: query.data?.nextPageToken,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: (query.error as Error)?.message,
    refetch: query.refetch,
    loadMore: loadMoreMutation.mutate,
    isLoadingMore: loadMoreMutation.isPending
  };
}

export function useGmailThread(threadId: string | null | undefined) {
  const query = useQuery<EmailThread | null>({
    queryKey: ["gmail", "thread", threadId],
    queryFn: async () => {
      if (!threadId) return null;
      
      const res = await fetch(`/api/integrations/google/gmail/threads/${threadId}`);
      
      if (!res.ok) {
        throw new Error("Error al cargar la conversación");
      }
      
      const data = await res.json();
      
      if (!data.id) {
        throw new Error("Conversación no encontrada");
      }
      
      return data;
    },
    enabled: !!threadId,
    staleTime: 30 * 1000,
    retry: 1
  });

  return {
    thread: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: (query.error as Error)?.message,
    refetch: query.refetch
  };
}

export function useGmailReply() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (params: ReplyParams) => {
      const res = await fetch("/api/integrations/google/gmail/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params)
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || "Error al enviar respuesta");
      }

      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["gmail", "thread", variables.threadId]
      });
      queryClient.invalidateQueries({
        queryKey: ["gmail", "emails"]
      });
    }
  });

  return {
    sendReply: mutation.mutate,
    sendReplyAsync: mutation.mutateAsync,
    isSending: mutation.isPending,
    isError: mutation.isError,
    error: (mutation.error as Error)?.message,
    isSuccess: mutation.isSuccess,
    reset: mutation.reset
  };
}

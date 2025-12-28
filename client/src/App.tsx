import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect, useState, useCallback } from "react";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { ModelAvailabilityProvider } from "@/contexts/ModelAvailabilityContext";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useChats } from "@/hooks/use-chats";
import { SearchModal } from "@/components/search-modal";
import Home from "@/pages/home";
import ProfilePage from "@/pages/profile";
import BillingPage from "@/pages/billing";
import SettingsPage from "@/pages/settings";
import PrivacyPage from "@/pages/privacy";
import AdminPage from "@/pages/admin";
import SystemHealthPage from "@/pages/admin/SystemHealth";
import WorkspaceSettingsPage from "@/pages/workspace-settings";
import WorkspacePage from "@/pages/workspace";
import SkillsPage from "@/pages/skills";
import LoginPage from "@/pages/login";
import SignupPage from "@/pages/signup";
import LandingPage from "@/pages/landing";
import NotFound from "@/pages/not-found";

function AuthCallbackHandler() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "success") {
      fetch("/api/auth/user", { credentials: "include" })
        .then(res => res.ok ? res.json() : null)
        .then(user => {
          if (user) {
            localStorage.setItem("siragpt_auth_user", JSON.stringify(user));
            queryClient.setQueryData(["/api/auth/user"], user);
          }
          queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        })
        .catch(() => {
          queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);
  return null;
}

function GlobalKeyboardShortcuts() {
  const [, setLocation] = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const { chats } = useChats();

  const handleNewChat = useCallback(() => {
    setLocation("/");
    window.dispatchEvent(new CustomEvent("new-chat-requested"));
  }, [setLocation]);

  const handleOpenSearch = useCallback(() => {
    setSearchOpen(true);
  }, []);

  const handleCloseDialogs = useCallback(() => {
    setSearchOpen(false);
    window.dispatchEvent(new CustomEvent("close-all-dialogs"));
  }, []);

  const handleOpenSettings = useCallback(() => {
    setLocation("/settings");
  }, [setLocation]);

  const handleSelectChat = useCallback((chatId: string) => {
    setSearchOpen(false);
    window.dispatchEvent(new CustomEvent("select-chat", { detail: { chatId } }));
  }, []);

  useKeyboardShortcuts([
    { key: "n", ctrl: true, action: handleNewChat, description: "Nuevo chat" },
    { key: "k", ctrl: true, action: handleOpenSearch, description: "Búsqueda rápida" },
    { key: "Escape", action: handleCloseDialogs, description: "Cerrar diálogo" },
    { key: ",", ctrl: true, action: handleOpenSettings, description: "Configuración" },
  ]);

  return (
    <SearchModal
      open={searchOpen}
      onOpenChange={setSearchOpen}
      chats={chats}
      onSelectChat={handleSelectChat}
    />
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/welcome" component={LandingPage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/signup" component={SignupPage} />
      <Route path="/profile" component={ProfilePage} />
      <Route path="/billing" component={BillingPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/privacy" component={PrivacyPage} />
      <Route path="/admin" component={AdminPage} />
      <Route path="/admin/health" component={SystemHealthPage} />
      <Route path="/workspace-settings" component={WorkspaceSettingsPage} />
      <Route path="/workspace" component={WorkspacePage} />
      <Route path="/skills" component={SkillsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <ModelAvailabilityProvider>
          <TooltipProvider>
            <AuthCallbackHandler />
            <GlobalKeyboardShortcuts />
            <Toaster />
            <Router />
          </TooltipProvider>
        </ModelAvailabilityProvider>
      </SettingsProvider>
    </QueryClientProvider>
  );
}

export default App;

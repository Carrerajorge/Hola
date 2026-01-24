import { Switch, Route, useLocation, useParams } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect, useState, useCallback, lazy, Suspense } from "react";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { ModelAvailabilityProvider } from "@/contexts/ModelAvailabilityContext";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useChats } from "@/hooks/use-chats";
import { SearchModal } from "@/components/search-modal";
import { ToolCatalog } from "@/components/tool-catalog";
import { BackgroundNotificationContainer } from "@/components/background-notification";
import { CommandPalette } from "@/components/command-palette";
import { KeyboardShortcutsModal } from "@/components/modals/KeyboardShortcutsModal";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { SkipLink } from "@/lib/accessibility";
import { Loader2 } from "lucide-react";
const Home = lazy(() => import("@/pages/home"));
import { AuthProvider } from "@/hooks/use-auth";

const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

function ChatPageRedirect() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (params.id) {
      window.dispatchEvent(new CustomEvent("select-chat", { detail: { chatId: params.id } }));
      setLocation("/");
    }
  }, [params.id, setLocation]);

  return <Home />;
}
const LoginPage = lazy(() => import("@/pages/login"));
const SignupPage = lazy(() => import("@/pages/signup"));
const LandingPage = lazy(() => import("@/pages/landing"));
const NotFound = lazy(() => import("@/pages/not-found"));

const ProfilePage = lazy(() => import("@/pages/profile"));
const BillingPage = lazy(() => import("@/pages/billing"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const PrivacyPage = lazy(() => import("@/pages/privacy"));
const AdminPage = lazy(() => import("@/pages/admin"));
const SystemHealthPage = lazy(() => import("@/pages/admin/SystemHealth"));
const WorkspaceSettingsPage = lazy(() => import("@/pages/workspace-settings"));
const WorkspacePage = lazy(() => import("@/pages/workspace"));
const SkillsPage = lazy(() => import("@/pages/skills"));
const SpreadsheetAnalyzerPage = lazy(() => import("@/pages/SpreadsheetAnalyzer"));
const MonitoringDashboard = lazy(() => import("@/pages/MonitoringDashboard"));

function GlobalKeyboardShortcuts() {
  const [, setLocation] = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [toolCatalogOpen, setToolCatalogOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const { chats } = useChats();

  const handleNewChat = useCallback(() => {
    setLocation("/");
    window.dispatchEvent(new CustomEvent("new-chat-requested"));
  }, [setLocation]);

  const handleOpenSearch = useCallback(() => {
    setCommandPaletteOpen(true); // Now opens Command Palette instead
  }, []);

  const handleOpenToolCatalog = useCallback(() => {
    setToolCatalogOpen(true);
  }, []);

  const handleCloseDialogs = useCallback(() => {
    setSearchOpen(false);
    setToolCatalogOpen(false);
    setCommandPaletteOpen(false);
    setShortcutsModalOpen(false);
    window.dispatchEvent(new CustomEvent("close-all-dialogs"));
  }, []);

  const handleOpenShortcuts = useCallback(() => {
    setShortcutsModalOpen(true);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setLocation("/settings");
  }, [setLocation]);

  const handleSelectChat = useCallback((chatId: string) => {
    setSearchOpen(false);
    setCommandPaletteOpen(false);
    window.dispatchEvent(new CustomEvent("select-chat", { detail: { chatId } }));
  }, []);

  const handleSelectTool = useCallback((tool: { name: string; description: string }) => {
    window.dispatchEvent(new CustomEvent("tool-selected", { detail: { tool } }));
  }, []);

  useKeyboardShortcuts([
    { key: "n", ctrl: true, action: handleNewChat, description: "Nuevo chat" },
    { key: "k", ctrl: true, action: handleOpenSearch, description: "Command Palette" },
    { key: "k", ctrl: true, shift: true, action: handleOpenToolCatalog, description: "Tool Catalog" },
    { key: "Escape", action: handleCloseDialogs, description: "Cerrar diálogo" },
    { key: ",", ctrl: true, action: handleOpenSettings, description: "Configuración" },
  ]);

  return (
    <>
      <SearchModal
        open={searchOpen}
        onOpenChange={setSearchOpen}
        chats={chats}
        onSelectChat={handleSelectChat}
      />
      <ToolCatalog
        open={toolCatalogOpen}
        onOpenChange={setToolCatalogOpen}
        onSelectTool={handleSelectTool}
      />
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onNewChat={handleNewChat}
        onOpenSettings={() => { setCommandPaletteOpen(false); setLocation("/settings"); }}
        onOpenShortcuts={handleOpenShortcuts}
        chats={chats}
        onSelectChat={handleSelectChat}
      />
      <KeyboardShortcutsModal
        isOpen={shortcutsModalOpen}
        onClose={() => setShortcutsModalOpen(false)}
      />
    </>
  );
}

import { GlobalErrorBoundary } from "@/components/global-error-boundary";

function Router() {
  return (
    <GlobalErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <main id="main-content" className="flex-1 outline-none" tabIndex={-1}>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/chat/:id" component={ChatPageRedirect} />
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
            <Route path="/spreadsheet-analyzer" component={SpreadsheetAnalyzerPage} />
            <Route path="/monitoring" component={MonitoringDashboard} />
            <Route component={NotFound} />
          </Switch>
        </main>
      </Suspense>
    </GlobalErrorBoundary>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SettingsProvider>
          <ModelAvailabilityProvider>
            <TooltipProvider>
              <SkipLink targetId="main-content" />
              <OfflineIndicator />
              {/* AuthCallbackHandler removed, moved to AuthProvider */}
              <GlobalKeyboardShortcuts />
              <Toaster />
              <SonnerToaster
                position="bottom-right"
                richColors
                closeButton
                toastOptions={{
                  classNames: {
                    toast: 'text-sm',
                    actionButton: 'text-xs font-medium',
                  }
                }}
              />
              <Router />
              <BackgroundNotificationContainer onNavigateToChat={() => { }} />
            </TooltipProvider>
          </ModelAvailabilityProvider>
        </SettingsProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;

import React, { useEffect, useState } from 'react';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OnboardingWizard } from './components/OnboardingWizard';
import { UpdateBanner } from './components/UpdateBanner';
import { UpdateNotification } from './components/UpdateNotification';
import { AppLogoMark, ChatIcon, OverviewIcon } from './components/AppIcons';
import { LoginPage } from './pages/Login';
import { ChatPage } from './pages/Chat';
import { TasksPage } from './pages/Tasks';
import { MemoryPage } from './pages/Memory';
import { StatusPage } from './pages/Status';
import { DashboardPage } from './pages/Dashboard';
import { MarketplacePage } from './pages/Marketplace';
import { ExtensionsPage } from './pages/Extensions';
import { AgentStorePage } from './pages/AgentStore';
import { SettingsPage } from './pages/Settings';
import { SetupWizardPage } from './pages/SetupWizard';
import { CostDashboardPage } from './pages/CostDashboard';
import { AffiliatePage } from './pages/Affiliate';
import { ModelConnectionsPage } from './pages/ModelConnections';
import { AutoPostPage } from './pages/AutoPost';
import { MarketingRoomPage } from './pages/MarketingRoom';
import { CustomerMarketingRoomPage } from './pages/CustomerMarketingRoom';
import KnowledgeUniversePage from './pages/KnowledgeUniverse';
import { ScheduledSessionsPage } from './pages/ScheduledSessions';
import { useAgentWorkspaceStore } from './store/agentWorkspace';
import { PersonalOfficeShell } from './shell/PersonalOfficeShell';
import {
  isPersonalOfficeShellEnabled,
  setPersonalOfficeShellEnabled,
} from './shell/featureFlags';
import { vi } from './i18n/vi';

type Page =
  | 'chat'
  | 'tasks'
  | 'memory'
  | 'status'
  | 'dashboard'
  | 'marketplace'
  | 'agents'
  | 'extensions'
  | 'settings'
  | 'setup'
  | 'costs'
  | 'knowledge'
  | 'connections'
  | 'autopost'
  | 'scheduled-sessions'
  | 'marketing'
  | 'customer-marketing'
  | 'affiliate';

const DEV_USER = {
  name: 'Demo User',
  email: 'demo@izziapi.com',
  plan: 'pro',
  balance: 42.5,
  activeKeys: 3,
  role: 'user',
  avatar: 'D',
};

export function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState<Page>('chat');
  const [isLoading, setIsLoading] = useState(true);
  const [extensionUpdateCount, setExtensionUpdateCount] = useState(0);
  // Read once at mount: flipping the shell is an explicit, reload-backed action,
  // so re-reading storage on every render would only add noise.
  const [showPersonalOfficeShell, setShowPersonalOfficeShell] = useState(() =>
    isPersonalOfficeShellEnabled(),
  );

  const bootstrapWorkspace = useAgentWorkspaceStore((state) => state.bootstrap);
  const ensureWorkspaceStream = useAgentWorkspaceStore((state) => state.ensureStream);
  const ensureUpdaterStream = useAgentWorkspaceStore((state) => state.ensureUpdaterStream);
  const ensureOnboardingAutoOpen = useAgentWorkspaceStore((state) => state.ensureOnboardingAutoOpen);
  const refreshIntegrations = useAgentWorkspaceStore((state) => state.refreshIntegrations);
  const updaterState = useAgentWorkspaceStore((state) => state.updaterState);
  const checkForUpdates = useAgentWorkspaceStore((state) => state.checkForUpdates);
  const downloadUpdate = useAgentWorkspaceStore((state) => state.downloadUpdate);
  const restartToUpdate = useAgentWorkspaceStore((state) => state.restartToUpdate);
  const resetWorkspace = useAgentWorkspaceStore((state) => state.reset);

  useEffect(() => {
    void checkAuth();
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      resetWorkspace();
      return;
    }

    ensureWorkspaceStream();
    ensureUpdaterStream();
    void bootstrapWorkspace();
    void ensureOnboardingAutoOpen();
    void refreshIntegrations();
    void checkForUpdates();
  }, [
    isAuthenticated,
    bootstrapWorkspace,
    ensureWorkspaceStream,
    ensureUpdaterStream,
    ensureOnboardingAutoOpen,
    refreshIntegrations,
    checkForUpdates,
    resetWorkspace,
  ]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    if (currentPage === 'settings' || currentPage === 'status') {
      void checkForUpdates();
    }
  }, [checkForUpdates, currentPage, isAuthenticated]);

  useEffect(() => {
    const extensionUpdates = window.electronAPI?.extensionUpdates;
    if (!isAuthenticated || !extensionUpdates) {
      return undefined;
    }

    async function pollUpdates() {
      try {
        const result = await extensionUpdates.getPending();
        setExtensionUpdateCount(result?.count || 0);
      } catch {
        setExtensionUpdateCount(0);
      }
    }

    void pollUpdates();
    const interval = window.setInterval(pollUpdates, 10 * 60 * 1000);
    return () => {
      window.clearInterval(interval);
    };
  }, [isAuthenticated]);

  // Subscribe to auto-profile-refresh (syncs balance after user tops up on izziapi.com)
  useEffect(() => {
    if (!isAuthenticated || !window.electronAPI?.auth?.onProfileRefreshed) {
      return undefined;
    }
    const unsubscribe = window.electronAPI.auth.onProfileRefreshed((user: any) => {
      if (user) {
        setCurrentUser(user);
      }
    });
    return unsubscribe;
  }, [isAuthenticated]);

  async function checkAuth() {
    try {
      if (window.electronAPI) {
        const authed = await window.electronAPI.auth.isAuthenticated();
        if (authed) {
          const user = await window.electronAPI.auth.getUser();
          setCurrentUser(user);
          setIsAuthenticated(true);
          setCurrentPage('chat');
        }
      } else {
        setCurrentUser(DEV_USER);
        setIsAuthenticated(true);
        setCurrentPage('chat');
      }
    } catch (error) {
      console.error('Auth check failed:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleLogin(email: string, password: string): Promise<string | null> {
    try {
      if (!window.electronAPI) {
        return 'Bạn chạy thử cần mở trong Electron app.';
      }

      const result = await window.electronAPI.auth.login({ email, password });
      if (result.success) {
        setCurrentUser(result.user);
        setIsAuthenticated(true);
        setCurrentPage('chat');
        return null;
      }
      return result.error || 'Đăng nhập thất bại';
    } catch (error) {
      return error instanceof Error ? error.message : 'Đăng nhập thất bại';
    }
  }

  async function handleSignup(email: string, password: string, name: string): Promise<string | null> {
    try {
      if (!window.electronAPI) {
        return 'Bạn chạy thử cần mở trong Electron app.';
      }

      const result = await window.electronAPI.auth.signup({ email, password, name });
      if (result.success) {
        // Check if auto-login happened (session was returned from signup)
        const user = await window.electronAPI.auth.getUser();
        if (user) {
          setCurrentUser(user);
          setIsAuthenticated(true);
          return null; // No need to show "check email" - user is already logged in
        }

        // If needsConfirmation, return a special message (not an error)
        if (result.needsConfirmation) {
          return null; // Login page will show success message about email confirmation
        }

        return null;
      }
      return result.error || 'Đăng ký thất bại';
    } catch (error) {
      return error instanceof Error ? error.message : 'Đăng ký thất bại';
    }
  }

  async function handleGoogleLogin(): Promise<string | null> {
    try {
      if (!window.electronAPI) {
        return 'Bạn chạy thử cần mở trong Electron app.';
      }

      const result = await window.electronAPI.auth.loginWithGoogle();
      if (result.success) {
        // The popup OAuth flow now returns the user directly
        if (result.user) {
          setCurrentUser(result.user as any);
          setIsAuthenticated(true);
        }
        return null;
      }
      return result.error || 'Đăng nhập Google thất bại';
    } catch (error) {
      return error instanceof Error ? error.message : 'Đăng nhập Google thất bại';
    }
  }

  async function handleLogout() {
    try {
      if (window.electronAPI) {
        await window.electronAPI.auth.logout();
      }
    } catch {
      // ignore
    }

    resetWorkspace();
    setCurrentUser(null);
    setIsAuthenticated(false);
    setCurrentPage('chat');
  }

  async function handleRefreshProfile() {
    try {
      if (window.electronAPI) {
        const user = await window.electronAPI.auth.refreshProfile();
        if (user) {
          setCurrentUser(user);
        }
      }
    } catch (error) {
      console.error('Profile refresh failed:', error);
    }
  }

  async function handleOpenClawQuickInstall() {
    try {
      await window.electronAPI?.system.openclawQuickInstall();
    } catch (error) {
      console.error('OpenClaw quick install failed:', error);
    }
  }

  async function handleBuyApi() {
    try {
      await window.electronAPI?.system.buyApi();
    } catch (error) {
      console.error('Buy API action failed:', error);
    }
  }

  /**
   * Renders a page by id.
   *
   * Defaults to `currentPage` so the legacy shell keeps calling it with no
   * argument, and the Personal Office shell can pass an explicit page as its
   * legacy adapter. The `Page` union, `useState<Page>` and every
   * `setCurrentPage(...)` trigger are unchanged — the navigation contract that
   * navigationMap.test.ts pins is preserved.
   */
  /**
   * Rollback: clear the flag and drop straight back to the legacy sidebar shell.
   *
   * No reload — the legacy layout is still mounted in this same component, so
   * flipping state is enough and the user keeps their session. This is the
   * escape hatch that makes the new shell safe to ship behind a flag.
   */
  function handleDisablePersonalOfficeShell() {
    setPersonalOfficeShellEnabled(false);
    setShowPersonalOfficeShell(false);
    setCurrentPage('chat');
  }

  function renderPage(page: Page = currentPage) {
    switch (page) {
      case 'chat':
        return (
          <ChatPage
            user={currentUser}
            onBuyApi={handleBuyApi}
            onNavigateToDashboard={() => setCurrentPage('dashboard')}
            onNavigateToAgentHub={() => setCurrentPage('agents')}
            onNavigateToExtensions={() => setCurrentPage('extensions')}
          />
        );
      case 'tasks':
        return <TasksPage />;
      case 'scheduled-sessions':
        return <ScheduledSessionsPage />;
      case 'memory':
        return <MemoryPage />;
      case 'status':
        return <StatusPage />;
      case 'dashboard':
        return (
          <DashboardPage
            user={currentUser}
            onRefresh={handleRefreshProfile}
            onOpenClawQuickInstall={handleOpenClawQuickInstall}
            onBuyApi={handleBuyApi}
            onGoChat={() => setCurrentPage('chat')}
          />
        );
      case 'marketplace':
        return <MarketplacePage onNavigateToChat={() => setCurrentPage('chat')} />;
      case 'agents':
        return <AgentStorePage onNavigateToChat={() => setCurrentPage('chat')} />;
      case 'extensions':
        return (
          <ExtensionsPage
            onGoMarketplace={() => setCurrentPage('marketplace')}
            onOpenClawQuickInstall={handleOpenClawQuickInstall}
          />
        );
      case 'setup':
        return (
          <SetupWizardPage
            onComplete={() => setCurrentPage('chat')}
          />
        );
      case 'costs':
        return <CostDashboardPage t={vi} />;
      case 'settings':
        return (
          <SettingsPage
            user={currentUser}
            onLogout={handleLogout}
            onRefresh={handleRefreshProfile}
            onOpenClawQuickInstall={handleOpenClawQuickInstall}
            onBuyApi={handleBuyApi}
          />
        );
      case 'knowledge':
        return <KnowledgeUniversePage />;
      case 'connections':
        return <ModelConnectionsPage />;
      case 'autopost':
        return <AutoPostPage />;
      case 'marketing':
        return <MarketingRoomPage />;
      case 'customer-marketing':
        return <CustomerMarketingRoomPage />;
      case 'affiliate':
        return <AffiliatePage />;
      default:
        return <ChatPage />;
    }
  }

  if (isLoading) {
    return (
      <div className="app-loader-paper" style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          width: 56,
          height: 56,
          animation: 'pulse 2s ease-in-out infinite',
        }}>
          <AppLogoMark />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <TitleBar />
        <LoginPage
          onLogin={handleLogin}
          onGoogleLogin={handleGoogleLogin}
          onSignup={handleSignup}
        />
      </>
    );
  }

  // Personal Office shell (Loop 02), behind `izzi.shell.personalOffice`.
  //
  // The legacy layout below is untouched and is the rollback path: clearing the
  // flag re-renders exactly the previous shell. Legacy pages are not
  // re-implemented — `renderPage` is handed down as the adapter, so every
  // pre-existing surface keeps rendering its own component inside the new chrome.
  if (showPersonalOfficeShell) {
    return (
      <>
        <TitleBar />
        <ErrorBoundary fallbackTitle="Loi hien thi trang">
          <PersonalOfficeShell
            renderLegacy={(page) => renderPage(page)}
            onDisableShell={handleDisablePersonalOfficeShell}
          />
        </ErrorBoundary>
        <OnboardingWizard user={currentUser} />
        <UpdateNotification
          updaterState={updaterState}
          onDownload={() => void downloadUpdate()}
          onRestart={() => void restartToUpdate()}
        />
      </>
    );
  }

  return (
    <>
      <TitleBar />
      <div className="app-layout">
        <Sidebar
          currentPage={currentPage}
          onNavigate={setCurrentPage}
          user={currentUser}
          updateCount={extensionUpdateCount}
          appUpdateAvailable={updaterState.state === 'available'}
          appUpdateDownloaded={updaterState.state === 'downloaded'}
          onUpdateClick={() => {
            if (updaterState.state === 'downloaded') {
              void restartToUpdate();
            } else if (updaterState.state === 'available') {
              void downloadUpdate();
            }
          }}
        />
        <nav className="app-mobile-nav" aria-label="Primary navigation">
          <button
            type="button"
            className={currentPage === 'chat' ? 'is-active' : ''}
            onClick={() => setCurrentPage('chat')}
          >
            <ChatIcon className="app-mobile-nav__icon" />
            <span>Chat</span>
          </button>
          <button
            type="button"
            className={currentPage === 'customer-marketing' ? 'is-active' : ''}
            onClick={() => setCurrentPage('customer-marketing')}
          >
            <OverviewIcon className="app-mobile-nav__icon" />
            <span>AI Marketing</span>
          </button>
        </nav>
        <main className="main-content" role="main" aria-label="Noi dung chinh">
          <UpdateBanner
            updaterState={updaterState}
            onCheck={() => void checkForUpdates()}
            onDownload={() => void downloadUpdate()}
            onRestart={() => void restartToUpdate()}
          />
          <ErrorBoundary fallbackTitle="Loi hien thi trang">
            {renderPage()}
          </ErrorBoundary>
        </main>
      </div>
      <OnboardingWizard user={currentUser} />
      <UpdateNotification
        updaterState={updaterState}
        onDownload={() => void downloadUpdate()}
        onRestart={() => void restartToUpdate()}
      />
    </>
  );
}

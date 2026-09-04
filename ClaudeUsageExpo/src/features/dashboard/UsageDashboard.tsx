import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useKeepAwake } from 'expo-keep-awake';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import WebView, { WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';

import {
  appendSample,
  buildActivityBuckets,
  type BurnRate,
  computeBurnRate,
  computeRecentDelta,
  deserializeHistory,
  type UsageSample,
  windowKey,
} from '@/src/domain/history';
import {
  createExperimentReport,
  deserializeSnapshot,
  hasSnapshotExpired,
  parseCodexUsagePayload,
  parseUsagePayload,
  serializeSnapshot,
  UsageSnapshot,
  UsageWindow,
} from '@/src/domain/usage';
import {
  buildUsageRequestScript,
  CLAUDE_HOME_URL,
  CLAUDE_LOGIN_URL,
  isClaudeURL,
  parseBridgeMessage,
} from '@/src/infrastructure/claudeWebBridge';
import { CandleGlow, HalloweenAmbience } from '@/src/features/dashboard/HalloweenAmbience';
import { ActivityStrip } from '@/src/features/dashboard/ActivityStrip';
import { NoteBadge, type NoteTone } from '@/src/features/dashboard/NoteBadge';
import { AppBackground } from '@/src/features/dashboard/AppBackground';
import { GlassBackdropProvider, GlassSurface } from '@/src/features/dashboard/GlassSurface';
import {
  BUILT_IN_BACKGROUNDS,
  DEFAULT_BACKGROUND_ID,
  GLASS_TOKENS,
  isImageBackground,
  type BackgroundId,
} from '@/src/features/dashboard/glass';
import { ResetLabel, type ResetFormat } from '@/src/features/dashboard/ResetLabel';
import { UsageBar } from '@/src/features/dashboard/UsageBar';
import { MOTION } from '@/src/features/dashboard/motion';
import { PulseDot } from '@/src/features/dashboard/PulseDot';
import { RefreshProgressBar } from '@/src/features/dashboard/RefreshProgressBar';
import {
  CODEX_HOME_URL,
  CODEX_LOGIN_URL,
  isCodexURL,
} from '@/src/infrastructure/codexWebBridge';
import {
  clearCodexAuth,
  CodexAuthRequiredError,
  CodexDeviceAuthorization,
  CODEX_SECURITY_SETTINGS_URL,
  completeCodexDeviceAuthorization,
  fetchCodexUsageWithStoredAuth,
  pollCodexDeviceAuthorization,
  requestCodexDeviceAuthorization,
} from '@/src/infrastructure/codexDeviceAuth';

const SAFARI_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const GOOGLE_LOGIN_UNAVAILABLE =
  'Google tillåter inte den här inbäddade inloggningen. Använd e-post eller Fortsätt med Apple.';
const AUTO_REFRESH_INTERVAL_MS = 60_000;
const KEEP_AWAKE_TAG = 'usage-monitor';
const NEAR_LIMIT_THRESHOLD = 90;
/**
 * A limit far ahead of the hero is worth pointing at even when it is nowhere near full.
 * Seen with live data: the five-hour window read 0 percent while the weekly sat at 63,
 * so the card showed the least informative number on the screen and said nothing about
 * the other one. Both values have to be met, so a quiet week stays quiet.
 */
const LEADING_GAP_POINTS = 30;
const LEADING_MIN_UTILIZATION = 35;
const CONNECTION_STORAGE_KEY = 'usage-monitor.connected-providers.v1';
const SNAPSHOT_STORAGE_KEY = 'usage-monitor.snapshots.v1';
const THEME_STORAGE_KEY = 'usage-monitor.theme.v1';
const HISTORY_STORAGE_KEY = 'usage-monitor.history.v1';
const RESET_FORMAT_STORAGE_KEY = 'usage-monitor.reset-format.v1';
const BACKGROUND_STORAGE_KEY = 'usage-monitor.background.v1';
const DEFAULT_THEME: ThemePreference = 'glass';
/** How long the landscape controls stay up after a tap before hiding themselves. */
const MONITOR_CHROME_TIMEOUT_MS = 4_000;
/** Kept out of the cache directory so the OS cannot reclaim the picked photo. */
const BACKGROUND_FILE_NAME = 'glass-background';

type UsageProvider = 'claude' | 'codex';
type ThemeName = 'light' | 'dark' | 'halloween' | 'glass';
type ThemePreference = 'system' | ThemeName;

/** Glass is first because it is the default, so the list opens on the current choice. */
const THEME_OPTIONS: { label: string; note: string; value: ThemePreference }[] = [
  { label: 'Glas', note: 'Frostat glas över en egen bakgrund', value: 'glass' },
  { label: 'Följ systemet', note: 'Byter med telefonens läge', value: 'system' },
  { label: 'Ljust', note: 'Alltid ljus bakgrund', value: 'light' },
  { label: 'Mörkt', note: 'Alltid mörk bakgrund', value: 'dark' },
  { label: 'Halloween', note: 'Pumpor, fladdermöss och levande ljus', value: 'halloween' },
];
type ProviderRecord<T> = Record<UsageProvider, T>;
type CodexLoginPhase = 'prerequisite' | 'starting' | 'waiting' | 'finishing' | 'error';

type CodexLoginState = {
  authorization: CodexDeviceAuthorization | null;
  errorMessage: string | null;
  phase: CodexLoginPhase;
};

const PROVIDERS: UsageProvider[] = ['claude', 'codex'];
const PROVIDER_META: Record<UsageProvider, { label: string; homeURL: string; loginURL: string }> = {
  claude: { label: 'Claude', homeURL: CLAUDE_HOME_URL, loginURL: CLAUDE_LOGIN_URL },
  codex: { label: 'Codex', homeURL: CODEX_HOME_URL, loginURL: CODEX_LOGIN_URL },
};

type Palette = {
  root: string;
  surface: string;
  ink: string;
  secondary: string;
  tertiary: string;
  line: string;
  accent: string;
  accentSoft: string;
  accentInk: string;
  hero: string;
  heroText: string;
  heroMuted: string;
  heroTrack: string;
  success: string;
  danger: string;
  errorBackground: string;
  errorText: string;
};

type ProviderTheme = Pick<Palette, 'accent' | 'accentSoft' | 'accentInk' | 'hero' | 'heroMuted' | 'heroTrack'> & {
  monitorAccent: string;
  monitorAccentInk: string;
};

const PROVIDER_THEMES: Record<ThemeName, Record<UsageProvider, ProviderTheme>> = {
  light: {
    claude: {
      accent: '#B45137',
      accentSoft: '#F6E8E2',
      accentInk: '#FFFFFF',
      hero: '#222326',
      heroMuted: '#C8C9CE',
      heroTrack: '#414247',
      monitorAccent: '#D66A49',
      monitorAccentInk: '#0E0F11',
    },
    codex: {
      accent: '#2563EB',
      accentSoft: '#E8F0FF',
      accentInk: '#FFFFFF',
      hero: '#111A2F',
      heroMuted: '#B8C9EE',
      heroTrack: '#2A3B61',
      monitorAccent: '#6B9CFF',
      monitorAccentInk: '#091327',
    },
  },
  dark: {
    claude: {
      accent: '#E67B59',
      accentSoft: '#36251F',
      accentInk: '#0E0F11',
      hero: '#242529',
      heroMuted: '#C8C9CE',
      heroTrack: '#434449',
      monitorAccent: '#E67B59',
      monitorAccentInk: '#0E0F11',
    },
    codex: {
      accent: '#6B9CFF',
      accentSoft: '#172746',
      accentInk: '#091327',
      hero: '#14203A',
      heroMuted: '#BBCBF0',
      heroTrack: '#30446F',
      monitorAccent: '#7AA7FF',
      monitorAccentInk: '#091327',
    },
  },
  halloween: {
    claude: {
      accent: '#FF7A1A',
      accentSoft: '#3A2110',
      accentInk: '#1A0F04',
      hero: '#241733',
      heroMuted: '#C9BBD6',
      heroTrack: '#43324F',
      monitorAccent: '#FF7A1A',
      monitorAccentInk: '#1A0F04',
    },
    codex: {
      accent: '#9B6DFF',
      accentSoft: '#241738',
      accentInk: '#0F0720',
      hero: '#1B1030',
      heroMuted: '#C6B8E4',
      heroTrack: '#3B2A5A',
      monitorAccent: '#A97DFF',
      monitorAccentInk: '#0F0720',
    },
  },
  // Only the accent differs per provider here. The hero and track stay transparent so
  // the pane behind them shows through, which is the whole point of the theme.
  glass: {
    claude: {
      accent: '#F4A488',
      accentSoft: 'rgba(244, 164, 136, 0.16)',
      accentInk: '#1A0C07',
      hero: 'transparent',
      heroMuted: '#C9CBD2',
      heroTrack: 'rgba(255, 255, 255, 0.16)',
      monitorAccent: '#F4A488',
      monitorAccentInk: '#1A0C07',
    },
    codex: {
      accent: '#99B7F7',
      accentSoft: 'rgba(153, 183, 247, 0.16)',
      accentInk: '#08101F',
      hero: 'transparent',
      heroMuted: '#C9CBD2',
      heroTrack: 'rgba(255, 255, 255, 0.16)',
      monitorAccent: '#99B7F7',
      monitorAccentInk: '#08101F',
    },
  },
};

const LIGHT_PALETTE: Palette = {
  root: '#F4F5F7',
  surface: '#FFFFFF',
  ink: '#18191B',
  secondary: '#65676D',
  tertiary: '#6E7078',
  line: '#E4E5E9',
  accent: '#C65F40',
  accentSoft: '#F6E8E2',
  accentInk: '#FFFFFF',
  hero: '#222326',
  heroText: '#FFFFFF',
  heroMuted: '#C8C9CE',
  heroTrack: '#414247',
  success: '#287A55',
  danger: '#C7443C',
  errorBackground: '#FBE9E7',
  errorText: '#91372F',
};

const DARK_PALETTE: Palette = {
  root: '#101113',
  surface: '#1B1C1F',
  ink: '#F4F5F7',
  secondary: '#AAACB2',
  tertiary: '#85878D',
  line: '#303238',
  accent: '#E67B59',
  accentSoft: '#36251F',
  accentInk: '#0E0F11',
  hero: '#242529',
  heroText: '#FFFFFF',
  heroMuted: '#C8C9CE',
  heroTrack: '#434449',
  success: '#55B789',
  danger: '#FF746C',
  errorBackground: '#3A201E',
  errorText: '#FFB4AE',
};

// Pumpaorange pa djup lila-svart. Lagsta uppmatta kontrast i paletten ar 4,73:1,
// alltsa over AA-kravet, sa temat ar ett utseende och inte en forsamring.
const HALLOWEEN_PALETTE: Palette = {
  root: '#120D18',
  surface: '#1E1428',
  ink: '#F6EFE4',
  secondary: '#B3A6BE',
  tertiary: '#8C7F99',
  line: '#362A44',
  accent: '#FF7A1A',
  accentSoft: '#3A2110',
  accentInk: '#1A0F04',
  hero: '#241733',
  heroText: '#F6EFE4',
  heroMuted: '#C9BBD6',
  heroTrack: '#43324F',
  success: '#7ED957',
  danger: '#FF5B4A',
  errorBackground: '#3A1518',
  errorText: '#FFB3A8',
};

/**
 * Glass is its own theme, so light, dark and halloween are untouched by it. Two values do
 * the heavy lifting: `root` and `surface` are transparent, because AppBackground and
 * GlassSurface paint them instead, and `line` becomes the glass edge, which means every
 * border already in the stylesheet follows along without a single extra change.
 *
 * The colours are measured against the four worst-case panes derived in glass.ts, not
 * against one background. The three that differ from the other themes do so because they
 * failed there: tertiary, the accent and the danger colour all sit on a pane that can be as
 * light as #424346 over a white photo, and each is the lightest value on its own hue that
 * still clears 4.5:1 on all four. The accent is used as a text colour, not only as a fill.
 */
const GLASS_PALETTE: Palette = {
  root: 'transparent',
  surface: 'transparent',
  ink: '#F6F7FA',
  secondary: '#C9CBD2',
  tertiary: '#B4B9C2',
  line: GLASS_TOKENS.borderColor,
  accent: '#F4A488',
  accentSoft: 'rgba(244, 164, 136, 0.16)',
  accentInk: '#1A0C07',
  hero: 'transparent',
  heroText: '#F6F7FA',
  heroMuted: '#C9CBD2',
  heroTrack: 'rgba(255, 255, 255, 0.16)',
  success: '#5FCB93',
  danger: '#FF9C93',
  errorBackground: 'rgba(255, 156, 147, 0.16)',
  errorText: '#FFC4BD',
};

const BASE_PALETTES: Record<ThemeName, Palette> = {
  light: LIGHT_PALETTE,
  dark: DARK_PALETTE,
  halloween: HALLOWEEN_PALETTE,
  glass: GLASS_PALETTE,
};

export function UsageDashboard() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const colorScheme = useColorScheme();
  const [activeProvider, setActiveProvider] = useState<UsageProvider>('claude');
  // Glass is the default rather than 'system'. A stored preference still wins, so anyone
  // who has already picked a theme keeps it; this only decides what a fresh install shows.
  const [themePreference, setThemePreference] = useState<ThemePreference>(DEFAULT_THEME);
  const systemTheme: ThemeName = colorScheme === 'dark' ? 'dark' : 'light';
  const themeName: ThemeName = themePreference === 'system' ? systemTheme : themePreference;
  const isHalloween = themeName === 'halloween';
  const isGlass = themeName === 'glass';
  const providerTheme = PROVIDER_THEMES[themeName][activeProvider];
  const palette = useMemo<Palette>(
    () => ({ ...BASE_PALETTES[themeName], ...providerTheme }),
    [themeName, providerTheme],
  );
  // Two named breakpoints for the whole screen. Deriving them once keeps the same
  // condition from being rewritten in every style rule.
  const isReducedMotion = useReducedMotion();
  const isCompactHeight = height < 700;
  const isWide = width >= 500;
  // The landscape monitor is the one place where a fixed type scale can overflow the
  // screen, because its whole layout has to fit a single viewport height with no scroll.
  // Deriving the numbers from the available height keeps it correct on any device instead
  // of guessing breakpoints, and every landscape phone lands in the same breakpoint band.
  const shortSide = Math.min(width, height);
  const styles = useMemo(
    () => createStyles(palette, providerTheme, { isCompactHeight, isWide, shortSide }, isGlass),
    [palette, providerTheme, isCompactHeight, isWide, shortSide, isGlass],
  );
  const webViewRef = useRef<WebView>(null);
  const webViewProviderRef = useRef<UsageProvider>('claude');
  const requestIdRef = useRef<string | null>(null);
  const requestProviderRef = useRef<UsageProvider | null>(null);
  const requestStartedAtRef = useRef(0);
  const requestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshAttemptAtRef = useRef<ProviderRecord<number>>({ claude: 0, codex: 0 });
  const pendingRefreshRef = useRef(true);
  const isWebReadyRef = useRef(false);
  const connectedProvidersRef = useRef<ProviderRecord<boolean>>({ claude: false, codex: false });
  const codexRefreshInFlightRef = useRef(false);
  const codexLoginGenerationRef = useRef(0);

  const [snapshots, setSnapshots] = useState<ProviderRecord<UsageSnapshot | null>>({ claude: null, codex: null });
  const [lastRefreshDurations, setLastRefreshDurations] = useState<ProviderRecord<number | null>>({
    claude: null,
    codex: null,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  // A provider is stale when its newest request failed but an older value is still worth showing.
  const [staleProviders, setStaleProviders] = useState<ProviderRecord<boolean>>({ claude: false, codex: false });
  const [histories, setHistories] = useState<ProviderRecord<UsageSample[]>>({ claude: [], codex: [] });
  // Timestamp of the newest reading actually fetched in this session, per provider. The
  // activity claim rests on this, so restored history alone can never assert activity.
  const [liveSampleAt, setLiveSampleAt] = useState<ProviderRecord<number | null>>({ claude: null, codex: null });
  const [connectionsHydrated, setConnectionsHydrated] = useState(false);
  const [needsSignInByProvider, setNeedsSignInByProvider] = useState<ProviderRecord<boolean>>({ claude: true, codex: true });
  const [isShowingLogin, setIsShowingLogin] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  // Keyed per window, not one global setting: tapping the weekly row must not change the
  // five-hour row. The key is the window rather than the render site, so the same limit
  // reads the same way in portrait and landscape.
  const [resetFormats, setResetFormats] = useState<Record<string, ResetFormat>>({});
  const [backgroundId, setBackgroundId] = useState<BackgroundId>(DEFAULT_BACKGROUND_ID);
  const [customBackgroundUri, setCustomBackgroundUri] = useState<string | null>(null);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  // Android blurs this view rather than whatever happens to be behind each pane.
  const blurTargetRef = useRef<View | null>(null);
  // A native Modal renders in a separate Android window, so it needs its own backdrop
  // target. Reusing the dashboard target makes glass panes sample the hidden window and
  // can leave the login screen transparent over the system's white modal background.
  const loginBlurTargetRef = useRef<View | null>(null);
  const [errorMessages, setErrorMessages] = useState<ProviderRecord<string | null>>({ claude: null, codex: null });
  const [loginStatus, setLoginStatus] = useState('Laddar Claudes säkra inloggning…');
  const [codexLogin, setCodexLogin] = useState<CodexLoginState | null>(null);
  const [isCodexCodeCopied, setIsCodexCodeCopied] = useState(false);
  const [webSourceURL, setWebSourceURL] = useState(CLAUDE_HOME_URL);

  const snapshot = snapshots[activeProvider];
  const isStale = staleProviders[activeProvider];
  const lastRefreshDuration = lastRefreshDurations[activeProvider];
  const needsSignIn = needsSignInByProvider[activeProvider];
  const errorMessage = errorMessages[activeProvider];

  useEffect(() => {
    void ScreenOrientation.unlockAsync();
  }, []);

  const clearRequestTimeout = useCallback(() => {
    if (requestTimeoutRef.current) clearTimeout(requestTimeoutRef.current);
    requestTimeoutRef.current = null;
  }, []);

  // Called from the two places a live reading actually arrives, rather than derived in an
  // effect. The timestamp guard keeps a repeated snapshot from becoming a second sample.
  const recordSample = useCallback((provider: UsageProvider, nextSnapshot: UsageSnapshot) => {
    setLiveSampleAt((current) => ({ ...current, [provider]: nextSnapshot.fetchedAt.getTime() }));
    setHistories((current) => {
      const series = current[provider];
      const latest = series[series.length - 1];
      if (latest && latest.at === nextSnapshot.fetchedAt.getTime()) return current;
      return { ...current, [provider]: appendSample(series, nextSnapshot) };
    });
  }, []);

  const rememberProviderConnection = useCallback((provider: UsageProvider, connected: boolean) => {
    connectedProvidersRef.current = { ...connectedProvidersRef.current, [provider]: connected };
    void AsyncStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(connectedProvidersRef.current));
  }, []);

  const refreshCodexProvider = useCallback(async () => {
    if (codexRefreshInFlightRef.current) return;
    codexRefreshInFlightRef.current = true;
    const startedAt = Date.now();
    lastRefreshAttemptAtRef.current.codex = startedAt;
    setIsRefreshing(true);
    setErrorMessages((current) => ({ ...current, codex: null }));

    try {
      const body = await fetchCodexUsageWithStoredAuth();
      const nextSnapshot = parseCodexUsagePayload(body);
      setSnapshots((current) => ({ ...current, codex: nextSnapshot }));
      recordSample('codex', nextSnapshot);
      setLastRefreshDurations((current) => ({ ...current, codex: (Date.now() - startedAt) / 1000 }));
      setNeedsSignInByProvider((current) => ({ ...current, codex: false }));
      setStaleProviders((current) => ({ ...current, codex: false }));
      rememberProviderConnection('codex', true);
      setLoginStatus('Klart — Codex-kontot är anslutet.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Codex usage kunde inte hämtas.';
      if (error instanceof CodexAuthRequiredError) {
        // Only an expired session invalidates the value we already have.
        setSnapshots((current) => ({ ...current, codex: null }));
        setStaleProviders((current) => ({ ...current, codex: false }));
        rememberProviderConnection('codex', false);
        setNeedsSignInByProvider((current) => ({ ...current, codex: true }));
      } else {
        // Keep the last known value and label it, rather than showing nothing at all.
        setStaleProviders((current) => ({ ...current, codex: true }));
        setErrorMessages((current) => ({ ...current, codex: message }));
      }
      setLoginStatus(message);
    } finally {
      codexRefreshInFlightRef.current = false;
      setIsRefreshing(false);
    }
  }, [recordSample, rememberProviderConnection]);

  const refreshProvider = useCallback((provider: UsageProvider) => {
    if (requestIdRef.current) return;
    lastRefreshAttemptAtRef.current[provider] = Date.now();

    if (provider === 'codex') {
      pendingRefreshRef.current = false;
      void refreshCodexProvider();
      return;
    }

    if (webViewProviderRef.current !== provider) {
      pendingRefreshRef.current = true;
      isWebReadyRef.current = false;
      webViewProviderRef.current = provider;
      setWebSourceURL(PROVIDER_META[provider].homeURL);
      return;
    }

    if (!isWebReadyRef.current || !webViewRef.current) {
      pendingRefreshRef.current = true;

      if (isShowingLogin) {
        // Never reload while the user is on the login page, it would wipe what they typed.
        setLoginStatus(`Återgår till ${PROVIDER_META[provider].label} och kontrollerar sessionen…`);
        setWebSourceURL(PROVIDER_META[provider].homeURL);
        return;
      }

      // Readiness is only ever set from onLoadEnd, so without this nudge a retry could
      // not lead anywhere and the app waited forever without saying so.
      webViewRef.current?.reload();
      setIsRefreshing(true);
      clearRequestTimeout();
      requestTimeoutRef.current = setTimeout(() => {
        setIsRefreshing(false);
        if (isWebReadyRef.current) return;
        const message = `${PROVIDER_META[provider].label}-sessionen svarar inte. Öppna menyn och logga in igen.`;
        setStaleProviders((current) => ({ ...current, [provider]: true }));
        setErrorMessages((current) => ({ ...current, [provider]: message }));
      }, 15_000);
      return;
    }

    clearRequestTimeout();
    const requestId = `${Date.now()}-${Math.random()}`;
    requestIdRef.current = requestId;
    requestProviderRef.current = provider;
    requestStartedAtRef.current = Date.now();
    pendingRefreshRef.current = false;
    setIsRefreshing(true);
    setErrorMessages((current) => ({ ...current, [provider]: null }));
    if (isShowingLogin) setLoginStatus('Kontrollerar inloggningen…');

    webViewRef.current.injectJavaScript(buildUsageRequestScript(requestId));
    requestTimeoutRef.current = setTimeout(() => {
      if (requestIdRef.current !== requestId) return;
      requestIdRef.current = null;
      requestProviderRef.current = null;
      setIsRefreshing(false);
      const message = `${PROVIDER_META[provider].label} svarade inte. Kontrollera nätet och dra nedåt för att försöka igen.`;
      setStaleProviders((current) => ({ ...current, [provider]: true }));
      setErrorMessages((current) => ({ ...current, [provider]: message }));
      if (isShowingLogin) setLoginStatus(message);
    }, 15_000);
  }, [clearRequestTimeout, isShowingLogin, refreshCodexProvider]);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      AsyncStorage.getItem(CONNECTION_STORAGE_KEY),
      AsyncStorage.getItem(SNAPSHOT_STORAGE_KEY),
      AsyncStorage.getItem(THEME_STORAGE_KEY),
      AsyncStorage.getItem(HISTORY_STORAGE_KEY),
      AsyncStorage.getItem(RESET_FORMAT_STORAGE_KEY),
      AsyncStorage.getItem(BACKGROUND_STORAGE_KEY),
    ])
      .then(([storedConnections, storedSnapshots, storedTheme, storedHistory, storedResetFormats, storedBackground]) => {
        if (cancelled) return;

        if (isThemePreference(storedTheme)) setThemePreference(storedTheme);
        // A picked photo lives on disk, so only its path is stored here alongside the id.
        if (storedBackground) {
          try {
            const parsed = JSON.parse(storedBackground) as { id?: unknown; uri?: unknown };
            if (isBackgroundId(parsed.id)) setBackgroundId(parsed.id);
            if (typeof parsed.uri === 'string') setCustomBackgroundUri(parsed.uri);
          } catch {
            void AsyncStorage.removeItem(BACKGROUND_STORAGE_KEY);
          }
        }
        // An earlier build stored a single string here. Anything that is not the current
        // shape is ignored rather than migrated, so a stale value cannot throw.
        if (storedResetFormats) {
          try {
            const parsed = JSON.parse(storedResetFormats) as Record<string, unknown>;
            const restored: Record<string, ResetFormat> = {};
            for (const [key, value] of Object.entries(parsed)) {
              if (value === 'clock' || value === 'remaining') restored[key] = value;
            }
            setResetFormats(restored);
          } catch {
            void AsyncStorage.removeItem(RESET_FORMAT_STORAGE_KEY);
          }
        }

        if (storedHistory) {
          const parsed = JSON.parse(storedHistory) as Partial<ProviderRecord<unknown>>;
          setHistories({
            claude: deserializeHistory(parsed.claude),
            codex: deserializeHistory(parsed.codex),
          });
        }

        if (storedConnections) {
          const stored = JSON.parse(storedConnections) as Partial<ProviderRecord<boolean>>;
          const connected: ProviderRecord<boolean> = {
            claude: stored.claude === true,
            codex: stored.codex === true,
          };
          connectedProvidersRef.current = connected;
          setNeedsSignInByProvider({ claude: !connected.claude, codex: !connected.codex });
        }

        // Render the last known usage right away. It is marked as stale until a live
        // request lands, and dropped entirely once one of its windows has reset.
        if (storedSnapshots) {
          const stored = JSON.parse(storedSnapshots) as Partial<ProviderRecord<unknown>>;
          const restored: ProviderRecord<UsageSnapshot | null> = { claude: null, codex: null };
          let restoredAny = false;

          for (const provider of PROVIDERS) {
            if (!connectedProvidersRef.current[provider]) continue;
            const candidate = deserializeSnapshot(stored[provider]);
            if (!candidate || hasSnapshotExpired(candidate)) continue;
            restored[provider] = candidate;
            restoredAny = true;
          }

          if (restoredAny) setSnapshots(restored);
        }
      })
      .catch(() => {
        if (cancelled) return;
        void AsyncStorage.multiRemove([
          CONNECTION_STORAGE_KEY,
          SNAPSHOT_STORAGE_KEY,
          THEME_STORAGE_KEY,
          HISTORY_STORAGE_KEY,
          RESET_FORMAT_STORAGE_KEY,
          BACKGROUND_STORAGE_KEY,
        ]);
        connectedProvidersRef.current = { claude: false, codex: false };
        setNeedsSignInByProvider({ claude: true, codex: true });
      })
      .finally(() => {
        if (!cancelled) setConnectionsHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!connectionsHydrated) return;
    void AsyncStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(histories)).catch(() => {});
  }, [connectionsHydrated, histories]);

  // One writer for every path that changes a snapshot, so persistence cannot drift
  // out of sync with what the screen is showing.
  useEffect(() => {
    if (!connectionsHydrated) return;
    void AsyncStorage.setItem(
      SNAPSHOT_STORAGE_KEY,
      JSON.stringify({
        claude: snapshots.claude ? serializeSnapshot(snapshots.claude) : null,
        codex: snapshots.codex ? serializeSnapshot(snapshots.codex) : null,
      }),
    ).catch(() => {});
  }, [connectionsHydrated, snapshots]);

  const refresh = useCallback(() => {
    refreshProvider(activeProvider);
  }, [activeProvider, refreshProvider]);

  useEffect(() => {
    if (!connectionsHydrated) return;
    if (!connectedProvidersRef.current[activeProvider]) {
      setNeedsSignInByProvider((current) => ({ ...current, [activeProvider]: true }));
      setIsRefreshing(false);
      return;
    }

    setNeedsSignInByProvider((current) => ({ ...current, [activeProvider]: false }));
    pendingRefreshRef.current = true;
    lastRefreshAttemptAtRef.current[activeProvider] = 0;
    refreshProvider(activeProvider);
  }, [activeProvider, connectionsHydrated, refreshProvider]);

  useEffect(() => {
    return () => {
      clearRequestTimeout();
    };
  }, [clearRequestTimeout]);

  useEffect(() => {
    const refreshIfDue = () => {
      if (AppState.currentState !== 'active' || isShowingLogin) return;
      if (!connectedProvidersRef.current[activeProvider]) return;

      const now = Date.now();
      if (now - lastRefreshAttemptAtRef.current[activeProvider] < AUTO_REFRESH_INTERVAL_MS) return;

      refresh();
    };

    // The timer is torn down on the way to the background rather than left ticking to hit
    // the AppState guard above, so a backgrounded app stops waking the JS thread at all.
    // Coming back to the foreground refreshes immediately and starts it again, so nothing
    // is lost by not counting while away.
    let interval: ReturnType<typeof setInterval> | null = setInterval(
      refreshIfDue,
      AUTO_REFRESH_INTERVAL_MS,
    );

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        refreshIfDue();
        interval ??= setInterval(refreshIfDue, AUTO_REFRESH_INTERVAL_MS);
        return;
      }
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    });

    return () => {
      if (interval) clearInterval(interval);
      subscription.remove();
    };
  }, [activeProvider, isShowingLogin, refresh]);

  const handleLoadEnd = useCallback(
    (event: { nativeEvent: { url: string } }) => {
      const provider = getProviderFromURL(event.nativeEvent.url);
      const expectedProvider = webViewProviderRef.current;
      const isReady = provider === expectedProvider;
      isWebReadyRef.current = isReady;
      if (!isReady) {
        if (event.nativeEvent.url === 'about:blank' && isShowingLogin) {
          setLoginStatus(`Inloggningen stängdes. Tryck Klar för att fortsätta till ${PROVIDER_META[expectedProvider].label}.`);
        }
        return;
      }

      setLoginStatus('Sidan är laddad. Logga in med e-post och tryck sedan Klar.');
      if (pendingRefreshRef.current || isShowingLogin) {
        setTimeout(() => refreshProvider(expectedProvider), 350);
      }
    },
    [isShowingLogin, refreshProvider],
  );

  const handleNavigationChange = useCallback((navigation: WebViewNavigation) => {
    isWebReadyRef.current = getProviderFromURL(navigation.url) === webViewProviderRef.current;
  }, []);

  const handleShouldStartLoad = useCallback((request: { url: string }) => {
    if (request.url.includes('accounts.google.')) {
      setLoginStatus(GOOGLE_LOGIN_UNAVAILABLE);
      return false;
    }
    return true;
  }, []);

  const handleOpenWindow = useCallback(() => {
    setLoginStatus(GOOGLE_LOGIN_UNAVAILABLE);
  }, []);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const provider = requestProviderRef.current;
      if (provider !== 'claude') return;

      const message = parseBridgeMessage(event.nativeEvent.data);
      if (!message || message.requestId !== requestIdRef.current) return;

      clearRequestTimeout();
      requestIdRef.current = null;
      requestProviderRef.current = null;
      setIsRefreshing(false);

      if (message.type === 'auth-required') {
        rememberProviderConnection(provider, false);
        setSnapshots((current) => ({ ...current, [provider]: null }));
        setStaleProviders((current) => ({ ...current, [provider]: false }));
        setNeedsSignInByProvider((current) => ({ ...current, [provider]: true }));
        setLoginStatus(`Inte inloggad ännu. Logga in på ${PROVIDER_META[provider].label}.`);
        return;
      }

      if (message.type === 'bridge-error') {
        setStaleProviders((current) => ({ ...current, [provider]: true }));
        setErrorMessages((current) => ({ ...current, [provider]: message.message }));
        setLoginStatus(message.message);
        return;
      }

      if (message.status === 429) {
        const text = `${PROVIDER_META[provider].label} begränsar uppdateringar tillfälligt. Försök snart igen.`;
        setStaleProviders((current) => ({ ...current, [provider]: true }));
        setErrorMessages((current) => ({ ...current, [provider]: text }));
        setLoginStatus(text);
        return;
      }

      if (message.status !== 200) {
        const text = `${PROVIDER_META[provider].label} svarade oväntat. Försök igen om en stund.`;
        setStaleProviders((current) => ({ ...current, [provider]: true }));
        setErrorMessages((current) => ({ ...current, [provider]: text }));
        setLoginStatus(text);
        return;
      }

      try {
        const nextSnapshot = parseUsagePayload(message.body);
        const duration = (Date.now() - requestStartedAtRef.current) / 1000;
        setSnapshots((current) => ({ ...current, [provider]: nextSnapshot }));
        recordSample(provider, nextSnapshot);
        setLastRefreshDurations((current) => ({ ...current, [provider]: duration }));
        rememberProviderConnection(provider, true);
        setNeedsSignInByProvider((current) => ({ ...current, [provider]: false }));
        setStaleProviders((current) => ({ ...current, [provider]: false }));
        setErrorMessages((current) => ({ ...current, [provider]: null }));
        setLoginStatus(`Klart — ${PROVIDER_META[provider].label}-kontot är anslutet.`);
        setWebSourceURL(PROVIDER_META[provider].homeURL);
        setIsShowingLogin(false);
      } catch (error) {
        const text = error instanceof Error ? error.message : 'Usage-datan kunde inte läsas.';
        setStaleProviders((current) => ({ ...current, [provider]: true }));
        setErrorMessages((current) => ({ ...current, [provider]: text }));
        setLoginStatus(text);
      }
    },
    [clearRequestTimeout, recordSample, rememberProviderConnection],
  );

  const openCodexDevicePage = useCallback((authorization = codexLogin?.authorization) => {
    if (!authorization) return;
    void WebBrowser.openBrowserAsync(authorization.verificationUrl).catch(() => {
      setLoginStatus('Webbläsaren kunde inte öppnas. Tryck Öppna och försök igen.');
    });
  }, [codexLogin?.authorization]);

  const openCodexSecuritySettings = useCallback(() => {
    void WebBrowser.openBrowserAsync(CODEX_SECURITY_SETTINGS_URL).catch(() => {
      setLoginStatus('ChatGPT-inställningarna kunde inte öppnas. Försök igen.');
    });
  }, []);

  const startCodexLogin = useCallback(async () => {
    const generation = codexLoginGenerationRef.current + 1;
    codexLoginGenerationRef.current = generation;
    setCodexLogin({ authorization: null, errorMessage: null, phase: 'starting' });
    setSnapshots((current) => ({ ...current, codex: null }));
    setLoginStatus('Skapar en säker engångskod hos OpenAI…');
    setIsShowingLogin(true);

    try {
      const authorization = await requestCodexDeviceAuthorization();
      if (codexLoginGenerationRef.current !== generation) return;

      setIsCodexCodeCopied(false);
      setCodexLogin({ authorization, errorMessage: null, phase: 'waiting' });
      setLoginStatus('Engångskoden är klar. Kopiera den och öppna sedan OpenAI.');

      while (Date.now() < authorization.expiresAt.getTime()) {
        if (codexLoginGenerationRef.current !== generation) return;
        const success = await pollCodexDeviceAuthorization(authorization);
        if (success) {
          setCodexLogin({ authorization, errorMessage: null, phase: 'finishing' });
          setLoginStatus('Godkänd. Slutför Codex-inloggningen…');
          await completeCodexDeviceAuthorization(success);
          if (codexLoginGenerationRef.current !== generation) return;

          dismissOpenBrowser();
          rememberProviderConnection('codex', true);
          setNeedsSignInByProvider((current) => ({ ...current, codex: false }));
          setCodexLogin(null);
          setIsShowingLogin(false);
          await refreshCodexProvider();
          return;
        }
        await wait(authorization.intervalSeconds * 1000);
      }

      throw new Error('Engångskoden löpte ut. Starta inloggningen igen.');
    } catch (error) {
      if (codexLoginGenerationRef.current !== generation) return;
      const message = error instanceof Error ? error.message : 'OpenAI-inloggningen misslyckades.';
      setCodexLogin((current) => ({
        authorization: current?.authorization ?? null,
        errorMessage: message,
        phase: 'error',
      }));
      setLoginStatus(message);
    }
  }, [refreshCodexProvider, rememberProviderConnection]);

  const copyCodexCode = useCallback(async () => {
    const userCode = codexLogin?.authorization?.userCode;
    if (!userCode) return;
    await Clipboard.setStringAsync(userCode);
    setIsCodexCodeCopied(true);
    setLoginStatus('Koden är kopierad. Öppna OpenAI och klistra in den.');
  }, [codexLogin?.authorization?.userCode]);

  const disconnectProvider = useCallback(async (provider: UsageProvider) => {
    if (provider === 'codex') {
      codexLoginGenerationRef.current += 1;
      setCodexLogin(null);
      await clearCodexAuth().catch(() => {});
    } else {
      isWebReadyRef.current = false;
      setWebSourceURL(PROVIDER_META.claude.homeURL);
    }

    clearRequestTimeout();
    requestIdRef.current = null;
    requestProviderRef.current = null;
    rememberProviderConnection(provider, false);
    setSnapshots((current) => ({ ...current, [provider]: null }));
    setStaleProviders((current) => ({ ...current, [provider]: false }));
    setErrorMessages((current) => ({ ...current, [provider]: null }));
    setNeedsSignInByProvider((current) => ({ ...current, [provider]: true }));
  }, [clearRequestTimeout, rememberProviderConnection]);

  const showLogin = useCallback(() => {
    clearRequestTimeout();
    requestIdRef.current = null;
    requestProviderRef.current = null;
    if (activeProvider === 'codex') {
      setCodexLogin({ authorization: null, errorMessage: null, phase: 'prerequisite' });
      setLoginStatus('Första gången: tillåt enhetskod för Codex i ChatGPT.');
      setIsShowingLogin(true);
      return;
    }
    setLoginStatus(
      'Logga in med e-post eller Apple. Sessionen sparas på enheten.',
    );
    webViewProviderRef.current = activeProvider;
    isWebReadyRef.current = false;
    pendingRefreshRef.current = true;
    setIsShowingLogin(true);
    setWebSourceURL(PROVIDER_META[activeProvider].loginURL);
  }, [activeProvider, clearRequestTimeout]);

  const dismissLogin = useCallback(() => {
    if (activeProvider === 'codex') {
      codexLoginGenerationRef.current += 1;
      setCodexLogin(null);
      dismissOpenBrowser();
    }
    setIsShowingLogin(false);
    setWebSourceURL(PROVIDER_META[activeProvider].homeURL);
  }, [activeProvider]);

  const selectProvider = useCallback((provider: UsageProvider) => {
    if (provider === activeProvider) return;

    clearRequestTimeout();
    requestIdRef.current = null;
    requestProviderRef.current = null;
    codexLoginGenerationRef.current += 1;
    setCodexLogin(null);
    dismissOpenBrowser();
    pendingRefreshRef.current = true;
    isWebReadyRef.current = false;
    if (provider === 'claude') webViewProviderRef.current = provider;
    setIsRefreshing(false);
    setIsShowingLogin(false);
    setActiveProvider(provider);
    setNeedsSignInByProvider((current) => ({ ...current, [provider]: !connectedProvidersRef.current[provider] }));
    setLoginStatus(`Laddar ${PROVIDER_META[provider].label}…`);
    if (provider === 'claude') setWebSourceURL(PROVIDER_META[provider].homeURL);
  }, [activeProvider, clearRequestTimeout]);

  const resetFormatFor = useCallback(
    (window: UsageWindow): ResetFormat => resetFormats[windowKey(window)] ?? 'clock',
    [resetFormats],
  );

  const toggleResetFormat = useCallback((window: UsageWindow) => {
    const key = windowKey(window);
    setResetFormats((current) => {
      const next: Record<string, ResetFormat> = {
        ...current,
        [key]: current[key] === 'remaining' ? 'clock' : 'remaining',
      };
      void AsyncStorage.setItem(RESET_FORMAT_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const persistBackground = useCallback((id: BackgroundId, uri: string | null) => {
    void AsyncStorage.setItem(BACKGROUND_STORAGE_KEY, JSON.stringify({ id, uri })).catch(() => {});
  }, []);

  const chooseBuiltInBackground = useCallback(
    (id: BackgroundId) => {
      setBackgroundError(null);
      setBackgroundId(id);
      // The picked photo is kept, so switching to a gradient and back does not lose it.
      persistBackground(id, customBackgroundUri);
    },
    [customBackgroundUri, persistBackground],
  );

  const pickCustomBackground = useCallback(async () => {
    setBackgroundError(null);

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setBackgroundError('Appen fick inte läsa dina bilder. Ge behörighet i systeminställningarna.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.9 });
    if (result.canceled || result.assets.length === 0) return;

    try {
      // The picker hands back a cache path the system may reclaim, so the file is copied
      // into the document directory and the stored URI points at that copy instead.
      const source = new File(result.assets[0].uri);
      const extension = source.extension || '.jpg';
      const destination = new File(Paths.document, `${BACKGROUND_FILE_NAME}${extension}`);
      if (destination.exists) destination.delete();
      source.copy(destination);

      setCustomBackgroundUri(destination.uri);
      setBackgroundId('custom');
      persistBackground('custom', destination.uri);
    } catch {
      setBackgroundError('Bilden kunde inte sparas. Försök med en annan bild.');
    }
  }, [persistBackground]);

  const resetBackground = useCallback(() => {
    setBackgroundError(null);
    setBackgroundId(DEFAULT_BACKGROUND_ID);
    setCustomBackgroundUri(null);
    persistBackground(DEFAULT_BACKGROUND_ID, null);
  }, [persistBackground]);

  const chooseTheme = useCallback((preference: ThemePreference) => {
    setThemePreference(preference);
    void AsyncStorage.setItem(THEME_STORAGE_KEY, preference).catch(() => {});
  }, []);

  const handleMenuConnect = useCallback((provider: UsageProvider) => {
    setIsMenuOpen(false);
    if (provider === activeProvider) {
      showLogin();
      return;
    }
    selectProvider(provider);
  }, [activeProvider, selectProvider, showLogin]);

  const handleMenuDisconnect = useCallback((provider: UsageProvider) => {
    setIsMenuOpen(false);
    void disconnectProvider(provider);
  }, [disconnectProvider]);

  const shareObservation = useCallback(async () => {
    if (!snapshot || lastRefreshDuration === null) return;
    await Share.share({ message: createExperimentReport(snapshot, lastRefreshDuration) });
  }, [lastRefreshDuration, snapshot]);

  // The five-hour window is deliberately always the hero, in portrait and landscape
  // alike, because it is the number people open the app to see. The risk that a fuller
  // weekly or model limit hides behind it is handled by primaryNote below instead of by
  // swapping the hero around, which would make the layout unpredictable.
  const primaryWindow = snapshot?.windows.find((window) => window.id === 'five-hour') ?? snapshot?.windows[0] ?? null;
  const secondaryWindows = snapshot?.windows.filter((window) => window !== primaryWindow) ?? [];
  const modelWindows = snapshot?.windows.filter((window) => window.id === 'scoped') ?? [];
  const burnRate = primaryWindow
    ? computeBurnRate(histories[activeProvider], windowKey(primaryWindow), primaryWindow.utilization)
    : null;
  const primaryNote = primaryWindow
    ? buildPrimaryNote({ burnRate, modelWindows, primaryWindow, secondaryWindows })
    : null;
  // No live reading in this session means nothing has been measured, so there is nothing
  // to claim. Restored history on its own must never assert that something is running.
  const liveAt = liveSampleAt[activeProvider];
  const recentDelta =
    primaryWindow && liveAt !== null
      ? computeRecentDelta(histories[activeProvider], windowKey(primaryWindow), new Date(), liveAt)
      : null;
  const activityBuckets = primaryWindow
    ? buildActivityBuckets(histories[activeProvider], windowKey(primaryWindow))
    : null;
  // Guarded here rather than in each view, so portrait and landscape cannot disagree.
  // Claiming consumption "right now" would be false while the newest request has failed.
  // The wording stays passive on purpose: the endpoint shows that quota was consumed, not
  // who or what consumed it, so it could be another device or a forgotten session.
  const activityText =
    recentDelta && !isStale
      ? `Förbrukat · ${formatDelta(recentDelta.risePercent)} % ${formatSpan(recentDelta.spanMs)}`
      : null;
  const isMonitorMode = width > height && Boolean(snapshot && primaryWindow) && !isShowingLogin;
  const isSignedOutLandscape = width > height && !snapshot && !isShowingLogin;
  const canShareObservation = snapshot !== null && lastRefreshDuration !== null;

  return (
    <GlassBackdropProvider
      photo={isGlass && (isImageBackground(backgroundId) || (backgroundId === 'custom' && customBackgroundUri !== null))}
      targetRef={blurTargetRef}>
      <View style={[styles.root, isMonitorMode && styles.monitorRoot]}>
        {isGlass ? (
          <AppBackground
            backgroundId={backgroundId}
            customUri={customBackgroundUri}
            targetRef={blurTargetRef}
          />
        ) : null}
        {isHalloween ? <HalloweenAmbience /> : null}
        {isMonitorMode ? <KeepScreenAwake /> : null}
        <StatusBar
          hidden={isMonitorMode}
          style={isMonitorMode || isHalloween || isGlass ? 'light' : 'auto'}
        />
        {isMonitorMode && snapshot && primaryWindow ? (
          <LandscapeMonitor
            activeProvider={activeProvider}
            activityText={activityText}
            isGlass={isGlass}
            isRefreshing={isRefreshing}
            note={primaryNote}
            onOpenMenu={() => setIsMenuOpen(true)}
            onRefresh={refresh}
            onToggleResetFormat={toggleResetFormat}
            resetFormatFor={resetFormatFor}
            onSelectProvider={selectProvider}
            primaryWindow={primaryWindow}
            providerAccentInk={isGlass ? palette.ink : providerTheme.monitorAccentInk}
            secondaryWindows={secondaryWindows}
            snapshot={snapshot}
            styles={styles}
          />
        ) : (
          <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
          <ScrollView
            contentContainerStyle={[
              styles.content,
              isSignedOutLandscape && styles.signedOutLandscapeContent,
              { paddingBottom: Math.max(32, insets.bottom + 20) },
            ]}
            refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={palette.accent} />}>
            <RefreshProgressBar color={palette.accent} isActive={isRefreshing} trackColor={palette.line} />

            <View style={styles.header}>
              <View>
                <Text style={styles.title}>{isHalloween ? 'Usage 🎃' : 'Usage'}</Text>
                <View style={styles.connectionRow}>
                  <View style={[styles.statusDot, { backgroundColor: snapshot ? palette.success : palette.secondary }]} />
                  <Text style={styles.connectionText}>
                    {`${PROVIDER_META[activeProvider].label} · ${snapshot ? 'anslutet' : needsSignIn ? 'inloggning krävs' : 'hämtar usage'}`}
                  </Text>
                </View>
              </View>
              <Pressable
                accessibilityLabel="Öppna menyn"
                accessibilityRole="button"
                accessibilityState={{ expanded: isMenuOpen }}
                onPress={() => setIsMenuOpen(true)}
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
                <Ionicons name="menu" size={24} color={palette.ink} />
              </Pressable>
            </View>

            <ProviderSwitcher
              activeProvider={activeProvider}
              isGlass={isGlass}
              onSelectProvider={selectProvider}
              styles={styles}
            />

            {snapshot && primaryWindow ? (
              <View style={styles.stack}>
                {isStale ? (
                  <Pressable
                    accessibilityLabel="Försök uppdatera igen"
                    accessibilityRole="button"
                    onPress={refresh}
                    style={({ pressed }) => [styles.staleBanner, pressed && styles.pressed]}>
                    <Ionicons name="cloud-offline-outline" size={18} color={palette.errorText} />
                    <Text style={styles.staleBannerText}>
                      {errorMessage ?? 'Kunde inte uppdatera just nu. Tryck för att försöka igen.'}
                    </Text>
                  </Pressable>
                ) : null}

                <PrimaryUsagePanel
                  activityText={activityText}
                  isGlass={isGlass}
                  isHalloween={isHalloween}
                  note={primaryNote}
                  onToggleResetFormat={toggleResetFormat}
                  providerAccentInk={isGlass ? palette.ink : providerTheme.monitorAccentInk}
                  resetFormatFor={resetFormatFor}
                  styles={styles}
                  window={primaryWindow}
                />

                {activityBuckets ? (
                  <View style={styles.activityCard}>
                    {isGlass ? <GlassSurface /> : null}
                    <ActivityStrip
                      buckets={activityBuckets}
                      color={palette.accent}
                      emptyColor={palette.line}
                      labelColor={palette.tertiary}
                      titleColor={palette.ink}
                    />
                  </View>
                ) : null}

                {secondaryWindows.length > 0 ? (
                  <View style={styles.limitsSection}>
                    <Text style={styles.sectionTitle}>Övriga gränser</Text>
                    <View style={styles.limitsCard}>
                      {isGlass ? <GlassSurface /> : null}
                      {secondaryWindows.map((window, index) => (
                        <View key={windowKey(window)}>
                          {index > 0 ? <View style={styles.divider} /> : null}
                          <UsageLimitRow
                            onToggleResetFormat={toggleResetFormat}
                            palette={palette}
                            resetFormatFor={resetFormatFor}
                            styles={styles}
                            window={window}
                          />
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}

                <View style={styles.freshnessRow}>
                  <View style={styles.freshnessCopy}>
                    <View style={styles.freshnessTitleRow}>
                      <View style={[styles.statusDot, { backgroundColor: isStale ? palette.danger : palette.success }]} />
                      <Text style={styles.freshnessTitle}>{`Uppdaterad ${formatRelativeTime(snapshot.fetchedAt)}`}</Text>
                    </View>
                  </View>
                  <Pressable
                    accessibilityLabel="Uppdatera usage"
                    accessibilityRole="button"
                    accessibilityState={{ disabled: isRefreshing, busy: isRefreshing }}
                    disabled={isRefreshing}
                    onPress={refresh}
                    style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
                    {isRefreshing ? (
                      <ActivityIndicator size="small" color={palette.ink} />
                    ) : (
                      <Ionicons name="refresh" size={21} color={palette.ink} />
                    )}
                  </Pressable>
                </View>

              </View>
            ) : (
              <View style={[styles.signInPanel, isSignedOutLandscape && styles.signInPanelLandscape]}>
                {isGlass ? <GlassSurface /> : null}
                <View style={[styles.signInIntro, isSignedOutLandscape && styles.signInIntroLandscape]}>
                  <View style={styles.signInIcon}>
                    {isHalloween && !errorMessage ? (
                      <Text style={styles.signInEmoji}>🎃</Text>
                    ) : (
                      <Ionicons name={errorMessage ? 'cloud-offline-outline' : 'person-outline'} size={32} color={palette.accent} />
                    )}
                  </View>
                  <View style={styles.signInCopy}>
                    <Text style={styles.signInTitle}>
                      {errorMessage
                        ? 'Usage kunde inte hämtas'
                        : needsSignIn
                          ? `Logga in på ${PROVIDER_META[activeProvider].label}`
                          : `Hämtar ${PROVIDER_META[activeProvider].label} usage`}
                    </Text>
                    <Text style={styles.signInText}>
                      {errorMessage
                        ? 'Kontrollera anslutningen och försök igen. Om sessionen har löpt ut får du logga in på nytt.'
                        : needsSignIn
                          ? activeProvider === 'codex'
                            ? 'Anslut ditt OpenAI-konto för att se aktuella Codex-gränser och återställningstider.'
                            : 'Anslut ditt Claude-konto för att se aktuella gränser och återställningstider.'
                          : 'Din sparade session kontrolleras. Det tar vanligtvis bara några sekunder.'}
                    </Text>
                  </View>
                </View>

                <View style={[styles.signInActions, isSignedOutLandscape && styles.signInActionsLandscape]}>
                  {needsSignIn || errorMessage ? (
                    <Pressable
                      accessibilityLabel={errorMessage && !needsSignIn ? 'Försök hämta usage igen' : `Logga in på ${PROVIDER_META[activeProvider].label}`}
                      accessibilityRole="button"
                      onPress={errorMessage && !needsSignIn ? refresh : showLogin}
                      style={({ pressed }) => [styles.signInButton, pressed && styles.pressed]}>
                      <Text style={styles.signInButtonText}>
                        {errorMessage && !needsSignIn
                          ? 'Försök igen'
                          : activeProvider === 'codex' ? 'Fortsätt med OpenAI' : 'Fortsätt med Claude'}
                      </Text>
                      <Ionicons name="arrow-forward" size={19} color={palette.accentInk} />
                    </Pressable>
                  ) : (
                    <View style={styles.checkingRow}>
                      <ActivityIndicator color={palette.accent} />
                      <Text style={styles.checkingText}>Kontrollerar sparad session…</Text>
                    </View>
                  )}

                  <View style={[styles.signInAssurances, isSignedOutLandscape && styles.signInAssurancesLandscape]}>
                    <View style={styles.assuranceRow}>
                      <Ionicons name="key-outline" size={19} color={palette.accent} />
                      <Text style={styles.assuranceText}>Du behöver normalt bara logga in en gång.</Text>
                    </View>
                    <View style={styles.assuranceRow}>
                      <Ionicons name="shield-checkmark-outline" size={19} color={palette.accent} />
                      <Text style={styles.assuranceText}>Session och usage stannar på din enhet.</Text>
                    </View>
                  </View>
                </View>
              </View>
            )}

          </ScrollView>
          </SafeAreaView>
        )}

        <Modal
          animationType="slide"
          hardwareAccelerated
          onRequestClose={dismissLogin}
          presentationStyle="fullScreen"
          visible={isShowingLogin}>
          <GlassBackdropProvider
            photo={isGlass && (isImageBackground(backgroundId) || (backgroundId === 'custom' && customBackgroundUri !== null))}
            targetRef={loginBlurTargetRef}>
            <View style={styles.loginModal}>
              {isGlass ? (
                <AppBackground
                  backgroundId={backgroundId}
                  customUri={customBackgroundUri}
                  targetRef={loginBlurTargetRef}
                />
              ) : null}
              <SafeAreaView
                accessibilityViewIsModal
                edges={['top', 'bottom', 'left', 'right']}
                style={styles.loginSafeArea}>
            <View style={styles.loginHeader}>
              <Pressable
                accessibilityLabel="Stäng inloggningen"
                accessibilityRole="button"
                hitSlop={12}
                onPress={dismissLogin}
                style={styles.loginHeaderAction}>
                <Text style={styles.loginAction}>Avbryt</Text>
              </Pressable>
              <Text style={styles.loginTitle}>
                {activeProvider === 'codex' ? 'Anslut Codex' : 'Logga in på Claude'}
              </Text>
              {activeProvider === 'codex' ? (
                <View style={styles.loginHeaderAction} />
              ) : (
                <Pressable
                  accessibilityRole="button"
                  hitSlop={12}
                  onPress={refresh}
                  style={styles.loginHeaderAction}>
                  <Text style={[styles.loginAction, styles.loginActionRight]}>Klar</Text>
                </Pressable>
              )}
            </View>
            <View style={[styles.loginHint, isCompactHeight && styles.loginHintCompact]}>
              {isRefreshing || codexLogin?.phase === 'starting' || codexLogin?.phase === 'finishing'
                ? <ActivityIndicator size="small" color={palette.accent} />
                : <Ionicons name={activeProvider === 'codex' ? 'key-outline' : 'mail-outline'} size={18} color={palette.accent} />}
              <Text numberOfLines={isCompactHeight ? 2 : undefined} style={styles.loginHintText}>{loginStatus}</Text>
            </View>
            {activeProvider === 'codex' ? (
              <ScrollView
                style={styles.deviceLoginScroll}
                contentContainerStyle={styles.deviceLoginPanel}
                showsVerticalScrollIndicator={false}>
                <View style={styles.deviceLoginIcon}>
                  <Ionicons name="shield-checkmark-outline" size={34} color={palette.accent} />
                </View>
                <Text style={styles.deviceLoginTitle}>
                  {codexLogin?.phase === 'prerequisite' ? 'Tillåt Codex-inloggning' : 'Logga in säkert hos OpenAI'}
                </Text>
                {codexLogin?.phase === 'prerequisite' ? (
                  <>
                    <Text style={styles.deviceLoginText}>
                      OpenAI har enhetskoder avstängda som standard. Slå på dem en gång innan du ansluter appen.
                    </Text>
                    <View style={styles.deviceSteps}>
                      <View style={styles.deviceStep}>
                        <View style={styles.deviceStepNumber}><Text style={styles.deviceStepNumberText}>1</Text></View>
                        <Text style={styles.deviceStepText}>Öppna ChatGPT:s säkerhetsinställningar.</Text>
                      </View>
                      <View style={styles.deviceStep}>
                        <View style={styles.deviceStepNumber}><Text style={styles.deviceStepNumberText}>2</Text></View>
                        <Text style={styles.deviceStepText}>Slå på “Enable device code authorization for Codex”.</Text>
                      </View>
                      <View style={styles.deviceStep}>
                        <View style={styles.deviceStepNumber}><Text style={styles.deviceStepNumberText}>3</Text></View>
                        <Text style={styles.deviceStepText}>Gå tillbaka hit och skapa engångskoden.</Text>
                      </View>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      onPress={openCodexSecuritySettings}
                      style={({ pressed }) => [styles.deviceLoginButton, pressed && styles.pressed]}>
                      <Text style={styles.deviceLoginButtonText}>Öppna säkerhetsinställningar</Text>
                      <Ionicons name="open-outline" size={19} color={palette.accentInk} />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void startCodexLogin()}
                      style={({ pressed }) => [styles.deviceLoginSecondaryButton, pressed && styles.pressed]}>
                      <Text style={styles.deviceLoginSecondaryButtonText}>Klart — skapa engångskod</Text>
                    </Pressable>
                    <Text style={styles.deviceLoginFootnote}>
                      Har du ett arbetskonto kan administratören behöva tillåta inställningen för arbetsytan.
                    </Text>
                  </>
                ) : codexLogin?.authorization ? (
                  <Text style={styles.deviceLoginText}>
                    Följ stegen nedan. Koden fungerar med Google, Apple eller e-post och löper ut efter 15 minuter.
                  </Text>
                ) : null}

                {codexLogin?.authorization ? (
                  <>
                    <View style={styles.deviceCodeBlock}>
                      {isGlass ? <GlassSurface elevated /> : null}
                      <Text style={styles.deviceCodeLabel}>DIN ENGÅNGSKOD</Text>
                      <Text selectable style={styles.deviceCode}>{codexLogin.authorization.userCode}</Text>
                    </View>
                    <View style={styles.deviceSteps}>
                      <View style={styles.deviceStep}>
                        <View style={styles.deviceStepNumber}><Text style={styles.deviceStepNumberText}>1</Text></View>
                        <Text style={styles.deviceStepText}>Kopiera engångskoden med knappen nedan.</Text>
                      </View>
                      <View style={styles.deviceStep}>
                        <View style={styles.deviceStepNumber}><Text style={styles.deviceStepNumberText}>2</Text></View>
                        <Text style={styles.deviceStepText}>Öppna OpenAI i webbläsaren och klistra in koden.</Text>
                      </View>
                      <View style={styles.deviceStep}>
                        <View style={styles.deviceStepNumber}><Text style={styles.deviceStepNumberText}>3</Text></View>
                        <Text style={styles.deviceStepText}>Godkänn och gå tillbaka hit. Anslutningen slutförs automatiskt.</Text>
                      </View>
                    </View>
                  </>
                ) : null}

                {codexLogin?.phase === 'starting' || codexLogin?.phase === 'finishing' ? (
                  <ActivityIndicator size="large" color={palette.accent} />
                ) : codexLogin?.phase === 'error' ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void startCodexLogin()}
                    style={({ pressed }) => [styles.deviceLoginButton, pressed && styles.pressed]}>
                    <Text style={styles.deviceLoginButtonText}>Skapa en ny kod</Text>
                    <Ionicons name="refresh" size={19} color={palette.accentInk} />
                  </Pressable>
                ) : codexLogin?.authorization ? (
                  <View style={styles.deviceActionStack}>
                    <Pressable
                      accessibilityLabel="Kopiera engångskoden"
                      accessibilityRole="button"
                      onPress={() => void copyCodexCode()}
                      style={({ pressed }) => [styles.deviceLoginButton, pressed && styles.pressed]}>
                      <Text style={styles.deviceLoginButtonText}>{isCodexCodeCopied ? 'Kopierad' : 'Kopiera engångskod'}</Text>
                      <Ionicons name={isCodexCodeCopied ? 'checkmark' : 'copy-outline'} size={19} color={palette.accentInk} />
                    </Pressable>
                    <Pressable
                      accessibilityLabel="Öppna OpenAI i webbläsaren"
                      accessibilityRole="button"
                      onPress={() => openCodexDevicePage()}
                      style={({ pressed }) => [styles.deviceLoginSecondaryButton, pressed && styles.pressed]}>
                      <Text style={styles.deviceLoginSecondaryButtonText}>Öppna OpenAI i webbläsaren</Text>
                      <Ionicons name="open-outline" size={19} color={palette.ink} />
                    </Pressable>
                  </View>
                ) : null}

                {codexLogin?.errorMessage ? <Text style={styles.deviceLoginError}>{codexLogin.errorMessage}</Text> : null}
                <Text style={styles.deviceLoginPrivacy}>Token sparas i enhetens säkra lagring och usage hämtas direkt från OpenAI.</Text>
              </ScrollView>
            ) : (
              <View style={styles.webViewHost}>
                <WebView
                  ref={webViewRef}
                  source={{ uri: webSourceURL }}
                  style={styles.webView}
                  javaScriptEnabled
                  domStorageEnabled
                  sharedCookiesEnabled
                  thirdPartyCookiesEnabled
                  javaScriptCanOpenWindowsAutomatically
                  setSupportMultipleWindows
                  userAgent={SAFARI_USER_AGENT}
                  onLoadEnd={handleLoadEnd}
                  onMessage={handleMessage}
                  onNavigationStateChange={handleNavigationChange}
                  onOpenWindow={handleOpenWindow}
                  onShouldStartLoadWithRequest={handleShouldStartLoad}
                  onError={() => setLoginStatus('Claude-sidan kunde inte laddas. Kontrollera nätverket.')}
                />
              </View>
            )}
              </SafeAreaView>
            </View>
          </GlassBackdropProvider>
        </Modal>

        {isMenuOpen ? (
          <Animated.View
            entering={isReducedMotion ? undefined : FadeIn.duration(MOTION.enter.duration)}
            exiting={isReducedMotion ? undefined : FadeOut.duration(MOTION.exit.duration)}
            style={[
              styles.menuOverlay,
              {
                paddingTop: insets.top,
                paddingBottom: insets.bottom,
                paddingLeft: insets.left,
                paddingRight: insets.right,
              },
            ]}>
            {isGlass ? <GlassSurface radius={0} /> : null}
            <View style={styles.loginHeader}>
              <View style={styles.loginHeaderSpacer} />
              <Text style={styles.loginTitle}>Meny</Text>
              <Pressable accessibilityRole="button" hitSlop={12} onPress={() => setIsMenuOpen(false)}>
                <Text style={styles.loginAction}>Stäng</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.menuContent}>
              <Text style={styles.menuSectionTitle}>Konton</Text>
              <View style={styles.menuCard}>
                {isGlass ? <GlassSurface elevated radius={16} /> : null}
                {PROVIDERS.map((provider, index) => {
                  const isConnected = !needsSignInByProvider[provider];
                  return (
                    <View key={provider}>
                      {index > 0 ? <View style={styles.divider} /> : null}
                      <View style={styles.menuRow}>
                        <View style={styles.menuRowCopy}>
                          <Text style={styles.menuRowTitle}>{PROVIDER_META[provider].label}</Text>
                          <View style={styles.freshnessTitleRow}>
                            <View
                              style={[
                                styles.statusDot,
                                { backgroundColor: isConnected ? palette.success : palette.secondary },
                              ]}
                            />
                            <Text style={styles.menuRowStatus}>
                              {isConnected ? 'Ansluten' : 'Inte ansluten'}
                            </Text>
                          </View>
                        </View>
                        <Pressable
                          accessibilityLabel={
                            isConnected
                              ? `Koppla bort ${PROVIDER_META[provider].label}`
                              : `Logga in på ${PROVIDER_META[provider].label}`
                          }
                          accessibilityRole="button"
                          onPress={() =>
                            isConnected ? handleMenuDisconnect(provider) : handleMenuConnect(provider)
                          }
                          style={({ pressed }) => [styles.menuAction, pressed && styles.pressed]}>
                          <Text style={styles.menuActionText}>
                            {isConnected ? 'Koppla bort' : 'Logga in'}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
              <Text style={styles.menuFootnote}>
                Codex loggas ut helt, tokens raderas ur enhetens säkra lagring. För Claude glömmer appen
                anslutningen, men webbsessionen ligger kvar tills du loggar ut på claude.ai.
              </Text>

              <Text style={styles.menuSectionTitle}>Tema</Text>
              <View style={styles.menuCard}>
                {isGlass ? <GlassSurface elevated radius={16} /> : null}
                {THEME_OPTIONS.map((option, index) => {
                  const isSelected = themePreference === option.value;
                  return (
                    <View key={option.value}>
                      {index > 0 ? <View style={styles.divider} /> : null}
                      <Pressable
                        accessibilityLabel={option.label}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: isSelected }}
                        onPress={() => chooseTheme(option.value)}
                        style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}>
                        <View style={styles.menuRowCopy}>
                          <Text style={styles.menuRowTitle}>
                            {option.value === 'halloween' ? `${option.label} 🎃` : option.label}
                          </Text>
                          <Text style={styles.menuRowStatus}>{option.note}</Text>
                        </View>
                        {isSelected ? (
                          <Ionicons name="checkmark-circle" size={23} color={palette.accent} />
                        ) : (
                          <Ionicons name="ellipse-outline" size={23} color={palette.line} />
                        )}
                      </Pressable>
                    </View>
                  );
                })}
              </View>

              {isGlass ? (
                <>
                  <Text style={styles.menuSectionTitle}>Bakgrund</Text>
                  <View style={styles.menuCard}>
                    <GlassSurface elevated radius={16} />
                    {BUILT_IN_BACKGROUNDS.map((background, index) => {
                      const isSelected = backgroundId === background.id;
                      return (
                        <View key={background.id}>
                          {index > 0 ? <View style={styles.divider} /> : null}
                          <Pressable
                            accessibilityLabel={background.label}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: isSelected }}
                            onPress={() => chooseBuiltInBackground(background.id)}
                            style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}>
                            {background.image ? (
                              <Image
                                contentFit="cover"
                                source={background.image}
                                style={styles.backgroundSwatch}
                              />
                            ) : (
                              <View
                                style={[
                                  styles.backgroundSwatch,
                                  { backgroundColor: background.colors[0] },
                                ]}>
                                <View
                                  style={[
                                    styles.backgroundSwatchInner,
                                    { backgroundColor: background.colors[2] },
                                  ]}
                                />
                              </View>
                            )}
                            <View style={styles.menuRowCopy}>
                              <Text style={styles.menuRowTitle}>{background.label}</Text>
                              <Text style={styles.menuRowStatus}>{background.note}</Text>
                            </View>
                            {isSelected ? (
                              <Ionicons name="checkmark-circle" size={23} color={palette.accent} />
                            ) : (
                              <Ionicons name="ellipse-outline" size={23} color={palette.line} />
                            )}
                          </Pressable>
                        </View>
                      );
                    })}

                    <View style={styles.divider} />
                    <Pressable
                      accessibilityLabel="Välj en egen bild som bakgrund"
                      accessibilityRole="button"
                      accessibilityState={{ selected: backgroundId === 'custom' }}
                      onPress={() => void pickCustomBackground()}
                      style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}>
                      {backgroundId === 'custom' && customBackgroundUri ? (
                        <Image
                          contentFit="cover"
                          source={{ uri: customBackgroundUri }}
                          style={styles.backgroundSwatch}
                        />
                      ) : (
                        <View style={styles.backgroundSwatch}>
                          <Ionicons name="image-outline" size={19} color={palette.secondary} />
                        </View>
                      )}
                      <View style={styles.menuRowCopy}>
                        <Text style={styles.menuRowTitle}>Egen bild</Text>
                        <Text style={styles.menuRowStatus}>
                          {backgroundId === 'custom'
                            ? 'Vald, tryck för att byta'
                            : 'Välj från dina bilder'}
                        </Text>
                      </View>
                      {backgroundId === 'custom' ? (
                        <Ionicons name="checkmark-circle" size={23} color={palette.accent} />
                      ) : (
                        <Ionicons name="ellipse-outline" size={23} color={palette.line} />
                      )}
                    </Pressable>

                    {backgroundId !== DEFAULT_BACKGROUND_ID || customBackgroundUri ? (
                      <>
                        <View style={styles.divider} />
                        <Pressable
                          accessibilityLabel="Återställ till standardbakgrunden"
                          accessibilityRole="button"
                          onPress={resetBackground}
                          style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}>
                          <Ionicons name="refresh-outline" size={19} color={palette.accent} />
                          <Text style={styles.menuInfoText}>Återställ till standard</Text>
                        </Pressable>
                      </>
                    ) : null}
                  </View>

                  {backgroundError ? (
                    <Text style={styles.menuFootnote}>{backgroundError}</Text>
                  ) : null}
                </>
              ) : null}

              <Text style={styles.menuSectionTitle}>Om appen</Text>
              <View style={styles.menuCard}>
                {isGlass ? <GlassSurface elevated radius={16} /> : null}
                <View style={styles.menuRow}>
                  <Ionicons name="shield-checkmark-outline" size={19} color={palette.accent} />
                  <Text style={styles.menuInfoText}>
                    Inloggning och usage stannar på enheten. Inget skickas till någon server som
                    appen äger.
                  </Text>
                </View>
                <View style={styles.divider} />
                <Pressable
                  accessibilityLabel="Dela en anonymiserad observation"
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canShareObservation }}
                  disabled={!canShareObservation}
                  onPress={shareObservation}
                  style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}>
                  <Ionicons
                    name="share-outline"
                    size={19}
                    color={canShareObservation ? palette.accent : palette.tertiary}
                  />
                  <Text style={[styles.menuInfoText, !canShareObservation && { color: palette.tertiary }]}>
                    {canShareObservation
                      ? 'Dela observation för EXP-001'
                      : 'Dela observation, kräver hämtad usage'}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </Animated.View>
        ) : null}
      </View>
    </GlassBackdropProvider>
  );
}

/**
 * Holds the idle timer for as long as it is mounted, so the caller controls it by whether
 * it renders. useKeepAwake has no conditional form, and this used to be called
 * unconditionally in the dashboard, which kept the display lit on every screen for as long
 * as the app was open. Only the landscape monitor is meant to be left running on a desk.
 */
function KeepScreenAwake() {
  useKeepAwake(KEEP_AWAKE_TAG);
  return null;
}

type DashboardStyles = ReturnType<typeof createStyles>;

function ProviderSwitcher({
  activeProvider,
  isGlass,
  isMonitor = false,
  onSelectProvider,
  styles,
}: {
  activeProvider: UsageProvider;
  isGlass: boolean;
  isMonitor?: boolean;
  onSelectProvider: (provider: UsageProvider) => void;
  styles: DashboardStyles;
}) {
  const isReducedMotion = useReducedMotion();
  const [trackWidth, setTrackWidth] = useState(0);
  const activeIndex = PROVIDERS.indexOf(activeProvider);
  const offset = useSharedValue(0);
  // onLayout reports the outer width, so the container's own padding has to come off
  // before splitting it, otherwise the indicator is too wide and slides past its slot.
  const trackPadding = isMonitor ? 3 : 4;
  const innerWidth = Math.max(0, trackWidth - trackPadding * 2);
  const optionWidth = innerWidth > 0 ? innerWidth / PROVIDERS.length : 0;

  useEffect(() => {
    const target = activeIndex * optionWidth;
    offset.value = isReducedMotion ? target : withTiming(target, MOTION.move);
  }, [activeIndex, isReducedMotion, offset, optionWidth]);

  const indicatorStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  return (
    <View
      accessibilityRole="tablist"
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      style={isMonitor ? styles.monitorProviderSwitcher : styles.providerSwitcher}>
      {isGlass ? <GlassSurface radius={isMonitor ? 14 : 15} /> : null}
      {optionWidth > 0 ? (
        <Animated.View
          style={[
            isMonitor ? styles.monitorProviderIndicator : styles.providerIndicator,
            { width: optionWidth },
            indicatorStyle,
          ]}
        />
      ) : null}

      {PROVIDERS.map((provider) => {
        const selected = provider === activeProvider;
        return (
          <Pressable
            key={provider}
            accessibilityLabel={`Visa ${PROVIDER_META[provider].label} usage`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onSelectProvider(provider)}
            style={({ pressed }) => [
              isMonitor ? styles.monitorProviderOption : styles.providerOption,
              pressed && styles.pressed,
            ]}>
            <Text
              style={[
                isMonitor ? styles.monitorProviderOptionText : styles.providerOptionText,
                selected && (isMonitor ? styles.monitorProviderOptionTextActive : styles.providerOptionTextActive),
              ]}>
              {PROVIDER_META[provider].label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function LandscapeMonitor({
  activeProvider,
  activityText,
  isGlass,
  isRefreshing,
  note,
  onOpenMenu,
  onRefresh,
  onSelectProvider,
  onToggleResetFormat,
  primaryWindow,
  providerAccentInk,
  resetFormatFor,
  secondaryWindows,
  snapshot,
  styles,
}: {
  activeProvider: UsageProvider;
  activityText: string | null;
  isGlass: boolean;
  note: PrimaryNote | null;
  isRefreshing: boolean;
  onOpenMenu: () => void;
  onToggleResetFormat: (window: UsageWindow) => void;
  resetFormatFor: (window: UsageWindow) => ResetFormat;
  onRefresh: () => void;
  onSelectProvider: (provider: UsageProvider) => void;
  primaryWindow: UsageWindow;
  providerAccentInk: string;
  secondaryWindows: UsageWindow[];
  snapshot: UsageSnapshot;
  styles: DashboardStyles;
}) {
  const utilization = Math.round(primaryWindow.utilization);
  const remaining = Math.max(0, 100 - utilization);
  // Each optional row above and below the number costs height that the landscape panel
  // does not have to spare, so the number gives way rather than the layout overflowing.
  const extraRows = (note ? 1 : 0) + (activityText ? 1 : 0);
  const isReducedMotion = useReducedMotion();

  // Landscape is the leave-it-on-a-desk view, so it starts with no chrome at all and the
  // panels get the whole screen. The controls are not dropped, though: the menu is the only
  // way to reach settings and the switcher the only way to change provider, and rotating the
  // phone to get at them would be a worse answer than a tap. So a tap reveals the bar and it
  // goes away again on its own, which is how a full-screen player behaves.
  const [isChromeVisible, setIsChromeVisible] = useState(false);

  useEffect(() => {
    if (!isChromeVisible) return;
    const timeout = setTimeout(() => setIsChromeVisible(false), MONITOR_CHROME_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [isChromeVisible]);

  return (
    <SafeAreaView style={styles.monitorSafeArea} edges={['top', 'bottom', 'left', 'right']}>
      <Pressable
        // Not a button, and not visible to assistive tech: it wraps the panels, which carry
        // their own controls, and a button announcing itself around other buttons is wrong
        // semantics everywhere. On web it was also invalid markup, a <button> inside a
        // <button>, which React refused to render. It is a background gesture, the way
        // tapping a video reveals its controls.
        accessible={false}
        onPress={() => setIsChromeVisible((current) => !current)}
        style={styles.monitorShell}>
        {isChromeVisible ? (
          <Animated.View
            entering={isReducedMotion ? undefined : FadeIn.duration(MOTION.enter.duration)}
            exiting={isReducedMotion ? undefined : FadeOut.duration(MOTION.exit.duration)}
            style={styles.monitorHeader}>
            <View style={styles.monitorIdentity}>
              <Text style={styles.monitorBrand}>Usage</Text>
              <View style={styles.monitorConnection}>
                <View style={[styles.monitorStatusDot, styles.monitorLiveDot]} />
                <Text style={styles.monitorConnectionText}>
                  {`${PROVIDER_META[activeProvider].label} · anslutet`}
                </Text>
              </View>
            </View>

            <ProviderSwitcher
              activeProvider={activeProvider}
              isGlass={isGlass}
              isMonitor
              onSelectProvider={onSelectProvider}
              styles={styles}
            />

            <View style={styles.monitorHeaderActions}>
              <Text numberOfLines={1} style={styles.monitorUpdated}>
                {`Uppdaterad ${formatRelativeTime(snapshot.fetchedAt)}`}
              </Text>
              <Pressable
                accessibilityLabel="Uppdatera usage"
                accessibilityRole="button"
                accessibilityState={{ busy: isRefreshing, disabled: isRefreshing }}
                disabled={isRefreshing}
                onPress={onRefresh}
                style={({ pressed }) => [styles.monitorRefreshButton, pressed && styles.monitorPressed]}>
                {isRefreshing ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="refresh" size={22} color="#FFFFFF" />
                )}
              </Pressable>

              <Pressable
                accessibilityLabel="Öppna menyn"
                accessibilityRole="button"
                onPress={onOpenMenu}
                style={({ pressed }) => [styles.monitorRefreshButton, pressed && styles.monitorPressed]}>
                <Ionicons name="menu" size={24} color="#FFFFFF" />
              </Pressable>
            </View>
          </Animated.View>
        ) : null}

        <View style={styles.monitorBody}>
          <View style={styles.monitorPrimary}>
            {isGlass ? <GlassSurface /> : null}
            <View style={styles.monitorPrimaryHeader}>
              <Text style={styles.monitorPrimaryTitle}>{formatMonitorTitle(primaryWindow)}</Text>
              <Text maxFontSizeMultiplier={1.2} style={styles.monitorRemaining}>{remaining}% kvar</Text>
            </View>

            {activityText ? (
              <View style={styles.monitorActivityRow}>
                <PulseDot color={providerAccentInk} size={7} />
                <Text numberOfLines={1} style={styles.monitorActivityText}>{activityText}</Text>
              </View>
            ) : null}

            <View style={styles.monitorMetricRow}>
              <Text
                maxFontSizeMultiplier={1.15}
                style={[
                  styles.monitorMetric,
                  extraRows === 1 && styles.monitorMetricWithNote,
                  extraRows >= 2 && styles.monitorMetricCompact,
                ]}>
                {utilization}%
              </Text>
              <Text style={styles.monitorMetricSuffix}>använt</Text>
            </View>

            <View
              accessibilityLabel={`${formatWindowTitle(primaryWindow)}, ${utilization} procent använt`}
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: utilization, text: `${remaining} procent kvar` }}
              style={styles.monitorTrackHost}>
              <UsageBar
                fillStyle={styles.monitorPrimaryFill}
                trackStyle={styles.monitorPrimaryTrack}
                utilization={primaryWindow.utilization}
              />
            </View>

            <View style={styles.monitorResetRow}>
              <Ionicons name="time-outline" size={23} color={providerAccentInk} />
              <ResetLabel
                format={resetFormatFor(primaryWindow)}
                onToggle={() => onToggleResetFormat(primaryWindow)}
                clockText={formatResetClock(primaryWindow)}
                numberOfLines={2}
                remainingText={formatResetRemaining(primaryWindow)}
                style={styles.monitorResetText}
              />
            </View>

            {note ? (
              <NoteBadge
                bubbleBackground={styles.noteBubble.backgroundColor as string}
                bubbleText={styles.noteBubbleText.color as string}
                color={providerAccentInk}
                label={note.label}
                labelStyle={styles.monitorResetText}
                placement="above"
                size={23}
                text={note.text}
                tone={note.tone}
              />
            ) : null}
          </View>

          {secondaryWindows.length > 0 ? (
            <View style={styles.monitorSecondaryPanel}>
              {isGlass ? <GlassSurface /> : null}
              {secondaryWindows.map((window, index) => (
                <View key={windowKey(window)} style={styles.monitorLimitSlot}>
                  {index > 0 ? <View style={styles.monitorDivider} /> : null}
                  <MonitorLimitRow
                    onToggleResetFormat={onToggleResetFormat}
                    resetFormatFor={resetFormatFor}
                    rowCount={secondaryWindows.length}
                    styles={styles}
                    window={window}
                  />
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </Pressable>

    </SafeAreaView>
  );
}

function MonitorLimitRow({
  onToggleResetFormat,
  resetFormatFor,
  rowCount,
  styles,
  window,
}: {
  onToggleResetFormat: (window: UsageWindow) => void;
  resetFormatFor: (window: UsageWindow) => ResetFormat;
  rowCount: number;
  styles: DashboardStyles;
  window: UsageWindow;
}) {
  const utilization = Math.round(window.utilization);
  const isOnly = rowCount === 1;
  // Three rows filled the landscape panel to within a point of the bottom edge, so a
  // fourth model limit would have spilled off screen. Tighten up instead of clipping.
  const isCompact = rowCount >= 3;

  return (
    <View style={[styles.monitorLimitRow, isCompact && styles.monitorLimitRowCompact]}>
      <View style={styles.monitorLimitHeader}>
        <Text numberOfLines={2} style={[styles.monitorLimitTitle, isOnly && styles.monitorLimitTitleSingle, isCompact && styles.monitorLimitTitleCompact]}>{formatMonitorTitle(window)}</Text>
        <View style={styles.monitorLimitValueRow}>
          {window.utilization >= NEAR_LIMIT_THRESHOLD ? (
            <Ionicons name="alert-circle" size={isOnly ? 26 : 20} color="#FF8A83" />
          ) : null}
          <Text maxFontSizeMultiplier={1.2} style={[styles.monitorLimitValue, isOnly && styles.monitorLimitValueSingle, isCompact && styles.monitorLimitValueCompact, window.utilization >= NEAR_LIMIT_THRESHOLD && styles.monitorDangerText]}>{utilization}%</Text>
          <Text style={[styles.monitorLimitSuffix, isOnly && styles.monitorLimitSuffixSingle]}>använt</Text>
        </View>
      </View>
      <View
        accessibilityLabel={`${formatWindowTitle(window)}, ${utilization} procent använt`}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: utilization }}
        style={styles.monitorTrackHost}>
        <UsageBar
          fillStyle={[styles.monitorLimitFill, window.utilization >= NEAR_LIMIT_THRESHOLD && styles.monitorDangerFill]}
          trackStyle={[styles.monitorLimitTrack, isOnly && styles.monitorLimitTrackSingle, isCompact && styles.monitorLimitTrackCompact]}
          utilization={window.utilization}
        />
      </View>
      <ResetLabel
        format={resetFormatFor(window)}
        onToggle={() => onToggleResetFormat(window)}
        clockText={formatResetClock(window)}
        remainingText={formatResetRemaining(window)}
        style={[styles.monitorLimitReset, isOnly && styles.monitorLimitResetSingle, isCompact && styles.monitorLimitResetCompact]}
      />
    </View>
  );
}

function PrimaryUsagePanel({
  activityText,
  isGlass,
  isHalloween,
  note,
  onToggleResetFormat,
  providerAccentInk,
  resetFormatFor,
  styles,
  window,
}: {
  activityText: string | null;
  onToggleResetFormat: (window: UsageWindow) => void;
  resetFormatFor: (window: UsageWindow) => ResetFormat;
  isGlass: boolean;
  isHalloween: boolean;
  note: PrimaryNote | null;
  providerAccentInk: string;
  styles: DashboardStyles;
  window: UsageWindow;
}) {
  const utilization = Math.round(window.utilization);
  const remaining = Math.max(0, 100 - utilization);

  return (
    <View style={styles.primaryPanel}>
      {isGlass ? <GlassSurface /> : null}
      {isHalloween ? <CandleGlow /> : null}
      <View style={styles.primaryHeader}>
        <Text style={styles.primaryLabel}>{formatWindowTitle(window)}</Text>
        <View style={styles.remainingBadge}>
          <Text style={styles.remainingBadgeText}>{remaining}% kvar</Text>
        </View>
      </View>

      {activityText ? (
        <View style={styles.primaryActivityRow}>
          <PulseDot color={providerAccentInk} size={7} />
          <Text numberOfLines={1} style={styles.primaryActivityText}>{activityText}</Text>
        </View>
      ) : null}

      <View style={styles.primaryValueRow}>
        <Text maxFontSizeMultiplier={1.3} style={styles.primaryValue}>{utilization}%</Text>
        <Text style={styles.primaryValueSuffix}>använt</Text>
      </View>

      <View
        accessibilityLabel={`${formatWindowTitle(window)}, ${utilization} procent använt`}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: utilization, text: `${remaining} procent kvar` }}
        style={styles.primaryTrackHost}>
        <UsageBar fillStyle={styles.primaryFill} trackStyle={styles.primaryTrack} utilization={window.utilization} />
      </View>

      <View style={styles.primaryFooter}>
        <View style={styles.primaryResetRow}>
          <Ionicons name="time-outline" size={18} color={providerAccentInk} />
          <ResetLabel
            format={resetFormatFor(window)}
            onToggle={() => onToggleResetFormat(window)}
            clockText={formatResetClock(window)}
            remainingText={formatResetRemaining(window)}
            style={styles.primaryResetText}
          />
        </View>

        {note ? (
          <NoteBadge
            bubbleBackground={styles.noteBubble.backgroundColor as string}
            bubbleText={styles.noteBubbleText.color as string}
            color={providerAccentInk}
            label={note.label}
            labelStyle={styles.primaryResetText}
            text={note.text}
            tone={note.tone}
          />
        ) : null}
      </View>
    </View>
  );
}

function UsageLimitRow({
  onToggleResetFormat,
  palette,
  resetFormatFor,
  styles,
  window,
}: {
  onToggleResetFormat: (window: UsageWindow) => void;
  resetFormatFor: (window: UsageWindow) => ResetFormat;
  palette: Palette;
  styles: DashboardStyles;
  window: UsageWindow;
}) {
  const utilization = Math.round(window.utilization);
  const tint = getUsageTint(window.utilization, palette);
  const isNearLimit = window.utilization >= NEAR_LIMIT_THRESHOLD;

  return (
    <View style={styles.limitRow}>
      <View style={styles.limitHeader}>
        <Text numberOfLines={2} style={styles.limitTitle}>{formatWindowTitle(window)}</Text>
        <View style={styles.limitValueRow}>
          {isNearLimit ? <Ionicons name="alert-circle" size={16} color={palette.danger} /> : null}
          <Text style={[styles.limitValue, isNearLimit && { color: palette.danger }]}>{utilization}%</Text>
          <Text style={styles.limitSuffix}>använt</Text>
        </View>
      </View>
      <View
        accessibilityLabel={`${formatWindowTitle(window)}, ${utilization} procent använt${isNearLimit ? ', nära gränsen' : ''}`}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: utilization }}
        style={styles.limitTrackHost}>
        <UsageBar
          fillStyle={[styles.limitFill, { backgroundColor: tint }]}
          trackStyle={styles.limitTrack}
          utilization={window.utilization}
        />
      </View>
      <ResetLabel
        format={resetFormatFor(window)}
        onToggle={() => onToggleResetFormat(window)}
        clockText={formatResetClock(window)}
        remainingText={formatResetRemaining(window)}
        style={styles.limitResetText}
      />
    </View>
  );
}

/** `label` is the short reading in the card, `text` the full sentence behind the tap. */
type PrimaryNote = { tone: NoteTone; label: string; text: string };

/**
 * The hero card gets at most one supporting line. Stacking four of them would bury the
 * number the card exists to show, so they compete and the most pressing one wins.
 */
function buildPrimaryNote({
  burnRate,
  modelWindows,
  primaryWindow,
  secondaryWindows,
}: {
  burnRate: BurnRate | null;
  modelWindows: UsageWindow[];
  primaryWindow: UsageWindow;
  secondaryWindows: UsageWindow[];
}): PrimaryNote | null {
  const tightest = secondaryWindows.reduce<UsageWindow | null>(
    (leader, candidate) => (!leader || candidate.utilization > leader.utilization ? candidate : leader),
    null,
  );
  const leads = tightest !== null && tightest.utilization > primaryWindow.utilization;

  // 1. Another limit is nearly full. Genuinely urgent, so it outranks everything, and the
  //    hero being the five-hour window means this is the only place it can be said.
  if (leads && tightest.utilization >= NEAR_LIMIT_THRESHOLD) {
    return {
      tone: 'warning',
      label: `${formatWindowTitle(tightest)} ${Math.round(tightest.utilization)} %`,
      text: `${formatWindowTitle(tightest)} är närmare sin gräns: ${Math.round(tightest.utilization)} % använt.`,
    };
  }

  // 2. The measured rate for the window actually on display. This is the line the card is
  //    expected to carry, so it outranks the softer notes below. It only exists once the
  //    history is long and steady enough, which is why the fallbacks matter.
  if (burnRate?.exhaustsAt) {
    const reset = primaryWindow.resetsAt;
    if (reset && burnRate.exhaustsAt.getTime() < reset.getTime()) {
      return {
        tone: 'burning',
        label: `Slut ${formatClockWithDay(burnRate.exhaustsAt)}`,
        text: `I den här takten är gränsen slut ${formatClockWithDay(burnRate.exhaustsAt)}, alltså före återställningen.`,
      };
    }

    // The projection falls after the reset, so it never actually happens. The time is
    // still shown by product decision, and the day makes it unambiguous: a bare HH:MM
    // more than a day out read as a time that had already passed. The down arrow and the
    // sentence behind the tap carry the fact that the reset comes first.
    return {
      tone: 'holding',
      label: `Slut ${formatClockWithDay(burnRate.exhaustsAt)}`,
      text: `I den här takten skulle gränsen tagit slut ${formatClockWithDay(burnRate.exhaustsAt)}, men den återställs innan dess. Takten räcker alltså.`,
    };
  }

  // 3. A limit far ahead of the hero, well short of full. Worth pointing at, but not at
  //    the cost of the rate, which is why it sits below it.
  if (
    leads &&
    tightest.utilization - primaryWindow.utilization >= LEADING_GAP_POINTS &&
    tightest.utilization >= LEADING_MIN_UTILIZATION
  ) {
    return {
      tone: 'info',
      label: `${formatWindowTitle(tightest)} ${Math.round(tightest.utilization)} %`,
      text: `${formatWindowTitle(tightest)} ligger betydligt högre än femtimmarsgränsen: ${Math.round(tightest.utilization)} % använt.`,
    };
  }

  // 4. Which model has room. Pointless with a single model limit, the row below says it.
  if (modelWindows.length > 1) {
    const roomiest = modelWindows.reduce((least, candidate) =>
      candidate.utilization < least.utilization ? candidate : least,
    );
    return {
      tone: 'info',
      label: `${shortModelName(roomiest.title)} ${Math.round(roomiest.utilization)} %`,
      text: `${shortModelName(roomiest.title)} har mest utrymme kvar: ${Math.round(roomiest.utilization)} % använt.`,
    };
  }

  return null;
}

function formatClock(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

/**
 * A projection can land more than a day out, and a bare HH:MM then reads as a time that
 * has already passed today. Seen with live Codex data: a slow burn projected 26 hours
 * ahead and rendered as "18:07". The day is spelled out whenever it is not today.
 */
function formatClockWithDay(date: Date, now = new Date()): string {
  const time = formatClock(date);
  if (date.toDateString() === now.toDateString()) return `kl. ${time}`;

  const tomorrow = new Date(now.getTime() + 86_400_000);
  if (date.toDateString() === tomorrow.toDateString()) return `i morgon kl. ${time}`;

  const day = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' }).format(date);
  return `${day} kl. ${time}`;
}

/** Trims the brand prefix so "Claude Sonnet 4.5" reads as "Sonnet 4.5" in a narrow row. */
function shortModelName(title: string): string {
  return title.replace(/^Claude\s+/i, '').trim() || title;
}

function formatWindowTitle(window: UsageWindow): string {
  if (window.id === 'five-hour') return '5-timmarsgräns';
  if (window.id === 'weekly') return 'Veckogräns';
  // Without the label the row was just a bare model name, which never explained itself.
  return `Modellgräns · ${shortModelName(window.title)}`;
}

function formatMonitorTitle(window: UsageWindow): string {
  if (window.id === 'five-hour') return '5 timmar';
  if (window.id === 'weekly') return 'Vecka';
  return shortModelName(window.title);
}

function getUsageTint(utilization: number, palette: Palette): string {
  return utilization >= NEAR_LIMIT_THRESHOLD ? palette.danger : palette.accent;
}

function getProviderFromURL(url: string): UsageProvider | null {
  if (isClaudeURL(url)) return 'claude';
  if (isCodexURL(url)) return 'codex';
  return null;
}

/**
 * The clock time is the primary reading, because that is what you plan around. The date
 * is only spelled out when the reset is not today, so a same-day reset stays short.
 */
function formatResetClock(window: UsageWindow, now = new Date()): string {
  const date = window.resetsAt;
  if (!date || !Number.isFinite(date.getTime())) return 'Återställningstid saknas';

  const time = formatClock(date);
  if (date.getTime() <= now.getTime()) return 'Gränsen har återställts';
  if (date.toDateString() === now.toDateString()) return `Återställs kl. ${time}`;

  const day = new Intl.DateTimeFormat('sv-SE', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  }).format(date);
  return `Återställs ${day} kl. ${time}`;
}

/** The second reading, revealed by tapping. Null when there is nothing left to count down. */
function formatResetRemaining(window: UsageWindow, now = new Date()): string | null {
  const date = window.resetsAt;
  if (!date || !Number.isFinite(date.getTime())) return null;

  const millisecondsLeft = date.getTime() - now.getTime();
  if (millisecondsLeft <= 0) return null;
  return `${formatDuration(millisecondsLeft)} kvar`;
}

function isBackgroundId(value: unknown): value is BackgroundId {
  return value === 'custom' || BUILT_IN_BACKGROUNDS.some((background) => background.id === value);
}

function isThemePreference(value: unknown): value is ThemePreference {
  return (
    value === 'system' ||
    value === 'light' ||
    value === 'dark' ||
    value === 'halloween' ||
    value === 'glass'
  );
}

/** Names the window the reading covers, so the percentage is not left hanging without a unit of time. */
function formatSpan(spanMs: number): string {
  const minutes = Math.max(1, Math.round(spanMs / 60_000));
  return minutes === 1 ? 'senaste minuten' : `senaste ${minutes} min`;
}

/** One decimal, because the payload carries fractions and rounding to whole percent would hide them. */
function formatDelta(value: number): string {
  return new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
}

function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.max(1, Math.round(milliseconds / 60_000));
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);

  if (days >= 1) {
    const hours = totalHours % 24;
    const dayLabel = days === 1 ? '1 dag' : `${days} dagar`;
    return hours === 0 ? dayLabel : `${dayLabel} ${hours} h`;
  }

  const minutes = totalMinutes % 60;
  if (totalHours === 0) return `${minutes} min`;
  if (minutes === 0) return `${totalHours} h`;
  return `${totalHours} h ${minutes} min`;
}

function formatRelativeTime(date: Date): string {
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'nyss';
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min sedan`;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function dismissOpenBrowser(): void {
  try {
    void WebBrowser.dismissBrowser().catch(() => {});
  } catch {}
}

type LayoutMetrics = { isCompactHeight: boolean; isWide: boolean; shortSide: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function createStyles(
  palette: Palette,
  providerTheme: ProviderTheme,
  metrics: LayoutMetrics,
  isGlass: boolean,
) {
  const { isCompactHeight, isWide, shortSide } = metrics;

  // On every other theme the hero panels are a solid accent fill, so their content is
  // dark ink on that colour. On glass they become panes over the chosen background, so
  // the same content has to flip to light ink and the progress fill becomes the accent,
  // which is now the brightest thing on the panel rather than the panel itself.
  const heroPanel = isGlass ? 'transparent' : providerTheme.monitorAccent;
  const heroInk = isGlass ? palette.ink : providerTheme.monitorAccentInk;
  const heroFill = isGlass ? palette.accent : providerTheme.monitorAccentInk;
  const heroTrack = isGlass ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.42)';

  // shortSide is the landscape height. The chrome around the hero number is roughly a
  // fixed 150 points, so the number scales with what is left rather than with the whole
  // screen, which is what keeps the tallest sizes from overflowing the shortest screens.
  const monitorMetricSize = clamp(Math.round((shortSide - 150) * 0.46), 52, 104);
  const monitorMetricWithNoteSize = clamp(Math.round((shortSide - 150) * 0.39), 44, 88);
  const monitorMetricCompactSize = clamp(Math.round((shortSide - 150) * 0.32), 38, 72);
  const monitorGap = clamp(Math.round(shortSide * 0.03), 6, 13);
  const monitorShellPadding = clamp(Math.round(shortSide * 0.032), 6, 12);
  const monitorPanelPadding = clamp(Math.round(shortSide * 0.028), 6, 14);

  return StyleSheet.create({
    root: { flex: 1, backgroundColor: palette.root },
    safeArea: { flex: 1 },
    monitorRoot: { backgroundColor: isGlass ? 'transparent' : '#0E0F11' },
    // Opaque on every other theme. On glass it has to let AppBackground through, which is
    // what made landscape look like the theme had not applied at all.
    monitorSafeArea: { flex: 1, backgroundColor: isGlass ? 'transparent' : '#0E0F11' },
    monitorShell: { flex: 1, paddingHorizontal: 18, paddingVertical: monitorShellPadding, gap: monitorGap },
    // Only rendered while the controls are revealed, so when it is gone the panels get the
    // whole screen. In the flow rather than floating over them: an overlay covered the
    // weekly number, which is one of the things someone is most likely to be reading.
    monitorHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 20 },
    monitorIdentity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    monitorBrand: { color: '#FFFFFF', fontSize: 28, fontWeight: '800', letterSpacing: -0.75 },
    monitorConnection: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    monitorStatusDot: { width: 7, height: 7, borderRadius: 4 },
    monitorLiveDot: { backgroundColor: '#55B789' },
    monitorConnectionText: { color: '#B8BAC1', fontSize: 15, fontWeight: '600' },
    monitorProviderSwitcher: {
      minWidth: 174,
      minHeight: 40,
      flexDirection: 'row',
      padding: 3,
      borderRadius: 14,
      backgroundColor: '#242529',
    },
    monitorProviderOption: { flex: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
    monitorProviderIndicator: {
      position: 'absolute',
      top: 3,
      bottom: 3,
      left: 3,
      borderRadius: 11,
      backgroundColor: providerTheme.monitorAccent,
      pointerEvents: 'none',
    },
    monitorProviderOptionText: { color: '#B8BAC1', fontSize: 14, fontWeight: '700' },
    monitorProviderOptionTextActive: { color: providerTheme.monitorAccentInk }, // on the accent pill
    monitorHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 13 },
    monitorFreshness: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
    monitorUpdated: { flexShrink: 1, color: '#92949B', fontSize: 14, fontWeight: '500' },
    monitorRefreshButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: isGlass ? 'rgba(255, 255, 255, 0.1)' : '#242529', alignItems: 'center', justifyContent: 'center' },
    monitorPressed: { opacity: 0.62, transform: [{ scale: 0.97 }] },
    monitorBody: { flex: 1, minHeight: 0, flexDirection: 'row', gap: monitorGap },
    monitorPrimary: {
      flex: 1.14,
      justifyContent: 'center',
      gap: monitorGap,
      paddingHorizontal: 22,
      paddingVertical: monitorPanelPadding,
      borderRadius: 16,
      overflow: 'hidden',
      backgroundColor: heroPanel,
    },
    monitorPrimaryHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 },
    monitorPrimaryTitle: { color: heroInk, fontSize: 20, fontWeight: '800', letterSpacing: -0.2 },
    monitorRemaining: { color: heroInk, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
    monitorMetricRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
    monitorMetricWithNote: { fontSize: monitorMetricWithNoteSize, letterSpacing: -2.4 },
    monitorMetricCompact: { fontSize: monitorMetricCompactSize, letterSpacing: -1.8 },
    monitorActivityRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    monitorActivityText: { flexShrink: 1, color: heroInk, fontSize: 15, fontWeight: '700', opacity: 0.85 },
    monitorMetric: { color: heroInk, fontSize: monitorMetricSize, fontWeight: '800', letterSpacing: -3, fontVariant: ['tabular-nums'] },
    monitorMetricSuffix: { color: heroInk, fontSize: 21, fontWeight: '700', opacity: 0.85 },
    monitorPrimaryTrack: { height: 16, borderRadius: 8, overflow: 'hidden', backgroundColor: heroTrack },
    monitorPrimaryFill: { height: '100%', borderRadius: 8, backgroundColor: heroFill },
    monitorResetRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
    monitorResetText: { flex: 1, color: heroInk, fontSize: 19, fontWeight: '700', opacity: 0.85, fontVariant: ['tabular-nums'] },
    monitorSecondaryPanel: { flex: 0.9, overflow: 'hidden', borderRadius: 16, backgroundColor: isGlass ? 'transparent' : '#1B1C20', paddingHorizontal: 20 },
    monitorLimitSlot: { flex: 1 },
    monitorDivider: { height: StyleSheet.hairlineWidth, backgroundColor: '#34353A' },
    monitorLimitRow: { flex: 1, justifyContent: 'center', gap: 8, paddingVertical: 8 },
    monitorLimitRowCompact: { gap: 5, paddingVertical: 5 },
    // Title sits above the number instead of beside it. Sharing one row meant the
    // title competed with the value for a narrow panel and truncated to "V…".
    monitorLimitHeader: { gap: 2 },
    monitorLimitTitle: { color: '#FFFFFF', fontSize: 21, fontWeight: '700' },
    monitorLimitTitleSingle: { fontSize: 27 },
    monitorLimitTitleCompact: { fontSize: 17 },
    monitorLimitValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
    monitorLimitValue: { color: '#FFFFFF', fontSize: 40, fontWeight: '800', letterSpacing: -1, fontVariant: ['tabular-nums'] },
    monitorLimitValueSingle: { fontSize: 54, letterSpacing: -1.4 },
    monitorLimitValueCompact: { fontSize: 30, letterSpacing: -0.6 },
    monitorLimitSuffix: { color: '#AEB0B7', fontSize: 13, fontWeight: '500' },
    monitorLimitSuffixSingle: { fontSize: 16 },
    monitorLimitTrack: { height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: '#3A3B40' },
    monitorLimitTrackSingle: { height: 14, borderRadius: 7 },
    monitorLimitTrackCompact: { height: 8, borderRadius: 4 },
    monitorLimitFill: { height: '100%', borderRadius: 5, backgroundColor: providerTheme.monitorAccent },
    monitorDangerFill: { backgroundColor: '#FF746C' },
    monitorDangerText: { color: '#FF8A83' },
    monitorLimitReset: { color: '#C8C9CE', fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
    monitorLimitResetSingle: { fontSize: 18 },
    monitorLimitResetCompact: { fontSize: 13 },
    content: { paddingHorizontal: 20, paddingTop: isCompactHeight ? 10 : 16, gap: isCompactHeight ? 16 : 24 },
    signedOutLandscapeContent: { paddingTop: 8, gap: 14 },
    header: { minHeight: isCompactHeight ? 56 : 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { color: palette.ink, fontSize: 36, fontWeight: '700', letterSpacing: -1.1 },
    connectionRow: { marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 7 },
    connectionText: { color: palette.secondary, fontSize: 14, fontWeight: '500' },
    statusDot: { width: 7, height: 7, borderRadius: 4 },
    providerSwitcher: {
      width: '100%',
      maxWidth: isWide ? 420 : undefined,
      alignSelf: 'center',
      minHeight: 48,
      flexDirection: 'row',
      padding: 4,
      borderRadius: 15,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.line,
      backgroundColor: palette.surface,
    },
    providerOption: { flex: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    providerIndicator: {
      position: 'absolute',
      top: 4,
      bottom: 4,
      left: 4,
      borderRadius: 12,
      backgroundColor: palette.accent,
      pointerEvents: 'none',
    },
    providerOptionText: { color: palette.secondary, fontSize: 16, fontWeight: '700' },
    providerOptionTextActive: { color: palette.accentInk }, // on the accent pill
    pressed: { opacity: 0.62, transform: [{ scale: 0.98 }] },
    stack: { width: '100%', maxWidth: 620, alignSelf: 'center', gap: isCompactHeight ? 16 : 22 },
    primaryPanel: { backgroundColor: heroPanel, padding: 20, borderRadius: 16, gap: 20, overflow: 'hidden' },
    primaryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    primaryLabel: { flex: 1, color: heroInk, fontSize: 17, fontWeight: '700' },
    remainingBadge: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, backgroundColor: isGlass ? 'rgba(255, 255, 255, 0.14)' : 'rgba(255, 255, 255, 0.22)' },
    remainingBadgeText: { color: heroInk, fontSize: 13, fontWeight: '700' },
    primaryActivityRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    primaryActivityText: { flexShrink: 1, color: heroInk, fontSize: 14, fontWeight: '700', opacity: 0.85 },
    primaryValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    primaryValue: { color: heroInk, fontSize: isCompactHeight ? 46 : 56, fontWeight: '800', letterSpacing: -1.8, fontVariant: ['tabular-nums'] },
    primaryValueSuffix: { color: heroInk, fontSize: 15, fontWeight: '600', opacity: 0.85 },
    primaryTrackHost: { alignSelf: 'stretch' },
    limitTrackHost: { alignSelf: 'stretch' },
    monitorTrackHost: { alignSelf: 'stretch' },
    primaryTrack: { height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: isGlass ? heroTrack : 'rgba(9, 15, 20, 0.18)' },
    primaryFill: { height: '100%', borderRadius: 5, backgroundColor: heroFill },
    primaryFooter: { gap: 6 },
    primaryResetRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    noteBubble: { backgroundColor: palette.ink },
    // palette.root is transparent on glass, which would have made this text invisible.
    noteBubbleText: { color: isGlass ? '#14161A' : palette.root },
    primaryResetText: { flex: 1, color: heroInk, fontSize: 16, fontWeight: '600', opacity: 0.85, fontVariant: ['tabular-nums'] },
    activityCard: {
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderRadius: 16,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.line,
      backgroundColor: palette.surface,
    },
    limitsSection: { gap: 10 },
    sectionTitle: { color: palette.ink, fontSize: 20, fontWeight: '700', letterSpacing: -0.35 },
    limitsCard: {
      overflow: 'hidden',
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.line,
      backgroundColor: palette.surface,
    },
    limitRow: { paddingHorizontal: 18, paddingVertical: 17, gap: 11 },
    limitHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 },
    limitValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
    limitSuffix: { color: palette.secondary, fontSize: 12, fontWeight: '500' },
    limitTitle: { flex: 1, color: palette.ink, fontSize: 16, fontWeight: '600' },
    limitValue: { color: palette.ink, fontSize: 20, fontWeight: '700', letterSpacing: -0.35, fontVariant: ['tabular-nums'] },
    limitTrack: { height: 7, borderRadius: 4, overflow: 'hidden', backgroundColor: palette.line },
    limitFill: { height: '100%', borderRadius: 4 },
    limitResetText: { color: palette.secondary, fontSize: 14, lineHeight: 20, fontWeight: '600', fontVariant: ['tabular-nums'] },
    muted: { color: palette.secondary, fontSize: 13, lineHeight: 18 },
    divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 18, backgroundColor: palette.line },
    freshnessRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
    freshnessCopy: { flex: 1 },
    freshnessTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    freshnessTitle: { color: palette.ink, fontSize: 14, fontWeight: '600' },
    caption: { color: palette.secondary, fontSize: 12, marginTop: 4, marginLeft: 14 },
    iconButton: {
      width: 48,
      height: 48,
      borderRadius: 24,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.line,
      backgroundColor: palette.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    menuOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 20,
      backgroundColor: palette.root,
    },
    menuContent: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 40, gap: 10 },
    menuSectionTitle: {
      marginTop: 12,
      color: palette.secondary,
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    menuCard: {
      overflow: 'hidden',
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.line,
      backgroundColor: palette.surface,
    },
    menuRow: {
      minHeight: 60,
      paddingHorizontal: 16,
      paddingVertical: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    menuRowCopy: { flex: 1, gap: 3 },
    menuRowTitle: { color: palette.ink, fontSize: 16, fontWeight: '700' },
    menuRowStatus: { color: palette.secondary, fontSize: 13.5 },
    menuAction: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: 14,
      borderRadius: 11,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.line,
      backgroundColor: palette.root,
    },
    menuActionText: { color: palette.accent, fontSize: 15, fontWeight: '700' },
    menuInfoText: { flex: 1, color: palette.ink, fontSize: 14.5, lineHeight: 20 },
    menuFootnote: { paddingHorizontal: 2, color: palette.secondary, fontSize: 12.5, lineHeight: 18 },
    backgroundSwatch: {
      width: 34,
      height: 34,
      borderRadius: 9,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.line,
      // The glass palette makes `root` transparent, so a swatch would have no body of its
      // own to show the gradient stops against.
      backgroundColor: palette.root === 'transparent' ? 'rgba(255, 255, 255, 0.08)' : palette.root,
    },
    backgroundSwatchInner: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: '52%',
    },
    staleBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      minHeight: 48,
      paddingHorizontal: 14,
      paddingVertical: 11,
      borderRadius: 12,
      backgroundColor: palette.errorBackground,
    },
    staleBannerText: { flex: 1, color: palette.errorText, fontSize: 13.5, lineHeight: 19, fontWeight: '600' },
    signInPanel: {
      width: '100%',
      maxWidth: 620,
      minHeight: isCompactHeight ? 344 : 430,
      alignSelf: 'center',
      paddingHorizontal: 24,
      paddingVertical: isCompactHeight ? 22 : 30,
      borderRadius: 16,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.line,
      backgroundColor: palette.surface,
      gap: 22,
    },
    signInPanelLandscape: { minHeight: 220, flexDirection: 'row', alignItems: 'center', paddingVertical: 18, gap: 30 },
    signInIntro: { gap: 22 },
    signInIntroLandscape: { flex: 1, gap: 14 },
    signInEmoji: { fontSize: 34 },
    signInIcon: { width: 64, height: 64, borderRadius: 16, backgroundColor: palette.accentSoft, alignItems: 'center', justifyContent: 'center' },
    signInCopy: { gap: 8 },
    signInTitle: { color: palette.ink, fontSize: 28, fontWeight: '800', letterSpacing: -0.7 },
    signInText: { color: palette.secondary, fontSize: 16, lineHeight: 23, maxWidth: 470 },
    signInButton: { minHeight: 56, paddingHorizontal: 20, borderRadius: 14, backgroundColor: palette.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
    signInButtonText: { color: palette.accentInk, fontSize: 17, fontWeight: '800' },
    signInActions: { gap: 18 },
    signInActionsLandscape: { flex: 1, gap: 16 },
    checkingRow: { minHeight: 56, paddingHorizontal: 18, borderRadius: 14, backgroundColor: palette.accentSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
    checkingText: { color: palette.ink, fontSize: 15, fontWeight: '700' },
    signInAssurances: { marginTop: 'auto', paddingTop: 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line, gap: 14 },
    signInAssurancesLandscape: { marginTop: 0, paddingTop: 16, gap: 10 },
    assuranceRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
    assuranceText: { flex: 1, color: palette.secondary, fontSize: 14, lineHeight: 20 },
    errorCard: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 14, borderRadius: 12, backgroundColor: palette.errorBackground },
    errorText: { flex: 1, color: palette.errorText, fontSize: 13, lineHeight: 19 },
    loginModal: { flex: 1, backgroundColor: palette.surface },
    loginSafeArea: { flex: 1 },
    loginHeader: { minHeight: 56, paddingVertical: 8, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, backgroundColor: palette.surface },
    loginTitle: { color: palette.ink, fontSize: 17, fontWeight: '700' },
    loginAction: {
      color: palette.accent,
      fontSize: 16,
      fontWeight: '600',
      minWidth: 48,
      minHeight: 44,
      lineHeight: 44,
    },
    loginHeaderSpacer: { width: 48 },
    loginHeaderAction: { minWidth: 64, minHeight: 44, justifyContent: 'center' },
    loginActionRight: { textAlign: 'right' },
    loginHint: { minHeight: 54, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: palette.accentSoft, flexDirection: 'row', alignItems: 'center', gap: 10 },
    loginHintCompact: { minHeight: 38, paddingVertical: 5 },
    loginHintText: { flex: 1, color: palette.ink, fontSize: 13, lineHeight: 18 },
    deviceLoginScroll: { flex: 1, backgroundColor: palette.surface },
    deviceLoginPanel: {
      flexGrow: 1,
      paddingHorizontal: 28,
      paddingTop: 42,
      paddingBottom: 32,
      alignItems: 'center',
      gap: 18,
      backgroundColor: palette.surface,
    },
    deviceLoginIcon: {
      width: 72,
      height: 72,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: palette.accentSoft,
    },
    deviceLoginTitle: { color: palette.ink, fontSize: 27, fontWeight: '800', letterSpacing: -0.6, textAlign: 'center' },
    deviceLoginText: { maxWidth: 330, color: palette.secondary, fontSize: 16, lineHeight: 23, textAlign: 'center' },
    deviceSteps: { width: '100%', maxWidth: 350, gap: 12, marginVertical: 2 },
    deviceStep: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    deviceStepNumber: { width: 30, height: 30, borderRadius: 15, backgroundColor: palette.accentSoft, alignItems: 'center', justifyContent: 'center' },
    deviceStepNumberText: { color: palette.accent, fontSize: 14, fontWeight: '800' },
    deviceStepText: { flex: 1, color: palette.ink, fontSize: 14, lineHeight: 20, fontWeight: '600' },
    deviceCodeBlock: {
      width: '100%',
      maxWidth: 350,
      marginTop: 8,
      paddingHorizontal: 20,
      paddingVertical: 18,
      borderRadius: 16,
      overflow: 'hidden',
      backgroundColor: palette.hero,
      alignItems: 'center',
      gap: 8,
    },
    deviceCodeLabel: { color: palette.heroMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.7 },
    deviceCode: { color: palette.heroText, fontSize: 32, fontWeight: '800', letterSpacing: 2.2, fontFamily: 'Courier' },
    deviceLoginButton: {
      width: '100%',
      maxWidth: 350,
      minHeight: 54,
      paddingHorizontal: 20,
      borderRadius: 14,
      backgroundColor: palette.accent,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    deviceLoginButtonText: { color: palette.accentInk, fontSize: 16, fontWeight: '700' },
    deviceLoginSecondaryButton: {
      width: '100%',
      maxWidth: 350,
      minHeight: 50,
      paddingHorizontal: 20,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: palette.line,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: palette.surface,
    },
    deviceLoginSecondaryButtonText: { color: palette.ink, fontSize: 15, fontWeight: '700' },
    deviceActionStack: { width: '100%', maxWidth: 350, gap: 12 },
    deviceLoginFootnote: { maxWidth: 340, color: palette.tertiary, fontSize: 12, lineHeight: 18, textAlign: 'center' },
    deviceLoginError: { maxWidth: 340, color: palette.errorText, fontSize: 13, lineHeight: 19, textAlign: 'center' },
    deviceLoginPrivacy: { marginTop: 'auto', maxWidth: 330, color: palette.tertiary, fontSize: 12, lineHeight: 18, textAlign: 'center' },
    webViewHost: { flex: 1, overflow: 'hidden' },
    webView: { flex: 1, backgroundColor: '#FFFFFF' },
  });
}

"use client";
/**
 * Oturum: cüzdan (passkey), API yapılandırması, kredi görünümü (30 sn'de bir), bildirimler (4 sn'de bir).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Keypair } from "@stellar/stellar-sdk";
import { api, type ApiConfig, type CreditView, type Notification, type Prices } from "./api.ts";
import { Chain } from "./chain.ts";
import { clearWallet, loadWallet, registerPasskey, saveWallet, unlockWithPasskey, type StoredWallet } from "./passkey.ts";

export interface Toast {
  id: number;
  title: string;
  body?: string;
  kind?: "ok" | "warn" | "info";
}

interface Session {
  ready: boolean;
  config?: ApiConfig;
  wallet: StoredWallet | null;
  chain: Chain | null; // kilit açıkken
  vault: string | null;
  credit?: CreditView;
  prices?: Prices;
  holds: import("./api.ts").Hold[];
  notifications: Notification[];
  toasts: Toast[];
  apiOk: boolean;
  createAccount: (onStep?: (s: string) => void) => Promise<void>;
  importSecret: (secret: string, onStep?: (s: string) => void) => Promise<void>;
  unlock: () => Promise<Chain>;
  logout: () => void;
  refresh: () => Promise<void>;
  toast: (t: Omit<Toast, "id">) => void;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<ApiConfig>();
  const [apiOk, setApiOk] = useState(true);
  const [wallet, setWallet] = useState<StoredWallet | null>(null);
  const [chain, setChain] = useState<Chain | null>(null);
  const [vault, setVault] = useState<string | null>(null);
  const [credit, setCredit] = useState<CreditView>();
  const [prices, setPrices] = useState<Prices>();
  const [holds, setHolds] = useState<import("./api.ts").Hold[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lastNote = useRef(0);
  const toastId = useRef(0);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = ++toastId.current;
    setToasts((x) => [...x, { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 6000);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setConfig(await api.config());
        setApiOk(true);
      } catch {
        setApiOk(false);
      }
      const w = loadWallet();
      setWallet(w);
      setVault(w?.vaultAddress ?? null);
      setReady(true);
    })();
  }, []);

  const pub = wallet?.publicKey;

  const refresh = useCallback(async () => {
    if (!pub) return;
    try {
      const [c, p, h] = await Promise.all([api.credit(pub), api.prices(), api.holds(pub)]);
      setCredit(c);
      setPrices(p);
      setHolds(h);
      if (!vault && c.vault) setVault(c.vault);
    } catch {
      /* vault henüz yok ya da API kapalı */
      try {
        setPrices(await api.prices());
      } catch {
        /* */
      }
    }
  }, [pub, vault]);

  useEffect(() => {
    if (!pub) return;
    void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, [pub, refresh]);

  // bildirimler
  useEffect(() => {
    if (!pub) return;
    let stop = false;
    const tick = async () => {
      try {
        const ns = await api.notifications(pub, lastNote.current);
        if (stop) return;
        if (ns.length) {
          if (lastNote.current > 0) {
            for (const n of ns.slice().reverse()) toast({ title: n.title, body: n.body, kind: n.kind.includes("declined") || n.kind.includes("failed") ? "warn" : "ok" });
            void refresh();
          }
          lastNote.current = Math.max(lastNote.current, ...ns.map((n) => n.id));
          setNotifications((old) => [...ns, ...old].slice(0, 50));
        }
      } catch {
        /* */
      }
    };
    void tick();
    const t = setInterval(tick, 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [pub, toast, refresh]);

  const finishSetup = useCallback(
    async (kp: Keypair, onStep?: (s: string) => void) => {
      if (!config) throw new Error("API yapılandırması yok");
      const { vault: v } = await Chain.onboard(config, kp, onStep);
      onStep?.("Passkey kaydı");
      const w = (await registerPasskey(kp.publicKey(), kp.secret())) ?? { publicKey: kp.publicKey(), mode: "plain" as const, plainSecret: kp.secret(), createdAt: Date.now() };
      w.vaultAddress = v;
      saveWallet(w);
      setWallet(w);
      setVault(v);
      setChain(new Chain(config, kp));
    },
    [config],
  );

  const createAccount = useCallback((onStep?: (s: string) => void) => finishSetup(Keypair.random(), onStep), [finishSetup]);

  const importSecret = useCallback(
    async (secret: string, onStep?: (s: string) => void) => {
      if (!config) throw new Error("API yapılandırması yok");
      const kp = Keypair.fromSecret(secret.trim());
      onStep?.("Hesap kontrol ediliyor");
      let v: string | null = null;
      try {
        v = (await api.user(kp.publicKey())).vaultAddress;
      } catch {
        /* kayıtlı değil */
      }
      if (!v) {
        try {
          v = (await api.registerVault(kp.publicKey())).vaultAddress;
        } catch {
          /* vault yok → tam onboarding */
        }
      }
      if (!v) return finishSetup(kp, onStep);
      const w: StoredWallet = { publicKey: kp.publicKey(), mode: "plain", plainSecret: secret.trim(), vaultAddress: v, createdAt: Date.now() };
      saveWallet(w);
      setWallet(w);
      setVault(v);
      setChain(new Chain(config, kp));
      try {
        await new Chain(config, kp).anchorLogin();
      } catch {
        /* anchor erişilemez */
      }
    },
    [config, finishSetup],
  );

  const unlock = useCallback(async () => {
    if (!wallet || !config) throw new Error("cüzdan yok");
    const secret = await unlockWithPasskey(wallet);
    const c = new Chain(config, Keypair.fromSecret(secret));
    setChain(c);
    return c;
  }, [wallet, config]);

  const logout = useCallback(() => {
    clearWallet();
    setWallet(null);
    setChain(null);
    setVault(null);
    setCredit(undefined);
  }, []);

  const value = useMemo<Session>(
    () => ({ ready, config, wallet, chain, vault, credit, prices, holds, notifications, toasts, apiOk, createAccount, importSecret, unlock, logout, refresh, toast }),
    [ready, config, wallet, chain, vault, credit, prices, holds, notifications, toasts, apiOk, createAccount, importSecret, unlock, logout, refresh, toast],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("SessionProvider yok");
  return s;
}

/** Kilit açık bir chain gerektiren işlemler için */
export function useChain(): { chain: Chain | null; ensure: () => Promise<Chain> } {
  const s = useSession();
  const ensure = useCallback(async () => s.chain ?? s.unlock(), [s]);
  return { chain: s.chain, ensure };
}

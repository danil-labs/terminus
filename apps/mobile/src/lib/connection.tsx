import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import {
  type BridgeEvent,
  type Notice,
  type Pairing,
  type TaskRow,
  type WorkspaceAttention,
  call,
  events,
  loadPairing,
  savePairing,
} from "./bridge";
import { t } from "./i18n";
import { Notifications } from "./notifications";

type Listener = (event: BridgeEvent) => void;

type Connection = {
  ready: boolean;
  pairing: Pairing | null;
  online: boolean;
  attention: WorkspaceAttention[];
  /** What happened while the app was open, newest first. */
  activity: { notice: Notice; at: number }[];
  titleOf: (session: string) => string | undefined;
  /** The task on screen; its notices are not shown. */
  setOpenTask: (session: string | null) => void;
  /** Titles the task list already knows, for notification text. */
  rememberTasks: (rows: TaskRow[]) => void;
  pair: (pairing: Pairing | null) => Promise<void>;
  subscribe: (listener: Listener) => () => void;
};

const Context = createContext<Connection | null>(null);

export function useConnection() {
  const value = useContext(Context);
  if (!value) throw new Error("useConnection outside ConnectionProvider");
  return value;
}

const CHANNEL = "tasks";

async function announce(notice: Notice, title: string | undefined) {
  const name = title?.trim() || t("notify.untitled");
  if (!Notifications) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: t(`notify.${notice.state === "unseen" ? "finished" : notice.state}` as const, { title: name }),
      body: "",
      data: { workspace: notice.workspace, folder: notice.project, task: notice.session },
    },
    trigger: Platform.OS === "android" ? { channelId: CHANNEL } : null,
  });
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [online, setOnline] = useState(false);
  const [attention, setAttention] = useState<WorkspaceAttention[]>([]);
  const [activity, setActivity] = useState<{ notice: Notice; at: number }[]>([]);
  const listeners = useRef(new Set<Listener>());
  const openTask = useRef<string | null>(null);
  const titles = useRef(new Map<string, string>());

  useEffect(() => {
    void loadPairing().then((saved) => {
      setPairing(saved);
      setReady(true);
    });
    if (Platform.OS === "android" && Notifications) {
      void Notifications.setNotificationChannelAsync(CHANNEL, {
        name: t("notify.channel"),
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
  }, []);

  useEffect(() => {
    if (!pairing) return;
    let stopped = false;
    const run = async () => {
      let after = -1;
      while (!stopped) {
        try {
          if (after < 0) {
            setAttention(await call<WorkspaceAttention[]>(pairing, "list_workspace_attention"));
            after = (await events(pairing, -1)).after;
            setOnline(true);
          }
          const page = await events(pairing, after);
          after = page.after;
          setOnline(true);
          for (const event of page.events) {
            if (event.name === "resync") after = -1;
            if (event.name === "attention") setAttention(event.payload as WorkspaceAttention[]);
            if (event.name === "notice") {
              const notice = event.payload as Notice;
              setActivity((old) => [{ notice, at: Date.now() }, ...old].slice(0, 100));
              if (notice.session !== openTask.current) void announce(notice, titles.current.get(notice.session));
            }
            for (const listener of listeners.current) listener(event);
          }
        } catch {
          setOnline(false);
          after = -1;
          await new Promise((r) => setTimeout(r, 3_000));
        }
      }
    };
    void run();
    return () => {
      stopped = true;
    };
  }, [pairing]);

  const pair = useCallback(async (next: Pairing | null) => {
    await savePairing(next);
    setOnline(false);
    setPairing(next);
  }, []);

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => void listeners.current.delete(listener);
  }, []);

  const setOpenTask = useCallback((session: string | null) => {
    openTask.current = session;
  }, []);

  const rememberTasks = useCallback((rows: TaskRow[]) => {
    for (const row of rows) titles.current.set(row.id, row.title);
  }, []);

  const titleOf = useCallback((session: string) => titles.current.get(session), []);

  const value: Connection = { ready, pairing, online, attention, activity, titleOf, setOpenTask, rememberTasks, pair, subscribe };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

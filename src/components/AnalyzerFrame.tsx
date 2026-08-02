"use client";

import { useEffect, useRef, useState } from "react";
import { signInAnonymously } from "firebase/auth";
import { get, ref, set } from "firebase/database";
import { getFirebaseAuth, getRealtimeDatabase } from "@/lib/firebase";

const savedSessionKey = "3d-motion-lab-session-v1";

type SavedSession = {
  code?: string;
  role?: "teacher" | "camera";
};

type SaveMessage = {
  type: "MOTION_LAB_SAVE_ANALYSIS";
  payload: Record<string, unknown> & { sessionId?: string; type?: string };
};

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
}

export default function AnalyzerFrame() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [roomCode, setRoomCode] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const requestedRoom = new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? "";
        const saved = window.localStorage.getItem(savedSessionKey);
        const session = saved ? JSON.parse(saved) as SavedSession : null;
        setRoomCode(requestedRoom || session?.code?.toUpperCase() || "");
      } catch {
        setRoomCode("");
      } finally {
        setReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    async function saveAnalysis(event: MessageEvent<SaveMessage>) {
      if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;
      if (!event.data || event.data.type !== "MOTION_LAB_SAVE_ANALYSIS") return;

      const respond = (result: { ok: boolean; id?: string; message?: string }) => {
        iframeRef.current?.contentWindow?.postMessage({ type: "MOTION_LAB_SAVE_RESULT", ...result }, window.location.origin);
      };

      if (!roomCode) {
        respond({ ok: false, message: "연결된 촬영 방이 없습니다. CSV로 내려받거나 촬영실에서 방을 먼저 열어 주세요." });
        return;
      }

      const auth = getFirebaseAuth();
      const database = getRealtimeDatabase();
      if (!auth || !database) {
        respond({ ok: false, message: "Firebase 연결 설정을 확인해 주세요." });
        return;
      }

      try {
        if (!auth.currentUser) await signInAnonymously(auth);
        const roomSnapshot = await get(ref(database, `rooms/${roomCode}`));
        if (!roomSnapshot.exists()) throw new Error("촬영 방이 이미 삭제되었거나 존재하지 않습니다.");
        const fallbackId = `analysis_${Date.now().toString(36)}`;
        const analysisId = safeId(event.data.payload.sessionId || fallbackId);
        await set(ref(database, `rooms/${roomCode}/analyses/${analysisId}`), {
          ...event.data.payload,
          savedAt: Date.now(),
          savedBy: auth.currentUser?.uid ?? "anonymous",
        });
        respond({ ok: true, id: analysisId });
      } catch (error) {
        respond({ ok: false, message: error instanceof Error ? error.message : "Firebase 저장에 실패했습니다." });
      }
    }

    window.addEventListener("message", saveAnalysis);
    return () => window.removeEventListener("message", saveAnalysis);
  }, [roomCode]);

  if (!ready) return <main className="analyzer-loading">분석 작업대를 준비하는 중입니다.</main>;

  const source = `/analyzer/index.html${roomCode ? `?room=${encodeURIComponent(roomCode)}` : ""}`;
  return <iframe ref={iframeRef} className="analyzer-frame" src={source} title="3D Motion Lab 분석 작업대" allow="fullscreen" />;
}

"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { signInAnonymously } from "firebase/auth";
import {
  get,
  onValue,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  update,
} from "firebase/database";
import { CameraRecorder, CaptureSettings } from "@/components/CameraRecorder";
import {
  getFirebaseAuth,
  getRealtimeDatabase,
  isFirebaseConfigured,
} from "@/lib/firebase";

type Mode = "teacher" | "camera";
type TeacherAction = "create" | "resume";
type CameraSlot = "A" | "B";
type Session = { code: string; role: Mode; slot?: CameraSlot };
type CameraState = { uid: string; ready: boolean; online?: boolean; joinedAt: number | object; lastSeen?: number | object };
type RoomState = {
  name: string;
  ownerUid: string;
  passwordHash: string;
  status: "waiting" | "countdown" | "recording";
  createdAt: number | object;
  cameras?: Partial<Record<CameraSlot, CameraState>>;
  recording?: { startAt: number; requestedAt: number | object; sequence: number };
  captureSettings?: CaptureSettings;
};

const steps = [
  { number: "01", title: "촬영 방 만들기", text: "선생님이 수업용 방과 비밀번호를 만든다." },
  { number: "02", title: "스마트폰 2대 연결", text: "두 휴대폰이 같은 방에 들어와 촬영 준비를 마친다." },
  { number: "03", title: "한 번에 촬영", text: "시작 버튼 하나로 두 카메라에 같은 시작 시각을 보낸다." },
  { number: "04", title: "자동 동기화·분석", text: "플래시 신호를 맞추고 3차원 운동을 계산한다." },
];

const roomAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const savedSessionKey = "3d-motion-lab-session-v1";
const defaultCaptureSettings: CaptureSettings = { fps: 30, shutterDenominator: 200, durationSeconds: 5 };

function normalizeNumberInput(value: string, fallback: number, min: number, max: number) {
  if (!value.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function makeRoomCode() {
  const values = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(values, (value) => roomAlphabet[value % roomAlphabet.length]).join("");
}

function normalizeRoomCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

async function hashPassword(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function getSignedInUid() {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase 연결 정보가 없습니다.");
  if (auth.currentUser) return auth.currentUser.uid;
  return (await signInAnonymously(auth)).user.uid;
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("teacher");
  const [teacherAction, setTeacherAction] = useState<TeacherAction>("create");
  const [roomName, setRoomName] = useState("");
  const [roomPassword, setRoomPassword] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [roomLoading, setRoomLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(0);
  const [serverOffset, setServerOffset] = useState(0);
  const [desiredFps, setDesiredFps] = useState(String(defaultCaptureSettings.fps));
  const [shutterDenominator, setShutterDenominator] = useState(String(defaultCaptureSettings.shutterDenominator));
  const [durationSeconds, setDurationSeconds] = useState(String(defaultCaptureSettings.durationSeconds));
  const [cameraActive, setCameraActive] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const captureSettingsSyncRef = useRef("");

  const canContinue = useMemo(() => {
    const needsCode = mode === "camera" || teacherAction === "resume";
    const validName = needsCode ? normalizeRoomCode(roomName).length === 6 : roomName.trim().length >= 2;
    return validName && roomPassword.trim().length >= 4 && !pending;
  }, [mode, pending, roomName, roomPassword, teacherAction]);

  const connectedCount = Number(Boolean(room?.cameras?.A && room.cameras.A.online !== false)) + Number(Boolean(room?.cameras?.B && room.cameras.B.online !== false));
  const readyCount = Number(Boolean(room?.cameras?.A?.ready)) + Number(Boolean(room?.cameras?.B?.ready));
  const startAt = room?.recording?.startAt ?? 0;
  const countdown = startAt ? Math.max(0, Math.ceil((startAt - (now + serverOffset)) / 1000)) : 0;
  const captureSettings = room?.captureSettings ?? defaultCaptureSettings;

  function activateSession(nextSession: Session) {
    window.localStorage.setItem(savedSessionKey, JSON.stringify(nextSession));
    setRoomLoading(true);
    setSession(nextSession);
    setMode(nextSession.role);
  }

  useEffect(() => {
    const restore = async () => {
      const saved = window.localStorage.getItem(savedSessionKey);
      if (!saved) return;
      try {
        const parsed = JSON.parse(saved) as Session;
        if (!parsed.code || !["teacher", "camera"].includes(parsed.role)) throw new Error("invalid session");
        await getSignedInUid();
        setRoomLoading(true);
        setMode(parsed.role);
        setSession(parsed);
      } catch {
        window.localStorage.removeItem(savedSessionKey);
      }
    };
    void restore();
  }, []);

  useEffect(() => {
    const database = getRealtimeDatabase();
    if (!database) return;
    return onValue(ref(database, ".info/serverTimeOffset"), (snapshot) => {
      setServerOffset(Number(snapshot.val()) || 0);
    });
  }, []);

  useEffect(() => {
    if (!session) return;
    const database = getRealtimeDatabase();
    if (!database) return;
    return onValue(ref(database, `rooms/${session.code}`), (snapshot) => {
      const nextRoom = snapshot.exists() ? (snapshot.val() as RoomState) : null;
      setRoom(nextRoom);
      setRoomLoading(false);
      if (nextRoom?.captureSettings) {
        const settingsKey = `${session.code}:${nextRoom.captureSettings.fps}:${nextRoom.captureSettings.shutterDenominator}:${nextRoom.captureSettings.durationSeconds}`;
        if (captureSettingsSyncRef.current !== settingsKey) {
          captureSettingsSyncRef.current = settingsKey;
          setDesiredFps(String(nextRoom.captureSettings.fps));
          setShutterDenominator(String(nextRoom.captureSettings.shutterDenominator));
          setDurationSeconds(String(nextRoom.captureSettings.durationSeconds));
        }
      }
      if (!nextRoom) window.localStorage.removeItem(savedSessionKey);
    });
  }, [session]);

  useEffect(() => {
    if (!startAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [startAt]);

  async function createRoom(uid: string, passwordHash: string) {
    const database = getRealtimeDatabase();
    if (!database) throw new Error("Firebase 데이터베이스에 연결할 수 없습니다.");
    const initialSettings: CaptureSettings = {
      fps: normalizeNumberInput(desiredFps, defaultCaptureSettings.fps, 1, 240),
      shutterDenominator: normalizeNumberInput(shutterDenominator, defaultCaptureSettings.shutterDenominator, 1, 10000),
      durationSeconds: normalizeNumberInput(durationSeconds, defaultCaptureSettings.durationSeconds, 1, 120),
    };

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = makeRoomCode();
      const result = await runTransaction(ref(database, `rooms/${code}`), (current) => {
        if (current) return;
        return {
          name: roomName.trim(),
          ownerUid: uid,
          passwordHash,
          status: "waiting",
          createdAt: serverTimestamp(),
          cameras: {},
          captureSettings: initialSettings,
        } satisfies RoomState;
      });
      if (result.committed) {
        activateSession({ code, role: "teacher" });
        setMessage("");
        return;
      }
    }
    throw new Error("방 코드를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }

  async function joinRoom(uid: string, passwordHash: string) {
    const database = getRealtimeDatabase();
    if (!database) throw new Error("Firebase 데이터베이스에 연결할 수 없습니다.");
    const code = normalizeRoomCode(roomName);
    const roomReference = ref(database, `rooms/${code}`);
    const snapshot = await get(roomReference);
    if (!snapshot.exists()) throw new Error("해당 촬영 방을 찾지 못했습니다.");
    if ((snapshot.val() as RoomState).passwordHash !== passwordHash) throw new Error("비밀번호가 맞지 않습니다.");

    const camerasReference = ref(database, `rooms/${code}/cameras`);
    const result = await runTransaction(camerasReference, (current: RoomState["cameras"] | null) => {
      const cameras = current ?? {};
      let slot: CameraSlot | undefined;
      if (cameras.A?.uid === uid) slot = "A";
      else if (cameras.B?.uid === uid) slot = "B";
      else if (!cameras.A) slot = "A";
      else if (!cameras.B) slot = "B";
      if (!slot) return;
      return {
        ...cameras,
        [slot]: {
          ...(cameras[slot] ?? { uid, ready: false, joinedAt: serverTimestamp() }),
          uid,
          online: true,
          lastSeen: serverTimestamp(),
        },
      };
    });

    if (!result.committed) throw new Error("이미 스마트폰 두 대가 연결되어 있습니다.");
    const cameras = (result.snapshot.val() as RoomState["cameras"]) ?? {};
    const slot = cameras.A?.uid === uid ? "A" : cameras.B?.uid === uid ? "B" : undefined;
    if (!slot) throw new Error("카메라 번호를 배정하지 못했습니다.");
    activateSession({ code, role: "camera", slot });
    setMessage("");
  }

  async function resumeTeacherRoom(uid: string, passwordHash: string) {
    const database = getRealtimeDatabase();
    if (!database) throw new Error("Firebase 데이터베이스에 연결할 수 없습니다.");
    const code = normalizeRoomCode(roomName);
    const roomReference = ref(database, `rooms/${code}`);
    const snapshot = await get(roomReference);
    if (!snapshot.exists()) throw new Error("해당 촬영 방을 찾지 못했습니다.");
    if ((snapshot.val() as RoomState).passwordHash !== passwordHash) throw new Error("비밀번호가 맞지 않습니다.");
    await update(roomReference, { ownerUid: uid });
    activateSession({ code, role: "teacher" });
    setMessage("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canContinue) return;
    setPending(true);
    setMessage("");
    try {
      const [uid, passwordHash] = await Promise.all([
        getSignedInUid(),
        hashPassword(roomPassword.trim()),
      ]);
      if (mode === "teacher" && teacherAction === "create") await createRoom(uid, passwordHash);
      else if (mode === "teacher") await resumeTeacherRoom(uid, passwordHash);
      else await joinRoom(uid, passwordHash);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "연결 중 문제가 생겼습니다.");
    } finally {
      setPending(false);
    }
  }

  async function toggleReady() {
    if (!session?.slot || !room) return;
    if (!cameraActive && !room.cameras?.[session.slot]?.ready) {
      setMessage("먼저 카메라를 열어 주세요.");
      return;
    }
    const database = getRealtimeDatabase();
    if (!database) return;
    const nextReady = !room.cameras?.[session.slot]?.ready;
    await update(ref(database, `rooms/${session.code}/cameras/${session.slot}`), {
      ready: nextReady,
      online: true,
      lastSeen: serverTimestamp(),
    });
    setMessage("");
  }

  async function saveCaptureSettings() {
    if (!session || session.role !== "teacher") return;
    const database = getRealtimeDatabase();
    if (!database) return;
    const settings: CaptureSettings = {
      fps: normalizeNumberInput(desiredFps, captureSettings.fps, 1, 240),
      shutterDenominator: normalizeNumberInput(shutterDenominator, captureSettings.shutterDenominator, 1, 10000),
      durationSeconds: normalizeNumberInput(durationSeconds, captureSettings.durationSeconds, 1, 120),
    };
    await set(ref(database, `rooms/${session.code}/captureSettings`), settings);
    setDesiredFps(String(settings.fps));
    setShutterDenominator(String(settings.shutterDenominator));
    setDurationSeconds(String(settings.durationSeconds));
    setMessage("촬영 설정을 두 스마트폰에 보냈습니다.");
  }

  async function startRecording() {
    if (!session || readyCount < 2) return;
    const database = getRealtimeDatabase();
    if (!database) return;
    const nextSequence = (room?.recording?.sequence ?? 0) + 1;
    await update(ref(database, `rooms/${session.code}`), {
      status: "countdown",
      recording: {
        startAt: Date.now() + serverOffset + 5000,
        requestedAt: serverTimestamp(),
        sequence: nextSequence,
      },
    });
  }

  async function resetRecording() {
    if (!session) return;
    const database = getRealtimeDatabase();
    if (!database) return;
    await update(ref(database, `rooms/${session.code}`), {
      status: "waiting",
      recording: {
        startAt: 0,
        requestedAt: serverTimestamp(),
        sequence: room?.recording?.sequence ?? 0,
      },
      "cameras/A/ready": false,
      "cameras/B/ready": false,
    });
  }

  async function leaveRoom() {
    if (session?.role === "camera" && session.slot) {
      const database = getRealtimeDatabase();
      if (database) {
        await update(ref(database, `rooms/${session.code}/cameras/${session.slot}`), {
          ready: false,
          online: false,
          lastSeen: serverTimestamp(),
        });
      }
    }
    window.localStorage.removeItem(savedSessionKey);
    setSession(null);
    setRoom(null);
    setRoomName("");
    setRoomPassword("");
    setMessage("");
    setCameraActive(false);
    setDeleteConfirm(false);
  }

  async function deleteRoom() {
    if (!session || session.role !== "teacher") return;
    const database = getRealtimeDatabase();
    if (!database) return;
    await remove(ref(database, `rooms/${session.code}`));
    window.localStorage.removeItem(savedSessionKey);
    setSession(null);
    setRoom(null);
    setRoomName("");
    setRoomPassword("");
    setMessage("촬영 방을 삭제했습니다.");
    setDeleteConfirm(false);
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="3D Motion Lab 홈">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>3D Motion Lab</span>
        </a>
        <span className="prototype-pill"><b /> Firebase 연결됨</span>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">TWO CAMERAS · ONE MOTION</p>
          <h1>두 대의 스마트폰으로<br /><em>움직임을 3차원으로.</em></h1>
          <p className="hero-description">촬영 준비부터 동기화, 좌표 보정, 운동 분석까지.<br />수업 시간에 한 화면에서 끝내는 과학 실험 도구이다.</p>
          <a className="primary-link" href="#start">첫 실험 준비하기 <span>→</span></a>
        </div>

        <div className="orbit-card" aria-label="두 카메라 3차원 촬영 개념 그림">
          <div className="grid-floor" />
          <div className="axis axis-x"><span>X</span></div>
          <div className="axis axis-y"><span>Y</span></div>
          <div className="axis axis-z"><span>Z</span></div>
          <div className="camera camera-a"><span>CAM A</span></div>
          <div className="camera camera-b"><span>CAM B</span></div>
          <div className="ray ray-a" /><div className="ray ray-b" />
          <div className="object-dot"><span>3D</span></div>
          <div className="orbit-caption"><span>실시간 연결</span><strong>두 시선이 만나는 한 점</strong></div>
        </div>
      </section>

      <section className="workflow" aria-labelledby="workflow-title">
        <p className="section-label">HOW IT WORKS</p>
        <h2 id="workflow-title">복잡한 과정은 안쪽으로 숨겼다.</h2>
        <div className="step-grid">
          {steps.map((step) => <article className="step-card" key={step.number}><span>{step.number}</span><h3>{step.title}</h3><p>{step.text}</p></article>)}
        </div>
      </section>

      <section className="start-panel" id="start" aria-labelledby="start-title">
        <div className="start-heading">
          <p className="section-label">START HERE</p>
          <h2 id="start-title">{session ? room?.name ?? "촬영 방 연결 중" : "어떤 기기로 들어왔나요?"}</h2>
          <p>{session ? "Firebase가 두 스마트폰의 접속과 준비 상태를 실시간으로 맞춘다." : "선생님은 방을 만들고, 두 스마트폰은 받은 코드로 같은 방에 들어간다."}</p>
        </div>

        {!session ? (
          <>
            <div className="mode-switch" role="tablist" aria-label="사용 기기 선택">
              <button className={mode === "teacher" ? "active" : ""} onClick={() => { setMode("teacher"); setRoomName(""); setMessage(""); }} role="tab" aria-selected={mode === "teacher"}>
                <span className="mode-icon">▰</span>선생님 화면
              </button>
              <button className={mode === "camera" ? "active" : ""} onClick={() => { setMode("camera"); setRoomName(""); setMessage(""); }} role="tab" aria-selected={mode === "camera"}>
                <span className="mode-icon">▯</span>스마트폰 카메라
              </button>
            </div>

            {mode === "teacher" && (
              <div className="teacher-action-switch" aria-label="선생님 방 작업 선택">
                <button className={teacherAction === "create" ? "active" : ""} type="button" onClick={() => { setTeacherAction("create"); setRoomName(""); setMessage(""); }}>새 방 만들기</button>
                <button className={teacherAction === "resume" ? "active" : ""} type="button" onClick={() => { setTeacherAction("resume"); setRoomName(""); setMessage(""); }}>기존 방 다시 관리</button>
              </div>
            )}

            <div className="entry-card">
              <div className="entry-copy">
                <span className="entry-tag">{mode === "teacher" ? "CONTROL DESK" : "CAMERA UNIT"}</span>
                <h3>{mode === "teacher" ? teacherAction === "create" ? "새 촬영 방을 준비한다" : "기존 방 관리 화면으로 돌아간다" : "촬영 방에 참여한다"}</h3>
                <p>{mode === "teacher" ? teacherAction === "create" ? "방을 만들면 6자리 참여 코드가 나온다. 새로고침해도 이 기기에서 자동으로 다시 열린다." : "기존 방의 6자리 코드와 비밀번호를 입력하면 다른 기기에서도 선생님 화면으로 돌아갈 수 있다." : "선생님 화면에 표시된 6자리 코드와 비밀번호를 입력하면 카메라 A 또는 B로 자동 배정된다."}</p>
              </div>
              <form className="entry-form" onSubmit={handleSubmit}>
                <label>
                  {mode === "teacher" && teacherAction === "create" ? "촬영 방 이름" : "6자리 촬영 방 코드"}
                  <input value={roomName} onChange={(event) => setRoomName(mode === "camera" || teacherAction === "resume" ? normalizeRoomCode(event.target.value) : event.target.value)} placeholder={mode === "teacher" && teacherAction === "create" ? "예: 2학년 자유낙하" : "예: A7K9Q2"} autoComplete="off" />
                </label>
                <label>
                  비밀번호
                  <input value={roomPassword} onChange={(event) => setRoomPassword(event.target.value)} placeholder="숫자 또는 글자 4자리 이상" type="password" autoComplete="new-password" />
                </label>
                <button className="continue-button" disabled={!canContinue}>{pending ? "연결 중…" : mode === "teacher" ? teacherAction === "create" ? "촬영 방 만들기" : "방 관리 화면 열기" : "촬영 방 들어가기"}<span>→</span></button>
                <small className={message ? "form-message error" : "form-message"}>{message || (isFirebaseConfigured ? "실시간 연결 준비 완료" : "Firebase 설정이 필요합니다.")}</small>
              </form>
            </div>
          </>
        ) : roomLoading ? (
          <div className="room-dashboard empty-room"><h3>촬영 방을 다시 불러오는 중입니다.</h3></div>
        ) : !room ? (
          <div className="room-dashboard empty-room">
            <h3>이 촬영 방은 존재하지 않습니다.</h3>
            <p>이미 삭제되었거나 잘못된 방이다. 처음 화면으로 돌아가 새 방을 만들 수 있다.</p>
            <button className="ghost-button" onClick={() => void leaveRoom()}>처음 화면으로 돌아가기</button>
          </div>
        ) : (
          <div className="room-dashboard">
            <div className="room-topline">
              <div><span className="entry-tag">ROOM CODE</span><strong className="room-code">{session.code}</strong></div>
              <div className="room-actions">
                <button className="ghost-button" onClick={() => void leaveRoom()}>{session.role === "teacher" ? "관리 화면 나가기" : "방 나가기"}</button>
                {session.role === "teacher" && !deleteConfirm && <button className="danger-button" onClick={() => setDeleteConfirm(true)}>방 종료·삭제</button>}
              </div>
            </div>

            {session.role === "teacher" && deleteConfirm && (
              <div className="delete-confirm">
                <div><strong>이 방을 정말 삭제할까요?</strong><span>연결된 핸드폰도 즉시 방에서 나가며 되돌릴 수 없습니다.</span></div>
                <button className="ghost-button" onClick={() => setDeleteConfirm(false)}>취소</button>
                <button className="danger-button solid" onClick={() => void deleteRoom()}>영구 삭제</button>
              </div>
            )}

            {session.role === "teacher" ? (
              <>
                <section className="capture-settings" aria-label="촬영 설정">
                  <div className="settings-heading"><div><span className="entry-tag">CAPTURE SETTINGS</span><h3>두 스마트폰 촬영 설정</h3></div><p>기기가 지원하는 범위에서 요청값을 적용하고, 실제 적용값은 각 핸드폰에 표시된다.</p></div>
                  <div className="settings-grid">
                    <label>초당 프레임(FPS)<input type="number" min="1" max="240" value={desiredFps} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setDesiredFps(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); void saveCaptureSettings(); } }} /></label>
                    <label>셔터 속도(1/N초)<input type="number" min="1" max="10000" value={shutterDenominator} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setShutterDenominator(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); void saveCaptureSettings(); } }} /></label>
                    <label>촬영 시간(초)<input type="number" min="1" max="120" value={durationSeconds} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setDurationSeconds(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); void saveCaptureSettings(); } }} /></label>
                    <button className="continue-button" onClick={() => void saveCaptureSettings()}>두 핸드폰에 적용 <span>→</span></button>
                  </div>
                  {message && <p className="settings-message">{message}</p>}
                </section>
                <div className="camera-grid">
                  {(["A", "B"] as CameraSlot[]).map((slot) => {
                    const camera = room?.cameras?.[slot];
                    return <article className={`camera-status ${camera?.ready ? "ready" : ""}`} key={slot}><span>CAMERA {slot}</span><strong>{!camera ? "접속 대기" : camera.ready ? "촬영 준비 완료" : "접속됨 · 준비 대기"}</strong><i /></article>;
                  })}
                </div>
                <div className="sync-panel">
                  <div><span>연결 {connectedCount}/2</span><strong>{startAt ? (countdown ? `${countdown}초 뒤 시작` : "촬영 시작") : `준비 ${readyCount}/2`}</strong></div>
                  <button className="continue-button sync-button" disabled={readyCount < 2 || Boolean(startAt)} onClick={startRecording}>5초 뒤 함께 시작 <span>→</span></button>
                  {startAt && <button className="ghost-button" onClick={resetRecording}>다시 준비하기</button>}
                </div>
                <section className="analysis-bridge">
                  <div><span className="entry-tag">3D ANALYSIS</span><h3>촬영 후 3차원 분석</h3><p>새 분석 서버가 완성되기 전까지는 기존 좌표 보정·추적 웹앱을 함께 사용할 수 있다.</p></div>
                  <a href="https://script.google.com/macros/s/AKfycbyne-aoxnT1dD_t6WNywKbRHlXvV1ahOnpAwH4ngnUmS4BJPVg_oYh6dlq9Ehdr2AX9/exec" target="_blank" rel="noreferrer">기존 3차원 분석 열기</a>
                </section>
              </>
            ) : (
              <div className="phone-panel">
                <span className="camera-badge">CAMERA {session.slot}</span>
                <h3>{startAt ? (countdown ? `${countdown}` : "지금 촬영 시작") : room?.cameras?.[session.slot!]?.ready ? "촬영 시작 신호를 기다리는 중" : "카메라를 고정하고 준비해 주세요"}</h3>
                <p>선생님이 정한 {captureSettings.fps}fps · 1/{captureSettings.shutterDenominator}초 · {captureSettings.durationSeconds}초 설정을 이 기기에 요청한다.</p>
                <CameraRecorder
                  roomCode={session.code}
                  slot={session.slot!}
                  settings={captureSettings}
                  startAt={startAt}
                  sequence={room.recording?.sequence ?? 0}
                  serverOffset={serverOffset}
                  onCameraActiveChange={setCameraActive}
                />
                <button className={`ready-button ${room?.cameras?.[session.slot!]?.ready ? "active" : ""}`} onClick={() => void toggleReady()} disabled={Boolean(startAt) || !cameraActive}>{room?.cameras?.[session.slot!]?.ready ? "준비 완료 ✓" : cameraActive ? "촬영 준비 완료 누르기" : "먼저 카메라를 열어 주세요"}</button>
                {message && <p className="camera-message error">{message}</p>}
              </div>
            )}
          </div>
        )}
      </section>

      <footer><strong>3D Motion Lab</strong><span>교실에서 시작하는 입체 운동 분석</span></footer>
    </main>
  );
}

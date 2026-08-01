"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { signInAnonymously } from "firebase/auth";
import {
  get,
  onValue,
  ref,
  runTransaction,
  serverTimestamp,
  set,
  update,
} from "firebase/database";
import {
  getFirebaseAuth,
  getRealtimeDatabase,
  isFirebaseConfigured,
} from "@/lib/firebase";

type Mode = "teacher" | "camera";
type CameraSlot = "A" | "B";
type Session = { code: string; role: Mode; slot?: CameraSlot };
type CameraState = { uid: string; ready: boolean; joinedAt: number | object };
type RoomState = {
  name: string;
  ownerUid: string;
  passwordHash: string;
  status: "waiting" | "countdown" | "recording";
  createdAt: number | object;
  cameras?: Partial<Record<CameraSlot, CameraState>>;
  recording?: { startAt: number; requestedAt: number | object; sequence: number };
};

const steps = [
  { number: "01", title: "촬영 방 만들기", text: "선생님이 수업용 방과 비밀번호를 만든다." },
  { number: "02", title: "스마트폰 2대 연결", text: "두 휴대폰이 같은 방에 들어와 촬영 준비를 마친다." },
  { number: "03", title: "한 번에 촬영", text: "시작 버튼 하나로 두 카메라에 같은 시작 시각을 보낸다." },
  { number: "04", title: "자동 동기화·분석", text: "플래시 신호를 맞추고 3차원 운동을 계산한다." },
];

const roomAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

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
  const [roomName, setRoomName] = useState("");
  const [roomPassword, setRoomPassword] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(0);
  const [serverOffset, setServerOffset] = useState(0);

  const canContinue = useMemo(() => {
    const validName = mode === "teacher" ? roomName.trim().length >= 2 : normalizeRoomCode(roomName).length === 6;
    return validName && roomPassword.trim().length >= 4 && !pending;
  }, [mode, pending, roomName, roomPassword]);

  const connectedCount = Number(Boolean(room?.cameras?.A)) + Number(Boolean(room?.cameras?.B));
  const readyCount = Number(Boolean(room?.cameras?.A?.ready)) + Number(Boolean(room?.cameras?.B?.ready));
  const startAt = room?.recording?.startAt ?? 0;
  const countdown = startAt ? Math.max(0, Math.ceil((startAt - (now + serverOffset)) / 1000)) : 0;

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
      setRoom(snapshot.exists() ? (snapshot.val() as RoomState) : null);
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
        } satisfies RoomState;
      });
      if (result.committed) {
        setSession({ code, role: "teacher" });
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
        [slot]: cameras[slot] ?? { uid, ready: false, joinedAt: serverTimestamp() },
      };
    });

    if (!result.committed) throw new Error("이미 스마트폰 두 대가 연결되어 있습니다.");
    const cameras = (result.snapshot.val() as RoomState["cameras"]) ?? {};
    const slot = cameras.A?.uid === uid ? "A" : cameras.B?.uid === uid ? "B" : undefined;
    if (!slot) throw new Error("카메라 번호를 배정하지 못했습니다.");
    setSession({ code, role: "camera", slot });
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
      if (mode === "teacher") await createRoom(uid, passwordHash);
      else await joinRoom(uid, passwordHash);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "연결 중 문제가 생겼습니다.");
    } finally {
      setPending(false);
    }
  }

  async function toggleReady() {
    if (!session?.slot || !room) return;
    const database = getRealtimeDatabase();
    if (!database) return;
    const nextReady = !room.cameras?.[session.slot]?.ready;
    await set(ref(database, `rooms/${session.code}/cameras/${session.slot}/ready`), nextReady);
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
      recording: null,
      "cameras/A/ready": false,
      "cameras/B/ready": false,
    });
  }

  function leaveRoom() {
    setSession(null);
    setRoom(null);
    setRoomName("");
    setRoomPassword("");
    setMessage("");
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

            <div className="entry-card">
              <div className="entry-copy">
                <span className="entry-tag">{mode === "teacher" ? "CONTROL DESK" : "CAMERA UNIT"}</span>
                <h3>{mode === "teacher" ? "새 촬영 방을 준비한다" : "촬영 방에 참여한다"}</h3>
                <p>{mode === "teacher" ? "방을 만들면 6자리 참여 코드가 나온다. 그 코드를 스마트폰 두 대에 입력하면 된다." : "선생님 화면에 표시된 6자리 코드와 비밀번호를 입력하면 카메라 A 또는 B로 자동 배정된다."}</p>
              </div>
              <form className="entry-form" onSubmit={handleSubmit}>
                <label>
                  {mode === "teacher" ? "촬영 방 이름" : "6자리 촬영 방 코드"}
                  <input value={roomName} onChange={(event) => setRoomName(mode === "camera" ? normalizeRoomCode(event.target.value) : event.target.value)} placeholder={mode === "teacher" ? "예: 2학년 자유낙하" : "예: A7K9Q2"} autoComplete="off" />
                </label>
                <label>
                  비밀번호
                  <input value={roomPassword} onChange={(event) => setRoomPassword(event.target.value)} placeholder="숫자 또는 글자 4자리 이상" type="password" autoComplete="new-password" />
                </label>
                <button className="continue-button" disabled={!canContinue}>{pending ? "연결 중…" : mode === "teacher" ? "촬영 방 만들기" : "촬영 방 들어가기"}<span>→</span></button>
                <small className={message ? "form-message error" : "form-message"}>{message || (isFirebaseConfigured ? "실시간 연결 준비 완료" : "Firebase 설정이 필요합니다.")}</small>
              </form>
            </div>
          </>
        ) : (
          <div className="room-dashboard">
            <div className="room-topline">
              <div><span className="entry-tag">ROOM CODE</span><strong className="room-code">{session.code}</strong></div>
              <button className="ghost-button" onClick={leaveRoom}>방 나가기</button>
            </div>

            {session.role === "teacher" ? (
              <>
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
              </>
            ) : (
              <div className="phone-panel">
                <span className="camera-badge">CAMERA {session.slot}</span>
                <h3>{startAt ? (countdown ? `${countdown}` : "지금 촬영 시작") : room?.cameras?.[session.slot!]?.ready ? "촬영 시작 신호를 기다리는 중" : "카메라를 고정하고 준비해 주세요"}</h3>
                <p>현재 단계에서는 두 기기에 같은 예약 시각을 전달한다. 실제 120fps·셔터 고정 촬영은 다음 모바일 촬영 기능에서 연결한다.</p>
                <button className={`ready-button ${room?.cameras?.[session.slot!]?.ready ? "active" : ""}`} onClick={toggleReady} disabled={Boolean(startAt)}>{room?.cameras?.[session.slot!]?.ready ? "준비 완료 ✓" : "촬영 준비 완료 누르기"}</button>
              </div>
            )}
          </div>
        )}
      </section>

      <footer><strong>3D Motion Lab</strong><span>교실에서 시작하는 입체 운동 분석</span></footer>
    </main>
  );
}

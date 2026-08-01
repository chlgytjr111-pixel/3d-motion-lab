"use client";

import { useMemo, useState } from "react";

type Mode = "teacher" | "camera";

const steps = [
  { number: "01", title: "촬영 방 만들기", text: "선생님이 수업용 방과 비밀번호를 만든다." },
  { number: "02", title: "스마트폰 2대 연결", text: "두 휴대폰이 같은 방에 들어와 촬영 준비를 마친다." },
  { number: "03", title: "한 번에 촬영", text: "시작 버튼 하나로 두 카메라가 함께 기록한다." },
  { number: "04", title: "자동 동기화·분석", text: "플래시 신호를 맞추고 3차원 운동을 계산한다." },
];

export default function Home() {
  const [mode, setMode] = useState<Mode>("teacher");
  const [roomName, setRoomName] = useState("");
  const [roomPassword, setRoomPassword] = useState("");

  const canContinue = useMemo(
    () => roomName.trim().length >= 2 && roomPassword.trim().length >= 4,
    [roomName, roomPassword],
  );

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="3D Motion Lab 홈">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>3D Motion Lab</span>
        </a>
        <span className="prototype-pill"><b /> 첫 번째 설계본</span>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">TWO CAMERAS · ONE MOTION</p>
          <h1>두 대의 스마트폰으로<br /><em>움직임을 3차원으로.</em></h1>
          <p className="hero-description">
            촬영 준비부터 동기화, 좌표 보정, 운동 분석까지.<br />
            수업 시간에 한 화면에서 끝내는 과학 실험 도구이다.
          </p>
          <a className="primary-link" href="#start">첫 실험 준비하기 <span>→</span></a>
        </div>

        <div className="orbit-card" aria-label="두 카메라 3차원 촬영 개념 그림">
          <div className="grid-floor" />
          <div className="axis axis-x"><span>X</span></div>
          <div className="axis axis-y"><span>Y</span></div>
          <div className="axis axis-z"><span>Z</span></div>
          <div className="camera camera-a"><span>CAM A</span></div>
          <div className="camera camera-b"><span>CAM B</span></div>
          <div className="ray ray-a" />
          <div className="ray ray-b" />
          <div className="object-dot"><span>3D</span></div>
          <div className="orbit-caption">
            <span>실시간 연결</span>
            <strong>두 시선이 만나는 한 점</strong>
          </div>
        </div>
      </section>

      <section className="workflow" aria-labelledby="workflow-title">
        <p className="section-label">HOW IT WORKS</p>
        <h2 id="workflow-title">복잡한 과정은 안쪽으로 숨겼다.</h2>
        <div className="step-grid">
          {steps.map((step) => (
            <article className="step-card" key={step.number}>
              <span>{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="start-panel" id="start" aria-labelledby="start-title">
        <div className="start-heading">
          <p className="section-label">START HERE</p>
          <h2 id="start-title">어떤 기기로 들어왔나요?</h2>
          <p>지금은 화면 흐름을 확인하는 첫 설계본이다. 실제 방 연결은 Firebase를 붙인 다음 단계에서 열린다.</p>
        </div>

        <div className="mode-switch" role="tablist" aria-label="사용 기기 선택">
          <button
            className={mode === "teacher" ? "active" : ""}
            onClick={() => setMode("teacher")}
            role="tab"
            aria-selected={mode === "teacher"}
          >
            <span className="mode-icon">▰</span>
            선생님 화면
          </button>
          <button
            className={mode === "camera" ? "active" : ""}
            onClick={() => setMode("camera")}
            role="tab"
            aria-selected={mode === "camera"}
          >
            <span className="mode-icon">▯</span>
            스마트폰 카메라
          </button>
        </div>

        <div className="entry-card">
          <div className="entry-copy">
            <span className="entry-tag">{mode === "teacher" ? "CONTROL DESK" : "CAMERA UNIT"}</span>
            <h3>{mode === "teacher" ? "새 촬영 방을 준비한다" : "촬영 방에 참여한다"}</h3>
            <p>
              {mode === "teacher"
                ? "방 이름과 비밀번호를 정하면 두 스마트폰의 준비 상태를 한곳에서 확인할 수 있다."
                : "선생님에게 받은 방 이름과 비밀번호를 입력하면 카메라 A 또는 B로 연결된다."}
            </p>
          </div>
          <form className="entry-form" onSubmit={(event) => event.preventDefault()}>
            <label>
              촬영 방 이름
              <input
                value={roomName}
                onChange={(event) => setRoomName(event.target.value)}
                placeholder="예: 2학년 자유낙하"
                autoComplete="off"
              />
            </label>
            <label>
              비밀번호
              <input
                value={roomPassword}
                onChange={(event) => setRoomPassword(event.target.value)}
                placeholder="숫자 또는 글자 4자리 이상"
                type="password"
                autoComplete="new-password"
              />
            </label>
            <button className="continue-button" disabled={!canContinue}>
              {mode === "teacher" ? "촬영 방 만들기" : "촬영 방 들어가기"}
              <span>→</span>
            </button>
            <small>Firebase 연결 전에는 실제 방이 생성되지 않는다.</small>
          </form>
        </div>
      </section>

      <footer>
        <strong>3D Motion Lab</strong>
        <span>교실에서 시작하는 입체 운동 분석</span>
      </footer>
    </main>
  );
}

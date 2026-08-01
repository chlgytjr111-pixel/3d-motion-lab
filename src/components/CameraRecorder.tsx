"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CaptureSettings = {
  fps: number;
  shutterDenominator: number;
  durationSeconds: number;
};

type NumberRange = { min: number; max: number; step?: number };
type ExtendedCapabilities = MediaTrackCapabilities & {
  exposureMode?: string[];
  exposureTime?: NumberRange;
};
type ExtendedSettings = MediaTrackSettings & {
  exposureMode?: string;
  exposureTime?: number;
};

type CameraRecorderProps = {
  roomCode: string;
  slot: "A" | "B";
  settings: CaptureSettings;
  startAt: number;
  sequence: number;
  serverOffset: number;
  onCameraActiveChange: (active: boolean) => void;
};

function chooseMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "video/mp4;codecs=h264",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function clamp(value: number, range: NumberRange) {
  return Math.min(range.max, Math.max(range.min, value));
}

export function CameraRecorder({
  roomCode,
  slot,
  settings,
  startAt,
  sequence,
  serverOffset,
  onCameraActiveChange,
}: CameraRecorderProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<number | null>(null);
  const startTimerRef = useRef<number | null>(null);
  const flashFrameRef = useRef<number | null>(null);
  const previousBrightnessRef = useRef<number | null>(null);
  const lastFlashAtRef = useRef(-1);
  const lastSequenceRef = useRef(0);
  const previewUrlRef = useRef("");

  const [cameraActive, setCameraActive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState("카메라를 열어 촬영 설정을 확인해 주세요.");
  const [appliedFps, setAppliedFps] = useState<number | null>(null);
  const [shutterStatus, setShutterStatus] = useState("아직 확인하지 않음");
  const [previewUrl, setPreviewUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [flashTimes, setFlashTimes] = useState<number[]>([]);

  const stopFlashMonitor = useCallback(() => {
    if (flashFrameRef.current !== null) cancelAnimationFrame(flashFrameRef.current);
    flashFrameRef.current = null;
    previousBrightnessRef.current = null;
    lastFlashAtRef.current = -1;
  }, []);

  const startFlashMonitor = useCallback(() => {
    stopFlashMonitor();
    setFlashTimes([]);
    const sample = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || recorderRef.current?.state !== "recording") return;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context || video.readyState < 2) {
        flashFrameRef.current = requestAnimationFrame(sample);
        return;
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let total = 0;
      for (let index = 0; index < pixels.length; index += 16) {
        total += pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722;
      }
      const brightness = total / (pixels.length / 16);
      const previous = previousBrightnessRef.current;
      const mediaTime = video.currentTime;
      if (previous !== null && brightness - previous > 42 && brightness > previous * 1.55 && mediaTime - lastFlashAtRef.current > 0.35) {
        lastFlashAtRef.current = mediaTime;
        setFlashTimes((times) => [...times, mediaTime]);
      }
      previousBrightnessRef.current = brightness;
      flashFrameRef.current = requestAnimationFrame(sample);
    };
    flashFrameRef.current = requestAnimationFrame(sample);
  }, [stopFlashMonitor]);

  const stopRecording = useCallback(() => {
    if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
    stopTimerRef.current = null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const beginRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === "undefined") {
      setStatus("이 브라우저에서는 영상 녹화를 시작할 수 없습니다.");
      return;
    }
    if (recorderRef.current?.state === "recording") return;

    const mimeType = chooseMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blobType = recorder.mimeType || mimeType || "video/webm";
      const blob = new Blob(chunksRef.current, { type: blobType });
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const nextUrl = URL.createObjectURL(blob);
      const extension = blobType.includes("mp4") ? "mp4" : "webm";
      const nextFileName = `${roomCode}-camera-${slot}-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
      previewUrlRef.current = nextUrl;
      setPreviewUrl(nextUrl);
      setFileName(nextFileName);
      setRecording(false);
      setStatus("녹화가 끝났습니다. 영상을 확인하고 이 핸드폰에 저장할 수 있습니다.");
      stopFlashMonitor();
    };
    recorder.start(250);
    setRecording(true);
    setStatus(`${settings.durationSeconds}초 동안 녹화 중입니다.`);
    startFlashMonitor();
    stopTimerRef.current = window.setTimeout(stopRecording, settings.durationSeconds * 1000);
  }, [roomCode, settings.durationSeconds, slot, startFlashMonitor, stopFlashMonitor, stopRecording]);

  const closeCamera = useCallback(() => {
    stopRecording();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
    onCameraActiveChange(false);
    setStatus("카메라가 꺼졌습니다.");
  }, [onCameraActiveChange, stopRecording]);

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("이 브라우저는 웹 카메라 촬영을 지원하지 않습니다.");
      return;
    }
    try {
      closeCamera();
      setStatus("카메라 권한과 촬영 설정을 확인하는 중입니다.");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: settings.fps, max: settings.fps },
        },
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities() as ExtendedCapabilities;

      try {
        await track.applyConstraints({ frameRate: { ideal: settings.fps, max: settings.fps } });
      } catch {
        // The actual applied FPS is reported below.
      }

      if (capabilities.exposureTime) {
        const wantedSeconds = 1 / settings.shutterDenominator;
        const usesMicroseconds = capabilities.exposureTime.max > 10;
        const wantedValue = usesMicroseconds ? wantedSeconds * 1_000_000 : wantedSeconds;
        const exposureTime = clamp(wantedValue, capabilities.exposureTime);
        const advanced = {
          exposureMode: capabilities.exposureMode?.includes("manual") ? "manual" : undefined,
          exposureTime,
        };
        try {
          await track.applyConstraints({ advanced: [advanced] } as unknown as MediaTrackConstraints);
          const actual = (track.getSettings() as ExtendedSettings).exposureTime;
          setShutterStatus(actual ? `기기에 적용됨 · ${actual}` : `기기에 적용 요청됨 · 1/${settings.shutterDenominator}초`);
        } catch {
          setShutterStatus(`수동 적용 거부됨 · 기록값 1/${settings.shutterDenominator}초`);
        }
      } else {
        setShutterStatus(`이 기기는 웹 수동 셔터 미지원 · 기록값 1/${settings.shutterDenominator}초`);
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setAppliedFps(track.getSettings().frameRate ?? null);
      setCameraActive(true);
      onCameraActiveChange(true);
      setStatus("카메라가 준비되었습니다. 아래의 촬영 준비 완료를 눌러 주세요.");
    } catch (error) {
      setCameraActive(false);
      onCameraActiveChange(false);
      setStatus(error instanceof Error ? `카메라를 열지 못했습니다: ${error.message}` : "카메라를 열지 못했습니다.");
    }
  }

  useEffect(() => {
    if (!cameraActive || !startAt || !sequence || lastSequenceRef.current === sequence) return;
    const delay = startAt - (Date.now() + serverOffset);
    if (delay < -1500) {
      lastSequenceRef.current = sequence;
      return;
    }
    lastSequenceRef.current = sequence;
    startTimerRef.current = window.setTimeout(() => {
      setStatus("동시 녹화를 시작합니다.");
      beginRecording();
    }, Math.max(0, delay));
    return () => {
      if (startTimerRef.current !== null) window.clearTimeout(startTimerRef.current);
    };
  }, [beginRecording, cameraActive, sequence, serverOffset, startAt]);

  useEffect(() => () => {
    if (startTimerRef.current !== null) window.clearTimeout(startTimerRef.current);
    if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
    if (flashFrameRef.current !== null) cancelAnimationFrame(flashFrameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  return (
    <section className="recorder-card" aria-label={`카메라 ${slot} 촬영기`}>
      <div className="video-shell">
        <video ref={videoRef} muted playsInline autoPlay />
        {!cameraActive && <div className="video-placeholder">카메라 미리보기</div>}
        {recording && <span className="recording-dot">REC</span>}
        <canvas ref={canvasRef} width="64" height="36" hidden />
      </div>

      <div className="camera-actions">
        <button className="continue-button" type="button" onClick={openCamera} disabled={recording}>{cameraActive ? "설정 다시 적용" : "카메라 열기"}<span>→</span></button>
        {cameraActive && <button className="ghost-button" type="button" onClick={closeCamera} disabled={recording}>카메라 끄기</button>}
        {cameraActive && <button className="ghost-button" type="button" onClick={recording ? stopRecording : beginRecording}>{recording ? "녹화 중지" : "시험 녹화"}</button>}
      </div>

      <div className="device-report">
        <span>요청 FPS <strong>{settings.fps}</strong></span>
        <span>실제 적용 FPS <strong>{appliedFps ? appliedFps.toFixed(1) : "확인 전"}</strong></span>
        <span>셔터 <strong>{shutterStatus}</strong></span>
      </div>
      <p className="camera-message">{status}</p>

      {previewUrl && (
        <div className="recording-result">
          <video src={previewUrl} controls playsInline />
          <div>
            <strong>촬영 영상 준비 완료</strong>
            <span>{flashTimes.length ? `밝기 급상승 후보: ${flashTimes.map((time) => `${time.toFixed(2)}초`).join(", ")}` : "뚜렷한 플래시 후보 없음"}</span>
          </div>
          <a className="download-button" href={previewUrl} download={fileName}>이 핸드폰에 영상 저장</a>
        </div>
      )}
    </section>
  );
}

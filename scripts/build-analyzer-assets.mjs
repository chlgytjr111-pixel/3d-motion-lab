import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gasRoot = path.join(projectRoot, "analyzer-src", "legacy-gas");
const externalGasRoot = path.resolve(projectRoot, "..", "outputs", "stereo-triangulation-gas");
const publicRoot = path.join(projectRoot, "public", "analyzer");
const sourceRoot = path.join(projectRoot, "analyzer-src");
const writeGas = process.argv.includes("--write-gas");

function extract(source, pattern, label) {
  const match = source.match(pattern);
  if (!match) throw new Error(`${label} 영역을 찾지 못했습니다.`);
  return match[1].trim();
}

function replaceRequired(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`${label} 치환 위치를 찾지 못했습니다.`);
  return source.replace(pattern, replacement);
}

function removeStructureFeature(source) {
  if (!source.includes('id="structureAppMode"')) return source;
  let next = source;

  next = replaceRequired(next, /\n\s*<button class="app-mode-button" id="structureAppMode"[^\n]*<\/button>/, "", "구조물 탭");
  next = replaceRequired(next, /\n<section class="section" id="structureWorkflow"[\s\S]*?<\/section>\s*\n\s*(?=<script>)/, "\n", "구조물 화면");
  next = replaceRequired(next, /\n\s*\.structure-node-grid[\s\S]*?\.structure-results-table \{ min-width: 820px !important; \}\s*\n/, "\n", "구조물 스타일");
  next = next
    .replace(/\s*\.structure-node-grid \{ grid-template-columns: repeat\(4,minmax\(100px,1fr\)\); \}/g, "")
    .replace(/\s*\.structure-node-grid \{ grid-template-columns: repeat\(2,minmax\(0,1fr\)\); \}/g, "");

  next = replaceRequired(next, /\n\s*var STRUCTURE_COLORS[\s\S]*?\n\s*var videoToastTimer = null;/, "\n\n    var videoToastTimer = null;", "구조물 상태");
  next = next
    .replace(/\n\s*renderStructureNodes\(\);\s*\n\s*updateStructureUi\(\);/, "")
    .replace(/\n\s*var structureWorkflow = id\('structureWorkflow'\);/, "")
    .replace(/ && node !== structureWorkflow/g, "")
    .replace(/\n\s*videoWorkflow\.insertAdjacentElement\('afterend', structureWorkflow\);/, "")
    .replace(/\n\s*id\('structureAppMode'\)\.addEventListener[^\n]*/, "")
    .replace(/\n\s*if \(structureState\.results\.length\) analyzeStructureMotion\(\);/g, "")
    .replace(/\n\s*clearAllStructureTracks\(false\);/g, "")
    .replace(/\s*clearAllStructureTracks\(false\);/g, "")
    .replace(/\n\s*updateStructureUi\(\);/g, "")
    .replace(/\n\s*if \(!id\('structureWorkflow'\)\.hidden\) \{ syncStructureFrameUi\(\); drawStructureOverlays\(\); \}/g, "")
    .replace(/\['videoCanvas', 'videoAnalysis', 'structureCanvas'\]/g, "['videoCanvas', 'videoAnalysis']");

  next = replaceRequired(
    next,
    /\n\s*id\('structureUseVideoSetup'\)[\s\S]*?id\('structureAnalyze'\)\.addEventListener\('click', analyzeStructureMotion\);\s*\n/,
    "\n",
    "구조물 이벤트"
  );

  next = replaceRequired(
    next,
    /\n\s*function setAppMode\(mode\) \{[\s\S]*?\n\s*\}\s*\n\s*(?=async function loadVideoFile)/,
    `
    function setAppMode(mode) {
      var photo = mode === 'photo';
      id('photoWorkflow').hidden = !photo;
      id('videoWorkflow').hidden = photo;
      id('photoAppMode').classList.toggle('active', photo);
      id('videoAppMode').classList.toggle('active', !photo);
      var hero = document.querySelector('.hero');
      var title = hero && hero.querySelector('h1');
      var text = hero && hero.querySelector('p');
      if (title) title.textContent = photo ? title.dataset.photoText : '두 카메라 3D 좌표·운동 분석기';
      if (text) text.textContent = photo ? text.dataset.photoText : '사진 한 점의 좌표부터 동기화된 두 영상의 3차원 궤적·속도·가속도까지 분석합니다.';
      document.body.classList.toggle('photo-mode', photo);
      if (!photo && videoState.files.A.loaded && videoState.files.B.loaded) goToVideoFrame(videoState.frame);
      if (window.__motionWorkspaceSetMode) window.__motionWorkspaceSetMode(photo ? 'photo' : 'video');
    }

    `,
    "분석 모드 전환"
  );

  next = replaceRequired(
    next,
    /\n\s*function selectedStructureNode\(\) \{[\s\S]*?\n\s*(?=async function runColorTracking\(\))/,
    "\n\n    ",
    "구조물 분석 함수"
  );

  if (/structure(?:State|Workflow|AppMode|Canvas|Guide|Node|Analyze|Results|Progress|UseVideo)/.test(next)) {
    throw new Error("구조물 기능 참조가 일부 남아 있습니다.");
  }
  return next;
}

function makePhotoSavePortable(script) {
  const replacement = `
      async function saveResult() {
        if (!state.result || !state.models) {
          notify('먼저 목표점 좌표를 계산해 주세요.', 'error');
          return;
        }
        var payload = {
          type: 'stereo-photo-point',
          sessionId: state.sessionId,
          measuredAt: new Date().toISOString(),
          unit: state.models.unit,
          sourceImages: {
            A: copyDriveFileInfo(state.images.A.driveFile),
            B: copyDriveFileInfo(state.images.B.driveFile)
          },
          imageSizes: {
            A: [state.images.A.width, state.images.A.height],
            B: [state.images.B.width, state.images.B.height]
          },
          calibration: state.models.rows.map(function (row) {
            return { label: row.label, gridCoordinate: row.grid, worldCoordinate: row.world, pixelA: row.pixelA, pixelB: row.pixelB };
          }),
          cameraModels: {
            A: { projectionMatrix: state.models.A.P, center: state.models.A.center, rmsPixelError: state.models.A.rms, maxPixelError: state.models.A.maxError },
            B: { projectionMatrix: state.models.B.P, center: state.models.B.center, rmsPixelError: state.models.B.rms, maxPixelError: state.models.B.maxError },
            baseline: state.models.baseline
          },
          targetPixels: { A: state.targetPixels.A, B: state.targetPixels.B },
          result: state.result
        };
        if (!canCallAppsScript()) {
          byId('savedResult').textContent = 'Firebase 방에 저장 중입니다.';
          byId('savedResult').classList.add('visible');
          window.parent.postMessage({ type: 'MOTION_LAB_SAVE_ANALYSIS', payload: payload }, window.location.origin);
          return;
        }
        try {
          await uploadBothPhotos(true);
          setBusy(true, '측정 결과를 Drive에 저장하는 중...');
          payload.sourceImages.A = copyDriveFileInfo(state.images.A.driveFile);
          payload.sourceImages.B = copyDriveFileInfo(state.images.B.driveFile);
          var saved = await callServer('saveMeasurement', payload);
          var box = byId('savedResult');
          box.innerHTML = '';
          box.appendChild(document.createTextNode('저장 완료: '));
          var link = document.createElement('a');
          link.href = saved.url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = saved.name;
          box.appendChild(link); box.classList.add('visible');
          notify('사진과 측정 결과를 Drive에 저장했습니다.', 'success');
        } catch (error) {
          notify(error.message, 'error');
        } finally {
          setBusy(false);
        }
      }

      `;
  return replaceRequired(script, /\n\s*async function saveResult\(\) \{[\s\S]*?\n\s*\}\s*\n\s*(?=function copyDriveFileInfo)/, replacement, "사진 결과 저장");
}

function makeVideoSavePortable(script) {
  const replacement = `
    function saveMotionToDrive() {
      if (!anyVideoResults()) return;
      var payload = {
        type: 'stereo-video-motion',
        sessionId: videoState.sessionId,
        fps: videoState.fps,
        playbackFps: videoState.playbackFps,
        offsetB: videoState.offsetB,
        analysisRange: { startFrame: videoState.analysisStart, endFrame: videoState.analysisEnd },
        coordinateTransform: videoState.resultTransform,
        unitScale: Number(id('videoUnitScale').value),
        unitName: id('videoUnitName').value.trim() || '단위',
        videos: {
          A: { name: videoState.files.A.name, width: videoState.files.A.width, height: videoState.files.A.height, duration: videoState.files.A.duration },
          B: { name: videoState.files.B.name, width: videoState.files.B.width, height: videoState.files.B.height, duration: videoState.files.B.duration }
        },
        calibration: videoState.rows.filter(function (row) { return row.pixelA && row.pixelB; }).map(function (row) { return { label: row.label, world: [row.x, row.y, row.z], pixelA: [row.pixelA.x, row.pixelA.y], pixelB: [row.pixelB.x, row.pixelB.y] }; }),
        cameraModels: { A: videoState.models.A, B: videoState.models.B, baseline: videoState.models.baseline },
        targets: Object.keys(videoState.targets).map(function (key) {
          var target = videoState.targets[key];
          return { id: target.id, name: target.name, color: target.color, results: target.results.map(function (row) { return { frame: row.frame, time: row.time, rawPoint: row.rawPoint, point: row.point, displayPoint: transformedResultPoint(row), velocity: row.velocity, displayVelocity: applyResultCoordinateTransform(row.velocity, true), speed: row.speed, acceleration: row.acceleration, distance: row.distance, rayGap: row.rayGap, confidence: row.confidence, pixelA: row.pixelA, pixelB: row.pixelB }; }) };
        })
      };
      if (typeof google === 'undefined' || !google.script || !google.script.run) {
        id('videoSaveStatus').textContent = 'Firebase 방에 저장 중입니다.';
        window.parent.postMessage({ type: 'MOTION_LAB_SAVE_ANALYSIS', payload: payload }, window.location.origin);
        return;
      }
      id('videoSaveStatus').textContent = 'Drive에 저장 중입니다.';
      google.script.run
        .withSuccessHandler(function (saved) { id('videoSaveStatus').innerHTML = '저장 완료 · <a href="' + saved.url + '" target="_blank" rel="noopener">' + saved.name + '</a>'; showVideoMessage('분석 결과를 Drive에 저장했습니다.'); })
        .withFailureHandler(function (error) { id('videoSaveStatus').textContent = '저장 실패'; showVideoMessage(error && error.message ? error.message : 'Drive 저장에 실패했습니다.', true); })
        .saveMeasurement(payload);
    }

    `;
  return replaceRequired(script, /\n\s*function saveMotionToDrive\(\) \{[\s\S]*?\n\s*\}\s*\n\s*(?=function showVideoMessage)/, replacement, "영상 결과 저장");
}

async function main() {
  const [indexSource, videoSource, workspaceCss, workspaceJs] = await Promise.all([
    readFile(path.join(gasRoot, "Index.html"), "utf8"),
    readFile(path.join(gasRoot, "Video.html"), "utf8"),
    readFile(path.join(sourceRoot, "workspace.css"), "utf8"),
    readFile(path.join(sourceRoot, "workspace.js"), "utf8"),
  ]);

  const cleanVideo = removeStructureFeature(videoSource);
  const baseCss = extract(indexSource, /<style>([\s\S]*?)<\/style>/, "기본 스타일");
  const videoCss = extract(cleanVideo, /<style>([\s\S]*?)<\/style>/, "영상 스타일");
  let baseJs = extract(indexSource, /<script>([\s\S]*?)<\/script>\s*<\/body>/, "기본 스크립트");
  let videoJs = extract(cleanVideo, /<script>([\s\S]*?)<\/script>/, "영상 스크립트");
  const indexBody = extract(indexSource, /<body>([\s\S]*?)<script>/, "기본 화면");
  const videoBody = extract(cleanVideo, /<\/style>([\s\S]*?)<script>/, "영상 화면");

  baseJs = makePhotoSavePortable(baseJs);
  videoJs = makeVideoSavePortable(videoJs);

  const body = indexBody.replace("<?!= include('Video'); ?>", videoBody);
  const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>3D Motion Lab · 분석 작업대</title>
  <link rel="stylesheet" href="./base.css">
  <link rel="stylesheet" href="./video.css">
  <link rel="stylesheet" href="./workspace.css">
</head>
<body>${body}
  <script src="./video.js"></script>
  <script src="./base.js"></script>
  <script src="./workspace.js"></script>
</body>
</html>`;

  await mkdir(publicRoot, { recursive: true });
  await Promise.all([
    writeFile(path.join(publicRoot, "index.html"), html, "utf8"),
    writeFile(path.join(publicRoot, "base.css"), baseCss, "utf8"),
    writeFile(path.join(publicRoot, "video.css"), videoCss, "utf8"),
    writeFile(path.join(publicRoot, "base.js"), baseJs, "utf8"),
    writeFile(path.join(publicRoot, "video.js"), videoJs, "utf8"),
    writeFile(path.join(publicRoot, "workspace.css"), workspaceCss, "utf8"),
    writeFile(path.join(publicRoot, "workspace.js"), workspaceJs, "utf8"),
  ]);

  if (writeGas) await writeFile(path.join(externalGasRoot, "Video.html"), cleanVideo, "utf8");
  console.log(`분석기 자산 생성 완료${writeGas ? " · Apps Script 원본에서도 구조물 기능 제거" : ""}`);
}

await main();

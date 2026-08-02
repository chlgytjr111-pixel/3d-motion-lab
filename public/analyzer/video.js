(function () {
    'use strict';

    var VIDEO_DEFAULT_ROWS = [
      { label: '원점 O', x: 0, y: 0, z: 0 },
      { label: 'x축 점', x: 2, y: 0, z: 0 },
      { label: 'y축 점', x: 0, y: 2, z: 0 },
      { label: 'xy 점', x: 2, y: 2, z: 0 },
      { label: 'z축 점', x: 0, y: 0, z: 2 },
      { label: 'xz 점', x: 2, y: 0, z: 2 },
      { label: 'yz 점', x: 0, y: 2, z: 2 }
    ];

    var initialVideoTargets = {
      target1: { id: 'target1', name: '물체 1', color: '#dc2626', trail: 'rgba(220,38,38,.58)', tracks: { A: {}, B: {} }, colors: { A: null, B: null }, results: [] },
      target2: { id: 'target2', name: '물체 2', color: '#0891b2', trail: 'rgba(8,145,178,.58)', tracks: { A: {}, B: {} }, colors: { A: null, B: null }, results: [] }
    };

    var videoState = {
      files: { A: emptyVideoState(), B: emptyVideoState() },
      rows: VIDEO_DEFAULT_ROWS.map(function (row, index) {
        return { id: 'vp' + (index + 1), label: row.label, x: row.x, y: row.y, z: row.z, pixelA: null, pixelB: null };
      }),
      selectedRowId: 'vp1',
      nextRowNumber: VIDEO_DEFAULT_ROWS.length + 1,
      frame: 0,
      maxFrame: 0,
      analysisStart: 0,
      analysisEnd: 0,
      fps: 120,
      playbackFps: 30,
      playbackRate: 1,
      offsetB: 0,
      mode: 'calibration',
      trackingMode: 'manual',
      models: null,
      targets: initialVideoTargets,
      activeTargetId: 'target1',
      tracks: initialVideoTargets.target1.tracks,
      colors: initialVideoTargets.target1.colors,
      results: initialVideoTargets.target1.results,
      resultTransform: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], zAxis: [0, 0, 1] },
      coordinateEditEnabled: true,
      coordinateDrag: null,
      transformGizmo: null,
      tracking: false,
      trackingReviewResolver: null,
      trackingReviewFrame: null,
      trackingStopFrame: null,
      playing: false,
      playbackToken: 0,
      targetRadius: 24,
      calibrationOverlay: false,
      calibrationDrag: null,
      suppressCanvasClick: false,
      view3d: { yaw: -2.42, pitch: -0.48, zoom: 1, dragging: false, lastX: 0, lastY: 0 },
      positionHoverIndex: null,
      renderSerial: 0,
      objectUrls: { A: null, B: null },
      sessionId: 'motion_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9)
    };

    var videoToastTimer = null;

    document.addEventListener('DOMContentLoaded', initVideoAnalyzer);

    function id(name) { return document.getElementById(name); }

    function activeVideoTarget() { return videoState.targets[videoState.activeTargetId]; }

    function anyVideoResults() {
      return Object.keys(videoState.targets).some(function (key) { return videoState.targets[key].results.length > 0; });
    }

    function syncActiveVideoTarget() {
      var target = activeVideoTarget();
      target.tracks = videoState.tracks;
      target.colors = videoState.colors;
      target.results = videoState.results;
    }

    function activateVideoTarget(targetId) {
      if (!videoState.targets[targetId] || videoState.tracking) return;
      syncActiveVideoTarget();
      videoState.activeTargetId = targetId;
      var target = activeVideoTarget();
      videoState.tracks = target.tracks;
      videoState.colors = target.colors;
      videoState.results = target.results;
      id('videoTarget1').classList.toggle('active', targetId === 'target1');
      id('videoTarget2').classList.toggle('active', targetId === 'target2');
      videoState.positionHoverIndex = null;
      updateColorSwatches();
      updateTrackingStatus();
      updateVideoGuide();
      drawVideoOverlay('A'); drawVideoOverlay('B');
      if (target.results.length) renderVideoResults();
      else if (anyVideoResults()) {
        id('videoResults').hidden = false;
        drawTrajectoryChart(null, id('videoUnitName').value.trim() || '단위');
        id('videoMotionMetrics').innerHTML = '<div class="motion-metric"><span>선택 물체</span><strong>' + target.name + '</strong></div><div class="motion-metric"><span>상태</span><strong>아직 분석 전</strong></div>';
        id('videoResultsBody').innerHTML = '';
        clearChart(id('videoPositionChart').getContext('2d'), id('videoPositionChart'), target.name + ' 위치 · 아직 분석 전');
        clearChart(id('videoKinematicsChart').getContext('2d'), id('videoKinematicsChart'), target.name + ' 속도·가속도 · 아직 분석 전');
      }
      showVideoMessage(target.name + ' 추적 모드로 바꿨습니다.');
    }

    function emptyVideoState() {
      return { file: null, loaded: false, width: 0, height: 0, duration: 0, name: '' };
    }

    function initVideoAnalyzer() {
      prepareAppModes();
      bindVideoEvents();
      renderVideoCalibrationTable();
      drawVideoEmpty('A');
      drawVideoEmpty('B');
      updateVideoTimeline();
      updateVideoGuide();
      setAppMode('video');
    }

    function prepareAppModes() {
      var shell = document.querySelector('main.shell');
      var header = shell ? shell.querySelector('.hero') : null;
      var nav = id('appModeNav');
      var videoWorkflow = id('videoWorkflow');
      if (!shell || !header || !nav || !videoWorkflow) return;

      var photoWorkflow = id('photoWorkflow');
      if (!photoWorkflow) {
        photoWorkflow = document.createElement('div');
        photoWorkflow.id = 'photoWorkflow';
        var candidates = Array.prototype.slice.call(shell.children).filter(function (node) {
          return node !== header && node !== nav && node !== videoWorkflow;
        });
        candidates.forEach(function (node) { photoWorkflow.appendChild(node); });
        header.insertAdjacentElement('afterend', nav);
        nav.insertAdjacentElement('afterend', photoWorkflow);
        photoWorkflow.insertAdjacentElement('afterend', videoWorkflow);
      }

      var heroTitle = header.querySelector('h1');
      var heroText = header.querySelector('p');
      if (heroTitle && !heroTitle.dataset.photoText) heroTitle.dataset.photoText = heroTitle.textContent;
      if (heroText && !heroText.dataset.photoText) heroText.dataset.photoText = heroText.textContent;
    }

    function bindVideoEvents() {
      id('photoAppMode').addEventListener('click', function () { setAppMode('photo'); });
      id('videoAppMode').addEventListener('click', function () { setAppMode('video'); });

      ['A', 'B'].forEach(function (side) {
        id('videoFile' + side).addEventListener('change', function (event) {
          var file = event.target.files && event.target.files[0];
          if (file) loadVideoFile(side, file);
          event.target.value = '';
        });
        var videoCanvas = id('videoCanvas' + side);
        videoCanvas.addEventListener('pointerdown', function (event) { beginCalibrationDrag(side, event); });
        videoCanvas.addEventListener('pointermove', function (event) { moveCalibrationDrag(side, event); });
        ['pointerup', 'pointercancel'].forEach(function (eventName) {
          videoCanvas.addEventListener(eventName, function (event) { endCalibrationDrag(side, event); });
        });
        videoCanvas.addEventListener('click', function (event) {
          handleVideoCanvasClick(side, event);
        });
      });

      id('videoFps').addEventListener('change', function () {
        videoState.fps = clampNumber(Number(this.value) || 120, 1, 960);
        this.value = videoState.fps;
        updateAnalysisRangeUi();
        updateFrameReadout();
        if (videoState.results.length) analyzeTrackedMotion();
        updateVideoGuide();
      });
      id('videoPlaybackFps').addEventListener('change', function () {
        videoState.playbackFps = clampNumber(Number(this.value) || 30, 1, 960);
        this.value = videoState.playbackFps;
        clearAllVideoTracks(false, true);
        updateVideoTimeline();
        goToVideoFrame(Math.min(videoState.frame, videoState.maxFrame));
      });
      id('videoOffsetB').addEventListener('change', function () {
        videoState.offsetB = Math.round(clampNumber(Number(this.value) || 0, -600, 600));
        this.value = videoState.offsetB;
        resetVideoModelsAndTracks();
        goToVideoFrame(videoState.frame);
      });
      id('videoUnitScale').addEventListener('change', resetVideoModelsAndTracks);
      id('videoUnitName').addEventListener('change', renderVideoResults);

      id('videoFirstFrame').addEventListener('click', function () { goToVideoFrame(0); });
      id('videoPrevFrame').addEventListener('click', function () { goToVideoFrame(videoState.frame - 1); });
      id('videoNextFrame').addEventListener('click', function () { goToVideoFrame(videoState.frame + 1); });
      id('videoFrameSlider').addEventListener('input', function () { goToVideoFrame(Number(this.value)); });
      id('videoRangeStart').addEventListener('change', function () { setAnalysisRange(Number(this.value), videoState.analysisEnd, true); });
      id('videoRangeEnd').addEventListener('change', function () { setAnalysisRange(videoState.analysisStart, Number(this.value), true); });
      id('videoSetRangeStart').addEventListener('click', function () { setAnalysisRange(videoState.frame, videoState.analysisEnd, true); });
      id('videoSetRangeEnd').addEventListener('click', function () { setAnalysisRange(videoState.analysisStart, videoState.frame, true); });
      id('videoGoRangeStart').addEventListener('click', function () { stopRangePlayback(); goToVideoFrame(videoState.analysisStart); });
      id('videoPlayRange').addEventListener('click', toggleRangePlayback);
      id('videoRate05').addEventListener('click', function () { setVideoPlaybackRate(.5); });
      id('videoRate1').addEventListener('click', function () { setVideoPlaybackRate(1); });
      id('videoRate2').addEventListener('click', function () { setVideoPlaybackRate(2); });
      id('videoRate4').addEventListener('click', function () { setVideoPlaybackRate(4); });

      id('videoAddPoint').addEventListener('click', addVideoCalibrationPoint);
      id('videoCoordinateOverlay').addEventListener('click', toggleCalibrationCoordinateOverlay);
      id('videoClearCalibration').addEventListener('click', clearVideoCalibrationClicks);
      id('videoCalibrate').addEventListener('click', calculateVideoCalibration);
      id('videoManualMode').addEventListener('click', function () { setVideoTrackingMode('manual'); });
      id('videoColorMode').addEventListener('click', function () { setVideoTrackingMode('color'); });
      id('videoTarget1').addEventListener('click', function () { activateVideoTarget('target1'); });
      id('videoTarget2').addEventListener('click', function () { activateVideoTarget('target2'); });
      id('videoClearCurrentTarget').addEventListener('click', clearCurrentVideoTarget);
      id('videoClearTracks').addEventListener('click', clearAllVideoTracks);
      id('videoAutoTrack').addEventListener('click', runColorTracking);
      id('videoTrackingReviewAccept').addEventListener('click', function () { resolveTrackingReview('accept'); });
      id('videoTrackingReviewManual').addEventListener('click', function () { resolveTrackingReview('manual'); });
      id('videoTrackingReviewSkip').addEventListener('click', function () { resolveTrackingReview('skip'); });
      id('videoRecalculate').addEventListener('click', analyzeTrackedMotion);
      id('videoDownloadCsv').addEventListener('click', downloadMotionCsv);
      id('videoSaveDrive').addEventListener('click', saveMotionToDrive);
      id('videoUseStartOrigin').addEventListener('click', useActiveStartAsOrigin);
      id('videoEditCoordinate').addEventListener('click', toggleCoordinateEditing);
      id('videoResetTransform').addEventListener('click', resetCoordinateTransform);

      id('videoColorThreshold').addEventListener('input', function () { id('videoThresholdValue').textContent = this.value; });
      id('videoSearchRadius').addEventListener('input', function () { id('videoRadiusValue').textContent = this.value + 'px'; });
      id('videoSmoothWindow').addEventListener('input', function () {
        id('videoSmoothValue').textContent = this.value + '프레임';
        if (videoState.results.length) analyzeTrackedMotion();
      });
      id('videoTargetRadius').addEventListener('input', function () {
        videoState.targetRadius = Number(this.value) || 24;
        id('videoTargetRadiusValue').textContent = videoState.targetRadius + 'px';
        refreshTargetRegions();
      });
      bindInteractiveCharts();
    }
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

    async function loadVideoFile(side, file) {
      if (!/^video\//i.test(file.type) && !/\.(mp4|webm|mov|m4v)$/i.test(file.name)) {
        showVideoMessage('MP4, WebM 또는 MOV 영상 파일을 선택해 주세요.', true);
        return;
      }

      var video = id('videoElement' + side);
      if (videoState.objectUrls[side]) URL.revokeObjectURL(videoState.objectUrls[side]);
      var url = URL.createObjectURL(file);
      videoState.objectUrls[side] = url;
      videoState.files[side] = emptyVideoState();
      videoState.files[side].file = file;
      videoState.files[side].name = file.name;
      video.src = url;
      video.load();

      try {
        await waitForVideoMetadata(video);
        await waitForFirstVideoFrame(video);
        videoState.files[side] = {
          file: file,
          loaded: true,
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration,
          name: file.name
        };
        resizeVideoCanvases(side, video.videoWidth, video.videoHeight);
        id('videoPlaceholder' + side).style.display = 'none';
        id('videoMeta' + side).textContent = file.name + ' · ' + video.videoWidth + '×' + video.videoHeight + ' · ' + video.duration.toFixed(3) + '초 · ' + formatBytesVideo(file.size);
        resetVideoModelsAndTracks();
        updateVideoTimeline();
        await goToVideoFrame(0);
        showVideoMessage('카메라 ' + side + ' 영상을 불러왔습니다.');
      } catch (error) {
        videoState.files[side] = emptyVideoState();
        drawVideoEmpty(side);
        id('videoMeta' + side).textContent = '영상을 읽지 못했습니다.';
        showVideoMessage(error.message || '영상을 읽지 못했습니다.', true);
      }
      updateVideoGuide();
    }

    function waitForVideoMetadata(video) {
      return new Promise(function (resolve, reject) {
        if (video.readyState >= 1 && video.videoWidth) { resolve(); return; }
        var timer = setTimeout(function () { cleanup(); reject(new Error('영상 정보를 읽는 시간이 너무 오래 걸립니다.')); }, 15000);
        function cleanup() {
          clearTimeout(timer);
          video.removeEventListener('loadedmetadata', loaded);
          video.removeEventListener('error', failed);
        }
        function loaded() { cleanup(); resolve(); }
        function failed() { cleanup(); reject(new Error('이 영상 형식을 브라우저에서 재생할 수 없습니다.')); }
        video.addEventListener('loadedmetadata', loaded, { once: true });
        video.addEventListener('error', failed, { once: true });
      });
    }

    function waitForFirstVideoFrame(video) {
      return new Promise(function (resolve, reject) {
        if (video.readyState >= 2 && video.videoWidth) { resolve(); return; }
        var timer = setTimeout(function () { cleanup(); reject(new Error('영상의 첫 장면을 읽는 시간이 너무 오래 걸립니다.')); }, 15000);
        function cleanup() {
          clearTimeout(timer);
          video.removeEventListener('loadeddata', loaded);
          video.removeEventListener('canplay', loaded);
          video.removeEventListener('error', failed);
        }
        function loaded() { cleanup(); resolve(); }
        function failed() { cleanup(); reject(new Error('영상의 첫 장면을 읽지 못했습니다.')); }
        video.addEventListener('loadeddata', loaded, { once: true });
        video.addEventListener('canplay', loaded, { once: true });
        video.addEventListener('error', failed, { once: true });
      });
    }

    function resizeVideoCanvases(side, width, height) {
      ['videoCanvas', 'videoAnalysis'].forEach(function (prefix) {
        var canvas = id(prefix + side);
        canvas.width = width;
        canvas.height = height;
      });
    }

    function drawVideoEmpty(side) {
      var canvas = id('videoCanvas' + side);
      var ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#e9eef5';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      id('videoPlaceholder' + side).style.display = 'grid';
    }

    function updateVideoTimeline() {
      var durations = ['A', 'B'].filter(function (side) { return videoState.files[side].loaded; }).map(function (side) {
        return videoState.files[side].duration;
      });
      var duration = durations.length ? Math.min.apply(null, durations) : 0;
      videoState.maxFrame = Math.max(0, Math.floor(duration * videoState.playbackFps + 1e-6) - 1);
      videoState.frame = Math.min(videoState.frame, videoState.maxFrame);
      videoState.analysisStart = 0;
      videoState.analysisEnd = videoState.maxFrame;
      var slider = id('videoFrameSlider');
      slider.max = videoState.maxFrame;
      slider.value = videoState.frame;
      id('videoRangeStart').max = videoState.maxFrame;
      id('videoRangeEnd').max = videoState.maxFrame;
      updateAnalysisRangeUi();
      updateFrameReadout();
    }

    function setAnalysisRange(start, end, moveInside) {
      stopRangePlayback();
      start = Math.round(clampNumber(Number(start) || 0, 0, videoState.maxFrame));
      end = Math.round(clampNumber(Number(end) || 0, 0, videoState.maxFrame));
      if (start > end) {
        if (moveInside) {
          if (start !== videoState.analysisStart) end = start;
          else start = end;
        } else {
          var swap = start; start = end; end = swap;
        }
      }
      videoState.analysisStart = start;
      videoState.analysisEnd = end;
      updateAnalysisRangeUi();
      if (videoState.frame < start || videoState.frame > end) goToVideoFrame(start);
      if (videoState.results.length) analyzeTrackedMotion();
      updateVideoGuide();
    }

    function updateAnalysisRangeUi() {
      id('videoRangeStart').value = videoState.analysisStart;
      id('videoRangeEnd').value = videoState.analysisEnd;
      var count = Math.max(0, videoState.analysisEnd - videoState.analysisStart + 1);
      var realDuration = count > 1 ? (count - 1) / videoState.fps : 0;
      var fileDuration = count > 1 ? (count - 1) / videoState.playbackFps : 0;
      id('videoRangeSummary').textContent = videoState.analysisStart + '~' + videoState.analysisEnd + ' 프레임 · 실제 ' + realDuration.toFixed(3) + '초 · 파일 재생 ' + fileDuration.toFixed(3) + '초 · 이 구간만 추적·분석합니다.';
    }

    function toggleRangePlayback() {
      if (videoState.playing) { stopRangePlayback(); return; }
      playAnalysisRange();
    }

    function setVideoPlaybackRate(rate) {
      videoState.playbackRate = clampNumber(Number(rate) || 1, .25, 8);
      [['videoRate05',.5],['videoRate1',1],['videoRate2',2],['videoRate4',4]].forEach(function (entry) {
        id(entry[0]).classList.toggle('active', Math.abs(videoState.playbackRate - entry[1]) < 1e-9);
      });
      showVideoMessage('영상 재생 속도를 ' + videoState.playbackRate + '배로 바꿨습니다. 분석 시간 계산에는 영향을 주지 않습니다.');
    }

    async function playAnalysisRange() {
      if (!videoState.files.A.loaded || !videoState.files.B.loaded) {
        showVideoMessage('영상 A와 B를 먼저 선택해 주세요.', true);
        return;
      }
      stopRangePlayback();
      videoState.playing = true;
      var token = ++videoState.playbackToken;
      var button = id('videoPlayRange');
      button.textContent = '■ 재생 멈춤';
      try {
        for (var frame = videoState.analysisStart; frame <= videoState.analysisEnd; frame += 1) {
          if (!videoState.playing || token !== videoState.playbackToken) break;
          await goToVideoFrame(frame);
          var delay = Math.max(4, 1000 / (videoState.playbackFps * videoState.playbackRate));
          await new Promise(function (resolve) { setTimeout(resolve, delay); });
        }
      } finally {
        if (token === videoState.playbackToken) stopRangePlayback();
      }
    }

    function stopRangePlayback() {
      videoState.playing = false;
      videoState.playbackToken += 1;
      var button = id('videoPlayRange');
      if (button) button.textContent = '▶ 선택 구간 재생';
    }

    function updateFrameReadout() {
      id('videoFrameSlider').value = videoState.frame;
      var realTime = videoState.frame / videoState.fps;
      var fileTime = videoState.frame / videoState.playbackFps;
      id('videoFrameReadout').textContent = videoState.frame + ' / ' + videoState.maxFrame + ' · 실제 ' + realTime.toFixed(3) + '초 · 파일 ' + fileTime.toFixed(3) + '초';
    }

    async function goToVideoFrame(frame) {
      if (videoState.tracking) return;
      videoState.frame = Math.round(clampNumber(Number(frame) || 0, 0, videoState.maxFrame));
      updateFrameReadout();
      var serial = ++videoState.renderSerial;
      var jobs = [];
      if (videoState.files.A.loaded) jobs.push(seekAndDrawRaw('A', videoState.frame));
      if (videoState.files.B.loaded) jobs.push(seekAndDrawRaw('B', videoState.frame + videoState.offsetB));
      try {
        await Promise.all(jobs);
        if (serial !== videoState.renderSerial) return;
        drawVideoOverlay('A');
        drawVideoOverlay('B');
        updateVideoGuide();
      } catch (error) {
        showVideoMessage(error.message || '프레임을 읽지 못했습니다.', true);
      }
    }

    function seekAndDrawRaw(side, requestedFrame) {
      if (!videoState.files[side].loaded) return Promise.resolve();
      var video = id('videoElement' + side);
      var frame = clampNumber(requestedFrame, 0, Math.max(0, Math.floor(video.duration * videoState.playbackFps) - 1));
      var time = Math.min(Math.max(0, frame / videoState.playbackFps), Math.max(0, video.duration - 0.0001));
      return seekVideo(video, time).then(function () {
        var analysis = id('videoAnalysis' + side);
        analysis.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0, analysis.width, analysis.height);
        var display = id('videoCanvas' + side);
        display.getContext('2d').drawImage(analysis, 0, 0);
      });
    }

    function seekVideo(video, time) {
      return new Promise(function (resolve, reject) {
        if (Math.abs(video.currentTime - time) < 0.0005 && video.readyState >= 2) { resolve(); return; }
        var timer = setTimeout(function () { cleanup(); reject(new Error('영상 프레임 이동 시간이 너무 오래 걸립니다.')); }, 8000);
        function cleanup() {
          clearTimeout(timer);
          video.removeEventListener('seeked', done);
          video.removeEventListener('error', failed);
        }
        function done() { cleanup(); resolve(); }
        function failed() { cleanup(); reject(new Error('영상 프레임을 읽지 못했습니다.')); }
        video.addEventListener('seeked', done, { once: true });
        video.addEventListener('error', failed, { once: true });
        try { video.currentTime = time; } catch (error) { cleanup(); reject(error); }
      });
    }

    function drawVideoOverlay(side) {
      if (!videoState.files[side].loaded) return;
      var canvas = id('videoCanvas' + side);
      var analysis = id('videoAnalysis' + side);
      var ctx = canvas.getContext('2d');
      ctx.drawImage(analysis, 0, 0);
      var radius = Math.max(6, Math.min(canvas.width, canvas.height) * 0.009);

      if (videoState.calibrationOverlay && videoState.mode === 'calibration') {
        drawCalibrationWireframe(ctx, side);
      }

      videoState.rows.forEach(function (row, index) {
        var point = row['pixel' + side];
        if (!point) return;
        drawVideoPoint(ctx, point, String(index + 1), row.id === videoState.selectedRowId && videoState.mode === 'calibration' ? '#f59e0b' : '#2563dc', radius);
      });

      if (videoState.mode === 'tracking') {
        Object.keys(videoState.targets).forEach(function (key) {
          var targetState = videoState.targets[key];
          drawTrackingTrail(ctx, side, radius, targetState);
          var targetPoint = targetState.tracks[side][videoState.frame];
          if (targetPoint) drawVideoTarget(ctx, targetPoint, targetPoint.radius || videoState.targetRadius, targetState.color, key === videoState.activeTargetId);
        });
      }
    }

    function drawCalibrationWireframe(ctx, side) {
      var points = videoState.rows.slice(0, 7).map(function (row) { return row['pixel' + side]; });
      var edges = [[0,1],[0,2],[1,3],[2,3],[0,4],[1,5],[2,6],[4,5],[4,6]];
      ctx.save();
      ctx.strokeStyle = 'rgba(37,99,220,.72)';
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      edges.forEach(function (edge) {
        var a = points[edge[0]], b = points[edge[1]];
        if (!a || !b) return;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      });
      ctx.restore();
    }

    function toggleCalibrationCoordinateOverlay() {
      if (!videoState.files.A.loaded || !videoState.files.B.loaded) {
        showVideoMessage('영상 A와 B를 먼저 선택해 주세요.', true);
        return;
      }
      videoState.mode = 'calibration';
      videoState.models = null;
      videoState.calibrationOverlay = !videoState.calibrationOverlay;
      id('videoCoordinateOverlay').textContent = videoState.calibrationOverlay ? '좌표계 잡기 종료' : '좌표계 잡기';
      ['A', 'B'].forEach(function (side) {
        id('videoCanvas' + side).classList.toggle('calibration-drag', videoState.calibrationOverlay);
        if (videoState.calibrationOverlay) seedCalibrationTemplate(side);
        drawVideoOverlay(side);
      });
      if (videoState.calibrationOverlay) {
        renderVideoCalibrationTable();
        showVideoMessage('두 영상의 1~7번 점을 각각 마우스로 끌어 실제 좌표계에 맞춘 뒤 카메라 보정을 누르세요.');
      } else {
        updateVideoGuide();
      }
    }

    function seedCalibrationTemplate(side) {
      var canvas = id('videoCanvas' + side);
      var templates = side === 'A' ? [
        [.27,.72],[.54,.67],[.38,.84],[.66,.77],[.27,.38],[.54,.33],[.38,.53]
      ] : [
        [.32,.73],[.58,.81],[.49,.59],[.72,.67],[.32,.38],[.58,.46],[.49,.28]
      ];
      videoState.rows.slice(0, 7).forEach(function (row, index) {
        if (!row['pixel' + side]) row['pixel' + side] = { x: templates[index][0] * canvas.width, y: templates[index][1] * canvas.height };
      });
    }

    function eventToVideoPoint(canvas, event) {
      var rect = canvas.getBoundingClientRect();
      return {
        x: clampNumber((event.clientX - rect.left) * canvas.width / rect.width, 0, canvas.width - 1),
        y: clampNumber((event.clientY - rect.top) * canvas.height / rect.height, 0, canvas.height - 1)
      };
    }

    function beginCalibrationDrag(side, event) {
      if (!videoState.calibrationOverlay || videoState.mode !== 'calibration' || videoState.tracking) return;
      var canvas = id('videoCanvas' + side);
      var point = eventToVideoPoint(canvas, event);
      var rect = canvas.getBoundingClientRect();
      var hitRadius = 26 * canvas.width / Math.max(1, rect.width);
      var closest = null, closestDistance = Infinity;
      videoState.rows.slice(0, 7).forEach(function (row) {
        var candidate = row['pixel' + side];
        if (!candidate) return;
        var distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
        if (distance < closestDistance) { closest = row; closestDistance = distance; }
      });
      if (!closest || closestDistance > hitRadius) return;
      event.preventDefault();
      videoState.selectedRowId = closest.id;
      videoState.calibrationDrag = { side: side, rowId: closest.id, pointerId: event.pointerId, startX: point.x, startY: point.y, moved: false };
      if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
      drawVideoOverlay(side);
      updateVideoCalibrationPanel();
    }

    function moveCalibrationDrag(side, event) {
      var drag = videoState.calibrationDrag;
      if (!drag || drag.side !== side || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      var canvas = id('videoCanvas' + side);
      var point = eventToVideoPoint(canvas, event);
      var row = videoState.rows.find(function (item) { return item.id === drag.rowId; });
      if (!row) return;
      row['pixel' + side] = point;
      drag.moved = drag.moved || Math.hypot(point.x - drag.startX, point.y - drag.startY) > 2;
      videoState.models = null;
      drawVideoOverlay(side);
    }

    function endCalibrationDrag(side, event) {
      var drag = videoState.calibrationDrag;
      if (!drag || drag.side !== side || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      videoState.suppressCanvasClick = true;
      videoState.calibrationDrag = null;
      renderVideoCalibrationTable();
      if (completeVideoCalibrationCount() === videoState.rows.length) {
        showVideoMessage('7개 기준점이 모두 배치되었습니다. 이제 ‘카메라 보정 계산’ 버튼을 누르세요.');
      }
    }

    function drawTrackingTrail(ctx, side, baseRadius, targetState) {
      var start = videoState.analysisStart;
      var end = Math.min(videoState.frame, videoState.analysisEnd);
      var points = [];
      for (var frame = start; frame <= end; frame += 1) {
        var point = targetState.tracks[side][frame];
        if (point) points.push({ frame: frame, x: point.x, y: point.y });
      }
      if (!points.length) return;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = targetState.trail;
      ctx.lineWidth = Math.max(targetState.id === videoState.activeTargetId ? 2.8 : 2, baseRadius * .28);
      ctx.beginPath();
      points.forEach(function (point, index) {
        if (!index || point.frame - points[index - 1].frame > 2) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
      points.forEach(function (point, index) {
        if (index !== points.length - 1 && index % Math.max(1, Math.floor(points.length / 35)) !== 0) return;
        ctx.beginPath();
        ctx.arc(point.x, point.y, Math.max(2.5, baseRadius * .32), 0, Math.PI * 2);
        ctx.fillStyle = index === points.length - 1 ? targetState.color : targetState.trail;
        ctx.fill();
      });
      ctx.restore();
    }

    function drawVideoPoint(ctx, point, label, color, radius) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius + 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '700 ' + Math.max(12, radius * 1.15) + 'px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, point.x, point.y + 1);
      ctx.restore();
    }

    function drawVideoTarget(ctx, point, radius, color, active) {
      ctx.save();
      ctx.globalAlpha = active ? 1 : .72;
      ctx.fillStyle = color;
      ctx.globalAlpha = active ? .10 : .06;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = active ? 1 : .72;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(5, radius * .55);
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, radius * .25);
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(point.x - radius * 1.4, point.y);
      ctx.lineTo(point.x + radius * 1.4, point.y);
      ctx.moveTo(point.x, point.y - radius * 1.4);
      ctx.lineTo(point.x, point.y + radius * 1.4);
      ctx.stroke();
      ctx.restore();
    }

    function handleVideoCanvasClick(side, event) {
      if (videoState.suppressCanvasClick) { videoState.suppressCanvasClick = false; return; }
      if (!videoState.files[side].loaded || videoState.tracking || videoState.calibrationOverlay) return;
      var canvas = id('videoCanvas' + side);
      var point = eventToVideoPoint(canvas, event);

      if (videoState.mode === 'calibration') {
        var row = getSelectedVideoRow();
        if (!row) return;
        row['pixel' + side] = point;
        videoState.models = null;
        if (row.pixelA && row.pixelB) {
          var next = findNextVideoRow(row.id);
          if (next) videoState.selectedRowId = next.id;
        }
        renderVideoCalibrationTable();
        var completedCalibration = completeVideoCalibrationCount();
        if (completedCalibration === videoState.rows.length) {
          showVideoMessage('7개 기준점을 모두 찍었습니다. 이제 ‘카메라 보정 계산’ 버튼을 누르세요.');
        }
      } else {
        point.confidence = 1;
        point.manual = true;
        point.radius = videoState.targetRadius;
        videoState.tracks[side][videoState.frame] = point;
        videoState.colors[side] = sampleTargetColor(side, point);
        updateColorSwatches();
        if (videoState.tracks.A[videoState.frame] && videoState.tracks.B[videoState.frame]) {
          var completedFrame = videoState.frame;
          analyzeTrackedMotion();
          if (videoState.trackingMode === 'manual' && completedFrame < videoState.analysisEnd) {
            setTimeout(function () { goToVideoFrame(completedFrame + 1); }, 120);
          }
        }
      }
      drawVideoOverlay(side);
      updateVideoGuide();
      updateTrackingStatus();
    }

    function sampleTargetColor(side, point) {
      var canvas = id('videoAnalysis' + side);
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      var radius = Math.max(4, Math.round(point.radius || videoState.targetRadius));
      var x0 = Math.max(0, Math.round(point.x) - radius);
      var y0 = Math.max(0, Math.round(point.y) - radius);
      var width = Math.min(canvas.width - x0, radius * 2 + 1);
      var height = Math.min(canvas.height - y0, radius * 2 + 1);
      var data = ctx.getImageData(x0, y0, width, height).data;
      var candidates = [];
      var fallback = [0, 0, 0, 0];
      for (var i = 0; i < data.length; i += 4) {
        var r = data[i], g = data[i + 1], b = data[i + 2];
        fallback[0] += r; fallback[1] += g; fallback[2] += b; fallback[3] += 1;
        var max = Math.max(r, g, b), min = Math.min(r, g, b);
        var saturation = max ? (max - min) / max : 0;
        if (saturation > .28 && max - min > 45) candidates.push([r, g, b, saturation]);
      }
      if (!candidates.length) return [fallback[0] / fallback[3], fallback[1] / fallback[3], fallback[2] / fallback[3]];
      candidates.sort(function (a, b) { return b[3] - a[3]; });
      var take = candidates.slice(0, Math.max(8, Math.floor(candidates.length * .55)));
      return [0, 1, 2].map(function (channel) {
        return take.reduce(function (sum, color) { return sum + color[channel]; }, 0) / take.length;
      });
    }

    function refreshTargetRegions() {
      ['A', 'B'].forEach(function (side) {
        var seed = videoState.tracks[side][videoState.frame];
        if (seed) {
          seed.radius = videoState.targetRadius;
          videoState.colors[side] = sampleTargetColor(side, seed);
        }
        drawVideoOverlay(side);
      });
      updateColorSwatches();
    }

    function updateColorSwatches() {
      ['A', 'B'].forEach(function (side) {
        var color = videoState.colors[side];
        id('videoColor' + side).style.background = color ? 'rgb(' + color.map(Math.round).join(',') + ')' : '#ccd5e3';
      });
      id('videoAutoTrack').disabled = !(videoState.models && videoState.colors.A && videoState.colors.B && !videoState.tracking);
    }

    function renderVideoCalibrationTable() {
      var body = id('videoCalibrationBody');
      body.innerHTML = '';
      videoState.rows.forEach(function (row, index) {
        var tr = document.createElement('tr');
        tr.classList.toggle('selected', row.id === videoState.selectedRowId);

        var selectCell = document.createElement('td');
        var selectButton = document.createElement('button');
        selectButton.type = 'button';
        selectButton.className = 'video-point-button' + (row.id === videoState.selectedRowId ? ' active' : '');
        selectButton.textContent = index + 1;
        selectButton.addEventListener('click', function () { videoState.selectedRowId = row.id; renderVideoCalibrationTable(); updateVideoGuide(); });
        selectCell.appendChild(selectButton);
        tr.appendChild(selectCell);

        tr.appendChild(videoInputCell(row, 'label', 'text', 'video-name'));
        tr.appendChild(videoInputCell(row, 'x', 'number'));
        tr.appendChild(videoInputCell(row, 'y', 'number'));
        tr.appendChild(videoInputCell(row, 'z', 'number'));
        tr.appendChild(videoPixelCell(row.pixelA));
        tr.appendChild(videoPixelCell(row.pixelB));
        body.appendChild(tr);
      });
      updateVideoCalibrationPanel();
      drawVideoOverlay('A');
      drawVideoOverlay('B');
    }

    function videoInputCell(row, key, type, className) {
      var td = document.createElement('td');
      var input = document.createElement('input');
      input.type = type;
      input.value = row[key];
      input.className = className || '';
      if (type === 'number') input.step = 'any';
      input.addEventListener('change', function () {
        row[key] = type === 'number' ? Number(input.value) : input.value.trim();
        resetVideoModelsAndTracks(false);
        updateVideoCalibrationPanel();
      });
      td.appendChild(input);
      return td;
    }

    function videoPixelCell(point) {
      var td = document.createElement('td');
      td.className = 'video-pixel ' + (point ? 'done' : 'missing');
      td.textContent = point ? Math.round(point.x) + ', ' + Math.round(point.y) : '아직 안 찍음';
      return td;
    }

    function updateVideoCalibrationPanel() {
      var selected = getSelectedVideoRow();
      var index = Math.max(0, videoState.rows.findIndex(function (row) { return row.id === videoState.selectedRowId; }));
      id('videoCalibrationPrompt').textContent = (index + 1) + '번 · ' + (selected ? selected.label : '기준점') + ' 선택';
      id('videoCalibrationDetail').textContent = selected ? '좌표 (' + selected.x + ', ' + selected.y + ', ' + selected.z + ')를 두 영상에서 클릭합니다.' : '';
      var complete = completeVideoCalibrationCount();
      id('videoCalibrationCount').textContent = complete + ' / ' + videoState.rows.length;
      var ready = complete >= 6;
      id('videoCalibrate').classList.toggle('ready', ready && !videoState.models);
      if (!videoState.models) {
        if (complete === videoState.rows.length) id('videoCalibrationStatus').textContent = '7개 모두 완료! 아래 ‘카메라 보정 계산’ 버튼을 누르세요.';
        else if (ready) id('videoCalibrationStatus').textContent = '계산할 준비가 되었습니다. ‘카메라 보정 계산’을 누르세요.';
        else id('videoCalibrationStatus').textContent = '최소 6개의 점이 필요합니다.';
      }
    }

    function completeVideoCalibrationCount() {
      return videoState.rows.filter(function (row) { return row.pixelA && row.pixelB && validVideoRow(row); }).length;
    }

    function getSelectedVideoRow() {
      return videoState.rows.find(function (row) { return row.id === videoState.selectedRowId; });
    }

    function findNextVideoRow(currentId) {
      var start = videoState.rows.findIndex(function (row) { return row.id === currentId; });
      for (var offset = 1; offset <= videoState.rows.length; offset += 1) {
        var row = videoState.rows[(start + offset) % videoState.rows.length];
        if (!row.pixelA || !row.pixelB) return row;
      }
      return null;
    }

    function validVideoRow(row) {
      return [row.x, row.y, row.z].every(Number.isFinite) && Boolean(row.label);
    }

    function addVideoCalibrationPoint() {
      var number = videoState.nextRowNumber++;
      var row = { id: 'vp' + Date.now().toString(36) + number, label: '기준점 ' + number, x: 0, y: 0, z: 0, pixelA: null, pixelB: null };
      videoState.rows.push(row);
      videoState.selectedRowId = row.id;
      resetVideoModelsAndTracks(false);
      renderVideoCalibrationTable();
    }

    function clearVideoCalibrationClicks() {
      videoState.rows.forEach(function (row) { row.pixelA = null; row.pixelB = null; });
      videoState.selectedRowId = videoState.rows[0] && videoState.rows[0].id;
      resetVideoModelsAndTracks();
      renderVideoCalibrationTable();
      showVideoMessage('영상 기준점 클릭을 모두 지웠습니다.');
    }

    function resetVideoModelsAndTracks(clearTracks) {
      videoState.models = null;
      videoState.mode = 'calibration';
      id('videoCalibrationStatus').textContent = '설정이 바뀌어 다시 보정해야 합니다.';
      if (clearTracks !== false) { clearAllVideoTracks(false, true); }
      updateColorSwatches();
      updateVideoGuide();
    }

    function calculateVideoCalibration() {
      if (!window.__stereoMath) { showVideoMessage('계산 모듈을 불러오지 못했습니다. 페이지를 새로고침해 주세요.', true); return; }
      if (!videoState.files.A.loaded || !videoState.files.B.loaded) { showVideoMessage('영상 A와 B를 먼저 선택해 주세요.', true); return; }
      var scale = Number(id('videoUnitScale').value);
      if (!Number.isFinite(scale) || scale <= 0) { showVideoMessage('좌표 1칸의 실제 길이를 올바르게 입력해 주세요.', true); return; }
      var rows = videoState.rows.filter(function (row) { return row.pixelA && row.pixelB && validVideoRow(row); });
      if (rows.length < 6) { showVideoMessage('두 영상에서 모두 찍은 기준점이 최소 6개 필요합니다.', true); return; }

      try {
        var pointsA = rows.map(function (row) { return { world: [row.x * scale, row.y * scale, row.z * scale], pixel: [row.pixelA.x, row.pixelA.y] }; });
        var pointsB = rows.map(function (row) { return { world: [row.x * scale, row.y * scale, row.z * scale], pixel: [row.pixelB.x, row.pixelB.y] }; });
        var modelA = window.__stereoMath.calibrateCamera(pointsA);
        var modelB = window.__stereoMath.calibrateCamera(pointsB);
        videoState.models = { A: modelA, B: modelB, baseline: window.__stereoMath.vectorDistance(modelA.center, modelB.center), count: rows.length };
        videoState.mode = 'tracking';
        videoState.calibrationOverlay = false;
        id('videoCoordinateOverlay').textContent = '좌표계 잡기';
        ['A', 'B'].forEach(function (side) { id('videoCanvas' + side).classList.remove('calibration-drag'); });
        id('videoCalibrate').classList.remove('ready');
        id('videoCalibrationStatus').textContent = '완료 · A 오차 ' + modelA.rms.toFixed(2) + 'px · B 오차 ' + modelB.rms.toFixed(2) + 'px';
        setVideoTrackingMode(videoState.trackingMode);
        showVideoMessage('카메라 보정이 완료되었습니다. 이제 목표점을 선택하세요.');
        updateVideoGuide();
      } catch (error) {
        videoState.models = null;
        videoState.mode = 'calibration';
        id('videoCalibrationStatus').textContent = '보정 실패';
        showVideoMessage(error.message || '카메라 보정에 실패했습니다.', true);
      }
    }

    function setVideoTrackingMode(mode) {
      videoState.trackingMode = mode;
      id('videoManualMode').classList.toggle('active', mode === 'manual');
      id('videoColorMode').classList.toggle('active', mode === 'color');
      if (videoState.models) videoState.mode = 'tracking';
      updateColorSwatches();
      updateTrackingStatus();
      updateVideoGuide();
    }

    function clearCurrentVideoTarget() {
      delete videoState.tracks.A[videoState.frame];
      delete videoState.tracks.B[videoState.frame];
      drawVideoOverlay('A');
      drawVideoOverlay('B');
      analyzeTrackedMotion();
      updateTrackingStatus();
    }

    function clearAllVideoTracks(showMessage, allTargets) {
      var targets = allTargets ? Object.keys(videoState.targets).map(function (key) { return videoState.targets[key]; }) : [activeVideoTarget()];
      targets.forEach(function (target) {
        target.tracks = { A: {}, B: {} };
        target.colors = { A: null, B: null };
        target.results = [];
      });
      var active = activeVideoTarget();
      videoState.tracks = active.tracks;
      videoState.colors = active.colors;
      videoState.results = active.results;
      id('videoResults').hidden = !anyVideoResults();
      updateColorSwatches();
      drawVideoOverlay('A');
      drawVideoOverlay('B');
      updateTrackingStatus();
      if (showMessage !== false) showVideoMessage(allTargets ? '두 물체의 추적 결과를 모두 지웠습니다.' : active.name + '의 추적 결과를 지웠습니다.');
    }

    function updateTrackingStatus() {
      if (!videoState.models) {
        id('videoTrackingStatus').textContent = '카메라 보정을 먼저 완료하세요.';
        return;
      }
      var targetName = activeVideoTarget().name + ' · ';
      var a = videoState.tracks.A[videoState.frame];
      var b = videoState.tracks.B[videoState.frame];
      if (!a && !b) id('videoTrackingStatus').textContent = targetName + '현재 프레임에서 카메라 A와 B의 같은 목표점을 클릭하세요.';
      else if (!a) id('videoTrackingStatus').textContent = targetName + '카메라 A의 목표점을 클릭하세요.';
      else if (!b) id('videoTrackingStatus').textContent = targetName + '카메라 B의 목표점을 클릭하세요.';
      else id('videoTrackingStatus').textContent = targetName + '현재 프레임의 두 목표점이 선택되었습니다. ' + (videoState.trackingMode === 'color' ? '동그라미 크기를 확인한 뒤 자동 추적을 시작하세요.' : '다음 프레임으로 자동 이동합니다.');
    }

    function updateVideoGuide() {
      var loadedA = videoState.files.A.loaded;
      var loadedB = videoState.files.B.loaded;
      if (!loadedA || !loadedB) {
        id('videoGuideTitle').textContent = '먼저 카메라 A와 B의 영상을 선택하세요.';
        id('videoGuideText').textContent = '두 영상은 같은 순간을 촬영하고 같은 FPS를 사용하는 것이 좋습니다.';
        id('videoGuideStatus').textContent = (loadedA ? 'A 완료 · ' : 'A 필요 · ') + (loadedB ? 'B 완료' : 'B 필요');
        return;
      }
      if (!videoState.models) {
        var complete = completeVideoCalibrationCount();
        if (complete >= 6) {
          id('videoGuideTitle').textContent = complete + '개 기준점 촬영 완료 · 이제 카메라 보정 계산을 누르세요.';
          id('videoGuideText').textContent = '오른쪽 보정 패널 아래의 파란색 ‘카메라 보정 계산’ 버튼을 누르면 목표물 추적으로 넘어갑니다.';
          id('videoGuideStatus').textContent = complete + ' / ' + videoState.rows.length + ' 완료';
          return;
        }
        var selected = getSelectedVideoRow();
        var index = videoState.rows.findIndex(function (row) { return row.id === videoState.selectedRowId; }) + 1;
        id('videoGuideTitle').textContent = index + '번 · ' + (selected ? selected.label : '기준점') + '을 두 영상에서 찍으세요.';
        id('videoGuideText').textContent = selected ? '알려진 좌표 (' + selected.x + ', ' + selected.y + ', ' + selected.z + ')' : '기준점을 선택하세요.';
        id('videoGuideStatus').textContent = '프레임 ' + videoState.frame;
        return;
      }
      id('videoGuideTitle').textContent = activeVideoTarget().name + ' · 프레임 ' + videoState.frame + '의 같은 목표점을 선택하세요.';
      id('videoGuideText').textContent = videoState.trackingMode === 'color' ? '두 화면의 목표물을 한 번씩 클릭하고 동그라미 크기로 범위를 정한 뒤 자동 추적을 시작합니다.' : '카메라 A와 B를 모두 찍으면 다음 프레임으로 자동 이동합니다.';
      var trackedInRange = 0;
      for (var frame = videoState.analysisStart; frame <= videoState.analysisEnd; frame += 1) {
        if (videoState.tracks.A[frame] && videoState.tracks.B[frame]) trackedInRange += 1;
      }
      id('videoGuideStatus').textContent = trackedInRange + ' / ' + (videoState.analysisEnd - videoState.analysisStart + 1) + ' 추적';
      updateTrackingStatus();
    }

    async function runColorTracking() {
      if (!videoState.models || !videoState.colors.A || !videoState.colors.B) {
        showVideoMessage('보정을 마친 뒤 같은 프레임에서 두 영상의 목표물을 먼저 클릭해 주세요.', true);
        return;
      }
      var seedFrame = videoState.frame;
      if (seedFrame < videoState.analysisStart || seedFrame > videoState.analysisEnd) {
        showVideoMessage('목표물 시작점은 선택한 분석 시간 범위 안에서 찍어 주세요.', true);
        return;
      }
      var seedA = videoState.tracks.A[seedFrame];
      var seedB = videoState.tracks.B[seedFrame];
      if (!seedA || !seedB) { showVideoMessage('현재 프레임의 두 영상에서 목표물을 먼저 클릭해 주세요.', true); return; }

      for (var clearFrame = videoState.analysisStart; clearFrame <= videoState.analysisEnd; clearFrame += 1) {
        if (clearFrame === seedFrame) continue;
        delete videoState.tracks.A[clearFrame];
        delete videoState.tracks.B[clearFrame];
      }

      videoState.tracking = true;
      videoState.trackingStopFrame = null;
      updateColorSwatches();
      var progressBox = id('videoTrackerProgress');
      var progressBar = id('videoTrackerProgressBar');
      var progressText = id('videoTrackerProgressText');
      progressBox.classList.add('visible');
      var total = videoState.analysisEnd - videoState.analysisStart + 1;
      var completed = 0;
      var stoppedForManual = false;
      var lastReviewFrame = -9999;

      try {
        var previousA = copyTrackPoint(seedA);
        var previousB = copyTrackPoint(seedB);
        for (var frame = seedFrame; frame <= videoState.analysisEnd; frame += 1) {
          await renderRawTrackingFrame(frame);
          if (frame !== seedFrame) {
            var foundA = detectColorTarget('A', previousA, videoState.colors.A);
            var foundB = detectColorTarget('B', previousB, videoState.colors.B);
            var review = assessTrackingCandidate(foundA, foundB, previousA, previousB);
            var decision = 'accept';
            if (review.ambiguous && Math.abs(frame - lastReviewFrame) >= 5) {
              lastReviewFrame = frame;
              setTrackingCandidates(frame, foundA, foundB);
              decision = await requestTrackingReview(frame, foundA, foundB, review);
            }
            if (decision === 'manual') {
              delete videoState.tracks.A[frame]; delete videoState.tracks.B[frame];
              videoState.trackingStopFrame = frame; stoppedForManual = true; break;
            }
            if (decision === 'skip') {
              delete videoState.tracks.A[frame]; delete videoState.tracks.B[frame];
            } else {
              if (foundA) { videoState.tracks.A[frame] = foundA; previousA = foundA; }
              if (foundB) { videoState.tracks.B[frame] = foundB; previousB = foundB; }
            }
          }
          drawVideoOverlay('A'); drawVideoOverlay('B');
          completed += 1;
          updateTrackingProgress(completed, total, frame, progressBar, progressText);
          await yieldToBrowser();
        }

        if (!stoppedForManual) {
          previousA = copyTrackPoint(seedA);
          previousB = copyTrackPoint(seedB);
          for (var back = seedFrame - 1; back >= videoState.analysisStart; back -= 1) {
            await renderRawTrackingFrame(back);
            var backA = detectColorTarget('A', previousA, videoState.colors.A);
            var backB = detectColorTarget('B', previousB, videoState.colors.B);
            var backReview = assessTrackingCandidate(backA, backB, previousA, previousB);
            var backDecision = 'accept';
            if (backReview.ambiguous && Math.abs(back - lastReviewFrame) >= 5) {
              lastReviewFrame = back;
              setTrackingCandidates(back, backA, backB);
              backDecision = await requestTrackingReview(back, backA, backB, backReview);
            }
            if (backDecision === 'manual') {
              delete videoState.tracks.A[back]; delete videoState.tracks.B[back];
              videoState.trackingStopFrame = back; stoppedForManual = true; break;
            }
            if (backDecision === 'skip') {
              delete videoState.tracks.A[back]; delete videoState.tracks.B[back];
            } else {
              if (backA) { videoState.tracks.A[back] = backA; previousA = backA; }
              if (backB) { videoState.tracks.B[back] = backB; previousB = backB; }
            }
            drawVideoOverlay('A'); drawVideoOverlay('B');
            completed += 1;
            updateTrackingProgress(completed, total, back, progressBar, progressText);
            await yieldToBrowser();
          }
        }

        analyzeTrackedMotion();
        showVideoMessage(stoppedForManual ? '애매한 프레임에서 자동 추적을 멈췄습니다. 두 영상의 목표점을 직접 클릭해 수정하세요.' : '색상 자동 추적과 3차원 운동 계산이 완료되었습니다.');
      } catch (error) {
        showVideoMessage(error.message || '자동 추적 중 오류가 발생했습니다.', true);
      } finally {
        videoState.tracking = false;
        id('videoTrackingReview').hidden = true;
        videoState.trackingReviewResolver = null;
        var trackedCount = 0;
        for (var countedFrame = videoState.analysisStart; countedFrame <= videoState.analysisEnd; countedFrame += 1) {
          if (videoState.tracks.A[countedFrame] && videoState.tracks.B[countedFrame]) trackedCount += 1;
        }
        progressText.textContent = (stoppedForManual ? '직접 수정 대기 · ' : '추적 완료 · ') + trackedCount + '개 프레임';
        updateColorSwatches();
        var finalFrame = stoppedForManual && videoState.trackingStopFrame != null ? videoState.trackingStopFrame : seedFrame;
        videoState.frame = finalFrame;
        await goToVideoFrame(finalFrame);
        updateVideoGuide();
      }
    }

    function setTrackingCandidates(frame, pointA, pointB) {
      if (pointA) videoState.tracks.A[frame] = pointA; else delete videoState.tracks.A[frame];
      if (pointB) videoState.tracks.B[frame] = pointB; else delete videoState.tracks.B[frame];
      drawVideoOverlay('A'); drawVideoOverlay('B');
    }

    function assessTrackingCandidate(pointA, pointB, previousA, previousB) {
      var reasons = [];
      if (!pointA || !pointB) reasons.push('두 영상 중 한쪽에서 목표를 찾지 못함');
      var confidences = [pointA, pointB].filter(Boolean).map(function (point) { return point.confidence || 0; });
      var confidence = confidences.length ? Math.min.apply(null, confidences) : 0;
      if (confidence < .52) reasons.push('추적 신뢰도 ' + Math.round(confidence * 100) + '%');
      var searchRadius = Number(id('videoSearchRadius').value) || 120;
      [[pointA, previousA, 'A'], [pointB, previousB, 'B']].forEach(function (entry) {
        if (entry[0] && entry[1] && Math.hypot(entry[0].x - entry[1].x, entry[0].y - entry[1].y) > searchRadius * .78) reasons.push('카메라 ' + entry[2] + ' 위치가 갑자기 크게 이동함');
      });
      return { ambiguous: reasons.length > 0, reasons: reasons, confidence: confidence };
    }

    function requestTrackingReview(frame, pointA, pointB, review) {
      videoState.trackingReviewFrame = frame;
      id('videoTrackingReviewTitle').textContent = '프레임 ' + frame + '의 추적 위치를 확인해 주세요.';
      id('videoTrackingReviewText').textContent = review.reasons.join(' · ') + '. 영상 위 후보점과 지금까지의 흔적을 보고 결정하세요.';
      id('videoTrackingReview').hidden = false;
      id('videoTrackerProgressText').textContent = '프레임 ' + frame + '에서 사용자 확인 대기 중';
      return new Promise(function (resolve) { videoState.trackingReviewResolver = resolve; });
    }

    function resolveTrackingReview(decision) {
      if (!videoState.trackingReviewResolver) return;
      var resolver = videoState.trackingReviewResolver;
      videoState.trackingReviewResolver = null;
      id('videoTrackingReview').hidden = true;
      resolver(decision);
    }

    function copyTrackPoint(point) {
      return { x: point.x, y: point.y, radius: point.radius || videoState.targetRadius, confidence: point.confidence || 1, manual: Boolean(point.manual) };
    }

    async function renderRawTrackingFrame(frame) {
      videoState.frame = frame;
      updateFrameReadout();
      await Promise.all([
        seekAndDrawRaw('A', frame),
        seekAndDrawRaw('B', frame + videoState.offsetB)
      ]);
    }

    function detectColorTarget(side, previous, targetColor) {
      var canvas = id('videoAnalysis' + side);
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      var threshold = Number(id('videoColorThreshold').value);
      var searchRadius = Number(id('videoSearchRadius').value);
      var x0 = Math.max(0, Math.floor(previous.x - searchRadius));
      var y0 = Math.max(0, Math.floor(previous.y - searchRadius));
      var x1 = Math.min(canvas.width - 1, Math.ceil(previous.x + searchRadius));
      var y1 = Math.min(canvas.height - 1, Math.ceil(previous.y + searchRadius));
      var width = x1 - x0 + 1;
      var height = y1 - y0 + 1;
      var pixels = ctx.getImageData(x0, y0, width, height).data;
      var stride = canvas.width > 1000 ? 2 : 1;
      var best = null;
      var bestScore = Infinity;

      for (var y = 0; y < height; y += stride) {
        for (var x = 0; x < width; x += stride) {
          var idx = (y * width + x) * 4;
          var dr = pixels[idx] - targetColor[0];
          var dg = pixels[idx + 1] - targetColor[1];
          var db = pixels[idx + 2] - targetColor[2];
          var colorDistance = Math.sqrt(dr * dr + dg * dg + db * db);
          if (colorDistance > threshold) continue;
          var absX = x0 + x, absY = y0 + y;
          var spatial = Math.hypot(absX - previous.x, absY - previous.y);
          var score = colorDistance + spatial * .12;
          if (score < bestScore) { bestScore = score; best = { x: absX, y: absY }; }
        }
      }
      if (!best) return null;

      var clusterRadius = Math.max(8, Math.min(120, Math.round((previous.radius || videoState.targetRadius) * 1.35)));
      var sumX = 0, sumY = 0, sumWeight = 0, sumDistance = 0, count = 0;
      for (var cy = Math.max(0, Math.floor(best.y - clusterRadius)); cy <= Math.min(canvas.height - 1, Math.ceil(best.y + clusterRadius)); cy += 1) {
        for (var cx = Math.max(0, Math.floor(best.x - clusterRadius)); cx <= Math.min(canvas.width - 1, Math.ceil(best.x + clusterRadius)); cx += 1) {
          if (Math.hypot(cx - best.x, cy - best.y) > clusterRadius) continue;
          var localX = cx - x0, localY = cy - y0;
          if (localX < 0 || localY < 0 || localX >= width || localY >= height) continue;
          var localIndex = (localY * width + localX) * 4;
          var rr = pixels[localIndex] - targetColor[0];
          var gg = pixels[localIndex + 1] - targetColor[1];
          var bb = pixels[localIndex + 2] - targetColor[2];
          var distance = Math.sqrt(rr * rr + gg * gg + bb * bb);
          if (distance > threshold) continue;
          var weight = Math.max(.05, 1 - distance / threshold);
          sumX += cx * weight; sumY += cy * weight; sumWeight += weight; sumDistance += distance; count += 1;
        }
      }
      if (!sumWeight || count < 3) return null;
      var meanDistance = sumDistance / count;
      var confidence = clampNumber((1 - meanDistance / threshold) * Math.min(1, count / 45), 0, 1);
      return { x: sumX / sumWeight, y: sumY / sumWeight, radius: previous.radius || videoState.targetRadius, confidence: confidence, manual: false };
    }

    function updateTrackingProgress(completed, total, frame, bar, text) {
      var percent = Math.round(completed / total * 100);
      bar.value = percent;
      text.textContent = '프레임 ' + frame + ' 분석 중 · ' + percent + '%';
    }

    function yieldToBrowser() {
      return new Promise(function (resolve) { requestAnimationFrame(function () { resolve(); }); });
    }

    function analyzeTrackedMotion() {
      if (!videoState.models || !window.__stereoMath) return;
      var raw = [];
      for (var frame = videoState.analysisStart; frame <= videoState.analysisEnd; frame += 1) {
        var a = videoState.tracks.A[frame];
        var b = videoState.tracks.B[frame];
        if (!a || !b) continue;
        try {
          var tri = window.__stereoMath.triangulateCore(videoState.models.A.P, videoState.models.B.P, [a.x, a.y], [b.x, b.y]);
          raw.push({
            frame: frame,
            time: frame / videoState.fps,
            rawPoint: tri.point.slice(),
            rayGap: tri.rayGap,
            reprojection: Math.max(tri.reprojectionA, tri.reprojectionB),
            angle: tri.angleDeg,
            confidence: Math.min(a.confidence == null ? 1 : a.confidence, b.confidence == null ? 1 : b.confidence),
            pixelA: [a.x, a.y],
            pixelB: [b.x, b.y]
          });
        } catch (error) {
          // A single invalid frame is skipped so the rest of the trajectory remains usable.
        }
      }

      if (!raw.length) {
        videoState.results = [];
        activeVideoTarget().results = videoState.results;
        id('videoResults').hidden = !anyVideoResults();
        if (anyVideoResults()) drawTrajectoryChart(null, id('videoUnitName').value.trim() || '단위');
        return;
      }

      var windowSize = Math.max(1, Number(id('videoSmoothWindow').value) || 1);
      var half = Math.floor(windowSize / 2);
      raw.forEach(function (row, index) {
        var neighbors = raw.filter(function (candidate, neighborIndex) {
          return Math.abs(neighborIndex - index) <= half && Math.abs(candidate.frame - row.frame) <= half;
        });
        row.point = [0, 1, 2].map(function (axis) {
          return neighbors.reduce(function (sum, item) { return sum + item.rawPoint[axis]; }, 0) / neighbors.length;
        });
      });

      raw.forEach(function (row, index) { row.velocity = vectorDerivative(raw, index, 'point'); row.speed = vectorNorm(row.velocity); });
      raw.forEach(function (row, index) { row.accelerationVector = vectorDerivative(raw, index, 'velocity'); row.acceleration = vectorNorm(row.accelerationVector); });
      var distance = 0;
      raw.forEach(function (row, index) {
        if (index) distance += vectorDistanceLocal(raw[index - 1].point, row.point);
        row.distance = distance;
      });

      videoState.results = raw;
      activeVideoTarget().results = raw;
      renderVideoResults();
      updateVideoGuide();
    }

    function vectorDerivative(rows, index, key) {
      if (rows.length < 2) return [0, 0, 0];
      var left = index === 0 ? 0 : index - 1;
      var right = index === rows.length - 1 ? rows.length - 1 : index + 1;
      if (left === right) return [0, 0, 0];
      var dt = rows[right].time - rows[left].time;
      if (dt <= 0 || rows[right].frame - rows[left].frame > 4) return [0, 0, 0];
      return [0, 1, 2].map(function (axis) { return (rows[right][key][axis] - rows[left][key][axis]) / dt; });
    }

    function applyResultCoordinateTransform(point, vectorOnly) {
      var transform = videoState.resultTransform;
      var q = point.map(function (value, axis) { return value - (vectorOnly ? 0 : transform.origin[axis]); });
      return [dotVector3(q, transform.xAxis), dotVector3(q, transform.yAxis), dotVector3(q, transform.zAxis)];
    }

    function transformedResultPoint(row) { return applyResultCoordinateTransform(row.point, false); }

    function toggleCoordinateEditing() {
      videoState.coordinateEditEnabled = !videoState.coordinateEditEnabled;
      var button = id('videoEditCoordinate');
      button.classList.toggle('active', videoState.coordinateEditEnabled);
      button.textContent = videoState.coordinateEditEnabled ? '좌표축 드래그 편집 켜짐' : '좌표축 드래그 편집 꺼짐';
      showVideoMessage(videoState.coordinateEditEnabled ? '3D 그래프의 큰 원점·X축·Y축 손잡이를 드래그하세요.' : '좌표축 편집을 껐습니다. 이제 그래프 어디든 드래그하면 시점이 회전합니다.');
    }

    function useActiveStartAsOrigin() {
      if (!videoState.results.length) { showVideoMessage('먼저 선택한 물체의 추적 결과를 만드세요.', true); return; }
      videoState.resultTransform.origin = videoState.results[0].point.slice();
      updateCoordinateTransformStatus();
      renderVideoResults();
      showVideoMessage(activeVideoTarget().name + '의 시작점을 새 원점으로 적용했습니다.');
    }

    function resetCoordinateTransform() {
      videoState.resultTransform = { origin: [0,0,0], xAxis: [1,0,0], yAxis: [0,1,0], zAxis: [0,0,1] };
      updateCoordinateTransformStatus();
      if (anyVideoResults()) renderVideoResults();
      showVideoMessage('원래 좌표계로 되돌렸습니다.');
    }

    function updateCoordinateTransformStatus() {
      var t = videoState.resultTransform;
      id('videoTransformStatus').textContent = '원점 (' + formatVector3(t.origin) + ') · X축 (' + formatVector3(t.xAxis) + ') · Y축 (' + formatVector3(t.yAxis) + ')';
    }

    function formatVector3(vector) { return vector.map(function (value) { return formatVideoNumber(value, 3); }).join(', '); }
    function dotVector3(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
    function crossVector3(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
    function normalizeVector3(vector, fallback) {
      var length = Math.hypot(vector[0], vector[1], vector[2]);
      return length > 1e-9 ? vector.map(function (value) { return value / length; }) : (fallback || [1,0,0]).slice();
    }
    function localDirectionToWorld(vector, transform) {
      return [0,1,2].map(function (axis) { return transform.xAxis[axis]*vector[0] + transform.yAxis[axis]*vector[1] + transform.zAxis[axis]*vector[2]; });
    }

    function renderVideoResults() {
      var rows = videoState.results;
      if (!rows.length) {
        id('videoResults').hidden = !anyVideoResults();
        if (anyVideoResults()) drawTrajectoryChart(null, id('videoUnitName').value.trim() || '단위');
        return;
      }
      id('videoResults').hidden = false;
      var unit = id('videoUnitName').value.trim() || '단위';
      var totalDistance = rows[rows.length - 1].distance;
      var maxSpeed = Math.max.apply(null, rows.map(function (row) { return row.speed; }));
      var maxAcceleration = Math.max.apply(null, rows.map(function (row) { return row.acceleration; }));
      var duration = rows[rows.length - 1].time - rows[0].time;
      var firstDisplayPoint = transformedResultPoint(rows[0]);
      var lastDisplayPoint = transformedResultPoint(rows[rows.length - 1]);
      var displacementVector = [0, 1, 2].map(function (axis) { return lastDisplayPoint[axis] - firstDisplayPoint[axis]; });
      var displacement = vectorNorm(displacementVector);
      var averageSpeed = duration > 0 ? totalDistance / duration : 0;
      var averageVelocity = duration > 0 ? displacementVector.map(function (value) { return value / duration; }) : [0, 0, 0];
      var averageAcceleration = rows.reduce(function (sum, row) { return sum + row.acceleration; }, 0) / rows.length;
      var metrics = [
        ['선택 물체', activeVideoTarget().name],
        ['분석 프레임', rows.length + '개'],
        ['분석 시간', formatVideoNumber(duration, 3) + ' s'],
        ['총 이동거리', formatVideoNumber(totalDistance, 4) + ' ' + unit],
        ['변위', formatVideoNumber(displacement, 4) + ' ' + unit],
        ['평균 속력', formatVideoNumber(averageSpeed, 4) + ' ' + unit + '/s'],
        ['평균 속도 벡터', '(' + averageVelocity.map(function (value) { return formatVideoNumber(value, 3); }).join(', ') + ')'],
        ['최대 속력', formatVideoNumber(maxSpeed, 4) + ' ' + unit + '/s'],
        ['평균 가속도', formatVideoNumber(averageAcceleration, 4) + ' ' + unit + '/s²'],
        ['최대 가속도', formatVideoNumber(maxAcceleration, 4) + ' ' + unit + '/s²']
      ];
      id('videoMotionMetrics').innerHTML = metrics.map(function (metric) { return '<div class="motion-metric"><span>' + metric[0] + '</span><strong>' + metric[1] + '</strong></div>'; }).join('');

      drawTrajectoryChart(rows, unit);
      drawPositionChart(rows, unit);
      drawKinematicsChart(rows, unit);

      var body = id('videoResultsBody');
      body.innerHTML = rows.map(function (row) {
        var displayPoint = transformedResultPoint(row);
        return '<tr><td>' + row.frame + '</td><td>' + row.time.toFixed(4) + '</td><td>' + displayPoint[0].toFixed(5) + '</td><td>' + displayPoint[1].toFixed(5) + '</td><td>' + displayPoint[2].toFixed(5) + '</td><td>' + row.speed.toFixed(5) + '</td><td>' + row.acceleration.toFixed(5) + '</td><td>' + row.rayGap.toExponential(2) + '</td><td>' + Math.round(row.confidence * 100) + '%</td></tr>';
      }).join('');
    }

    function drawTrajectoryChart(rows, unit) {
      var canvas = id('videoTrajectoryChart');
      var ctx = canvas.getContext('2d');
      clearChart(ctx, canvas, '3D 실제 좌표 궤적 (' + unit + ') · 드래그 회전 · 휠 확대');
      var series = Object.keys(videoState.targets).map(function (key) {
        var target = videoState.targets[key];
        return { target: target, points: target.results.map(transformedResultPoint) };
      }).filter(function (item) { return item.points.length > 0; });
      if (!series.length) return;
      var allPoints = [].concat.apply([], series.map(function (item) { return item.points; }));
      var ranges = trajectoryAxisRanges(allPoints);
      var center = ranges.map(function (range) { return (range.min + range.max) / 2; });
      var extent = Math.max.apply(null, ranges.map(function (range) { return range.max - range.min; }));
      if (!Number.isFinite(extent) || extent < 1e-9) extent = 1;
      var box = chartBox(canvas);
      var scale = Math.min(box.right - box.left, box.bottom - box.top) / extent * .62 * videoState.view3d.zoom;
      drawInteractive3dReference(ctx, canvas, ranges, center, scale, unit);
      series.forEach(function (item) {
        var projected = item.points.map(function (point) { return projectInteractive3d(point, center, scale, canvas); });
        ctx.beginPath();
        projected.forEach(function (point, index) { if (!index) ctx.moveTo(point[0], point[1]); else ctx.lineTo(point[0], point[1]); });
        ctx.strokeStyle = item.target.color;
        ctx.lineWidth = item.target.id === videoState.activeTargetId ? 3.5 : 2.8;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
        projected.forEach(function (point, index) {
          if (index !== projected.length - 1 && index % Math.max(1, Math.floor(projected.length / 45)) !== 0) return;
          ctx.beginPath(); ctx.arc(point[0], point[1], index === projected.length - 1 ? 5 : 2.5, 0, Math.PI * 2);
          ctx.fillStyle = index === projected.length - 1 ? item.target.color : item.target.trail; ctx.fill();
        });
        drawEndpoint(ctx, canvas, projected, 0, item.target.color);
        drawEndpoint(ctx, canvas, projected, projected.length - 1, item.target.color);
        drawTrajectoryCoordinateLabel(ctx, canvas, projected[0], item.points[0], item.target.name + ' 시작', item.target.color, -1);
        drawTrajectoryCoordinateLabel(ctx, canvas, projected[projected.length - 1], item.points[item.points.length - 1], item.target.name + ' 끝', item.target.color, 1);
      });
      drawChartLegend(ctx, series.map(function (item) { return [item.target.name + (item.target.id === videoState.activeTargetId ? ' (선택)' : ''), item.target.color]; }));
      drawCoordinateTransformGizmo(ctx, canvas, ranges, center, scale);
      drawTrajectoryRangeSummary(ctx, canvas, ranges, unit);
    }

    function drawCoordinateTransformGizmo(ctx, canvas, ranges, center, scale) {
      var span = Math.max.apply(null, ranges.map(function (range) { return range.max - range.min; }));
      var length = Math.max(ranges[0].step || .25, span * .24);
      var origin = projectInteractive3d([0,0,0], center, scale, canvas);
      var xEnd = projectInteractive3d([length,0,0], center, scale, canvas);
      var yEnd = projectInteractive3d([0,length,0], center, scale, canvas);
      var zEnd = projectInteractive3d([0,0,length], center, scale, canvas);
      videoState.transformGizmo = { origin: origin, xEnd: xEnd, yEnd: yEnd, zEnd: zEnd, length: length, scale: scale };
      ctx.save();
      ctx.globalAlpha = videoState.coordinateEditEnabled ? 1 : .55;
      [[xEnd,'#dc2626','X'],[yEnd,'#16835e','Y'],[zEnd,'#2563dc','Z']].forEach(function (entry) {
        ctx.beginPath(); ctx.moveTo(origin[0],origin[1]); ctx.lineTo(entry[0][0],entry[0][1]); ctx.strokeStyle=entry[1]; ctx.lineWidth=5; ctx.stroke();
        ctx.beginPath(); ctx.arc(entry[0][0],entry[0][1],entry[2]==='Z'?8:12,0,Math.PI*2); ctx.fillStyle=entry[1]; ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=3; ctx.stroke();
        ctx.fillStyle='#fff'; ctx.font='800 11px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(entry[2],entry[0][0],entry[0][1]+.5);
      });
      ctx.beginPath(); ctx.arc(origin[0],origin[1],13,0,Math.PI*2); ctx.fillStyle='#263650'; ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=3; ctx.stroke();
      ctx.fillStyle='#fff'; ctx.font='800 10px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('O',origin[0],origin[1]+.5);
      ctx.restore();
    }

    function trajectoryAxisRanges(points) {
      var scale = Number(id('videoUnitScale').value) || 1;
      var calibrationPoints = videoState.rows.map(function (row) { return applyResultCoordinateTransform([Number(row.x) * scale, Number(row.y) * scale, Number(row.z) * scale], false); });
      var usable = points.concat(calibrationPoints).filter(function (point) {
        return point && point.length === 3 && point.every(Number.isFinite);
      });
      if (!usable.length) usable = [[0, 0, 0], [1, 1, 1]];
      return [0, 1, 2].map(function (axis) {
        var values = usable.map(function (point) { return point[axis]; }).concat([0]);
        var rawMin = Math.min.apply(null, values);
        var rawMax = Math.max.apply(null, values);
        var rawSpan = rawMax - rawMin;
        var step = niceTrajectoryStep(rawSpan || Math.max(Math.abs(rawMin), Math.abs(rawMax), 1), 4);
        var nearMin = Math.round(rawMin / step) * step;
        var nearMax = Math.round(rawMax / step) * step;
        if (Math.abs(rawMin - nearMin) <= step * .06) rawMin = nearMin;
        if (Math.abs(rawMax - nearMax) <= step * .06) rawMax = nearMax;
        var min = Math.floor(rawMin / step) * step;
        var max = Math.ceil(rawMax / step) * step;
        if (Math.abs(max - min) < step * .5) { min -= step; max += step; }
        return { min: min, max: max, step: step };
      });
    }

    function niceTrajectoryStep(span, targetTicks) {
      var rough = Math.max(span, 1e-9) / Math.max(2, targetTicks || 4);
      var power = Math.pow(10, Math.floor(Math.log(rough) / Math.LN10));
      var fraction = rough / power;
      var nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
      return nice * power;
    }

    function projectInteractive3d(point, center, scale, canvas) {
      var x = point[0] - center[0], y = point[1] - center[1], z = point[2] - center[2];
      var cy = Math.cos(videoState.view3d.yaw), sy = Math.sin(videoState.view3d.yaw);
      var cp = Math.cos(videoState.view3d.pitch), sp = Math.sin(videoState.view3d.pitch);
      var horizontal = cy * x - sy * y;
      var depth = sy * x + cy * y;
      var vertical = cp * z - sp * depth;
      return [canvas.width / 2 + horizontal * scale, canvas.height / 2 - vertical * scale];
    }

    function drawInteractive3dReference(ctx, canvas, ranges, center, scale, unit) {
      var x = ranges[0], y = ranges[1], z = ranges[2];
      var corners = [
        [x.min,y.min,z.min], [x.max,y.min,z.min], [x.max,y.max,z.min], [x.min,y.max,z.min],
        [x.min,y.min,z.max], [x.max,y.min,z.max], [x.max,y.max,z.max], [x.min,y.max,z.max]
      ];
      var edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
      var positiveZView = videoState.view3d.pitch <= 0;
      var plane = [[x.min,y.min,0],[x.max,y.min,0],[x.max,y.max,0],[x.min,y.max,0]].map(function (point) {
        return projectInteractive3d(point, center, scale, canvas);
      });

      ctx.save();
      ctx.beginPath();
      plane.forEach(function (point, index) { if (!index) ctx.moveTo(point[0], point[1]); else ctx.lineTo(point[0], point[1]); });
      ctx.closePath();
      ctx.fillStyle = positiveZView ? 'rgba(107,114,128,.12)' : 'rgba(17,24,39,.30)';
      ctx.strokeStyle = positiveZView ? '#9ca3af' : '#111827';
      ctx.lineWidth = 1.4;
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#d9e1ec'; ctx.lineWidth = 1;
      trajectoryTicks(x).forEach(function (value) {
        drawTrajectorySegment(ctx, canvas, [value,y.min,z.min], [value,y.max,z.min], center, scale);
      });
      trajectoryTicks(y).forEach(function (value) {
        drawTrajectorySegment(ctx, canvas, [x.min,value,z.min], [x.max,value,z.min], center, scale);
      });
      ctx.strokeStyle = '#bdc9d8';
      edges.forEach(function (edge) { drawTrajectorySegment(ctx, canvas, corners[edge[0]], corners[edge[1]], center, scale); });
      ctx.restore();

      drawTrajectoryAxis(ctx, canvas, 'X', '#dc2626', 0, x, ranges, center, scale);
      drawTrajectoryAxis(ctx, canvas, 'Y', '#16835e', 1, y, ranges, center, scale);
      drawTrajectoryAxis(ctx, canvas, 'Z', '#2563dc', 2, z, ranges, center, scale);

      var origin = projectInteractive3d([0,0,0], center, scale, canvas);
      ctx.fillStyle = '#263650'; ctx.font = '700 11px Arial';
      ctx.fillText('O (0,0,0)', origin[0] + 6, origin[1] - 7);
      ctx.fillStyle = positiveZView ? '#6b7280' : '#111827';
      ctx.font = '700 11px Arial';
      ctx.fillText('XY 평면 · ' + (positiveZView ? '+Z에서 봄 (회색)' : '-Z에서 봄 (검정)'), 14, 48);
    }

    function trajectoryTicks(range) {
      var ticks = [];
      var start = Math.ceil((range.min - range.step * .001) / range.step) * range.step;
      for (var value = start, guard = 0; value <= range.max + range.step * .001 && guard < 12; value += range.step, guard += 1) {
        ticks.push(Math.abs(value) < range.step * 1e-8 ? 0 : value);
      }
      return ticks;
    }

    function drawTrajectorySegment(ctx, canvas, start, end, center, scale) {
      var a = projectInteractive3d(start, center, scale, canvas);
      var b = projectInteractive3d(end, center, scale, canvas);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }

    function drawTrajectoryAxis(ctx, canvas, label, color, axis, range, ranges, center, scale) {
      var start = [0,0,0], end = [0,0,0];
      start[axis] = range.min; end[axis] = range.max;
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = 2.25;
      drawTrajectorySegment(ctx, canvas, start, end, center, scale);
      var axisEnd = projectInteractive3d(end, center, scale, canvas);
      ctx.fillStyle = color; ctx.font = '800 13px Arial';
      ctx.fillText(label, axisEnd[0] + 7, axisEnd[1] - 7);
      ctx.font = '10px Arial';
      trajectoryTicks(range).forEach(function (value) {
        var point = [0,0,0]; point[axis] = value;
        var screen = projectInteractive3d(point, center, scale, canvas);
        ctx.beginPath(); ctx.arc(screen[0], screen[1], 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#53637a';
        ctx.fillText(formatVideoNumber(value, 2), screen[0] + 4, screen[1] + 12);
        ctx.fillStyle = color;
      });
      ctx.restore();
    }

    function drawTrajectoryCoordinateLabel(ctx, canvas, screen, point, label, color, direction) {
      if (!screen || !point) return;
      var text = label + ' (' + point.map(function (value) { return formatVideoNumber(value, 3); }).join(', ') + ')';
      ctx.save(); ctx.font = '700 12px Arial';
      var width = ctx.measureText(text).width + 14;
      var x = clampNumber(screen[0] + 10, 6, canvas.width - width - 6);
      var y = clampNumber(screen[1] + (direction < 0 ? -30 : 12), 50, canvas.height - 28);
      ctx.fillStyle = 'rgba(255,255,255,.94)'; ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(x, y, width, 22, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = color; ctx.fillText(text, x + 7, y + 15); ctx.restore();
    }

    function drawTrajectoryRangeSummary(ctx, canvas, ranges, unit) {
      var text = ['X','Y','Z'].map(function (label, axis) {
        return label + ' ' + formatVideoNumber(ranges[axis].min, 2) + ' ~ ' + formatVideoNumber(ranges[axis].max, 2);
      }).join('   ·   ') + ' ' + unit;
      ctx.save(); ctx.font = '11px Arial';
      var width = Math.min(canvas.width - 24, ctx.measureText(text).width + 16);
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(12, canvas.height - 25, width, 19);
      ctx.fillStyle = '#5d6d83'; ctx.fillText(text, 20, canvas.height - 11); ctx.restore();
    }

    function drawPositionChart(rows, unit) {
      var canvas = id('videoPositionChart');
      var ctx = canvas.getContext('2d');
      clearChart(ctx, canvas, '위치 (' + unit + ')');
      var times = rows.map(function (row) { return row.time; });
      var displayPoints = rows.map(transformedResultPoint);
      var geometry = drawSeriesChart(ctx, canvas, times, [
        { name: 'X', color: '#dc2626', values: displayPoints.map(function (point) { return point[0]; }) },
        { name: 'Y', color: '#16835e', values: displayPoints.map(function (point) { return point[1]; }) },
        { name: 'Z', color: '#2563dc', values: displayPoints.map(function (point) { return point[2]; }) }
      ]);
      if (geometry && videoState.positionHoverIndex != null) drawPositionHover(ctx, rows, geometry);
    }

    function drawKinematicsChart(rows, unit) {
      var canvas = id('videoKinematicsChart');
      var ctx = canvas.getContext('2d');
      clearChart(ctx, canvas, '속도·가속도 (' + unit + '/s, ' + unit + '/s²)');
      var times = rows.map(function (row) { return row.time; });
      drawSeriesChart(ctx, canvas, times, [
        { name: '속도', color: '#d97706', values: rows.map(function (row) { return row.speed; }) },
        { name: '가속도', color: '#7c3aed', values: rows.map(function (row) { return row.acceleration; }) }
      ]);
    }

    function bindInteractiveCharts() {
      var trajectory = id('videoTrajectoryChart');
      trajectory.addEventListener('pointerdown', function (event) {
        var point = trajectoryCanvasPoint(trajectory, event);
        var gizmo = videoState.transformGizmo;
        var handle = null;
        if (videoState.coordinateEditEnabled && gizmo) {
          if (Math.hypot(point.x-gizmo.origin[0],point.y-gizmo.origin[1]) <= 18) handle = 'origin';
          else if (Math.hypot(point.x-gizmo.xEnd[0],point.y-gizmo.xEnd[1]) <= 19) handle = 'x';
          else if (Math.hypot(point.x-gizmo.yEnd[0],point.y-gizmo.yEnd[1]) <= 19) handle = 'y';
        }
        if (handle) {
          videoState.coordinateDrag = {
            kind: handle, startX: point.x, startY: point.y, length: gizmo.length, scale: gizmo.scale,
            transform: cloneResultTransform(videoState.resultTransform)
          };
        } else {
          videoState.view3d.dragging = true;
          videoState.view3d.lastX = event.clientX;
          videoState.view3d.lastY = event.clientY;
        }
        if (trajectory.setPointerCapture) trajectory.setPointerCapture(event.pointerId);
      });
      trajectory.addEventListener('pointermove', function (event) {
        if (videoState.coordinateDrag) {
          var point = trajectoryCanvasPoint(trajectory, event);
          updateCoordinateDrag(point.x-videoState.coordinateDrag.startX, point.y-videoState.coordinateDrag.startY);
          if (anyVideoResults()) drawTrajectoryChart(null, id('videoUnitName').value.trim() || '단위');
          return;
        }
        if (!videoState.view3d.dragging) return;
        videoState.view3d.yaw += (event.clientX - videoState.view3d.lastX) * .012;
        videoState.view3d.pitch = clampNumber(videoState.view3d.pitch + (event.clientY - videoState.view3d.lastY) * .012, -1.45, 1.45);
        videoState.view3d.lastX = event.clientX;
        videoState.view3d.lastY = event.clientY;
        if (anyVideoResults()) drawTrajectoryChart(null, id('videoUnitName').value.trim() || '단위');
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (eventName) {
        trajectory.addEventListener(eventName, function () {
          var edited = Boolean(videoState.coordinateDrag);
          videoState.coordinateDrag = null;
          videoState.view3d.dragging = false;
          if (edited && anyVideoResults()) { updateCoordinateTransformStatus(); renderVideoResults(); }
        });
      });
      trajectory.addEventListener('wheel', function (event) {
        event.preventDefault();
        videoState.view3d.zoom = clampNumber(videoState.view3d.zoom * (event.deltaY < 0 ? 1.12 : .89), .45, 4);
        if (anyVideoResults()) drawTrajectoryChart(null, id('videoUnitName').value.trim() || '단위');
      }, { passive: false });
      id('videoReset3dView').addEventListener('click', function () {
        applyVideo3dView(-2.42, -.48, 1);
      });
      id('videoViewFront').addEventListener('click', function () { applyVideo3dView(0, 0, 1); });
      id('videoViewSide').addEventListener('click', function () { applyVideo3dView(-Math.PI / 2, 0, 1); });
      id('videoViewTop').addEventListener('click', function () { applyVideo3dView(0, -1.45, 1); });

      var positionCanvas = id('videoPositionChart');
      positionCanvas.addEventListener('pointermove', handlePositionChartHover);
      positionCanvas.addEventListener('pointerleave', function () {
        videoState.positionHoverIndex = null;
        id('videoPositionTooltip').classList.remove('visible');
        if (videoState.results.length) drawPositionChart(videoState.results, id('videoUnitName').value.trim() || '단위');
      });
    }

    function trajectoryCanvasPoint(canvas, event) {
      var rect = canvas.getBoundingClientRect();
      return { x:(event.clientX-rect.left)*canvas.width/rect.width, y:(event.clientY-rect.top)*canvas.height/rect.height };
    }

    function cloneResultTransform(transform) {
      return { origin:transform.origin.slice(), xAxis:transform.xAxis.slice(), yAxis:transform.yAxis.slice(), zAxis:transform.zAxis.slice() };
    }

    function updateCoordinateDrag(screenDx, screenDy) {
      var drag = videoState.coordinateDrag;
      if (!drag) return;
      var base = drag.transform;
      var cy=Math.cos(videoState.view3d.yaw), sy=Math.sin(videoState.view3d.yaw), cp=Math.cos(videoState.view3d.pitch), sp=Math.sin(videoState.view3d.pitch);
      var horizontal=[cy,-sy,0];
      var vertical=[-sp*sy,-sp*cy,cp];
      var localDelta=[0,1,2].map(function (axis) { return horizontal[axis]*screenDx/drag.scale + vertical[axis]*(-screenDy/drag.scale); });
      if (drag.kind==='origin') {
        var worldDelta=localDirectionToWorld(localDelta,base);
        videoState.resultTransform.origin=base.origin.map(function (value,axis) { return value+worldDelta[axis]; });
        return;
      }
      if (drag.kind==='x') {
        var xCandidate=normalizeVector3(localDirectionToWorld([drag.length+localDelta[0],localDelta[1],localDelta[2]],base),base.xAxis);
        var zFromX=normalizeVector3(crossVector3(xCandidate,base.yAxis),base.zAxis);
        var yFromX=normalizeVector3(crossVector3(zFromX,xCandidate),base.yAxis);
        videoState.resultTransform={origin:base.origin.slice(),xAxis:xCandidate,yAxis:yFromX,zAxis:zFromX};
        return;
      }
      var yCandidateWorld=localDirectionToWorld([localDelta[0],drag.length+localDelta[1],localDelta[2]],base);
      var xFixed=base.xAxis.slice();
      var projection=dotVector3(yCandidateWorld,xFixed);
      var yOrthogonal=normalizeVector3(yCandidateWorld.map(function (value,axis) { return value-projection*xFixed[axis]; }),base.yAxis);
      var zFromY=normalizeVector3(crossVector3(xFixed,yOrthogonal),base.zAxis);
      videoState.resultTransform={origin:base.origin.slice(),xAxis:xFixed,yAxis:yOrthogonal,zAxis:zFromY};
    }

    function applyVideo3dView(yaw, pitch, zoom) {
      videoState.view3d.yaw = yaw;
      videoState.view3d.pitch = pitch;
      videoState.view3d.zoom = zoom;
      if (anyVideoResults()) drawTrajectoryChart(null, id('videoUnitName').value.trim() || '단위');
    }

    function handlePositionChartHover(event) {
      if (!videoState.results.length) return;
      var canvas = id('videoPositionChart');
      var rect = canvas.getBoundingClientRect();
      var canvasX = (event.clientX - rect.left) * canvas.width / rect.width;
      var box = chartBox(canvas);
      var ratio = clampNumber((canvasX - box.left) / (box.right - box.left), 0, 1);
      var firstTime = videoState.results[0].time;
      var lastTime = videoState.results[videoState.results.length - 1].time;
      var targetTime = firstTime + ratio * (lastTime - firstTime);
      var nearestIndex = 0;
      videoState.results.forEach(function (row, index) {
        if (Math.abs(row.time - targetTime) < Math.abs(videoState.results[nearestIndex].time - targetTime)) nearestIndex = index;
      });
      videoState.positionHoverIndex = nearestIndex;
      drawPositionChart(videoState.results, id('videoUnitName').value.trim() || '단위');

      var row = videoState.results[nearestIndex];
      var displayPoint = transformedResultPoint(row);
      var tooltip = id('videoPositionTooltip');
      tooltip.innerHTML = '<strong>' + activeVideoTarget().name + ' · ' + row.time.toFixed(4) + '초 · ' + row.frame + '프레임</strong><br>X: ' + displayPoint[0].toFixed(5) + '<br>Y: ' + displayPoint[1].toFixed(5) + '<br>Z: ' + displayPoint[2].toFixed(5);
      var wrapRect = id('videoPositionChartWrap').getBoundingClientRect();
      var left = clampNumber(event.clientX - wrapRect.left + 12, 4, Math.max(4, wrapRect.width - 168));
      var top = clampNumber(event.clientY - wrapRect.top - 88, 4, Math.max(4, wrapRect.height - 112));
      tooltip.style.left = left + 'px';
      tooltip.style.top = top + 'px';
      tooltip.classList.add('visible');
    }

    function drawPositionHover(ctx, rows, geometry) {
      var index = clampNumber(videoState.positionHoverIndex, 0, rows.length - 1);
      var row = rows[index];
      var displayPoint = transformedResultPoint(row);
      var x = geometry.box.left + (row.time - geometry.minX) / (geometry.maxX - geometry.minX) * (geometry.box.right - geometry.box.left);
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, geometry.box.top); ctx.lineTo(x, geometry.box.bottom); ctx.stroke();
      ctx.setLineDash([]);
      [
        { value: displayPoint[0], color: '#dc2626' },
        { value: displayPoint[1], color: '#16835e' },
        { value: displayPoint[2], color: '#2563dc' }
      ].forEach(function (item) {
        var y = geometry.box.bottom - (item.value - geometry.minY) / (geometry.maxY - geometry.minY) * (geometry.box.bottom - geometry.box.top);
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = item.color; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      });
      ctx.restore();
    }

    function clearChart(ctx, canvas, label) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fbfcfe'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#617087'; ctx.font = '14px Arial'; ctx.fillText(label, 18, 24);
    }

    function chartBox(canvas) { return { left: 58, right: canvas.width - 22, top: 44, bottom: canvas.height - 44 }; }

    function drawSeriesChart(ctx, canvas, times, series) {
      if (!times.length) return null;
      var box = chartBox(canvas);
      var allValues = [].concat.apply([], series.map(function (item) { return item.values; }));
      var minX = Math.min.apply(null, times), maxX = Math.max.apply(null, times);
      var minY = Math.min.apply(null, allValues), maxY = Math.max.apply(null, allValues);
      if (Math.abs(maxX - minX) < 1e-12) maxX = minX + 1;
      if (Math.abs(maxY - minY) < 1e-12) { minY -= 1; maxY += 1; }
      var padY = (maxY - minY) * .08; minY -= padY; maxY += padY;
      drawAxes(ctx, box, minX, maxX, minY, maxY);
      series.forEach(function (item) {
        ctx.beginPath();
        item.values.forEach(function (value, index) {
          var x = box.left + (times[index] - minX) / (maxX - minX) * (box.right - box.left);
          var y = box.bottom - (value - minY) / (maxY - minY) * (box.bottom - box.top);
          if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = item.color; ctx.lineWidth = 2.5; ctx.stroke();
      });
      drawChartLegend(ctx, series.map(function (item) { return [item.name, item.color]; }));
      return { box: box, minX: minX, maxX: maxX, minY: minY, maxY: maxY };
    }

    function drawAxes(ctx, box, minX, maxX, minY, maxY) {
      ctx.strokeStyle = '#d7dfeb'; ctx.lineWidth = 1; ctx.fillStyle = '#718096'; ctx.font = '12px Arial';
      for (var i = 0; i <= 4; i += 1) {
        var y = box.top + (box.bottom - box.top) * i / 4;
        ctx.beginPath(); ctx.moveTo(box.left, y); ctx.lineTo(box.right, y); ctx.stroke();
        var value = maxY - (maxY - minY) * i / 4;
        ctx.fillText(formatVideoNumber(value, 2), 5, y + 4);
      }
      ctx.fillText(formatVideoNumber(minX, 2) + 's', box.left, box.bottom + 24);
      ctx.textAlign = 'right'; ctx.fillText(formatVideoNumber(maxX, 2) + 's', box.right, box.bottom + 24); ctx.textAlign = 'left';
    }

    function drawNormalizedPath(ctx, canvas, points, color) {
      if (!points.length) return;
      var box = chartBox(canvas);
      var xs = points.map(function (p) { return p[0]; }), ys = points.map(function (p) { return p[1]; });
      var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
      if (maxX - minX < 1e-9) { minX -= 1; maxX += 1; }
      if (maxY - minY < 1e-9) { minY -= 1; maxY += 1; }
      var scale = Math.min((box.right - box.left) / (maxX - minX), (box.bottom - box.top) / (maxY - minY)) * .86;
      var centerX = (box.left + box.right) / 2, centerY = (box.top + box.bottom) / 2;
      var dataCenterX = (minX + maxX) / 2, dataCenterY = (minY + maxY) / 2;
      points.forEach(function (p) { p._screen = [centerX + (p[0] - dataCenterX) * scale, centerY - (p[1] - dataCenterY) * scale]; });
      ctx.beginPath();
      points.forEach(function (p, index) { if (!index) ctx.moveTo(p._screen[0], p._screen[1]); else ctx.lineTo(p._screen[0], p._screen[1]); });
      ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke();
    }

    function drawEndpoint(ctx, canvas, points, index, color) {
      if (!points[index]) return;
      var p = points[index]._screen || points[index];
      ctx.beginPath(); ctx.arc(p[0], p[1], 6, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    }

    function drawChartLegend(ctx, items) {
      var x = 18, y = 42;
      ctx.font = '12px Arial';
      items.forEach(function (item) {
        ctx.fillStyle = item[1]; ctx.fillRect(x, y - 8, 14, 3); ctx.fillStyle = '#526079'; ctx.fillText(item[0], x + 20, y); x += ctx.measureText(item[0]).width + 50;
      });
    }

    function downloadMotionCsv() {
      if (!anyVideoResults()) return;
      var unit = id('videoUnitName').value.trim() || 'unit';
      var header = ['object','frame','time_s','world_x','world_y','world_z','display_x','display_y','display_z','display_vx','display_vy','display_vz','speed_' + unit + '_s','acceleration_' + unit + '_s2','distance_' + unit,'ray_gap','reprojection_px','ray_angle_deg','confidence','camera_a_u','camera_a_v','camera_b_u','camera_b_v'];
      var lines = [header.join(',')];
      Object.keys(videoState.targets).forEach(function (key) {
        var target = videoState.targets[key];
        target.results.forEach(function (row) {
          var displayPoint = transformedResultPoint(row);
          var displayVelocity = applyResultCoordinateTransform(row.velocity, true);
          lines.push([
            target.name, row.frame, row.time, row.point[0], row.point[1], row.point[2], displayPoint[0], displayPoint[1], displayPoint[2], displayVelocity[0], displayVelocity[1], displayVelocity[2], row.speed, row.acceleration, row.distance, row.rayGap, row.reprojection, row.angle, row.confidence, row.pixelA[0], row.pixelA[1], row.pixelB[0], row.pixelB[1]
          ].join(','));
        });
      });
      var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url; link.download = 'stereo_motion_' + Date.now() + '.csv'; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }
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

    function showVideoMessage(message, isError) {
      var toast = id('toast');
      if (!toast) return;
      clearTimeout(videoToastTimer);
      toast.textContent = message;
      toast.classList.toggle('error', Boolean(isError));
      toast.classList.add('visible');
      videoToastTimer = setTimeout(function () { toast.classList.remove('visible'); }, 4200);
    }

    function formatBytesVideo(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    function formatVideoNumber(value, digits) {
      if (!Number.isFinite(value)) return '-';
      return Number(value).toFixed(digits).replace(/\.?0+$/, '');
    }

    if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
      window.__videoAnalyzerTest = {
        seedCalibration: function (pixels) {
          videoState.rows.slice(0, pixels.A.length).forEach(function (row, index) {
            row.pixelA = { x: pixels.A[index][0], y: pixels.A[index][1] };
            row.pixelB = { x: pixels.B[index][0], y: pixels.B[index][1] };
          });
          renderVideoCalibrationTable();
          calculateVideoCalibration();
          return Boolean(videoState.models);
        },
        seedTarget: async function (frame, pixelA, pixelB) {
          await goToVideoFrame(frame);
          videoState.mode = 'tracking';
          videoState.trackingMode = 'color';
          videoState.tracks.A[frame] = { x: pixelA[0], y: pixelA[1], confidence: 1, manual: true };
          videoState.tracks.B[frame] = { x: pixelB[0], y: pixelB[1], confidence: 1, manual: true };
          videoState.colors.A = sampleTargetColor('A', videoState.tracks.A[frame]);
          videoState.colors.B = sampleTargetColor('B', videoState.tracks.B[frame]);
          setVideoTrackingMode('color');
          drawVideoOverlay('A');
          drawVideoOverlay('B');
        },
        runColorTracking: runColorTracking,
        summary: function () {
          var rows = videoState.results;
          return {
            calibrated: Boolean(videoState.models),
            calibrationRmsA: videoState.models ? videoState.models.A.rms : null,
            calibrationRmsB: videoState.models ? videoState.models.B.rms : null,
            trackedA: Object.keys(videoState.tracks.A).length,
            trackedB: Object.keys(videoState.tracks.B).length,
            resultCount: rows.length,
            first: rows.length ? rows[0].point.slice() : null,
            middle: rows.length ? rows[Math.floor(rows.length / 2)].point.slice() : null,
            last: rows.length ? rows[rows.length - 1].point.slice() : null,
            maxRayGap: rows.length ? Math.max.apply(null, rows.map(function (row) { return row.rayGap; })) : null
          };
        }
      };
    }

    function clampNumber(value, min, max) { return Math.min(max, Math.max(min, value)); }
    function vectorNorm(vector) { return Math.sqrt(vector.reduce(function (sum, value) { return sum + value * value; }, 0)); }
    function vectorDistanceLocal(a, b) { return Math.sqrt(a.reduce(function (sum, value, index) { var d = value - b[index]; return sum + d * d; }, 0)); }
  })();
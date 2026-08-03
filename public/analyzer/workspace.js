(function () {
  'use strict';

  var icons = {
    files: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 7h6l2 2h8v10H4z" stroke-width="1.8"/><path d="M4 7V5h6l2 2" stroke-width="1.8"/></svg>',
    calibrate: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="7" stroke-width="1.8"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5" stroke-width="1.8"/></svg>',
    track: '<svg viewBox="0 0 24 24" fill="none"><path d="M3 18c4-9 8-2 11-9 2-4 4-4 7-3" stroke-width="1.8"/><circle cx="5" cy="16" r="2" stroke-width="1.8"/><circle cx="14" cy="9" r="2" stroke-width="1.8"/><circle cx="20" cy="6" r="2" stroke-width="1.8"/></svg>',
    results: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 19V5M4 19h16" stroke-width="1.8"/><path d="M7 15l4-5 3 2 5-7" stroke-width="1.8"/></svg>'
  };

  function make(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html != null) node.innerHTML = html;
    return node;
  }

  function toolButton(key, label, mode) {
    var button = make('button', 'workspace-tool ' + mode + '-only', icons[key] + '<span>' + label + '</span>');
    button.type = 'button';
    button.dataset.panel = key;
    button.setAttribute('aria-label', label);
    return button;
  }

  function installChartFullscreen(resultsBlock) {
    var charts = Array.prototype.slice.call(resultsBlock.querySelectorAll('.motion-chart'));
    charts.forEach(function (chart) {
      var head = chart.querySelector('.motion-chart-head');
      if (!head || head.querySelector('.chart-fullscreen-button')) return;
      var controls = head.querySelector('.view-buttons');
      if (!controls) {
        controls = make('div', 'view-buttons');
        head.appendChild(controls);
      }
      var button = make('button', 'secondary chart-fullscreen-button', '전체화면');
      button.type = 'button';
      controls.appendChild(button);

      function pseudoActive() { return chart.classList.contains('chart-pseudo-fullscreen'); }
      function syncButton() {
        var active = document.fullscreenElement === chart || pseudoActive();
        button.textContent = active ? '전체화면 닫기' : '전체화면';
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      }

      button.addEventListener('click', function () {
        if (document.fullscreenElement === chart) {
          document.exitFullscreen();
        } else if (pseudoActive()) {
          chart.classList.remove('chart-pseudo-fullscreen');
          document.body.classList.remove('chart-fullscreen-open');
          syncButton();
        } else if (chart.requestFullscreen) {
          var request = chart.requestFullscreen();
          if (request && request.catch) {
            request.catch(function () {
              chart.classList.add('chart-pseudo-fullscreen');
              document.body.classList.add('chart-fullscreen-open');
              syncButton();
            });
          }
        } else {
          chart.classList.add('chart-pseudo-fullscreen');
          document.body.classList.add('chart-fullscreen-open');
          syncButton();
        }
      });
      document.addEventListener('fullscreenchange', syncButton);
      syncButton();
    });
  }

  function initWorkspace() {
    var shell = document.querySelector('main.shell');
    var nav = document.getElementById('appModeNav');
    var videoWorkflow = document.getElementById('videoWorkflow');
    if (!shell || !nav || !videoWorkflow) return;

    var params = new URLSearchParams(window.location.search);
    var roomCode = (params.get('room') || '').toUpperCase();
    var topbar = make('header', 'workspace-topbar');
    topbar.innerHTML = '<a class="workspace-brand" href="/" target="_top"><span class="workspace-brand-mark" aria-hidden="true"></span><span>3D Motion Lab</span></a>';
    topbar.appendChild(nav);
    var room = make('span', 'workspace-room', roomCode ? 'Firebase 방 · ' + roomCode : '독립 분석 모드');
    topbar.appendChild(room);
    shell.insertBefore(topbar, shell.firstChild);

    var mediaBlock = document.getElementById('videoFileA').closest('.video-block');
    var calibrationBlock = document.getElementById('videoCalibrate').closest('.video-block');
    var trackingBlock = document.getElementById('videoAutoTrack').closest('.video-block');
    var resultsBlock = document.getElementById('videoResults');
    var videoGrid = mediaBlock.querySelector('.video-grid');
    var timeline = mediaBlock.querySelector('.video-timeline');
    var guide = videoWorkflow.querySelector('.video-guide');
    installChartFullscreen(resultsBlock);

    var layout = make('div', 'workspace-layout');
    var toolbar = make('nav', 'workspace-toolbar');
    toolbar.setAttribute('aria-label', '분석 도구');
    [['files', '영상 열기'], ['calibrate', '좌표 보정'], ['track', '목표 추적'], ['results', '결과 보기']].forEach(function (item) {
      toolbar.appendChild(toolButton(item[0], item[1], 'video'));
    });

    var main = make('section', 'workspace-main');
    var viewer = make('div', 'workspace-viewer');
    var timelineWrap = make('div', 'workspace-timeline');
    viewer.appendChild(videoGrid);
    timelineWrap.appendChild(timeline);
    main.appendChild(viewer);
    main.appendChild(timelineWrap);
    guide.classList.add('workspace-guide');
    main.appendChild(guide);

    var dock = make('aside', 'workspace-dock');
    var panels = {
      files: make('div', 'workspace-dock-panel'),
      calibrate: make('div', 'workspace-dock-panel'),
      track: make('div', 'workspace-dock-panel'),
      results: make('div', 'workspace-dock-panel')
    };
    panels.files.appendChild(mediaBlock);
    panels.calibrate.appendChild(calibrationBlock);
    panels.track.appendChild(trackingBlock);
    panels.results.appendChild(resultsBlock);
    Object.keys(panels).forEach(function (key) { panels[key].dataset.panel = key; dock.appendChild(panels[key]); });

    var emptyResults = make('div', 'workspace-empty-results', '<div><strong>아직 계산된 궤적이 없습니다.</strong><p>좌표 보정과 목표 추적을 마치면<br>3차원 궤적·그래프·표가 이곳에 나타납니다.</p></div>');
    panels.results.insertBefore(emptyResults, resultsBlock);
    function syncEmptyResults() { emptyResults.hidden = !resultsBlock.hidden; }
    new MutationObserver(syncEmptyResults).observe(resultsBlock, { attributes: true, attributeFilter: ['hidden'] });
    syncEmptyResults();

    layout.appendChild(toolbar);
    layout.appendChild(main);
    layout.appendChild(dock);
    videoWorkflow.appendChild(layout);

    var photoWorkflow = document.getElementById('photoWorkflow');
    var photoSections = photoWorkflow ? Array.prototype.slice.call(photoWorkflow.querySelectorAll(':scope > section.section')) : [];
    if (photoWorkflow && photoSections.length >= 3) {
      var photoLayout = make('div', 'workspace-layout photo-workspace-layout');
      var photoToolbar = make('nav', 'workspace-toolbar');
      photoToolbar.setAttribute('aria-label', '사진 분석 도구');
      [['files', '사진 열기'], ['calibrate', '좌표 보정'], ['results', '좌표 결과']].forEach(function (item) {
        photoToolbar.appendChild(toolButton(item[0], item[1], 'photo'));
      });
      var photoMain = make('section', 'workspace-main photo-workspace-main');
      var photoViewer = make('div', 'workspace-viewer photo-workspace-viewer');
      var photoGrid = photoSections[0].querySelector('.photo-grid');
      var photoGuide = document.getElementById('captureGuide');
      photoViewer.appendChild(photoGrid);
      photoMain.appendChild(photoViewer);
      if (photoGuide) { photoGuide.classList.add('workspace-guide', 'photo-workspace-guide'); photoMain.appendChild(photoGuide); }

      var photoDock = make('aside', 'workspace-dock');
      var photoPanels = {
        files: make('div', 'workspace-dock-panel'),
        calibrate: make('div', 'workspace-dock-panel'),
        results: make('div', 'workspace-dock-panel')
      };
      photoPanels.files.appendChild(photoSections[0]);
      photoPanels.calibrate.appendChild(photoSections[1]);
      photoPanels.results.appendChild(photoSections[2]);
      Object.keys(photoPanels).forEach(function (key) { photoPanels[key].dataset.panel = key; photoDock.appendChild(photoPanels[key]); });
      photoLayout.appendChild(photoToolbar);
      photoLayout.appendChild(photoMain);
      photoLayout.appendChild(photoDock);
      photoWorkflow.appendChild(photoLayout);

      var photoIntro = make('div', 'workspace-photo-intro', '<strong>사진 분석 순서</strong><p>좌우 사진을 연 뒤 좌표 보정에서 같은 기준점을 찍고, 마지막으로 목표점의 3차원 좌표를 계산합니다.</p>');
      photoPanels.files.insertBefore(photoIntro, photoSections[0]);
      var uploadButton = document.getElementById('uploadButton');
      if (uploadButton) uploadButton.closest('.actions').style.display = 'none';

      function showPhotoPanel(key) {
        Object.keys(photoPanels).forEach(function (name) { photoPanels[name].classList.toggle('active', name === key); });
        Array.prototype.forEach.call(photoToolbar.querySelectorAll('.workspace-tool'), function (button) {
          button.classList.toggle('active', button.dataset.panel === key);
        });
      }
      photoToolbar.addEventListener('click', function (event) {
        var button = event.target.closest('[data-panel]');
        if (button) showPhotoPanel(button.dataset.panel);
      });
      showPhotoPanel('files');
      document.getElementById('calibrateButton').addEventListener('click', function () {
        window.setTimeout(function () { if (!document.getElementById('targetModeButton').disabled) showPhotoPanel('results'); }, 120);
      });
    }

    function showPanel(key) {
      Object.keys(panels).forEach(function (name) { panels[name].classList.toggle('active', name === key); });
      Array.prototype.forEach.call(toolbar.querySelectorAll('.workspace-tool'), function (button) {
        button.classList.toggle('active', button.dataset.panel === key);
      });
    }

    toolbar.addEventListener('click', function (event) {
      var button = event.target.closest('[data-panel]');
      if (button) showPanel(button.dataset.panel);
    });
    showPanel('files');

    window.__motionWorkspaceSetMode = function (mode) {
      document.body.classList.toggle('photo-mode', mode === 'photo');
    };
    window.__motionWorkspaceSetMode('video');

    document.getElementById('videoCalibrate').addEventListener('click', function () {
      window.setTimeout(function () {
        if (!document.getElementById('videoCalibrate').disabled) return;
        showPanel('track');
      }, 120);
    });
    document.getElementById('videoRecalculate').addEventListener('click', function () { window.setTimeout(function () { showPanel('results'); }, 80); });

    var videoSave = document.getElementById('videoSaveDrive');
    if (videoSave) videoSave.textContent = '분석 결과를 Firebase 방에 저장';
    var videoStatus = document.getElementById('videoSaveStatus');
    if (videoStatus) videoStatus.textContent = roomCode ? '영상 파일은 올리지 않고 분석 숫자만 이 방에 저장합니다.' : '방 연결 없이 CSV 내려받기를 사용할 수 있습니다.';
    var photoSave = document.getElementById('saveResultButton');
    if (photoSave) photoSave.textContent = '측정 결과를 Firebase 방에 저장';

    window.addEventListener('message', function (event) {
      if (event.origin !== window.location.origin || !event.data || event.data.type !== 'MOTION_LAB_SAVE_RESULT') return;
      var message = event.data.ok ? 'Firebase 저장 완료 · ' + event.data.id : (event.data.message || 'Firebase 저장 실패');
      if (videoStatus) videoStatus.textContent = message;
      var photoStatus = document.getElementById('savedResult');
      if (photoStatus) { photoStatus.textContent = message; photoStatus.classList.add('visible'); }
      var toast = document.getElementById('toast');
      if (toast) { toast.textContent = message; toast.classList.toggle('error', !event.data.ok); toast.classList.add('visible'); window.setTimeout(function () { toast.classList.remove('visible'); }, 4200); }
    });
  }

  document.addEventListener('DOMContentLoaded', initWorkspace);
})();

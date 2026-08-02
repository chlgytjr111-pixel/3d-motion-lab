(function () {
      'use strict';

      var MAX_SOURCE_BYTES = 30 * 1024 * 1024;
      var MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
      var MAX_IMAGE_EDGE = 1800;
      var JPEG_QUALITY = 0.90;

      var DEFAULT_ROWS = [
        { label: '원점 O', x: 0, y: 0, z: 0 },
        { label: 'x축 점', x: 2, y: 0, z: 0 },
        { label: 'y축 점', x: 0, y: 2, z: 0 },
        { label: 'xy 점', x: 2, y: 2, z: 0 },
        { label: 'z축 점', x: 0, y: 0, z: 2 },
        { label: 'xz 점', x: 2, y: 0, z: 2 },
        { label: 'yz 점', x: 0, y: 2, z: 2 }
      ];

      var state = {
        sessionId: createSessionId(),
        images: {
          A: emptyImageState(),
          B: emptyImageState()
        },
        rows: DEFAULT_ROWS.map(function (row, index) {
          return {
            id: 'p' + (index + 1),
            label: row.label,
            x: row.x,
            y: row.y,
            z: row.z,
            pixelA: null,
            pixelB: null
          };
        }),
        nextRowNumber: DEFAULT_ROWS.length + 1,
        selectedRowId: 'p1',
        mode: 'calibration',
        models: null,
        targetPixels: { A: null, B: null },
        result: null,
        appInfo: null
      };

      var toastTimer = null;

      document.addEventListener('DOMContentLoaded', init);

      function init() {
        bindEvents();
        drawEmptyCanvas('A');
        drawEmptyCanvas('B');
        renderCalibrationTable();
        updateModeUI();
        checkDriveConnection();

        window.__triangulationTest = function (data) {
          var pointsA = data.calibration.map(function (item) {
            return { world: item.world.slice(), pixel: item.a.slice() };
          });
          var pointsB = data.calibration.map(function (item) {
            return { world: item.world.slice(), pixel: item.b.slice() };
          });
          validateWorldGeometry(pointsA.map(function (p) { return p.world; }));
          var modelA = calibrateCamera(pointsA);
          var modelB = calibrateCamera(pointsB);
          var result = triangulateCore(modelA.P, modelB.P, data.targetA, data.targetB);
          result.onePixelSensitivity = estimateOnePixelSensitivity(
            modelA.P, modelB.P, data.targetA, data.targetB, result.point
          );
          return { cameraA: modelA, cameraB: modelB, result: result };
        };
      }

      function bindEvents() {
        byId('fileA').addEventListener('change', function (event) {
          var input = event.target;
          if (input.files[0]) {
            loadPhoto('A', input.files[0]).finally(function () { input.value = ''; });
          }
        });
        byId('fileB').addEventListener('change', function (event) {
          var input = event.target;
          if (input.files[0]) {
            loadPhoto('B', input.files[0]).finally(function () { input.value = ''; });
          }
        });
        byId('canvasA').addEventListener('pointerdown', function (event) {
          handleCanvasClick('A', event);
        });
        byId('canvasB').addEventListener('pointerdown', function (event) {
          handleCanvasClick('B', event);
        });
        byId('uploadButton').addEventListener('click', function () {
          uploadBothPhotos(false).catch(function () {
            // 사용자에게는 uploadBothPhotos 안에서 오류 내용을 이미 안내했습니다.
          });
        });
        byId('addRowButton').addEventListener('click', addCalibrationRow);
        byId('clearClicksButton').addEventListener('click', clearAllCalibrationClicks);
        byId('calibrateButton').addEventListener('click', calculateCameraModels);
        byId('calModeButton').addEventListener('click', function () { setMode('calibration'); });
        byId('targetModeButton').addEventListener('click', function () { setMode('target'); });
        byId('clearTargetButton').addEventListener('click', clearTarget);
        byId('saveResultButton').addEventListener('click', saveResult);
        byId('unitScale').addEventListener('input', function () { invalidateModels(); });
        byId('unitName').addEventListener('input', function () {
          if (state.models) state.models.unit.unit = byId('unitName').value.trim() || '단위';
          if (state.result) renderResult();
        });
      }

      function byId(id) {
        return document.getElementById(id);
      }

      function emptyImageState() {
        return {
          image: null,
          dataUrl: '',
          originalName: '',
          width: 0,
          height: 0,
          byteSize: 0,
          driveFile: null
        };
      }

      function createSessionId() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
          return window.crypto.randomUUID().replace(/-/g, '').slice(0, 16);
        }
        return String(Date.now()) + String(Math.random()).slice(2, 10);
      }

      function canCallAppsScript() {
        return typeof google !== 'undefined' &&
          google.script &&
          google.script.run;
      }

      function callServer(functionName, payload) {
        return new Promise(function (resolve, reject) {
          if (!canCallAppsScript()) {
            reject(new Error('Apps Script로 배포한 화면에서만 Drive 저장을 사용할 수 있습니다.'));
            return;
          }
          var runner = google.script.run
            .withSuccessHandler(resolve)
            .withFailureHandler(function (error) {
              reject(new Error(error && error.message ? error.message : String(error)));
            });
          if (typeof payload === 'undefined') {
            runner[functionName]();
          } else {
            runner[functionName](payload);
          }
        });
      }

      async function checkDriveConnection() {
        var box = byId('serverStatus');
        if (!canCallAppsScript()) {
          box.innerHTML = '<strong>로컬 미리보기</strong><span>계산은 가능하지만 Drive 저장은 배포 후 작동합니다.</span>';
          return;
        }
        try {
          var info = await callServer('getAppInfo');
          state.appInfo = info;
          MAX_UPLOAD_BYTES = Number(info.maxImageBytes) || MAX_UPLOAD_BYTES;
          box.innerHTML = '';
          var strong = document.createElement('strong');
          strong.textContent = 'Drive 연결됨';
          var link = document.createElement('a');
          link.href = info.folderUrl;
          link.target = '_blank';
          link.rel = 'noopener';
          link.textContent = info.folderName;
          box.appendChild(strong);
          box.appendChild(link);
        } catch (error) {
          box.innerHTML = '<strong>Drive 연결 확인 필요</strong><span></span>';
          box.querySelector('span').textContent = error.message;
        }
      }

      async function loadPhoto(side, file) {
        var allowed = /^(image\/jpeg|image\/png|image\/webp)$/i;
        if (!allowed.test(file.type || '')) {
          notify('JPG, PNG 또는 WebP 사진을 선택해 주세요. HEIC는 먼저 JPG로 변환해야 합니다.', 'error');
          return;
        }
        if (file.size > MAX_SOURCE_BYTES) {
          notify('원본 사진이 30MB를 넘습니다. 더 작은 사진을 선택해 주세요.', 'error');
          return;
        }

        setBusy(true, '사진 ' + side + ' 크기를 맞추는 중...');
        try {
          var originalDataUrl = await readFileAsDataUrl(file);
          var sourceImage = await loadImageElement(originalDataUrl);
          var converted = resizeImageToJpeg(sourceImage, MAX_IMAGE_EDGE, JPEG_QUALITY);

          if (converted.byteSize > MAX_UPLOAD_BYTES) {
            throw new Error('사진을 줄인 뒤에도 8MB를 넘습니다. 더 작은 사진을 선택해 주세요.');
          }

          var previewImage = await loadImageElement(converted.dataUrl);
          state.images[side] = {
            image: previewImage,
            dataUrl: converted.dataUrl,
            originalName: file.name,
            width: converted.width,
            height: converted.height,
            byteSize: converted.byteSize,
            driveFile: null
          };

          state.rows.forEach(function (row) { row['pixel' + side] = null; });
          state.targetPixels[side] = null;
          invalidateModels();
          byId('placeholder' + side).classList.add('hidden');
          renderCanvas(side);
          renderPhotoMeta(side);
          renderCalibrationTable();
          updateTargetStatus();
          notify('사진 ' + side + '를 불러왔습니다.', 'success');
        } catch (error) {
          notify(error.message || '사진을 읽는 중 문제가 생겼습니다.', 'error');
        } finally {
          setBusy(false);
        }
      }

      function readFileAsDataUrl(file) {
        return new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onload = function () { resolve(reader.result); };
          reader.onerror = function () { reject(new Error('사진 파일을 읽지 못했습니다.')); };
          reader.readAsDataURL(file);
        });
      }

      function loadImageElement(src) {
        return new Promise(function (resolve, reject) {
          var image = new Image();
          image.onload = function () { resolve(image); };
          image.onerror = function () { reject(new Error('사진 형식을 해석하지 못했습니다.')); };
          image.src = src;
        });
      }

      function resizeImageToJpeg(image, maxEdge, initialQuality) {
        var sourceWidth = image.naturalWidth || image.width;
        var sourceHeight = image.naturalHeight || image.height;
        if (!sourceWidth || !sourceHeight) throw new Error('사진 크기를 확인하지 못했습니다.');

        var scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
        var width = Math.max(1, Math.round(sourceWidth * scale));
        var height = Math.max(1, Math.round(sourceHeight * scale));
        var quality = initialQuality;
        var dataUrl = '';
        var byteSize = Infinity;

        for (var attempt = 0; attempt < 6; attempt += 1) {
          var canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(image, 0, 0, width, height);
          dataUrl = canvas.toDataURL('image/jpeg', quality);
          byteSize = dataUrlByteSize(dataUrl);
          if (byteSize <= MAX_UPLOAD_BYTES) break;
          width = Math.max(1, Math.round(width * 0.82));
          height = Math.max(1, Math.round(height * 0.82));
          quality = Math.max(0.68, quality - 0.05);
        }
        return { dataUrl: dataUrl, width: width, height: height, byteSize: byteSize };
      }

      function dataUrlByteSize(dataUrl) {
        var base64 = dataUrl.split(',')[1] || '';
        var padding = (base64.match(/=*$/) || [''])[0].length;
        return Math.floor(base64.length * 3 / 4) - padding;
      }

      function drawEmptyCanvas(side) {
        var canvas = byId('canvas' + side);
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f1f4f8';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      function renderCanvas(side) {
        var canvas = byId('canvas' + side);
        var photo = state.images[side];
        if (!photo.image) {
          drawEmptyCanvas(side);
          return;
        }

        if (canvas.width !== photo.width || canvas.height !== photo.height) {
          canvas.width = photo.width;
          canvas.height = photo.height;
        }
        var ctx = canvas.getContext('2d');
        ctx.drawImage(photo.image, 0, 0, photo.width, photo.height);

        var baseRadius = Math.max(5, Math.min(photo.width, photo.height) * 0.009);
        state.rows.forEach(function (row, index) {
          var point = row['pixel' + side];
          if (!point) return;
          var selected = row.id === state.selectedRowId && state.mode === 'calibration';
          drawMarker(ctx, point, String(index + 1), selected ? '#ffd84d' : '#2d73ed', baseRadius);
        });

        var target = state.targetPixels[side];
        if (target) drawTargetMarker(ctx, target, baseRadius * 1.25);
      }

      function drawMarker(ctx, point, label, color, radius) {
        ctx.save();
        ctx.lineWidth = Math.max(2, radius * 0.28);
        ctx.strokeStyle = '#ffffff';
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(point[0], point[1], radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.font = 'bold ' + Math.max(12, Math.round(radius * 1.45)) + 'px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(3, radius * 0.45);
        ctx.strokeStyle = 'rgba(0,0,0,.7)';
        ctx.strokeText(label, point[0], point[1] - radius * 1.8);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, point[0], point[1] - radius * 1.8);
        ctx.restore();
      }

      function drawTargetMarker(ctx, point, radius) {
        ctx.save();
        ctx.strokeStyle = '#ee2439';
        ctx.fillStyle = 'rgba(238,36,57,.22)';
        ctx.lineWidth = Math.max(3, radius * .35);
        ctx.beginPath();
        ctx.arc(point[0], point[1], radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(point[0] - radius * 1.5, point[1]);
        ctx.lineTo(point[0] + radius * 1.5, point[1]);
        ctx.moveTo(point[0], point[1] - radius * 1.5);
        ctx.lineTo(point[0], point[1] + radius * 1.5);
        ctx.stroke();
        ctx.restore();
      }

      function renderPhotoMeta(side) {
        var photo = state.images[side];
        var box = byId('meta' + side);
        if (!photo.image) {
          box.textContent = '아직 선택한 사진이 없습니다.';
          return;
        }
        box.innerHTML = '';
        var text = document.createElement('span');
        text.textContent = photo.originalName + ' · ' + photo.width + '×' + photo.height +
          ' · ' + formatBytes(photo.byteSize);
        box.appendChild(text);
        if (photo.driveFile) {
          box.appendChild(document.createElement('br'));
          var link = document.createElement('a');
          link.className = 'saved';
          link.href = photo.driveFile.url;
          link.target = '_blank';
          link.rel = 'noopener';
          link.textContent = 'Drive 저장됨: ' + photo.driveFile.name;
          box.appendChild(link);
        }
      }

      function formatBytes(bytes) {
        if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + 'KB';
        return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
      }

      async function uploadBothPhotos(silent) {
        if (!state.images.A.dataUrl || !state.images.B.dataUrl) {
          if (!silent) notify('사진 A와 B를 모두 선택해 주세요.', 'error');
          throw new Error('사진 A와 B가 모두 필요합니다.');
        }
        if (!canCallAppsScript()) {
          var localError = new Error('Apps Script로 배포한 화면에서만 Drive 저장을 사용할 수 있습니다.');
          if (!silent) notify(localError.message, 'error');
          throw localError;
        }

        setBusy(true, '사진을 Drive에 저장하는 중...');
        try {
          var sides = ['A', 'B'];
          for (var i = 0; i < sides.length; i += 1) {
            var side = sides[i];
            if (state.images[side].driveFile) continue;
            byId('busyText').textContent = '사진 ' + side + '를 Drive에 저장하는 중...';
            var saved = await callServer('uploadImage', {
              side: side,
              dataUrl: state.images[side].dataUrl,
              sessionId: state.sessionId
            });
            state.images[side].driveFile = saved;
            renderPhotoMeta(side);
          }
          if (!silent) notify('사진 두 장을 Drive에 저장했습니다.', 'success');
          return true;
        } catch (error) {
          if (!silent) notify(error.message, 'error');
          throw error;
        } finally {
          setBusy(false);
        }
      }

      function handleCanvasClick(side, event) {
        var photo = state.images[side];
        if (!photo.image) {
          notify('먼저 사진 ' + side + '를 선택해 주세요.', 'error');
          return;
        }
        var canvas = byId('canvas' + side);
        var rect = canvas.getBoundingClientRect();
        var x = (event.clientX - rect.left) * canvas.width / rect.width;
        var y = (event.clientY - rect.top) * canvas.height / rect.height;
        x = clamp(x, 0, canvas.width - 1);
        y = clamp(y, 0, canvas.height - 1);

        if (state.mode === 'calibration') {
          var row = getSelectedRow();
          if (!row) {
            notify('기준점 표에서 한 행을 먼저 선택해 주세요.', 'error');
            return;
          }
          row['pixel' + side] = [x, y];
          invalidateModels();
          renderCalibrationTable();
          renderCanvas('A');
          renderCanvas('B');

          if (row.pixelA && row.pixelB) {
            var next = findNextIncompleteRow(row.id);
            if (next) {
              state.selectedRowId = next.id;
              renderCalibrationTable();
              renderCanvas('A');
              renderCanvas('B');
              notify('기준점이 기록되었습니다. 다음 행을 선택했습니다.', 'success');
            } else {
              notify('현재 기준점들의 두 사진 좌표를 모두 기록했습니다.', 'success');
            }
          }
        } else {
          if (!state.models) {
            notify('먼저 카메라 보정을 계산해 주세요.', 'error');
            return;
          }
          state.targetPixels[side] = [x, y];
          renderCanvas(side);
          updateTargetStatus();
          if (state.targetPixels.A && state.targetPixels.B) calculateTargetPosition();
        }
      }

      function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
      }

      function getSelectedRow() {
        return state.rows.find(function (row) { return row.id === state.selectedRowId; }) || null;
      }

      function findNextIncompleteRow(currentId) {
        var currentIndex = state.rows.findIndex(function (row) { return row.id === currentId; });
        for (var offset = 1; offset <= state.rows.length; offset += 1) {
          var row = state.rows[(currentIndex + offset) % state.rows.length];
          if (!row.pixelA || !row.pixelB) return row;
        }
        return null;
      }

      function renderCalibrationTable() {
        var body = byId('calibrationBody');
        body.innerHTML = '';

        state.rows.forEach(function (row, index) {
          var tr = document.createElement('tr');
          if (row.id === state.selectedRowId) tr.classList.add('selected');
          if (row.pixelA && row.pixelB) tr.classList.add('complete');

          var selectorCell = document.createElement('td');
          var selector = document.createElement('button');
          selector.type = 'button';
          selector.className = 'select-row';
          selector.textContent = String(index + 1);
          selector.title = '이 기준점 선택';
          selector.addEventListener('click', function () {
            state.selectedRowId = row.id;
            setMode('calibration');
            renderCalibrationTable();
            renderCanvas('A');
            renderCanvas('B');
          });
          selectorCell.appendChild(selector);
          tr.appendChild(selectorCell);

          tr.appendChild(inputCell(row, 'label', 'text', 'label-input'));
          tr.appendChild(inputCell(row, 'x', 'number', 'coord-input'));
          tr.appendChild(inputCell(row, 'y', 'number', 'coord-input'));
          tr.appendChild(inputCell(row, 'z', 'number', 'coord-input'));

          var pixelA = document.createElement('td');
          pixelA.className = 'pixel-value';
          pixelA.textContent = formatPixel(row.pixelA);
          tr.appendChild(pixelA);
          var pixelB = document.createElement('td');
          pixelB.className = 'pixel-value';
          pixelB.textContent = formatPixel(row.pixelB);
          tr.appendChild(pixelB);

          var removeCell = document.createElement('td');
          var remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'remove-row';
          remove.textContent = '×';
          remove.title = '행 삭제';
          remove.disabled = state.rows.length <= 6;
          remove.addEventListener('click', function () { removeCalibrationRow(row.id); });
          removeCell.appendChild(remove);
          tr.appendChild(removeCell);
          body.appendChild(tr);
        });

        updateCalibrationCount();
        updateModeUI();
      }

      function inputCell(row, field, type, className) {
        var td = document.createElement('td');
        var input = document.createElement('input');
        input.type = type;
        input.className = className;
        input.value = row[field];
        if (type === 'number') input.step = 'any';
        if (field === 'label') input.maxLength = 24;
        input.addEventListener('input', function () {
          row[field] = type === 'number' ? input.value : input.value;
          invalidateModels();
          if (field === 'label') updateModeUI();
        });
        input.addEventListener('focus', function () {
          state.selectedRowId = row.id;
          Array.prototype.forEach.call(document.querySelectorAll('#calibrationBody tr'), function (item) {
            item.classList.remove('selected');
          });
          input.closest('tr').classList.add('selected');
          renderCanvas('A');
          renderCanvas('B');
          updateModeUI();
        });
        td.appendChild(input);
        return td;
      }

      function formatPixel(point) {
        if (!point) return '아직 안 찍음';
        return '(' + point[0].toFixed(1) + ', ' + point[1].toFixed(1) + ')';
      }

      function addCalibrationRow() {
        var id = 'p' + state.nextRowNumber;
        state.nextRowNumber += 1;
        state.rows.push({
          id: id,
          label: '기준점 ' + state.rows.length,
          x: 0,
          y: 0,
          z: 0,
          pixelA: null,
          pixelB: null
        });
        state.selectedRowId = id;
        setMode('calibration');
        renderCalibrationTable();
      }

      function removeCalibrationRow(id) {
        if (state.rows.length <= 6) return;
        var index = state.rows.findIndex(function (row) { return row.id === id; });
        state.rows = state.rows.filter(function (row) { return row.id !== id; });
        if (state.selectedRowId === id) {
          state.selectedRowId = state.rows[Math.max(0, index - 1)].id;
        }
        invalidateModels();
        renderCalibrationTable();
        renderCanvas('A');
        renderCanvas('B');
      }

      function clearAllCalibrationClicks() {
        state.rows.forEach(function (row) {
          row.pixelA = null;
          row.pixelB = null;
        });
        state.selectedRowId = state.rows[0].id;
        invalidateModels();
        renderCalibrationTable();
        renderCanvas('A');
        renderCanvas('B');
        notify('기준점 클릭을 모두 지웠습니다.');
      }

      function updateCalibrationCount() {
        var complete = state.rows.filter(function (row) {
          return row.pixelA && row.pixelB && validWorldFields(row);
        }).length;
        byId('calibrationCount').textContent =
          '완료된 기준점 ' + complete + '개 / 최소 6개 · 권장 8개 이상';
      }

      function validWorldFields(row) {
        return [row.x, row.y, row.z].every(function (value) {
          return value !== '' && Number.isFinite(Number(value));
        });
      }

      function setMode(mode) {
        if (mode === 'target' && !state.models) {
          notify('먼저 카메라 보정을 계산해 주세요.', 'error');
          return;
        }
        state.mode = mode;
        updateModeUI();
        renderCanvas('A');
        renderCanvas('B');
      }

      function updateModeUI() {
        var isCalibration = state.mode === 'calibration';
        var selected = getSelectedRow();
        var selectedIndex = selected
          ? state.rows.findIndex(function (row) { return row.id === selected.id; }) + 1
          : 0;
        byId('calModeButton').classList.toggle('active', isCalibration);
        byId('targetModeButton').classList.toggle('active', !isCalibration);
        byId('targetModeButton').disabled = !state.models;
        byId('modeTitle').textContent = isCalibration
          ? '현재: 기준점 ' + selectedIndex + ' · ' + (selected ? selected.label : '') + ' 찍기'
          : '현재: 빨간 목표점 찍기';
        byId('modeHint').textContent = isCalibration
          ? '표에서 기준점 행을 고른 뒤 두 사진을 클릭하세요.'
          : '같은 목표점을 사진 A와 B에서 각각 클릭하세요.';
        updateCaptureGuide();
      }

      function updateCaptureGuide() {
        var isCalibration = state.mode === 'calibration';
        var selected = getSelectedRow();
        var selectedIndex = selected
          ? state.rows.findIndex(function (row) { return row.id === selected.id; }) + 1
          : 0;
        var hasPhotoA = Boolean(state.images.A.image);
        var hasPhotoB = Boolean(state.images.B.image);
        var clickedA = isCalibration ? Boolean(selected && selected.pixelA) : Boolean(state.targetPixels.A);
        var clickedB = isCalibration ? Boolean(selected && selected.pixelB) : Boolean(state.targetPixels.B);
        var completedRows = state.rows.filter(function (row) {
          return row.pixelA && row.pixelB;
        }).length;

        var guide = byId('captureGuide');
        guide.classList.toggle('target-mode', !isCalibration);
        byId('captureGuideKicker').textContent = isCalibration
          ? '지금 찍을 기준점'
          : '지금 찍을 목표점';

        if (isCalibration && selected) {
          byId('captureGuideTitle').textContent = selectedIndex + '번 · ' + (selected.label || '이름 없는 기준점');
          byId('captureGuideCoords').textContent =
            'X ' + guideCoordinate(selected.x) +
            ' · Y ' + guideCoordinate(selected.y) +
            ' · Z ' + guideCoordinate(selected.z);
          byId('captureGuideProgress').textContent =
            '완료 ' + completedRows + ' / ' + state.rows.length;
        } else {
          byId('captureGuideTitle').textContent = '빨간 목표점';
          byId('captureGuideCoords').textContent = '두 사진을 찍으면 XYZ 좌표를 계산합니다';
          byId('captureGuideProgress').textContent = state.models ? '카메라 보정 완료' : '카메라 보정 필요';
        }

        var instruction;
        if (!hasPhotoA && !hasPhotoB) {
          instruction = '먼저 왼쪽 사진 A와 오른쪽 사진 B를 선택하세요.';
        } else if (!hasPhotoA) {
          instruction = '왼쪽 사진 A를 먼저 선택하세요.';
        } else if (!hasPhotoB) {
          instruction = '오른쪽 사진 B를 먼저 선택하세요.';
        } else if (!clickedA) {
          instruction = isCalibration
            ? '왼쪽 사진 A에서 ' + selectedIndex + '번 점의 정중앙을 클릭하세요.'
            : '왼쪽 사진 A에서 빨간 목표점의 정중앙을 클릭하세요.';
        } else if (!clickedB) {
          instruction = isCalibration
            ? '사진 A 완료 · 이제 오른쪽 사진 B에서 같은 ' + selectedIndex + '번 점을 클릭하세요.'
            : '사진 A 완료 · 이제 오른쪽 사진 B에서 같은 빨간 목표점을 클릭하세요.';
        } else if (isCalibration && completedRows === state.rows.length) {
          instruction = '모든 기준점 클릭 완료 · 아래의 ‘카메라 보정 계산’을 누르세요.';
        } else if (!isCalibration) {
          instruction = '두 사진의 목표점 클릭 완료 · 계산된 결과를 확인하세요.';
        } else {
          instruction = '두 사진 클릭을 완료했습니다. 다음 기준점으로 이동합니다.';
        }
        byId('captureGuideInstruction').textContent = instruction;

        updateCaptureStatus('A', hasPhotoA, clickedA, hasPhotoA && hasPhotoB && !clickedA);
        updateCaptureStatus('B', hasPhotoB, clickedB, hasPhotoA && hasPhotoB && clickedA && !clickedB);
        byId('photoCardA').classList.toggle('next-photo', !hasPhotoA || (hasPhotoA && hasPhotoB && !clickedA));
        byId('photoCardB').classList.toggle('next-photo', !hasPhotoB || (hasPhotoA && hasPhotoB && clickedA && !clickedB));
      }

      function updateCaptureStatus(side, hasPhoto, clicked, isNext) {
        var badge = byId('captureStatus' + side);
        badge.className = 'capture-status';
        if (!hasPhoto) {
          badge.classList.add('missing');
          badge.textContent = '사진 ' + side + ' · 사진 필요';
        } else if (clicked) {
          badge.classList.add('done');
          badge.textContent = '사진 ' + side + ' · 완료 ✓';
        } else {
          if (isNext) badge.classList.add('next');
          badge.textContent = '사진 ' + side + (isNext ? ' · 다음 클릭' : ' · 아직');
        }
      }

      function guideCoordinate(value) {
        if (value === '' || value === null || typeof value === 'undefined') return '?';
        var numeric = Number(value);
        return Number.isFinite(numeric) ? String(numeric) : String(value);
      }

      function invalidateModels() {
        state.models = null;
        state.result = null;
        state.mode = 'calibration';
        byId('calibrationSummary').hidden = true;
        byId('resultPanel').classList.remove('visible');
        byId('savedResult').classList.remove('visible');
        hideError('calibrationError');
        hideError('targetError');
        updateModeUI();
        updateTargetStatus();
      }

      function getUnitSettings() {
        var scale = Number(byId('unitScale').value);
        if (!Number.isFinite(scale) || scale <= 0) {
          throw new Error('한 칸의 실제 길이는 0보다 큰 숫자여야 합니다.');
        }
        var unit = byId('unitName').value.trim() || '단위';
        return { scale: scale, unit: unit };
      }

      function collectCompleteRows() {
        var unit = getUnitSettings();
        return state.rows.filter(function (row) {
          return row.pixelA && row.pixelB && validWorldFields(row);
        }).map(function (row) {
          return {
            id: row.id,
            label: row.label,
            grid: [Number(row.x), Number(row.y), Number(row.z)],
            world: [
              Number(row.x) * unit.scale,
              Number(row.y) * unit.scale,
              Number(row.z) * unit.scale
            ],
            pixelA: row.pixelA.slice(),
            pixelB: row.pixelB.slice()
          };
        });
      }

      function calculateCameraModels() {
        hideError('calibrationError');
        try {
          if (!state.images.A.image || !state.images.B.image) {
            throw new Error('사진 A와 B를 먼저 선택해 주세요.');
          }
          var rows = collectCompleteRows();
          if (rows.length < 6) {
            throw new Error('두 사진에서 모두 찍은 기준점이 최소 6개 필요합니다.');
          }

          validateWorldGeometry(rows.map(function (row) { return row.world; }));
          validatePixelSpread(rows.map(function (row) { return row.pixelA; }), state.images.A);
          validatePixelSpread(rows.map(function (row) { return row.pixelB; }), state.images.B);

          var pointsA = rows.map(function (row) {
            return { world: row.world, pixel: row.pixelA };
          });
          var pointsB = rows.map(function (row) {
            return { world: row.world, pixel: row.pixelB };
          });
          var modelA = calibrateCamera(pointsA);
          var modelB = calibrateCamera(pointsB);
          var baseline = vectorDistance(modelA.center, modelB.center);
          if (!Number.isFinite(baseline) || baseline < 1e-8) {
            throw new Error('두 카메라 위치가 거의 같게 계산되었습니다. 서로 다른 위치에서 찍은 사진인지 확인해 주세요.');
          }

          state.models = {
            A: modelA,
            B: modelB,
            rows: rows,
            baseline: baseline,
            unit: getUnitSettings()
          };
          renderCalibrationSummary();
          state.mode = 'target';
          updateModeUI();
          updateTargetStatus();
          notify('카메라 보정이 끝났습니다. 이제 빨간 목표점을 두 사진에서 찍으세요.', 'success');

          if (state.targetPixels.A && state.targetPixels.B) calculateTargetPosition();
        } catch (error) {
          state.models = null;
          state.result = null;
          showError('calibrationError', error.message);
          updateModeUI();
          notify(error.message, 'error');
        }
      }

      function validateWorldGeometry(worldPoints) {
        if (worldPoints.length < 6) throw new Error('기준점이 최소 6개 필요합니다.');
        var center = [0, 0, 0];
        worldPoints.forEach(function (point) {
          for (var i = 0; i < 3; i += 1) center[i] += point[i];
        });
        center = center.map(function (value) { return value / worldPoints.length; });
        var covariance = zeros(3, 3);
        worldPoints.forEach(function (point) {
          var d = subtractVectors(point, center);
          for (var r = 0; r < 3; r += 1) {
            for (var c = 0; c < 3; c += 1) covariance[r][c] += d[r] * d[c];
          }
        });
        var eigen = jacobiEigenSymmetric(covariance).values
          .map(Math.abs)
          .sort(function (a, b) { return a - b; });
        if (eigen[2] < 1e-14 || eigen[0] / eigen[2] < 1e-7) {
          throw new Error(
            '기준점이 거의 한 평면에만 있습니다. z축 위 점처럼 높이가 다른 점을 추가해 입체적으로 퍼뜨려 주세요.'
          );
        }
      }

      function validatePixelSpread(points, photo) {
        var xs = points.map(function (point) { return point[0]; });
        var ys = points.map(function (point) { return point[1]; });
        var width = Math.max.apply(null, xs) - Math.min.apply(null, xs);
        var height = Math.max.apply(null, ys) - Math.min.apply(null, ys);
        if (width < Math.max(5, photo.width * 0.03) ||
            height < Math.max(5, photo.height * 0.03)) {
          throw new Error('사진 속 기준점이 너무 좁은 곳에 모여 있습니다. 화면 전체에 넓게 퍼진 점을 사용해 주세요.');
        }
      }

      function calibrateCamera(points) {
        var norm2 = normalize2D(points.map(function (p) { return p.pixel; }));
        var norm3 = normalize3D(points.map(function (p) { return p.world; }));
        var A = [];

        for (var i = 0; i < points.length; i += 1) {
          var X = norm3.points[i].concat([1]);
          var u = norm2.points[i][0];
          var v = norm2.points[i][1];
          A.push([
            X[0], X[1], X[2], X[3],
            0, 0, 0, 0,
            -u * X[0], -u * X[1], -u * X[2], -u * X[3]
          ]);
          A.push([
            0, 0, 0, 0,
            X[0], X[1], X[2], X[3],
            -v * X[0], -v * X[1], -v * X[2], -v * X[3]
          ]);
        }

        var AtA = multiplyMatrices(transpose(A), A);
        var decomposition = jacobiEigenSymmetric(AtA);
        var order = decomposition.values.map(function (value, index) {
          return { value: value, index: index };
        }).sort(function (a, b) { return a.value - b.value; });

        var largest = Math.max(1e-30, Math.abs(order[order.length - 1].value));
        var secondSmallestRatio = Math.abs(order[1].value) / largest;
        if (!Number.isFinite(secondSmallestRatio) || secondSmallestRatio < 1e-11) {
          throw new Error('기준점 배치로 카메라를 안정적으로 계산할 수 없습니다. 점을 더 추가하고 입체적으로 퍼뜨려 주세요.');
        }

        var vector = decomposition.vectors.map(function (row) {
          return row[order[0].index];
        });
        var Pn = [
          vector.slice(0, 4),
          vector.slice(4, 8),
          vector.slice(8, 12)
        ];
        var P = multiplyMatrices(
          multiplyMatrices(inverse3(norm2.T), Pn),
          norm3.T
        );
        var frobenius = Math.sqrt(P.reduce(function (sum, row) {
          return sum + row.reduce(function (inner, value) { return inner + value * value; }, 0);
        }, 0));
        P = P.map(function (row) {
          return row.map(function (value) { return value / frobenius; });
        });

        var depths = points.map(function (point) {
          return dot(P[2], point.world.concat([1]));
        }).sort(function (a, b) { return a - b; });
        if (depths[Math.floor(depths.length / 2)] < 0) {
          P = P.map(function (row) { return row.map(function (value) { return -value; }); });
        }

        var errors = points.map(function (point) {
          return vectorDistance(projectPoint(P, point.world), point.pixel);
        });
        var rms = Math.sqrt(errors.reduce(function (sum, value) {
          return sum + value * value;
        }, 0) / errors.length);
        var maxError = Math.max.apply(null, errors);
        var center = cameraCenter(P);

        if (![rms, maxError].every(Number.isFinite) || !center.every(Number.isFinite)) {
          throw new Error('카메라 계산 결과가 유효하지 않습니다. 기준점 좌표와 클릭 위치를 확인해 주세요.');
        }
        return {
          P: P,
          center: center,
          rms: rms,
          maxError: maxError,
          errors: errors,
          conditionIndicator: secondSmallestRatio
        };
      }

      function normalize2D(points) {
        var center = [
          points.reduce(function (s, p) { return s + p[0]; }, 0) / points.length,
          points.reduce(function (s, p) { return s + p[1]; }, 0) / points.length
        ];
        var meanDistance = points.reduce(function (sum, point) {
          return sum + vectorDistance(point, center);
        }, 0) / points.length;
        if (meanDistance < 1e-12) throw new Error('사진 기준점들이 모두 같은 픽셀에 있습니다.');
        var scale = Math.SQRT2 / meanDistance;
        return {
          T: [
            [scale, 0, -scale * center[0]],
            [0, scale, -scale * center[1]],
            [0, 0, 1]
          ],
          points: points.map(function (point) {
            return [(point[0] - center[0]) * scale, (point[1] - center[1]) * scale];
          })
        };
      }

      function normalize3D(points) {
        var center = [0, 0, 0];
        points.forEach(function (point) {
          for (var i = 0; i < 3; i += 1) center[i] += point[i];
        });
        center = center.map(function (value) { return value / points.length; });
        var meanDistance = points.reduce(function (sum, point) {
          return sum + vectorDistance(point, center);
        }, 0) / points.length;
        if (meanDistance < 1e-12) throw new Error('3차원 기준점 좌표가 모두 같습니다.');
        var scale = Math.sqrt(3) / meanDistance;
        return {
          T: [
            [scale, 0, 0, -scale * center[0]],
            [0, scale, 0, -scale * center[1]],
            [0, 0, scale, -scale * center[2]],
            [0, 0, 0, 1]
          ],
          points: points.map(function (point) {
            return [
              (point[0] - center[0]) * scale,
              (point[1] - center[1]) * scale,
              (point[2] - center[2]) * scale
            ];
          })
        };
      }

      function cameraCenter(P) {
        var M = P.map(function (row) { return row.slice(0, 3); });
        var p4 = P.map(function (row) { return row[3]; });
        return multiplyMatrixVector(inverse3(M), p4).map(function (value) { return -value; });
      }

      function projectPoint(P, point) {
        var projected = multiplyMatrixVector(P, point.concat([1]));
        if (Math.abs(projected[2]) < 1e-14) return [Infinity, Infinity];
        return [projected[0] / projected[2], projected[1] / projected[2]];
      }

      function renderCalibrationSummary() {
        var modelA = state.models.A;
        var modelB = state.models.B;
        var box = byId('calibrationSummary');
        box.hidden = false;
        box.innerHTML = '';
        box.appendChild(metricCard('사진 A 보정 오차', fmt(modelA.rms, 2) + ' px RMS', '최대 ' + fmt(modelA.maxError, 2) + ' px'));
        box.appendChild(metricCard('사진 B 보정 오차', fmt(modelB.rms, 2) + ' px RMS', '최대 ' + fmt(modelB.maxError, 2) + ' px'));
      }

      function metricCard(label, value, detail) {
        var card = document.createElement('div');
        card.className = 'metric-card';
        var span = document.createElement('span');
        span.textContent = label;
        var strong = document.createElement('strong');
        strong.textContent = value;
        card.appendChild(span);
        card.appendChild(strong);
        if (detail) {
          var small = document.createElement('span');
          small.textContent = detail;
          card.appendChild(small);
        }
        return card;
      }

      function clearTarget() {
        state.targetPixels.A = null;
        state.targetPixels.B = null;
        state.result = null;
        byId('resultPanel').classList.remove('visible');
        byId('savedResult').classList.remove('visible');
        hideError('targetError');
        renderCanvas('A');
        renderCanvas('B');
        if (state.models) setMode('target');
        updateTargetStatus();
      }

      function updateTargetStatus() {
        var text;
        if (!state.models) {
          text = '먼저 카메라 보정을 완료하세요.';
        } else if (!state.targetPixels.A && !state.targetPixels.B) {
          text = '사진 A와 B에서 같은 목표점을 클릭하세요.';
        } else if (!state.targetPixels.A) {
          text = '사진 B 목표점은 기록했습니다. 사진 A의 같은 점을 클릭하세요.';
        } else if (!state.targetPixels.B) {
          text = '사진 A 목표점은 기록했습니다. 사진 B의 같은 점을 클릭하세요.';
        } else {
          text = '두 사진의 목표점을 기록했습니다.';
        }
        byId('targetStatus').textContent = text;
        updateCaptureGuide();
      }

      function calculateTargetPosition() {
        hideError('targetError');
        try {
          if (!state.models || !state.targetPixels.A || !state.targetPixels.B) return;
          var result = triangulateCore(
            state.models.A.P,
            state.models.B.P,
            state.targetPixels.A,
            state.targetPixels.B
          );
          result.onePixelSensitivity = estimateOnePixelSensitivity(
            state.models.A.P,
            state.models.B.P,
            state.targetPixels.A,
            state.targetPixels.B,
            result.point
          );
          state.result = result;
          renderResult();
        } catch (error) {
          state.result = null;
          byId('resultPanel').classList.remove('visible');
          showError('targetError', error.message);
          notify(error.message, 'error');
        }
      }

      function rayFromPixel(P, pixel) {
        var M = P.map(function (row) { return row.slice(0, 3); });
        var invM = inverse3(M);
        var center = cameraCenter(P);
        var direction = normalizeVector(multiplyMatrixVector(invM, [pixel[0], pixel[1], 1]));
        return { center: center, direction: direction };
      }

      function triangulateCore(PA, PB, pixelA, pixelB) {
        var rayA = rayFromPixel(PA, pixelA);
        var rayB = rayFromPixel(PB, pixelB);
        var c1 = rayA.center;
        var c2 = rayB.center;
        var d1 = rayA.direction;
        var d2 = rayB.direction;
        var w = subtractVectors(c1, c2);
        var a = dot(d1, d1);
        var b = dot(d1, d2);
        var c = dot(d2, d2);
        var d = dot(d1, w);
        var e = dot(d2, w);
        var denominator = a * c - b * b;
        if (denominator < 1e-9) {
          throw new Error('두 시선이 거의 평행합니다. 카메라 사이 거리를 늘리거나 다른 각도에서 찍어 주세요.');
        }
        var s = (b * e - c * d) / denominator;
        var t = (a * e - b * d) / denominator;
        if (s <= 0 || t <= 0) {
          throw new Error('목표점이 카메라 뒤쪽으로 계산되었습니다. 두 사진에서 같은 점을 찍었는지 확인해 주세요.');
        }
        var closestA = addVectors(c1, scaleVector(d1, s));
        var closestB = addVectors(c2, scaleVector(d2, t));
        var point = scaleVector(addVectors(closestA, closestB), 0.5);
        var gap = vectorDistance(closestA, closestB);
        var cosine = clamp(Math.abs(dot(d1, d2)), -1, 1);
        var angleDeg = Math.acos(cosine) * 180 / Math.PI;
        var reprojectionA = vectorDistance(projectPoint(PA, point), pixelA);
        var reprojectionB = vectorDistance(projectPoint(PB, point), pixelB);
        return {
          point: point,
          closestA: closestA,
          closestB: closestB,
          rayGap: gap,
          angleDeg: angleDeg,
          distanceAlongRayA: s,
          distanceAlongRayB: t,
          reprojectionA: reprojectionA,
          reprojectionB: reprojectionB
        };
      }

      function estimateOnePixelSensitivity(PA, PB, pixelA, pixelB, basePoint) {
        var variations = [
          [[pixelA[0] + 1, pixelA[1]], pixelB],
          [[pixelA[0], pixelA[1] + 1], pixelB],
          [pixelA, [pixelB[0] + 1, pixelB[1]]],
          [pixelA, [pixelB[0], pixelB[1] + 1]]
        ];
        var distances = [];
        variations.forEach(function (pair) {
          try {
            var changed = triangulateCore(PA, PB, pair[0], pair[1]);
            distances.push(vectorDistance(changed.point, basePoint));
          } catch (ignore) {
            // 민감도 보조값 하나가 실패해도 본 측정값은 유지합니다.
          }
        });
        return distances.length ? Math.max.apply(null, distances) : NaN;
      }

      function renderResult() {
        var result = state.result;
        if (!result) return;
        var unit = getUnitSettings().unit;
        byId('resultX').textContent = fmt(result.point[0], 4) + ' ' + unit;
        byId('resultY').textContent = fmt(result.point[1], 4) + ' ' + unit;
        byId('resultZ').textContent = fmt(result.point[2], 4) + ' ' + unit;

        var quality = assessQuality(result);
        var pill = byId('qualityPill');
        pill.textContent = quality.label;
        pill.className = 'quality-pill' + (quality.level === 'warn' ? ' warn' : quality.level === 'bad' ? ' bad' : '');

        var metrics = byId('resultMetrics');
        metrics.innerHTML = '';
        metrics.appendChild(metricCard('두 시선 사이 거리', fmt(result.rayGap, 5) + ' ' + unit));
        metrics.appendChild(metricCard('두 시선 교차각', fmt(result.angleDeg, 2) + '°'));
        metrics.appendChild(metricCard('목표 재투영 오차', 'A ' + fmt(result.reprojectionA, 2) + 'px', 'B ' + fmt(result.reprojectionB, 2) + 'px'));
        metrics.appendChild(metricCard('1픽셀 민감도', Number.isFinite(result.onePixelSensitivity)
          ? fmt(result.onePixelSensitivity, 5) + ' ' + unit
          : '계산 불가'));

        byId('resultNote').textContent = quality.note +
          ' 이 값은 사진 속 클릭과 현재 보정 모델의 계산 결과이며, 실제 정밀도는 렌즈 왜곡·기준점 오차·사진 해상도에 따라 달라집니다.';
        byId('resultPanel').classList.add('visible');
        byId('savedResult').classList.remove('visible');
      }

      function assessQuality(result) {
        var calibrationRms = Math.max(state.models.A.rms, state.models.B.rms);
        var gapRatio = result.rayGap / Math.max(state.models.baseline, 1e-12);
        var targetReprojection = Math.max(result.reprojectionA, result.reprojectionB);
        if (result.angleDeg < 2 || calibrationRms > 8 || gapRatio > 0.1 || targetReprojection > 8) {
          return {
            level: 'bad',
            label: '다시 촬영 권장',
            note: result.angleDeg < 2
              ? '두 시선의 각도가 너무 작아 깊이 값이 매우 불안정합니다.'
              : calibrationRms > 8
                ? '기준점의 재투영 오차가 커서 보정을 다시 하는 편이 좋습니다.'
                : gapRatio > 0.1
                  ? '두 시선 사이의 간격이 커서 서로 다른 목표점을 찍었을 가능성이 있습니다.'
                  : '목표점의 재투영 오차가 큽니다. 같은 물리적 점을 다시 찍어 주세요.'
          };
        }
        if (result.angleDeg < 5 || calibrationRms > 3 || gapRatio > 0.03 || targetReprojection > 3) {
          return {
            level: 'warn',
            label: '주의해서 사용',
            note: result.angleDeg < 5
              ? '두 시선의 각도가 작아 깊이 오차가 커질 수 있습니다.'
              : calibrationRms > 3
                ? '기준점 클릭 오차가 다소 큽니다.'
                : gapRatio > 0.03
                  ? '두 시선 사이의 간격이 다소 큽니다. 목표점 클릭을 확인해 주세요.'
                  : '목표점의 재투영 오차가 다소 큽니다.'
          };
        }
        return { level: 'good', label: '계산 상태 양호', note: '현재 수치상 큰 불안정 신호는 보이지 않습니다.' };
      }
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

      function copyDriveFileInfo(file) {
        if (!file) return null;
        return {
          id: file.id,
          name: file.name,
          url: file.url,
          size: file.size,
          mimeType: file.mimeType
        };
      }

      function showError(id, message) {
        var box = byId(id);
        box.textContent = message;
        box.classList.add('visible');
      }

      function hideError(id) {
        var box = byId(id);
        box.textContent = '';
        box.classList.remove('visible');
      }

      function notify(message, type) {
        var toast = byId('toast');
        toast.textContent = message;
        toast.className = 'toast show' + (type ? ' ' + type : '');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
          toast.className = 'toast';
        }, 3600);
      }

      function setBusy(isBusy, text) {
        byId('busyCover').classList.toggle('visible', Boolean(isBusy));
        if (text) byId('busyText').textContent = text;
      }

      function fmt(value, digits) {
        if (!Number.isFinite(value)) return '-';
        var absolute = Math.abs(value);
        if (absolute !== 0 && (absolute >= 100000 || absolute < Math.pow(10, -digits))) {
          return value.toExponential(Math.min(3, digits));
        }
        return Number(value.toFixed(digits)).toLocaleString('ko-KR', {
          maximumFractionDigits: digits
        });
      }

      function zeros(rows, columns) {
        return Array.from({ length: rows }, function () {
          return Array(columns).fill(0);
        });
      }

      function identity(size) {
        var matrix = zeros(size, size);
        for (var i = 0; i < size; i += 1) matrix[i][i] = 1;
        return matrix;
      }

      function transpose(matrix) {
        return matrix[0].map(function (_, column) {
          return matrix.map(function (row) { return row[column]; });
        });
      }

      function multiplyMatrices(A, B) {
        if (A[0].length !== B.length) throw new Error('행렬 크기가 맞지 않습니다.');
        var result = zeros(A.length, B[0].length);
        for (var i = 0; i < A.length; i += 1) {
          for (var k = 0; k < B.length; k += 1) {
            var value = A[i][k];
            for (var j = 0; j < B[0].length; j += 1) {
              result[i][j] += value * B[k][j];
            }
          }
        }
        return result;
      }

      function multiplyMatrixVector(matrix, vector) {
        return matrix.map(function (row) { return dot(row, vector); });
      }

      function inverse3(matrix) {
        var a = matrix[0][0], b = matrix[0][1], c = matrix[0][2];
        var d = matrix[1][0], e = matrix[1][1], f = matrix[1][2];
        var g = matrix[2][0], h = matrix[2][1], i = matrix[2][2];
        var A = e * i - f * h;
        var B = -(d * i - f * g);
        var C = d * h - e * g;
        var D = -(b * i - c * h);
        var E = a * i - c * g;
        var F = -(a * h - b * g);
        var G = b * f - c * e;
        var H = -(a * f - c * d);
        var I = a * e - b * d;
        var determinant = a * A + b * B + c * C;
        if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-14) {
          throw new Error('카메라 행렬을 뒤집을 수 없습니다. 기준점 배치를 확인해 주세요.');
        }
        return [
          [A / determinant, D / determinant, G / determinant],
          [B / determinant, E / determinant, H / determinant],
          [C / determinant, F / determinant, I / determinant]
        ];
      }

      function jacobiEigenSymmetric(input) {
        var n = input.length;
        var A = input.map(function (row) { return row.slice(); });
        var V = identity(n);
        var maxIterations = Math.max(80, n * n * 120);

        for (var iteration = 0; iteration < maxIterations; iteration += 1) {
          var p = 0;
          var q = 1;
          var maxOffDiagonal = 0;
          var diagonalScale = 1;
          for (var r = 0; r < n; r += 1) {
            diagonalScale = Math.max(diagonalScale, Math.abs(A[r][r]));
            for (var col = r + 1; col < n; col += 1) {
              var off = Math.abs(A[r][col]);
              if (off > maxOffDiagonal) {
                maxOffDiagonal = off;
                p = r;
                q = col;
              }
            }
          }
          if (maxOffDiagonal < 1e-13 * diagonalScale) break;

          var app = A[p][p];
          var aqq = A[q][q];
          var apq = A[p][q];
          var angle = 0.5 * Math.atan2(2 * apq, aqq - app);
          var cosine = Math.cos(angle);
          var sine = Math.sin(angle);

          for (var k = 0; k < n; k += 1) {
            if (k === p || k === q) continue;
            var akp = A[k][p];
            var akq = A[k][q];
            A[k][p] = cosine * akp - sine * akq;
            A[p][k] = A[k][p];
            A[k][q] = sine * akp + cosine * akq;
            A[q][k] = A[k][q];
          }
          A[p][p] = cosine * cosine * app - 2 * sine * cosine * apq + sine * sine * aqq;
          A[q][q] = sine * sine * app + 2 * sine * cosine * apq + cosine * cosine * aqq;
          A[p][q] = 0;
          A[q][p] = 0;

          for (var row = 0; row < n; row += 1) {
            var vkp = V[row][p];
            var vkq = V[row][q];
            V[row][p] = cosine * vkp - sine * vkq;
            V[row][q] = sine * vkp + cosine * vkq;
          }
        }
        return {
          values: A.map(function (row, index) { return row[index]; }),
          vectors: V
        };
      }

      function dot(a, b) {
        var sum = 0;
        for (var i = 0; i < a.length; i += 1) sum += a[i] * b[i];
        return sum;
      }

      function addVectors(a, b) {
        return a.map(function (value, index) { return value + b[index]; });
      }

      function subtractVectors(a, b) {
        return a.map(function (value, index) { return value - b[index]; });
      }

      function scaleVector(vector, scale) {
        return vector.map(function (value) { return value * scale; });
      }

      function vectorDistance(a, b) {
        return Math.sqrt(a.reduce(function (sum, value, index) {
          var delta = value - b[index];
          return sum + delta * delta;
        }, 0));
      }

      function normalizeVector(vector) {
        var length = Math.sqrt(dot(vector, vector));
        if (!Number.isFinite(length) || length < 1e-14) {
          throw new Error('시선 방향을 계산할 수 없습니다.');
        }
        return vector.map(function (value) { return value / length; });
      }

      window.__stereoMath = {
        calibrateCamera: calibrateCamera,
        triangulateCore: triangulateCore,
        projectPoint: projectPoint,
        vectorDistance: vectorDistance
      };
    })();
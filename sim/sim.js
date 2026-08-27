/* ============================================================
   sim.js — CANARY 표정 시뮬레이터

   실제 OLED(128×64)와 픽셀 단위로 동일한 결과를 만든다.
   그리기 로직은 firmware/canary_firmware.ino 의 renderFrame() 과
   1:1로 대응해야 한다. 한쪽만 고치면 시뮬레이터가 거짓말이 된다.

   구조:
     drawScene()  — 128×64 오프스크린 캔버스에 흑백으로 그림
     blit()       — 그 결과를 1비트로 판정해 확대 표시
     step()       — 40ms마다 애니메이션 갱신 + 렌더
     generateCode() — 현재 설정에 해당하는 Arduino 코드 출력
   ============================================================ */

(function () {
  "use strict";

  var W = PARAMS.SCREEN_W;   // 128
  var H = PARAMS.SCREEN_H;   // 64
  var SCALE = 5;             // 화면에 몇 배로 확대해 보여줄지

  /* ── 캔버스 준비 ─────────────────────────────────────
     off : 실제 OLED와 같은 128×64. 여기에 그린다.
     view: 사용자에게 보여줄 확대 화면.
     두 단계로 나눠야 "픽셀이 보이는" 진짜 OLED 느낌이 난다. */
  var view = document.getElementById("oled");
  var vctx = view.getContext("2d");
  view.width = W * SCALE;
  view.height = H * SCALE;

  var off = document.createElement("canvas");
  off.width = W;
  off.height = H;
  var octx = off.getContext("2d", { willReadFrequently: true });

  /* ── 상태 ────────────────────────────────────────────
     펌웨어의 전역 변수와 이름을 맞춰둔다. */
  var stress = 0;            // 위험도 0~100 (맥북이 보내는 값)
  var forced = "auto";       // "auto"면 stress로 결정, 아니면 강제 지정

  var curR = PARAMS.R_CALM;  // 현재 눈 반지름 (float — 보간 때문에)
  var curJit = 0;            // 현재 떨림 오프셋
  var gazeX = 0;             // 현재 시선 오프셋
  var startleBoost = 0;      // 놀람으로 인한 추가 크기

  var eyeOpen = true;
  var lastBlink = 0;
  var lastFrame = 0;
  var lastEvent = performance.now();
  var frames = 0, fpsT = 0;

  /* 일회형 애니메이션 상태 */
  var startle = { active: false, start: 0, duration: PARAMS.STARTLE_MS };

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── DOM 참조 ───────────────────────────────────────── */
  var el = {
    stress: document.getElementById("stress"),
    sv: document.getElementById("sv"),
    tb: document.getElementById("tb"),
    out: document.getElementById("out"),
    fps: document.getElementById("fps"),
    rr: document.getElementById("r-r"),
    rj: document.getElementById("r-j"),
    rb: document.getElementById("r-b"),
    rf: document.getElementById("r-f"),
    blink: document.getElementById("t-blink"),
    jit: document.getElementById("t-jit"),
    lerp: document.getElementById("t-lerp"),
    idle: document.getElementById("t-idle"),
    sleep: document.getElementById("t-sleep"),
    hud: document.getElementById("t-hud"),
    fire: document.getElementById("fire"),
    copy: document.getElementById("copy")
  };

  var TIER_COLOR = {
    calm: "var(--calm)", alert: "var(--alert)",
    tense: "var(--tense)", alarm: "var(--alarm)", sleep: "var(--calm)"
  };

  function markEvent() {
    lastEvent = performance.now();
  }

  /* 지금 그려야 할 표정 이름 */
  function activeFace() {
    if (forced !== "auto") return forced;
    if (el.sleep.checked && stress === 0 &&
        performance.now() - lastEvent >= PARAMS.SLEEP_AFTER_MS) return "sleep";
    return tierOf(stress);
  }

  /* ============================================================
     일회형 애니메이션 뼈대 — 펌웨어와 같은 구조
     ============================================================ */

  function animStart(a) {
    a.active = true;
    a.start = performance.now();
  }

  /* 진행도를 0.0 ~ 1.0으로 반환. 끝나면 스스로 꺼진다. */
  function animProgress(a, now) {
    if (!a.active) return 1;
    var elapsed = now - a.start;
    if (elapsed >= a.duration) { a.active = false; return 1; }
    return elapsed / a.duration;
  }

  /* 목표를 살짝 지나쳤다 돌아오는 곡선 — "헉!" 하는 느낌 */
  function easeOutBack(t) {
    var c1 = 1.70158, c3 = c1 + 1, p = t - 1;
    return 1 + c3 * p * p * p + c1 * p * p;
  }

  /* ============================================================
     애니메이션 갱신 — 각 함수는 자기 변수 하나만 담당한다
     ============================================================ */

  function updateBlink(now) {
    if (!el.blink.checked || reduce || stress >= PARAMS.BLINK_STOP_AT || activeFace() === "sleep") {
      eyeOpen = true;
      lastBlink = now;          // 타이머도 리셋. 안 하면 나중에 몰아서 깜빡인다.
      return;
    }
    var interval = eyeOpen ? PARAMS.BLINK_OPEN_MS : PARAMS.BLINK_SHUT_MS;
    if (now - lastBlink > interval) {
      eyeOpen = !eyeOpen;
      lastBlink = now;
    }
  }

  function updateEyeSize() {
    var target = radiusOf(activeFace());
    if (el.lerp.checked && !reduce) {
      curR += (target - curR) * PARAMS.LERP;   // 남은 거리의 18%씩
    } else {
      curR = target;                            // 즉시 전환
    }
  }

  function updateJitter() {
    var target = 0;
    if (el.jit.checked && !reduce && stress >= PARAMS.JITTER_AT) {
      // 정수 -JITTER_PX ~ +JITTER_PX 중 하나
      target = Math.floor(Math.random() * (PARAMS.JITTER_PX * 2 + 1)) - PARAMS.JITTER_PX;
    }
    // 그대로 쓰면 지직거린다. 절반씩 따라가게 해서 "떨림"으로 만든다.
    curJit += (target - curJit) * PARAMS.JITTER_SMOOTH;
  }

  function updateGaze(now) {
    if (el.idle.checked && !reduce && stress < PARAMS.GAZE_UNDER && activeFace() !== "sleep") {
      // sin은 -1~1. 진폭을 곱해 픽셀 단위로.
      gazeX = Math.sin(now * PARAMS.GAZE_SPEED) * PARAMS.GAZE_PX;
    } else {
      gazeX *= 0.9;   // 스르륵 멈춤
    }
  }

  function updateStartle(now) {
    var t = animProgress(startle, now);
    if (t >= 1) { startleBoost = 0; return; }
    // 시작(t=0)에 가장 크고, 끝(t=1)에 0이 된다.
    startleBoost = (1 - easeOutBack(t)) * PARAMS.STARTLE_PX;
  }

  /* ============================================================
     그리기 — .ino 의 renderFrame() 과 1:1 대응
     ============================================================ */

  function drawScene() {
    octx.fillStyle = "#000";
    octx.fillRect(0, 0, W, H);
    octx.fillStyle = "#fff";
    octx.strokeStyle = "#fff";
    octx.lineWidth = 2;

    var face = activeFace();

    // ── 레이어 합성: 떨림 + 시선 ──
    var jx = Math.round(curJit + gazeX);
    // ── 레이어 합성: 기본 크기 + 놀람 ──
    var r = Math.round(curR + startleBoost);
    if (r < 1) r = 1;
    if (r > 28) r = 28;

    var LX = PARAMS.EYE_L_X + jx;
    var RX = PARAMS.EYE_R_X + jx;
    var EY = PARAMS.EYE_Y;

    if (face === "sleep") {
      // 아래로 처진 반달 눈: 중앙이 양 끝보다 낮다.
      [LX, RX].forEach(function (x) {
        octx.beginPath();
        for (var dx = -PARAMS.SLEEP_HALF_W; dx <= PARAMS.SLEEP_HALF_W; dx++) {
          var sy = PARAMS.SLEEP_Y -
            (dx * dx * PARAMS.SLEEP_DROP_PX) /
            (PARAMS.SLEEP_HALF_W * PARAMS.SLEEP_HALF_W);
          if (dx === -PARAMS.SLEEP_HALF_W) octx.moveTo(x + dx, sy);
          else octx.lineTo(x + dx, sy);
        }
        octx.stroke();
      });
    } else if (face === "locked") {
      // X자 눈
      var d = PARAMS.R_LOCKED;
      [LX, RX].forEach(function (x) {
        octx.beginPath();
        octx.moveTo(x - d, EY - d); octx.lineTo(x + d, EY + d);
        octx.moveTo(x + d, EY - d); octx.lineTo(x - d, EY + d);
        octx.stroke();
      });
    } else if (!eyeOpen) {
      // 감은 눈 — 가로선. 크기와 무관하게 항상 같은 두께.
      octx.fillRect(LX - 12, EY - 1, 24, 2);
      octx.fillRect(RX - 12, EY - 1, 24, 2);
    } else if (face === "alert") {
      // 실눈 — 납작한 사각형. r을 세로 반높이로 쓴다.
      var h = Math.max(3, r * 2);
      octx.fillRect(LX - 11, EY - h / 2, 22, h);
      octx.fillRect(RX - 11, EY - h / 2, 22, h);
    } else {
      octx.beginPath(); octx.arc(LX, EY, r, 0, Math.PI * 2); octx.fill();
      octx.beginPath(); octx.arc(RX, EY, r, 0, Math.PI * 2); octx.fill();

      if (face === "alarm") {
        // 성난 눈썹 — 바깥쪽이 위, 안쪽이 아래
        octx.beginPath();
        octx.moveTo(LX - PARAMS.BROW_OUT_X, EY - PARAMS.BROW_OUT_Y);
        octx.lineTo(LX + PARAMS.BROW_IN_X, EY - PARAMS.BROW_IN_Y);
        octx.moveTo(RX + PARAMS.BROW_OUT_X, EY - PARAMS.BROW_OUT_Y);
        octx.lineTo(RX - PARAMS.BROW_IN_X, EY - PARAMS.BROW_IN_Y);
        octx.stroke();
      }
    }

    if (el.hud.checked) {
      octx.font = "8px monospace";
      octx.textBaseline = "top";
      octx.fillStyle = "#fff";
      octx.fillText("RISK " + stress, 1, 1);
    }
  }

  /* 오프스크린 결과를 1비트로 판정해 확대 표시.
     이 과정이 있어야 실제 OLED처럼 계단이 보인다. */
  function blit() {
    var d = octx.getImageData(0, 0, W, H).data;
    vctx.fillStyle = "#080C0E";
    vctx.fillRect(0, 0, view.width, view.height);
    vctx.fillStyle = "#BDEFFA";           // OLED 인광 색
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        // 빨강 채널만 봐도 흑백이라 충분하다. 128 초과면 "켜짐".
        if (d[(y * W + x) * 4] > 128) {
          vctx.fillRect(x * SCALE, y * SCALE, SCALE - 1, SCALE - 1);
          //                                  ↑ -1 을 빼서 픽셀 사이 간격을 만든다
        }
      }
    }
  }

  /* ── 메인 루프 ──────────────────────────────────────── */
  function step(now) {
    if (now - lastFrame >= PARAMS.FRAME_MS) {
      lastFrame = now;

      updateBlink(now);
      updateEyeSize();
      updateJitter();
      updateGaze(now);
      updateStartle(now);

      drawScene();
      blit();

      el.rr.textContent = curR.toFixed(1);
      el.rj.textContent = curJit.toFixed(1);
      el.rb.textContent = eyeOpen ? "open" : "shut";
      el.rf.textContent = activeFace();

      frames++;
      if (now - fpsT > 1000) {
        el.fps.textContent = frames + " FPS";
        frames = 0; fpsT = now;
      }
    }
    requestAnimationFrame(step);
  }

  /* ============================================================
     Arduino 코드 생성
     ★ 여기서 출력하는 숫자는 params.js 와 .ino 와 일치해야 한다
     ============================================================ */
  function generateCode() {
    var P = PARAMS;
    var L = [];

    L.push("// ── setup() 안에 ───────────────────────────────");
    L.push("Wire.begin();");
    L.push("Wire.setClock(400000);   // 400kHz. 없으면 10fps로 떨어진다");
    L.push("Serial.setTimeout(20);   // readString 계열이 보드를 얼리는 것 방지");
    L.push("");
    L.push("// ── PARAMS ─────────────────────────────────────");
    L.push("const int LX = " + P.EYE_L_X + ", RX = " + P.EYE_R_X + ", EY = " + P.EYE_Y + ";");
    L.push("const int T_ALERT = " + P.T_ALERT + ", T_TENSE = " + P.T_TENSE + ", T_ALARM = " + P.T_ALARM + ";");
    L.push("const int R_CALM = " + P.R_CALM + ", R_ALERT = " + P.R_ALERT +
           ", R_TENSE = " + P.R_TENSE + ", R_ALARM = " + P.R_ALARM + ";");
    L.push("const unsigned long SLEEP_AFTER_MS = " + P.SLEEP_AFTER_MS + "UL;");
    L.push("const int SLEEP_Y = " + P.SLEEP_Y + ", SLEEP_HALF_W = " + P.SLEEP_HALF_W +
           ", SLEEP_DROP_PX = " + P.SLEEP_DROP_PX + ";");
    L.push("");
    L.push("int   stress  = " + stress + ";");
    L.push("float curR    = " + P.R_CALM + ".0;   // float 이어야 보간이 된다");
    L.push("bool  eyeOpen = true;");
    L.push("unsigned long lastBlink = 0, lastFrame = 0, lastEvent = 0;");
    L.push("");
    L.push("void renderFrame() {");
    L.push("  if (millis() - lastFrame < " + P.FRAME_MS + ") return;   // " +
           Math.round(1000 / P.FRAME_MS) + "fps 제한");
    L.push("  lastFrame = millis();");
    L.push("  bool sleeping = stress == 0 && millis() - lastEvent >= SLEEP_AFTER_MS;");
    L.push("");

    if (el.blink.checked) {
      L.push("  // 깜빡임 — 긴장하면 멈춘다");
      L.push("  if (!sleeping && stress < " + P.BLINK_STOP_AT + ") {");
      L.push("    unsigned long iv = eyeOpen ? " + P.BLINK_OPEN_MS + "UL : " + P.BLINK_SHUT_MS + "UL;");
      L.push("    if (millis() - lastBlink > iv) { eyeOpen = !eyeOpen; lastBlink = millis(); }");
      L.push("  } else { eyeOpen = true; lastBlink = millis(); }");
      L.push("");
    }

    L.push("  // 목표 크기");
    L.push("  int targetR = R_CALM;");
    L.push("  if (stress >= T_ALERT) targetR = R_ALERT;");
    L.push("  if (stress >= T_TENSE) targetR = R_TENSE;");
    L.push("  if (stress >= T_ALARM) targetR = R_ALARM;");

    if (el.lerp.checked) {
      L.push("  curR += (targetR - curR) * " + P.LERP + "f;   // 부드러운 전환");
    } else {
      L.push("  curR = targetR;                    // 즉시 전환");
    }
    L.push("");

    if (el.jit.checked) {
      L.push("  int jx = (stress >= " + P.JITTER_AT + ") ? random(-" + P.JITTER_PX +
             ", " + (P.JITTER_PX + 1) + ") : 0;   // 긴장 떨림");
    } else {
      L.push("  int jx = 0;");
    }
    L.push("  int r = (int)(curR + 0.5f);        // 반올림. (int)만 하면 버려진다");
    L.push("  if (r < 1) r = 1;");
    L.push("");
    L.push("  oled.clearDisplay();");
    L.push("  if (sleeping) {");
    L.push("    const int eyes[2] = { LX + jx, RX + jx };");
    L.push("    for (int e = 0; e < 2; e++) {");
    L.push("      for (int dx = -SLEEP_HALF_W; dx <= SLEEP_HALF_W; dx++) {");
    L.push("        int y = SLEEP_Y - (dx * dx * SLEEP_DROP_PX) / (SLEEP_HALF_W * SLEEP_HALF_W);");
    L.push("        oled.drawPixel(eyes[e] + dx, y, SSD1306_WHITE);");
    L.push("        oled.drawPixel(eyes[e] + dx, y + 1, SSD1306_WHITE);");
    L.push("      }");
    L.push("    }");
    L.push("  } else if (!eyeOpen) {");
    L.push("    oled.fillRect(LX + jx - 12, EY - 1, 24, 2, SSD1306_WHITE);");
    L.push("    oled.fillRect(RX + jx - 12, EY - 1, 24, 2, SSD1306_WHITE);");
    L.push("  } else if (stress >= T_ALERT && stress < T_TENSE) {");
    L.push("    int h = r * 2; if (h < 3) h = 3;");
    L.push("    oled.fillRect(LX + jx - 11, EY - h/2, 22, h, SSD1306_WHITE);");
    L.push("    oled.fillRect(RX + jx - 11, EY - h/2, 22, h, SSD1306_WHITE);");
    L.push("  } else {");
    L.push("    oled.fillCircle(LX + jx, EY, r, SSD1306_WHITE);");
    L.push("    oled.fillCircle(RX + jx, EY, r, SSD1306_WHITE);");
    L.push("    if (stress >= T_ALARM) {   // 성난 눈썹");
    L.push("      oled.drawLine(LX + jx - " + P.BROW_OUT_X + ", EY - " + P.BROW_OUT_Y +
           ", LX + jx + " + P.BROW_IN_X + ", EY - " + P.BROW_IN_Y + ", SSD1306_WHITE);");
    L.push("      oled.drawLine(RX + jx + " + P.BROW_OUT_X + ", EY - " + P.BROW_OUT_Y +
           ", RX + jx - " + P.BROW_IN_X + ", EY - " + P.BROW_IN_Y + ", SSD1306_WHITE);");
    L.push("    }");
    L.push("  }");

    if (el.hud.checked) {
      L.push("  oled.setTextSize(1); oled.setTextColor(SSD1306_WHITE);");
      L.push('  oled.setCursor(0,0); oled.print("RISK "); oled.print(stress);');
    }

    L.push("  oled.display();   // 프레임당 정확히 한 번");
    L.push("}");

    el.out.textContent = L.join("\n");
  }

  /* ── 이벤트 연결 ────────────────────────────────────── */
  el.stress.addEventListener("input", function () {
    markEvent();
    stress = +el.stress.value;
    var t = tierOf(stress);
    el.sv.textContent = stress;
    el.tb.textContent = t.toUpperCase();
    el.tb.style.background = TIER_COLOR[t];
    generateCode();
  });

  document.querySelectorAll("#faces button").forEach(function (b) {
    b.addEventListener("click", function () {
      markEvent();
      forced = b.dataset.f;
      document.querySelectorAll("#faces button").forEach(function (o) {
        o.setAttribute("aria-pressed", o === b ? "true" : "false");
      });
      generateCode();
    });
  });

  ["blink", "jit", "lerp", "idle", "sleep", "hud"].forEach(function (k) {
    el[k].addEventListener("change", function () { markEvent(); generateCode(); });
  });

  el.fire.addEventListener("click", function () {
    markEvent();
    animStart(startle);
  });

  el.copy.addEventListener("click", function () {
    navigator.clipboard.writeText(el.out.textContent).then(function () {
      el.copy.textContent = "복사됨";
      setTimeout(function () { el.copy.textContent = "코드 복사"; }, 1200);
    });
  });

  generateCode();
  requestAnimationFrame(step);
})();

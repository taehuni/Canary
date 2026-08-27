/* ============================================================
   params.js — 단일 진실 공급원 (Single Source of Truth)

   표정을 결정하는 모든 숫자가 여기 있다.
   이 파일을 고치면 반드시 아래 두 곳도 함께 고칠 것:
     1) firmware/canary_firmware.ino  상단 "── PARAMS ──" 블록
     2) sim/sim.js                    generateCode() 안의 출력 문자열

   ★ ES 모듈(export)을 쓰지 않는다.
     file:// 로 index.html을 열 수 있어야 하기 때문.
   ============================================================ */

var PARAMS = {

  /* ── 화면 ───────────────────────────────────────────── */
  SCREEN_W: 128,        // OLED 가로 픽셀
  SCREEN_H: 64,         // OLED 세로 픽셀
  FRAME_MS: 40,         // 프레임 간격 (40ms = 25fps)
                        // 낮추면 부드럽지만 I2C가 포화된다

  /* ── 눈 위치 ────────────────────────────────────────── */
  EYE_L_X: 40,          // 왼쪽 눈 중심 x
  EYE_R_X: 88,          // 오른쪽 눈 중심 x
  EYE_Y:   32,          // 두 눈의 중심 y (화면 세로 중앙)

  /* ── 위험도 경계값 ──────────────────────────────────── */
  T_ALERT: 25,          // 이 값 이상이면 ALERT
  T_TENSE: 55,          // 이 값 이상이면 TENSE
  T_ALARM: 80,          // 이 값 이상이면 ALARM

  /* ── 단계별 눈 반지름 (픽셀) ────────────────────────── */
  R_CALM:   6,          // 평온 — 보통 눈
  R_ALERT:  3,          // 주의 — 실눈 (세로로 납작)
  R_TENSE: 10,          // 긴장 — 커짐
  R_ALARM: 16,          // 경악 — 매우 커짐
  R_LOCKED: 9,          // 잠김 — X자 눈의 팔 길이

  /* ── 보간 (부드러운 전환) ───────────────────────────── */
  LERP: 0.18,           // 매 프레임 남은 거리의 몇 %를 이동할지
                        //  0.05 = 느긋 (2.4초)
                        //  0.18 = 자연스러움 (0.6초)  ← 기본
                        //  0.40 = 예민 (0.25초)
                        //  1.00 = 즉시 (전환 없음)

  /* ── 깜빡임 ─────────────────────────────────────────── */
  BLINK_OPEN_MS: 3000,  // 눈을 뜨고 있는 시간
  BLINK_SHUT_MS:  120,  // 눈을 감고 있는 시간 (짧아야 자연스럽다)
  BLINK_STOP_AT:   55,  // 이 위험도 이상이면 깜빡임을 멈춘다
                        // (겁먹으면 눈을 안 감는다)

  /* ── 긴장 떨림 ──────────────────────────────────────── */
  JITTER_AT: 80,        // 이 위험도 이상에서만 떨림
  JITTER_PX:  2,        // 좌우로 ±몇 픽셀 흔들릴지
  JITTER_SMOOTH: 0.5,   // 랜덤값을 얼마나 뭉갤지 (1.0이면 지직거림)

  /* ── 시선 이동 (idle drift) ─────────────────────────── */
  GAZE_UNDER: 25,       // 이 위험도 미만에서만 시선이 움직인다
  GAZE_PX:     4,       // 좌우 진폭 (픽셀)
  GAZE_SPEED:  0.0008,  // 사인파 속도. 한 왕복 = 2π / 이 값 ≈ 7.8초

  /* ── 놀람 연출 (일회형) ─────────────────────────────── */
  STARTLE_MS: 500,      // 연출 길이
  STARTLE_PX:   8,      // 눈이 추가로 커지는 최대 픽셀

  /* ── 수면 (stress 0 + 무입력) ───────────────────────── */
  SLEEP_AFTER_MS: 30000, // 이벤트가 없으면 30초 뒤 SLEEP
  SLEEP_Y:          38,  // 아래로 처진 반달의 중심 y
  SLEEP_HALF_W:     12,  // 한쪽 눈의 반너비
  SLEEP_DROP_PX:     6,  // 중앙이 아래로 처지는 깊이

  /* ── 눈썹 (ALARM 전용) ──────────────────────────────── */
  BROW_OUT_X: 18,       // 바깥쪽 끝 x 오프셋
  BROW_IN_X:  10,       // 안쪽 끝 x 오프셋
  BROW_OUT_Y: 24,       // 바깥쪽 끝 y 오프셋 (위로)
  BROW_IN_Y:  16        // 안쪽 끝 y 오프셋 (위로)
};

/* 위험도 → 단계 이름 */
function tierOf(stress) {
  if (stress >= PARAMS.T_ALARM) return "alarm";
  if (stress >= PARAMS.T_TENSE) return "tense";
  if (stress >= PARAMS.T_ALERT) return "alert";
  return "calm";
}

/* 표정 이름 → 목표 눈 반지름 */
function radiusOf(face) {
  switch (face) {
    case "alarm":  return PARAMS.R_ALARM;
    case "tense":  return PARAMS.R_TENSE;
    case "alert":  return PARAMS.R_ALERT;
    case "locked": return PARAMS.R_LOCKED;
    default:       return PARAMS.R_CALM;
  }
}

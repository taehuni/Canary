/* ============================================================================
   CANARY — NU-40 DK (Nordic nRF52840) 펌웨어

   보드 설정:
     보드 매니저 URL:
       https://raw.githubusercontent.com/Nucode01/Adafruit_nRF52_Arduino/refs/heads/master/package_nuduino_index.json
     툴 → 보드 → NUBoards nRF52 → NU40DK nRF52840

   필요 라이브러리:
     Adafruit GFX Library
     Adafruit SSD1306

   설계 원칙 (AGENTS.md 참조):
     - 입력은 상태 변수만 바꾸고, 출력은 상태 변수만 읽는다
     - delay() 금지 (200ms 미만 서보 몸짓만 예외)
     - oled.display()는 프레임당 정확히 한 번
   ============================================================================ */

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Servo.h>

/* ── 하드웨어 핀 ─────────────────────────────────────────────
   ★ 현장에서 보드 실크스크린을 보고 실제 번호로 수정할 것 */
const int PIN_PAN        = 2;    // 서보 좌우
const int PIN_TILT       = 3;    // 서보 상하
const int PIN_TOUCH_HEAD = 4;    // 머리 터치 → WHY
const int PIN_TOUCH_BODY = 5;    // 몸통 터치 → 길게 누르면 APPROVE

const uint8_t OLED_ADDR = 0x3C;  // I2C 스캐너로 확인. 0x3D인 경우도 있음

/* ── PARAMS ──────────────────────────────────────────────────
   ★ sim/params.js 와 반드시 같은 값이어야 한다.
     한쪽만 고치면 시뮬레이터가 거짓말이 된다. */
const int LX = 40, RX = 88, EY = 32;          // 눈 좌표
const int T_ALERT = 25, T_TENSE = 55, T_ALARM = 80;   // 위험도 경계
const int R_CALM = 6, R_ALERT = 3, R_TENSE = 10, R_ALARM = 16, R_LOCKED = 9;
const float LERP = 0.18f;                      // 보간 계수
const int FRAME_MS = 40;                       // 25fps
const unsigned long BLINK_OPEN_MS = 3000, BLINK_SHUT_MS = 120;
const int BLINK_STOP_AT = 55;                  // 이 위험도 이상이면 안 깜빡임
const int JITTER_AT = 80, JITTER_PX = 2;
const int STARTLE_MS = 500, STARTLE_PX = 8;
const unsigned long SLEEP_AFTER_MS = 30000;
const int SLEEP_Y = 38, SLEEP_HALF_W = 12, SLEEP_DROP_PX = 6;
const int BROW_OUT_X = 18, BROW_IN_X = 10, BROW_OUT_Y = 24, BROW_IN_Y = 16;

/* 서보 안전 각도 — 기어 보호 */
const int PAN_MIN = 60, PAN_MAX = 120, PAN_CENTER = 90;
const int TILT_MIN = 60, TILT_MAX = 120, TILT_CENTER = 90;

/* ── 객체 ────────────────────────────────────────────────────
   이 줄이 실행되면 RAM에 1024바이트 프레임버퍼가 생긴다.
   (128 × 64 픽셀 ÷ 8비트 = 1024바이트) */
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
Servo panServo, tiltServo;

/* ── 표정 ────────────────────────────────────────────────────
   문자열 대신 enum을 쓴다.
     - 오타가 컴파일 에러로 잡힌다 (문자열은 조용히 실패한다)
     - 비교가 숫자 하나라 빠르다
     - switch를 쓸 수 있다 */
enum Face { FACE_CALM, FACE_ALERT, FACE_TENSE, FACE_ALARM, FACE_LOCKED, FACE_SLEEP };

/* ── 상태 변수 ───────────────────────────────────────────────
   화면에 그려지는 모든 것은 이 변수들로 결정된다.
   그리기 함수 밖에서는 아무도 화면을 건드리지 않는다. */
int   stress   = 0;          // 위험도 0~100 (맥북이 STRESS 명령으로 설정)
Face  face     = FACE_CALM;  // 강제 지정된 표정
bool  faceAuto = true;       // true면 stress로 표정을 자동 결정

float curR         = (float)R_CALM;  // 현재 눈 반지름 — float이어야 보간이 된다
float curJit       = 0;              // 현재 떨림 오프셋
float startleBoost = 0;              // 놀람으로 인한 추가 크기
bool  eyeOpen      = true;

unsigned long lastBlink = 0;
unsigned long lastFrame = 0;
unsigned long lastEvent = 0;

/* 일회형 애니메이션 */
struct Anim { bool active; unsigned long start; unsigned int duration; };
Anim startle = { false, 0, STARTLE_MS };

// Arduino의 자동 프로토타입 생성보다 사용자 정의 타입 선언이 먼저 오도록 명시한다.
Face activeFace();
void animStart(Anim &a);
float animProgress(Anim &a);

/* 시리얼 수신 버퍼 — 한 글자씩 모은다 */
char cmdBuf[64];
int  cmdLen = 0;

/* ============================================================================
   SETUP
   ============================================================================ */
void setup() {
  Serial.begin(115200);
  Serial.setTimeout(20);        // 기본 1000ms. 안 줄이면 보드가 1초씩 얼어붙는다

  pinMode(PIN_TOUCH_HEAD, INPUT);
  pinMode(PIN_TOUCH_BODY, INPUT);

  Wire.begin();
  Wire.setClock(400000);        // ★ 100kHz → 400kHz. 없으면 10fps로 떨어진다

  // begin()의 반환값을 반드시 확인한다.
  // 안 보면 OLED가 안 붙었을 때 코드를 뒤지며 시간을 버린다.
  if (!oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println("ERR OLED not found");
    while (1) { delay(100); }   // 여기서 멈춤 (하드웨어 문제 신호)
  }

  panServo.attach(PIN_PAN);
  tiltServo.attach(PIN_TILT);
  gesture("center");

  oled.clearDisplay();
  oled.display();
  lastEvent = millis();
  Serial.println("READY");
}

/* ============================================================================
   LOOP — 4단 분리. 각 함수는 자기 일만 한다.
   ============================================================================ */
void loop() {
  handleSerial();      // ① 맥북 명령 수신 — 상태만 바꾼다. 그리지 않는다
  pollTouch();         // ② 센서 읽기     — 상태만 바꾼다. 그리지 않는다
  updateAnimations();  // ③ 애니메이션 계산
  renderFrame();       // ④ 그리기 — 오직 여기서만
}

/* ============================================================================
   ① 시리얼 수신 — 절대 블로킹하지 않는다
   ============================================================================ */
void handleSerial() {
  // 도착한 글자가 있는 동안만 반복한다.
  // 없으면 available()이 0이라 즉시 빠져나간다 = 대기 시간 0
  while (Serial.available()) {
    char c = Serial.read();

    if (c == '\n' || c == '\r') {          // 문장이 끝났다
      if (cmdLen > 0) {
        cmdBuf[cmdLen] = '\0';             // C 문자열 종료 표시
        processCommand(cmdBuf);
        cmdLen = 0;                        // 버퍼 비우기
      }
    }
    else if (cmdLen < (int)sizeof(cmdBuf) - 1) {
      cmdBuf[cmdLen++] = c;                // 버퍼 오버플로 방지
    }
    // 버퍼가 꽉 차면 나머지 글자는 조용히 버린다 (크래시보다 낫다)
  }
}

void processCommand(char* line) {
  lastEvent = millis();                     // 모든 유효한 수신은 수면 타이머를 깨운다
  char* sp = strchr(line, ' ');            // 첫 공백의 주소를 찾는다

  if (sp) {
    *sp = '\0';                            // 공백을 종료문자로 바꿔 두 조각으로 자른다
    char* arg = sp + 1;                    // 공백 다음부터가 인자

    // strcmp는 같으면 0을 반환한다. 그래서 !strcmp가 "같다"는 뜻.
    if (!strcmp(line, "STRESS")) {
      int v = atoi(arg);
      stress = constrain(v, 0, 100);       // ★ 방어. 9999가 와도 화면이 안 깨진다
      if (stress >= T_ALARM) animStart(startle);   // 고위험이면 놀람 연출
    }
    else if (!strcmp(line, "FACE"))    setFace(arg);
    else if (!strcmp(line, "GESTURE")) gesture(arg);
  }
  else {
    if (!strcmp(line, "PING")) Serial.println("PONG");
  }
}

void setFace(const char* s) {
  // 문자열이 등장하는 곳은 이 함수 하나뿐이다. 나머지는 전부 enum 비교.
  faceAuto = false;
  if      (!strcmp(s, "calm"))   face = FACE_CALM;
  else if (!strcmp(s, "alert"))  face = FACE_ALERT;
  else if (!strcmp(s, "tense"))  face = FACE_TENSE;
  else if (!strcmp(s, "alarm"))  face = FACE_ALARM;
  else if (!strcmp(s, "locked")) face = FACE_LOCKED;
  else                           faceAuto = true;   // 모르는 값이면 자동으로
}

/* 지금 그려야 할 표정 */
Face activeFace() {
  if (!faceAuto) return face;
  if (stress == 0 && millis() - lastEvent >= SLEEP_AFTER_MS) return FACE_SLEEP;
  if (stress >= T_ALARM) return FACE_ALARM;
  if (stress >= T_TENSE) return FACE_TENSE;
  if (stress >= T_ALERT) return FACE_ALERT;
  return FACE_CALM;
}

/* ============================================================================
   ② 터치 — 짧게/길게 구분
   ============================================================================ */
unsigned long headDown = 0, bodyDown = 0;
bool headPrev = false, bodyPrev = false;

void pollTouch() {
  bool h = digitalRead(PIN_TOUCH_HEAD);
  bool b = digitalRead(PIN_TOUCH_BODY);
  unsigned long now = millis();

  // 머리 — 누르는 순간 시각 기록, 떼는 순간 이벤트 발사
  if (h && !headPrev) headDown = now;
  if (!h && headPrev && now - headDown > 50) {   // 50ms 미만은 노이즈로 무시
    lastEvent = now;
    Serial.println("EVT TOUCH_HEAD");
  }
  headPrev = h;

  // 몸통 — 누른 시간으로 짧게/길게를 나눈다
  if (b && !bodyPrev) bodyDown = now;
  if (!b && bodyPrev) {
    unsigned long d = now - bodyDown;
    if (d > 1500) { lastEvent = now; Serial.println("EVT TOUCH_BODY_LONG"); }   // 승인
    else if (d > 50) { lastEvent = now; Serial.println("EVT TOUCH_BODY"); }
  }
  bodyPrev = b;
}

/* ============================================================================
   ③ 애니메이션 — 각 함수는 자기 변수 하나만 담당한다
   ============================================================================ */
void updateAnimations() {
  updateBlink();
  updateEyeSize();
  updateJitter();
  updateStartle();
}

void updateBlink() {
  if (stress >= BLINK_STOP_AT || activeFace() == FACE_SLEEP) {
    eyeOpen = true;
    lastBlink = millis();   // ★ 타이머도 리셋. 안 하면 긴장이 풀리는 순간
    return;                 //   밀린 시간이 터져서 미친듯이 깜빡인다
  }
  unsigned long interval = eyeOpen ? BLINK_OPEN_MS : BLINK_SHUT_MS;

  // millis() - lastBlink 형태로 빼는 이유:
  // millis()는 49.7일 후 0으로 돌아간다. 덧셈 비교는 그때 깨지지만
  // unsigned 뺄셈은 넘어가도 정상 동작한다. 아두이노 표준 관용구.
  if (millis() - lastBlink > interval) {
    eyeOpen = !eyeOpen;
    lastBlink = millis();
  }
}

void updateEyeSize() {
  int targetR;
  switch (activeFace()) {
    case FACE_ALARM:  targetR = R_ALARM;  break;
    case FACE_TENSE:  targetR = R_TENSE;  break;
    case FACE_ALERT:  targetR = R_ALERT;  break;
    case FACE_LOCKED: targetR = R_LOCKED; break;
    case FACE_SLEEP:  targetR = R_CALM;   break;
    default:          targetR = R_CALM;   break;
  }
  // 남은 거리의 18%씩 이동 → 약 15프레임(0.6초) 뒤 도착
  curR += (targetR - curR) * LERP;
}

void updateJitter() {
  float target = 0;
  if (stress >= JITTER_AT) {
    // ★ random(min, max)은 max를 포함하지 않는다.
    //   random(-2, 3) → -2, -1, 0, 1, 2
    target = random(-JITTER_PX, JITTER_PX + 1);
  }
  // 랜덤값을 그대로 쓰면 지직거린다. 절반씩 따라가야 "떨림"이 된다.
  curJit += (target - curJit) * 0.5f;
}

void animStart(Anim &a) {     // ★ &a = 참조. 빼면 복사본만 바뀌어 아무 일도 안 난다
  a.active = true;
  a.start  = millis();
}

float animProgress(Anim &a) {
  if (!a.active) return 1.0f;
  unsigned long elapsed = millis() - a.start;
  if (elapsed >= a.duration) { a.active = false; return 1.0f; }
  return (float)elapsed / a.duration;   // ★ (float) 없으면 정수 나눗셈으로 0이 된다
}

/* 목표를 살짝 지나쳤다 돌아오는 곡선 — "헉!" 하는 느낌 */
float easeOutBack(float t) {
  const float c1 = 1.70158f, c3 = c1 + 1.0f;
  float p = t - 1.0f;
  return 1.0f + c3 * p * p * p + c1 * p * p;
}

void updateStartle() {
  float t = animProgress(startle);
  if (t >= 1.0f) { startleBoost = 0; return; }
  startleBoost = (1.0f - easeOutBack(t)) * STARTLE_PX;
}

/* ============================================================================
   ④ 그리기 — sim/sim.js 의 drawScene() 과 1:1 대응
   ============================================================================ */
void renderFrame() {
  if (millis() - lastFrame < FRAME_MS) return;   // 조기 탈출로 25fps 제한
  lastFrame = millis();

  // ── 레이어 합성 ──
  int jx = (int)(curJit + 0.5f);                  // 떨림 (+시선이 있다면 여기 더한다)
  int r  = (int)(curR + startleBoost + 0.5f);     // 기본 크기 + 놀람. +0.5는 반올림
  if (r < 1)  r = 1;                              // 방어: 0이면 원이 안 그려진다
  if (r > 28) r = 28;                             // 방어: 화면 밖으로 나가지 않게

  Face f = activeFace();

  oled.clearDisplay();                            // ① 프레임버퍼를 0으로 (빠름)

  if (f == FACE_SLEEP) {
    drawSleepEye(LX + jx);
    drawSleepEye(RX + jx);
  }
  else if (f == FACE_LOCKED) {                    // ② 프레임버퍼에 그리기 (빠름)
    drawX(LX + jx, EY, R_LOCKED);
    drawX(RX + jx, EY, R_LOCKED);
  }
  else if (!eyeOpen) {
    oled.fillRect(LX + jx - 12, EY - 1, 24, 2, SSD1306_WHITE);
    oled.fillRect(RX + jx - 12, EY - 1, 24, 2, SSD1306_WHITE);
  }
  else if (f == FACE_ALERT) {
    int h = r * 2; if (h < 3) h = 3;
    oled.fillRect(LX + jx - 11, EY - h / 2, 22, h, SSD1306_WHITE);
    oled.fillRect(RX + jx - 11, EY - h / 2, 22, h, SSD1306_WHITE);
  }
  else {
    oled.fillCircle(LX + jx, EY, r, SSD1306_WHITE);
    oled.fillCircle(RX + jx, EY, r, SSD1306_WHITE);

    if (f == FACE_ALARM) {   // 성난 눈썹 — 바깥쪽이 위, 안쪽이 아래
      oled.drawLine(LX + jx - BROW_OUT_X, EY - BROW_OUT_Y,
                    LX + jx + BROW_IN_X,  EY - BROW_IN_Y, SSD1306_WHITE);
      oled.drawLine(RX + jx + BROW_OUT_X, EY - BROW_OUT_Y,
                    RX + jx - BROW_IN_X,  EY - BROW_IN_Y, SSD1306_WHITE);
    }
  }

  oled.setTextSize(1);
  oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(0, 0);
  oled.print("RISK "); oled.print(stress);

  oled.display();   // ③ 1024바이트를 I2C로 전송 (느림 — 프레임당 한 번만!)
}

void drawX(int cx, int cy, int d) {
  oled.drawLine(cx - d, cy - d, cx + d, cy + d, SSD1306_WHITE);
  oled.drawLine(cx + d, cy - d, cx - d, cy + d, SSD1306_WHITE);
}

void drawSleepEye(int cx) {
  for (int dx = -SLEEP_HALF_W; dx <= SLEEP_HALF_W; dx++) {
    int y = SLEEP_Y - (dx * dx * SLEEP_DROP_PX) / (SLEEP_HALF_W * SLEEP_HALF_W);
    oled.drawPixel(cx + dx, y, SSD1306_WHITE);
    oled.drawPixel(cx + dx, y + 1, SSD1306_WHITE);
  }
}

/* ============================================================================
   서보 몸짓 — 200ms 미만이라 블로킹을 허용한다
   ============================================================================ */
void gesture(const char* g) {
  if      (!strcmp(g, "center")) { panServo.write(PAN_CENTER); tiltServo.write(TILT_CENTER); }
  else if (!strcmp(g, "recoil")) { tiltServo.write(TILT_MAX); }        // 뒤로 젖힘
  else if (!strcmp(g, "tilt"))   { panServo.write(PAN_CENTER - 20); }  // 갸웃
  else if (!strcmp(g, "bow"))    { tiltServo.write(TILT_MIN); }        // 고개 숙임
  else if (!strcmp(g, "shake"))  {
    for (int i = 0; i < 3; i++) {
      panServo.write(PAN_CENTER - 15); delay(90);
      panServo.write(PAN_CENTER + 15); delay(90);
    }
    panServo.write(PAN_CENTER);
  }
}

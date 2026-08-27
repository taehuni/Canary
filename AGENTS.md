# AGENTS.md — CANARY

> 이 파일은 Codex(및 다른 코딩 에이전트)가 이 저장소에서 작업할 때 반드시 따라야 할 규칙이다.
> 작업을 시작하기 전에 전체를 읽을 것.

---

## 1. 프로젝트가 무엇인가

CANARY는 **Autonomous AI Agent가 위험한 행동을 제안할 때 몸으로 경고하고, 인간이 만지거나 흔들어 그 행동을 승인·중단할 수 있는 물리 인터페이스**다.

- 대회: TOYTHON 2026 (제작 시간 5시간, 16:30 이후 코드 수정 금지)
- 보드: **NUCODE NU-40 DK — Nordic nRF52840, Arduino IDE 공식 지원**
- 화면: SSD1306/SSD1309 계열 **128×64 단색 OLED**, I2C(Qwiic) 연결
- 그 외: MG90S 서보 ×2 (Pan/Tilt), 6축 IMU, TTP223 터치 ×2

핵심 메시지: *"Miners had canaries. Autonomous AI needs one too."*

---

## 2. 저장소 구조

```
canary/
├── AGENTS.md                     ← 지금 이 파일
├── README.md
├── sim/                          ← 브라우저 표정 시뮬레이터
│   ├── index.html
│   ├── style.css
│   ├── params.js                 ★ 단일 진실 공급원 (아래 §4)
│   └── sim.js
├── firmware/
│   └── canary_firmware.ino       ← 보드에 굽는 코드
└── host/
    └── controller.py             ← 맥북 쪽 컨트롤러
```

---

## 3. 절대 규칙

### 3.1 시뮬레이터

- **빌드 도구를 도입하지 말 것.** npm, Vite, webpack, TypeScript, React, Tailwind 전부 금지.
  `sim/index.html`을 **파일 탐색기에서 더블클릭하면 그냥 열려야 한다.**
- **ES 모듈(`import`/`export`)을 쓰지 말 것.** `file://` 프로토콜에서 CORS로 막힌다.
  전역 상수와 일반 `<script>` 태그만 사용한다.
- **외부 CDN, 외부 폰트, 외부 이미지를 추가하지 말 것.** 대회장 와이파이를 신뢰할 수 없다.
- 캔버스 렌더링은 반드시 **128×64 오프스크린 캔버스에 그린 뒤 확대**해야 한다.
  실제 OLED와 픽셀 단위로 같아야 시뮬레이터의 의미가 있다.

### 3.2 펌웨어

- **`delay()`를 새로 추가하지 말 것.** 200ms 미만의 서보 몸짓만 예외.
  나머지는 전부 `millis()` 기반 비블로킹 패턴.
- **`oled.display()`는 한 프레임에 정확히 한 번만** 호출한다. 두 번 이상이면 화면이 번쩍인다.
- **`Wire.setClock(400000)`을 지우지 말 것.** 없으면 10fps로 떨어진다.
- **`Serial.readStringUntil()`을 쓰지 말 것.** 기본 타임아웃 1000ms 때문에 보드가 얼어붙는다.
  한 글자씩 모으는 `handleSerial()` 방식을 유지한다.
- **ArduinoJson 등 JSON 라이브러리를 추가하지 말 것.** 보드↔맥북은 공백 구분 텍스트 한 줄이다.
- 시리얼로 들어온 값은 항상 `constrain()`으로 범위를 자른다.

### 3.3 통신 프로토콜 (변경 금지)

```
맥북 → 보드          보드 → 맥북
─────────────        ──────────────────
STRESS <0-100>       EVT TOUCH_HEAD
FACE <name>          EVT TOUCH_BODY
GESTURE <name>       EVT TOUCH_BODY_LONG
PING                 EVT SHAKE <0.00-9.99>
                     EVT FLIP
                     EVT ROTARY <0-100>
                     READY
                     PONG
```

- 모든 줄은 `\n`으로 끝난다.
- `FACE` 값: `calm | alert | tense | alarm | locked`
- `GESTURE` 값: `center | tilt | recoil | shake | bow`
- **새 명령을 추가할 때는 이 표와 `sim/params.js`와 `host/controller.py`를 함께 고친다.**

---

## 4. 단일 진실 공급원 — `sim/params.js`

표정을 결정하는 모든 숫자는 `sim/params.js`의 `PARAMS` 객체에 있다.

**시뮬레이터를 고쳤는데 펌웨어를 안 고치면 시뮬레이터가 거짓말이 된다.** 그러면 존재 이유가 사라진다.

### 값을 바꿀 때 반드시 3곳을 함께 고칠 것

1. `sim/params.js` 의 `PARAMS`
2. `firmware/canary_firmware.ino` 상단의 `// ── PARAMS ──` 블록
3. `sim/sim.js` 의 `generateCode()` 가 출력하는 코드 문자열

세 곳의 숫자가 다르면 그 커밋은 잘못된 것이다. 작업 후 스스로 검증할 것.

---

## 5. 실행 방법

```bash
# 시뮬레이터 — 서버 필요 없음
open sim/index.html          # macOS
xdg-open sim/index.html      # Linux

# 호스트 컨트롤러
pip3 install pyserial
ls /dev/tty.usbmodem*        # 포트 확인 후 controller.py 상단 PORT 수정
python3 host/controller.py

# 펌웨어 — Arduino IDE에서
#   보드 매니저 URL:
#   https://raw.githubusercontent.com/Nucode01/Adafruit_nRF52_Arduino/refs/heads/master/package_nuduino_index.json
#   보드: NUBoards nRF52 → NU40DK nRF52840
```

---

## 6. 우선순위 (시간이 부족할 때 무엇을 버리나)

| 등급 | 항목 | 버려도 되나 |
|---|---|:--:|
| **P0** | OLED 표정 4단계 · 깜빡임 · 시리얼 왕복 · IMU shake 취소 | ❌ |
| **P0** | 터치 WHY · 30초 타임아웃 자동 거부 | ❌ |
| **P1** | 몸통 long-press 승인 · 서보 몸짓 · lerp 전환 | ⚠️ |
| **P2** | Rotary 자율성 · 거리센서 · 시선 이동 · 떨림 | ✅ |

**P2 작업을 하다가 P0를 불안정하게 만들면 즉시 되돌린다.**

---

## 7. 하지 말 것

- 하드웨어 없이 검증 불가능한 대규모 리팩터링
- 파일 분할·디렉터리 재구성 (구조는 이미 정해졌다)
- 테스트 프레임워크 도입
- 표정을 비트맵 이미지(`drawBitmap`)로 교체 — 도형으로 그려야 크기를 실시간 변경할 수 있다
- 실제 파일 시스템에 대한 삭제 코드 작성. 삭제는 `host/fake_repo/` 안에서만, 경로 검사 필수

---

## 8. 커밋 규칙

- 한 커밋 = 한 가지 변경
- 메시지는 한국어 또는 영어, 무엇을 왜 바꿨는지 한 줄
- `sim`과 `firmware`의 숫자를 함께 바꿨다면 커밋 메시지에 `[sync]` 표시

---

## 9. 작업을 마치기 전 자가 점검

- [ ] `sim/index.html`을 더블클릭해서 열리는가 (서버 없이)
- [ ] `params.js` · `.ino` · `generateCode()` 세 곳의 숫자가 일치하는가
- [ ] 펌웨어에 새 `delay()`가 들어가지 않았는가
- [ ] `oled.display()`가 프레임당 한 번인가
- [ ] 프로토콜 표를 바꿨다면 3개 파일을 모두 고쳤는가

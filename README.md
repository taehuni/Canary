# CANARY

> **Miners had canaries. Autonomous AI needs one too.**

Autonomous AI Agent가 위험한 행동을 제안할 때 몸으로 경고하고, 인간이 만지거나 흔들어 그 행동을 승인·중단할 수 있는 작은 물리 인터페이스.

TOYTHON 2026 · NU-40 DK (Nordic nRF52840)

**[▶ 하드웨어 없이 지금 체험하기](https://taehuni.github.io/canary/)** — 브라우저에서 위험도를 올려보면 실제 OLED와 같은 128×64 픽셀로 카나리아 표정이 그려집니다.

---

## 빠른 시작

### 1. 시뮬레이터 (하드웨어 불필요)

```bash
open sim/index.html          # macOS
xdg-open sim/index.html      # Linux
```

서버가 필요 없습니다. 파일을 더블클릭해도 열립니다.

슬라이더로 위험도를 바꾸면 실제 OLED와 같은 128×64 픽셀로 표정이 그려지고, 아래에 붙여넣을 Arduino 코드가 나옵니다.

### 2. 펌웨어

Arduino IDE에서:

1. **환경설정 → 추가 보드 매니저 URL**
   ```
   https://raw.githubusercontent.com/Nucode01/Adafruit_nRF52_Arduino/refs/heads/master/package_nuduino_index.json
   ```
2. **보드 매니저** → `NUCODE` 검색 → **NUBoards nRF52 v1.0.1 이상** 설치
3. **툴 → 보드 → NUBoards nRF52 → NU40DK nRF52840**
4. 라이브러리 설치: `Adafruit GFX Library`, `Adafruit SSD1306`
5. `firmware/canary_firmware.ino` 열고 업로드

포트가 안 보이면 **RESET 버튼을 두 번 빠르게** 눌러 부트로더 모드로 진입하세요.

### 3. 호스트 컨트롤러

```bash
pip3 install pyserial
ls /dev/tty.usbmodem*                  # 포트 확인
# host/controller.py 상단 PORT 를 수정
python3 host/controller.py
```

```
> a    안전한 작업 제안        → 카나리아 평온
> b    14개 삭제 제안          → 눈이 커지고 고개가 젖혀짐
       (머리 터치)             → 이유를 음성으로 설명
       (로봇 흔들기)           → 취소. 파일 변경 0건
> r    fake-repo 초기화
> q    종료
```

---

## 구조

```
canary/
├── AGENTS.md                  ★ Codex 등 에이전트가 먼저 읽어야 할 규칙
├── sim/
│   ├── index.html
│   ├── style.css
│   ├── params.js              ★ 모든 표정 숫자의 단일 진실 공급원
│   └── sim.js
├── firmware/
│   └── canary_firmware.ino
└── host/
    └── controller.py
```

---

## 통신 프로토콜

USB Serial · 115200 · 개행 구분 텍스트. **JSON을 쓰지 않습니다.**

| 맥북 → 보드 | 보드 → 맥북 |
|---|---|
| `STRESS <0-100>` | `EVT TOUCH_HEAD` |
| `FACE <name>` | `EVT TOUCH_BODY` / `EVT TOUCH_BODY_LONG` |
| `GESTURE <name>` | `EVT SHAKE <0.00-9.99>` |
| `PING` | `EVT FLIP` / `EVT ROTARY <0-100>` |
| | `READY` / `PONG` |

`FACE`: `calm | alert | tense | alarm | locked`
`GESTURE`: `center | tilt | recoil | shake | bow`

---

## 위험도 4단계

| Stress | 단계 | 눈 반지름 | 정책 |
|---|---|---|---|
| 0–24 | CALM | 6 | 즉시 허용 |
| 25–54 | ALERT | 3 (실눈) | 자동 허용 가능 |
| 55–79 | TENSE | 10 | 이유 확인 |
| 80–100 | ALARM | 16 + 눈썹 | **물리 승인 필수** |

---

## 값을 수정할 때

표정 관련 숫자는 **세 곳이 항상 같아야** 합니다.

1. `sim/params.js` 의 `PARAMS`
2. `firmware/canary_firmware.ino` 상단 `// ── PARAMS ──` 블록
3. `sim/sim.js` 의 `generateCode()` 출력 문자열

하나만 고치면 시뮬레이터가 거짓말을 하게 되고, 존재 이유가 사라집니다.

---

## 안전 원칙

- AI에게 일반 셸을 주지 않습니다. 전용 도구로 **요청만** 할 수 있습니다.
- 실제 실행은 사람이 로봇을 물리적으로 조작해야 일어납니다.
- 승인이 없으면 30초 후 **자동 거부**됩니다. 안전 기본값은 항상 거부입니다.
- 삭제는 `host/fake_repo/` 안에서만, `realpath` 경계 검사를 통과한 경로에만 적용됩니다.

---

## 팀

TOYTHON 2026 (서울 AI 허브 피지컬 AI 해커톤) 에서 시작한 프로젝트입니다.

| 이름 | 역할 |
|---|---|
| taehuni | (여기에 본인 역할) |
| (팀원) | (역할) |
| (팀원) | (역할) |

## 라이선스

MIT — 자세한 내용은 [LICENSE](LICENSE) 참조.

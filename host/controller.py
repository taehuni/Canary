#!/usr/bin/env python3
"""
CANARY — 맥북 컨트롤러

역할:
  - AI Agent의 위험한 제안을 받아 위험도를 계산한다
  - NU-40 보드에 STRESS / FACE / GESTURE 명령을 보낸다
  - 보드의 물리 입력(터치, 흔들기)을 받아 승인/취소를 결정한다
  - 승인된 작업만 fake_repo 안에서 실행한다

실행:
  pip3 install pyserial
  ls /dev/tty.usbmodem*      # 포트 확인 후 아래 PORT 수정
  python3 controller.py
"""

import os
import time
import uuid
import shutil
import threading
import subprocess

import serial

# ── 설정 ────────────────────────────────────────────────────
PORT = "/dev/tty.usbmodem1101"   # ls /dev/tty.usbmodem* 로 확인해서 수정
BAUD = 115200

HERE = os.path.dirname(os.path.abspath(__file__))
FAKE_REPO = os.path.join(HERE, "fake_repo")
FAKE_SEED = os.path.join(HERE, "fake_repo_seed")

APPROVAL_TIMEOUT = 30            # 초. 이 시간 안에 승인 없으면 자동 거부

# ── 상태 ────────────────────────────────────────────────────
pending = None                   # 승인 대기 중인 요청 (없으면 None)
autonomy = 50                    # Rotary로 조절. 이 값 미만의 위험도는 자동 승인
read_only = False                # 뒤집기로 켜지는 하드 락

board = serial.Serial(PORT, BAUD, timeout=0.1)


# ── 유틸 ────────────────────────────────────────────────────
def send(cmd):
    """보드에 명령 한 줄. 반드시 \\n으로 끝나야 보드가 인식한다."""
    board.write((cmd + "\n").encode())


def say(text):
    """macOS 내장 TTS. 블로킹하지 않게 Popen을 쓴다."""
    subprocess.Popen(["say", "-v", "Yuna", text])


def safe_path(rel):
    """
    fake_repo 밖으로 나가는 경로를 차단한다.
    realpath로 풀어야 '../../Documents' 같은 우회를 막을 수 있다.
    """
    root = os.path.realpath(FAKE_REPO)
    full = os.path.realpath(os.path.join(FAKE_REPO, rel))
    if not full.startswith(root + os.sep) and full != root:
        raise ValueError(f"경계 밖 접근 차단: {rel}")
    return full


def reset_repo():
    """데모를 반복하기 위해 fake_repo를 원본에서 복구한다."""
    if os.path.isdir(FAKE_SEED):
        shutil.rmtree(FAKE_REPO, ignore_errors=True)
        shutil.copytree(FAKE_SEED, FAKE_REPO)
        print("CANARY: fake-repo reset")


# ── 위험도 평가 ─────────────────────────────────────────────
def assess(action, n=0):
    """(위험도 0~100, 사람에게 읽어줄 이유) 를 반환한다."""
    if action == "read":
        return 0, "읽기 작업입니다."
    if action == "edit":
        return 25, "파일 몇 개를 수정합니다."
    if action == "delete":
        if n >= 10:
            return 80, f"{n}개 파일을 삭제하려 합니다. 현재 자율성 기준을 넘었습니다."
        if n >= 3:
            return 55, f"{n}개 파일을 삭제하려 합니다."
        return 30, "파일 한두 개를 삭제합니다."
    if action in ("transfer", "shell"):
        return 100, "외부 전송 또는 셸 실행입니다. 거부됩니다."
    return 50, "알 수 없는 작업입니다."


def face_for(risk):
    if risk >= 80:
        return "alarm"
    if risk >= 55:
        return "tense"
    if risk >= 25:
        return "alert"
    return "calm"


# ── 요청 흐름 ───────────────────────────────────────────────
def on_proposal(action, paths):
    """AI가 작업을 제안했을 때 호출한다."""
    global pending

    if read_only:
        print("CANARY: READ-ONLY — 제안이 거부되었습니다")
        return

    risk, reason = assess(action, len(paths))

    pending = {
        "id": str(uuid.uuid4())[:8],
        "action": action,
        "paths": paths,
        "risk": risk,
        "reason": reason,
        "expires": time.time() + APPROVAL_TIMEOUT,
    }

    # ★ 물리 반응이 먼저다. TTS나 네트워크를 기다리지 않는다.
    send(f"STRESS {risk}")
    send(f"FACE {face_for(risk)}")
    if risk >= 80:
        send("GESTURE recoil")

    print(f"CANARY: RISK {risk} — {len(paths)} files pending physical approval")

    if risk >= 100:
        cancel("POLICY")                 # 최고 위험은 무조건 거부
    elif risk < autonomy:
        execute()                        # 자율성 기준 이하면 자동 승인


def execute():
    global pending
    if not pending:
        return

    print(f"CANARY: APPROVED — executing {pending['action']}")

    if pending["action"] == "delete":
        for rel in pending["paths"]:
            try:
                os.remove(safe_path(rel))
            except FileNotFoundError:
                pass
            except ValueError as e:
                print(f"CANARY: {e}")

    print(f"CANARY: done — {len(pending['paths'])} paths")
    reset_state("calm", 0)


def cancel(source):
    global pending
    if not pending:
        return
    print(f"CANARY: CANCELLED BY {source} — no files changed")
    say("작업을 중단했습니다.")
    reset_state("locked", 0)


def reset_state(face, risk):
    global pending
    pending = None
    send(f"STRESS {risk}")
    send(f"FACE {face}")
    send("GESTURE center")


# ── 보드 이벤트 수신 ────────────────────────────────────────
def reader():
    """
    별도 스레드에서 계속 돈다.
    메인 스레드가 input()에서 멈춰 있어도 보드 말을 놓치지 않기 위함.
    """
    global autonomy, read_only

    while True:
        try:
            line = board.readline().decode(errors="ignore").strip()
        except Exception as e:
            print(f"[serial error] {e}")
            time.sleep(0.5)
            continue

        if not line:
            continue

        p = line.split()

        if p[0] != "EVT":
            print(f"[board] {line}")     # READY, PONG, 디버그 출력 등
            continue

        evt = p[1]

        if evt == "TOUCH_HEAD":
            say(pending["reason"] if pending else "지금은 안전합니다.")

        elif evt == "TOUCH_BODY_LONG":
            execute()

        elif evt == "SHAKE":
            cancel("PHYSICAL KILL SWITCH")

        elif evt == "FLIP":
            read_only = True
            send("FACE locked")
            say("읽기 전용으로 전환합니다.")

        elif evt == "ROTARY" and len(p) > 2:
            autonomy = int(p[2])
            print(f"CANARY: autonomy = {autonomy}")


# ── 타임아웃 감시 ───────────────────────────────────────────
def watchdog():
    """승인이 없으면 자동 거부. 안전 기본값은 항상 '거부'다."""
    while True:
        if pending and time.time() > pending["expires"]:
            cancel("TIMEOUT")
        time.sleep(0.5)


# ── 시작 ────────────────────────────────────────────────────
if __name__ == "__main__":
    threading.Thread(target=reader, daemon=True).start()
    threading.Thread(target=watchdog, daemon=True).start()

    time.sleep(2)                # ★ 시리얼 연결 시 보드가 재부팅된다. 기다려야 한다.
    reset_state("calm", 0)
    print("CANARY controller ready.")
    print("  a = 안전한 작업   b = 위험한 삭제 제안   r = fake-repo 초기화   q = 종료")

    while True:
        try:
            c = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            break

        if c == "a":
            on_proposal("read", ["README.md"])
        elif c == "b":
            on_proposal("delete", [f"docs/legacy-{i:02d}.md" for i in range(14)])
        elif c == "r":
            reset_repo()
            read_only = False
            reset_state("calm", 0)
        elif c == "p":
            send("PING")
        elif c == "q":
            break

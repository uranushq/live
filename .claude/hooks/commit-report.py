#!/usr/bin/env python3
"""git commit이 실행되면 커밋 리포트를 메일로 보낸다.

두 가지 모드로 동작한다:

* git-hook 모드(--git-hook 인자): .git/hooks/post-commit이 호출한다. 터미널·IDE·
  Claude Code 등 무엇으로 커밋하든 '모든 커밋'에 실행된다. git은 커밋이 성공한
  뒤에만 post-commit을 부르므로 잘못된 리포트가 나가지 않는다.

* Claude Code hook 모드(인자 없음): stdin(JSON)을 읽는다. git hook이 이미 Claude
  Code 커밋도 커버하므로, 중복 메일 방지를 위해 이 저장소는 git hook만 연결한다.

- 이 스크립트에는 비밀 정보가 없다(안전하게 git 커밋 가능).
- SMTP 계정/비밀번호 등은 .claude/commit-report.env(gitignore됨)에서 읽는다.
- 설정이 없거나 발송 실패해도 절대 커밋 흐름을 막지 않는다(항상 exit 0).
"""
import json
import os
import re
import ssl
import smtplib
import subprocess
import sys
from email.message import EmailMessage
from pathlib import Path


GIT_HOOK_MODE = "--git-hook" in sys.argv


def emit(message: str) -> None:
    """상태 한 줄. git-hook 모드에선 평문, Claude Code 모드에선 systemMessage JSON."""
    if GIT_HOOK_MODE:
        print(message)
    else:
        print(json.dumps({"systemMessage": message}))


def to_native_path(p: str) -> str:
    """Git-Bash/MSYS 경로(/c/Users/...)를 Windows 경로(C:\\Users\\...)로 정규화.
    다른 형식은 그대로 반환."""
    if not p:
        return p
    m = re.match(r"^/([a-zA-Z])/(.*)$", p)
    if m:
        return f"{m.group(1).upper()}:\\" + m.group(2).replace("/", "\\")
    return p


def load_env(env_path: Path) -> None:
    """KEY=VALUE 형식의 env 파일을 os.environ에 로드(따옴표/주석 허용)."""
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def git(repo: Path, *args: str) -> str:
    try:
        out = subprocess.run(
            ["git", *args],
            cwd=repo,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
        )
        return out.stdout.strip()
    except Exception:
        return ""


def find_claude() -> str:
    """claude 실행파일 경로를 찾는다(env → PATH → 알려진 위치). 없으면 ''."""
    from shutil import which

    cand = os.environ.get("COMMIT_CLAUDE_BIN", "")
    if cand and Path(cand).exists():
        return cand
    for name in ("claude", "claude.exe"):
        p = which(name)
        if p:
            return p
    home = Path(os.path.expanduser("~"))
    for p in (home / ".local" / "bin" / "claude.exe", home / ".local" / "bin" / "claude"):
        if p.exists():
            return str(p)
    return ""


def read_capped(path: Path, limit: int) -> str:
    try:
        t = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return ""
    return t if len(t) <= limit else t[:limit] + "\n...(생략)..."


def analyze_commit(repo: Path, meta: dict, model: str) -> str:
    """claude 헤드리스로 커밋 diff를 분석해 마크다운 텍스트를 반환. 실패 시 ''."""
    claude_bin = find_claude()
    if not claude_bin:
        return ""
    status_doc = read_capped(repo / "docs" / "PROJECT_STATUS.md", 6000)
    diff = git(repo, "show", "HEAD", "--format=", "-p")
    if len(diff) > 12000:
        diff = diff[:12000] + "\n...(diff 생략)..."

    prompt = (
        "너는 이 소프트웨어 프로젝트의 커밋을 분석하는 어시스턴트다.\n"
        "아래 [프로젝트 개요]를 참고해, [이번 커밋]이 무엇을 바꿨고 프로젝트 진행에\n"
        "어떤 의미인지 한국어로 간결하게 분석하라. 도구를 쓰지 말고 주어진 정보만으로\n"
        "판단하라. 반드시 아래 마크다운 형식으로만 출력하라(다른 제목/서론 없이):\n\n"
        "**요약**: (한 줄)\n"
        "**주요 변경점**:\n- ...\n"
        "**의미/영향**: (기존 기능·진행상황 관점, 2-3문장)\n"
        "**주의/리스크**: (없으면 \"특이사항 없음\")\n\n"
        f"[프로젝트 개요]\n{status_doc}\n\n"
        f"[이번 커밋]\n해시: {meta['hash']}\n브랜치: {meta['branch']}\n"
        f"메시지: {meta['subject']}\n{meta['body']}\n\n"
        f"변경 통계:\n{meta['stat']}\n\ndiff:\n{diff}\n"
    )
    try:
        out = subprocess.run(
            [claude_bin, "-p", "--model", model],
            input=prompt,
            cwd=repo,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=240,
        )
        return out.stdout.strip()
    except Exception:
        return ""


def append_dev_log(repo: Path, meta: dict, analysis: str) -> None:
    """DEV_LOG.md의 <!-- ENTRIES --> 마커 바로 아래에 최신 항목을 추가."""
    log = repo / "docs" / "DEV_LOG.md"
    marker = "<!-- ENTRIES -->"
    entry = (
        f"\n## {meta['date']} — `{meta['hash']}` {meta['subject']}\n\n"
        f"_branch: {meta['branch']} · author: {meta['author']}_\n\n"
        f"{analysis}\n\n---\n"
    )
    try:
        content = log.read_text(encoding="utf-8", errors="replace") if log.exists() else (marker + "\n")
        if marker in content:
            content = content.replace(marker, marker + "\n" + entry, 1)
        else:
            content += "\n" + entry
        log.parent.mkdir(parents=True, exist_ok=True)
        log.write_text(content, encoding="utf-8")
    except Exception:
        pass


def resolve_repo() -> Path:
    """리포트를 만들 저장소 경로를 결정한다."""
    if GIT_HOOK_MODE:
        # git은 워크트리 루트에서 post-commit을 실행한다.
        top = git(Path(os.getcwd()), "rev-parse", "--show-toplevel")
        return Path(to_native_path(top) if top else os.getcwd())
    # Claude Code hook 모드: stdin(JSON)에서 cwd를 얻는다.
    try:
        payload = json.load(sys.stdin)
    except Exception:
        payload = {}
    command = (payload.get("tool_input") or {}).get("command", "")
    if "git commit" not in command:
        sys.exit(0)
    return Path(to_native_path(payload.get("cwd") or os.getcwd()))


def main() -> int:
    repo = resolve_repo()

    # 로컬 env(비밀) 로드
    load_env(repo / ".claude" / "commit-report.env")

    host = os.environ.get("COMMIT_SMTP_HOST", "")
    port = int(os.environ.get("COMMIT_SMTP_PORT", "587") or "587")
    user = os.environ.get("COMMIT_SMTP_USER", "")
    password = os.environ.get("COMMIT_SMTP_PASS", "")
    mail_from = os.environ.get("COMMIT_MAIL_FROM", user)
    mail_to = os.environ.get("COMMIT_MAIL_TO", "")
    use_ssl = os.environ.get("COMMIT_SMTP_SSL", "").lower() in ("1", "true", "yes")

    # 설정이 없으면 조용히 종료(커밋 방해 금지)
    if not (host and mail_to and mail_from):
        emit(
            "commit-report: SMTP 설정 미완료 -- 메일 건너뜀. "
            ".claude/commit-report.env 를 채우세요."
        )
        return 0

    # 최신 커밋 정보 수집
    commit_hash = git(repo, "rev-parse", "--short", "HEAD")
    if not commit_hash:
        return 0  # 커밋이 없으면 스킵
    branch = git(repo, "rev-parse", "--abbrev-ref", "HEAD")
    subject = git(repo, "log", "-1", "--format=%s")
    author = git(repo, "log", "-1", "--format=%an <%ae>")
    date = git(repo, "log", "-1", "--format=%cd", "--date=iso")
    body = git(repo, "log", "-1", "--format=%b")
    stat = git(repo, "show", "--stat", "--format=", "HEAD")

    # Claude(Opus) 커밋 분석 — 실패해도 메일/커밋에 영향 없음
    meta = {
        "hash": commit_hash,
        "branch": branch,
        "subject": subject,
        "author": author,
        "date": date,
        "body": body,
        "stat": stat,
    }
    analysis = ""
    if os.environ.get("COMMIT_ANALYZE", "1").lower() not in ("0", "false", "no", "off"):
        model = os.environ.get("COMMIT_ANALYZE_MODEL", "opus")
        emit(f"commit-report: {model}로 커밋 {commit_hash} 분석 중...")
        analysis = analyze_commit(repo, meta, model)
        if analysis:
            append_dev_log(repo, meta, analysis)

    report = (
        f"New commit in {repo}\n\n"
        f"Commit : {commit_hash}\n"
        f"Branch : {branch}\n"
        f"Author : {author}\n"
        f"Date   : {date}\n"
        f"Subject: {subject}\n"
    )
    if body:
        report += f"\n{body}\n"
    report += f"\nChanges:\n{stat or '(no file changes)'}\n"
    if analysis:
        report += "\n" + ("=" * 52) + "\n[Claude 분석]\n" + ("=" * 52) + "\n" + analysis + "\n"

    # 메일 구성
    msg = EmailMessage()
    tag = "[commit+분석]" if analysis else "[commit]"
    msg["Subject"] = f"{tag} {branch} {commit_hash} - {subject}"
    msg["From"] = mail_from
    msg["To"] = mail_to
    msg.set_content(report)

    # 발송 (실패해도 커밋은 막지 않음)
    try:
        if use_ssl or port == 465:
            ctx = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, port, context=ctx, timeout=20) as s:
                if user and password:
                    s.login(user, password)
                s.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=20) as s:
                s.ehlo()
                try:
                    s.starttls(context=ssl.create_default_context())
                    s.ehlo()
                except smtplib.SMTPException:
                    pass  # STARTTLS 미지원 서버면 평문 진행
                if user and password:
                    s.login(user, password)
                s.send_message(msg)
    except Exception as e:
        emit(f"commit-report: 메일 발송 실패 ({e})")
        return 0

    emit(f"commit-report: emailed {commit_hash} to {mail_to}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

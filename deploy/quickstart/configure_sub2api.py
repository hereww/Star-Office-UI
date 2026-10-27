#!/usr/bin/env python3
"""Interactively configure the optional Star Office UI -> Sub2API link.

The script writes only deployment metadata to ``.env``.  The scoped s2ut
credential and the office admin password hash are kept in private files so a
shell history, a Compose file, or ``docker inspect`` never contains the token.
It does not install a Sub2API plugin: the signed plugin must be installed and
enabled in Sub2API first.
"""
from __future__ import annotations

import argparse
import getpass
import hashlib
import os
import re
import secrets
import shlex
import shutil
import ssl
import stat
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit


TOKEN_RE = re.compile(r"s2ut_[A-Za-z0-9_-]{43}\Z")
ID_RE = re.compile(r"[1-9][0-9]{0,18}\Z")
INT64_MAX = 2**63 - 1
PBKDF2_ITERATIONS = 600_000


class ConfigError(ValueError):
    pass


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"sub2api-config: {message}")


def validate_id(value: str, label: str = "ID") -> str:
    value = value.strip()
    if not ID_RE.fullmatch(value) or int(value) > INT64_MAX:
        raise ConfigError(f"{label} 必须是 1 到 9223372036854775807 的十进制数字")
    return value


def parse_user_ids(value: str) -> list[str]:
    values = [part.strip() for part in value.split(",") if part.strip()]
    if not 1 <= len(values) <= 500:
        raise ConfigError("用户 ID 必须填写 1 到 500 个")
    normalized = [validate_id(part, "用户 ID") for part in values]
    if len(set(normalized)) != len(normalized):
        raise ConfigError("用户 ID 不能重复")
    return sorted(normalized, key=int)


def normalize_url(value: str, allow_http: bool) -> str:
    value = value.strip().rstrip("/")
    try:
        parsed = urlsplit(value)
        # Accessing .port validates malformed ports without making a request.
        _ = parsed.port
    except ValueError as exc:
        raise ConfigError("Sub2API 地址端口无效") from exc
    schemes = {"https", "http"} if allow_http else {"https"}
    if (parsed.scheme not in schemes or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or parsed.path not in ("", "/")
            or parsed.query or parsed.fragment or any(char.isspace() for char in value)):
        expected = "HTTPS" if not allow_http else "HTTPS 或显式允许的 HTTP"
        raise ConfigError(f"Sub2API 地址必须是无路径的 {expected} origin，例如 https://sub2api.example.com")
    return value


def normalize_expiry(value: str) -> str:
    value = value.strip()
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ConfigError("凭据到期时间必须是带时区的 ISO-8601，例如 2026-12-31T12:00:00Z") from exc
    if parsed.tzinfo is None:
        raise ConfigError("凭据到期时间必须包含时区")
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def regular_file(path: Path, label: str, modes=(0o400, 0o600)) -> Path:
    try:
        info = path.lstat()
    except OSError as exc:
        raise ConfigError(f"{label} 不可读：{path}") from exc
    if path.is_symlink() or not stat.S_ISREG(info.st_mode):
        raise ConfigError(f"{label} 必须是普通文件，不能是符号链接：{path}")
    if stat.S_IMODE(info.st_mode) not in modes:
        allowed = "/".join(format(mode, "04o") for mode in modes)
        raise ConfigError(f"{label} 权限必须为 {allowed}：{path}")
    return path


def read_secret_file(path: Path, label: str) -> str:
    regular_file(path, label)
    try:
        return path.read_text(encoding="ascii").strip()
    except (OSError, UnicodeError) as exc:
        raise ConfigError(f"{label} 不是可读的 ASCII 文件：{path}") from exc


def atomic_write(path: Path, content: str, mode: int) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.parent.chmod(0o700)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        path.chmod(mode)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def copy_private(source: Path, target: Path, mode: int = 0o600) -> None:
    regular_file(source, "输入文件", modes=(0o400, 0o440, 0o600, 0o640, 0o644))
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    target.parent.chmod(0o700)
    fd, temporary = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "wb") as output, source.open("rb") as input_file:
            shutil.copyfileobj(input_file, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
        target.chmod(mode)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def default_ca_file() -> Path | None:
    candidate = ssl.get_default_verify_paths().cafile
    if candidate:
        path = Path(candidate)
        if path.is_file() and b"BEGIN CERTIFICATE" in path.read_bytes():
            return path
    for candidate in ("/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt"):
        path = Path(candidate)
        if path.is_file() and b"BEGIN CERTIFICATE" in path.read_bytes():
            return path
    return None


def generate_password_hash(password: str) -> str:
    if not password or len(password) > 1024:
        raise ConfigError("办公室管理员密码不能为空，且不能超过 1024 个字符")
    alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    salt = "".join(secrets.choice(alphabet) for _ in range(24))
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("ascii"), PBKDF2_ITERATIONS)
    return f"pbkdf2:sha256:{PBKDF2_ITERATIONS}${salt}${digest.hex()}"


def parse_env(path: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    if not path.exists():
        return result
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            continue
        try:
            parsed = shlex.split(value, comments=False, posix=True)
            result[key] = parsed[0] if len(parsed) == 1 else value
        except ValueError:
            result[key] = value.strip().strip("'\"")
    return result


def quote_env(value: str) -> str:
    return shlex.quote(str(value))


def update_env(path: Path, values: dict[str, str]) -> None:
    existing = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    seen: set[str] = set()
    output: list[str] = []
    for raw in existing:
        line = raw
        stripped = raw.strip()
        key = None
        candidate = stripped[7:].lstrip() if stripped.startswith("export ") else stripped
        if "=" in candidate and not candidate.startswith("#"):
            candidate_key = candidate.split("=", 1)[0].strip()
            if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", candidate_key):
                key = candidate_key
        if key in values:
            output.append(f"{key}={quote_env(values[key])}")
            seen.add(key)
        else:
            output.append(line)
    if output and output[-1] != "":
        output.append("")
    for key, value in values.items():
        if key not in seen:
            output.append(f"{key}={quote_env(value)}")
    atomic_write(path, "\n".join(output).rstrip("\n") + "\n", 0o600)


def ask(label: str, default: str | None = None, *, secret: bool = False, required: bool = True) -> str:
    prompt = label
    if default not in (None, ""):
        prompt += f" [{default}]"
    prompt += ": "
    value = (getpass.getpass(prompt) if secret else input(prompt)).strip()
    if not value and default is not None:
        value = default
    if required and not value:
        raise ConfigError(f"{label} 不能为空")
    return value


def ask_secret(label: str, existing: str | None = None) -> str:
    prompt = label
    if existing:
        prompt += "（直接回车保留现有凭据）"
    value = getpass.getpass(prompt + ": ").strip()
    if not value and existing:
        return existing
    if not value:
        raise ConfigError(f"{label} 不能为空")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install-dir", type=Path, required=True)
    parser.add_argument("--sub2api-base-url")
    parser.add_argument("--installation-id")
    parser.add_argument("--user-ids")
    parser.add_argument("--credential-expires-at")
    parser.add_argument("--token-file", type=Path, help="已有 s2ut_... 文件；不接受 token 文字参数")
    parser.add_argument("--ca-file", type=Path, help="Sub2API CA bundle；不提供时复制本机默认 CA bundle")
    parser.add_argument("--admin-password-file", type=Path, help="包含办公室管理员密码的一行私有文件")
    parser.add_argument("--admin-username")
    parser.add_argument("--allow-http-sub2api", action="store_true")
    parser.add_argument("--allow-http-admin", action="store_true")
    parser.add_argument("--non-interactive", action="store_true")
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    install_dir = args.install_dir.expanduser().resolve()
    install_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    install_dir.chmod(0o700)
    env_path = install_dir / ".env"
    existing_env = parse_env(env_path)
    private_dir = install_dir / "private"
    token_path = private_dir / "office-consumer.token"
    ca_path = private_dir / "upstream-ca.pem"
    password_hash_path = private_dir / "office-admin-password.hash"

    try:
        allow_http_sub2api = args.allow_http_sub2api or existing_env.get("OFFICE_ALLOW_HTTP") == "1"
        base_url_raw = args.sub2api_base_url or existing_env.get("OFFICE_SUB2API_BASE_URL")
        if not base_url_raw:
            if args.non_interactive:
                raise ConfigError("--non-interactive 必须提供 --sub2api-base-url")
            base_url_raw = ask("Sub2API HTTPS 地址")
        base_url = normalize_url(base_url_raw, allow_http_sub2api)
        if urlsplit(base_url).scheme == "http" and not allow_http_sub2api:
            raise ConfigError("HTTP 上游必须显式使用 --allow-http-sub2api")

        installation_raw = args.installation_id or existing_env.get("OFFICE_INSTALLATION_ID")
        if not installation_raw:
            if args.non_interactive:
                raise ConfigError("--non-interactive 必须提供 --installation-id")
            installation_raw = ask("插件安装 ID", "1")
        installation_id = validate_id(installation_raw, "插件安装 ID")

        user_ids_raw = args.user_ids or existing_env.get("OFFICE_USER_IDS")
        if not user_ids_raw:
            if args.non_interactive:
                raise ConfigError("--non-interactive 必须提供 --user-ids")
            user_ids_raw = ask("Star Office 用户 ID（逗号分隔，例如 42,43）")
        user_ids = parse_user_ids(user_ids_raw)

        expiry_raw = args.credential_expires_at or existing_env.get("OFFICE_CREDENTIAL_EXPIRES_AT")
        if not expiry_raw:
            if args.non_interactive:
                raise ConfigError("--non-interactive 必须提供 --credential-expires-at")
            expiry_raw = ask("凭据到期时间（带时区 ISO-8601）")
        expiry = normalize_expiry(expiry_raw)

        existing_token = None
        if token_path.exists():
            try:
                existing_token = read_secret_file(token_path, "现有 Sub2API 凭据")
            except ConfigError:
                existing_token = None
        if args.token_file:
            token = read_secret_file(args.token_file.expanduser(), "Sub2API 凭据文件")
        elif args.non_interactive:
            if not existing_token:
                raise ConfigError("--non-interactive 必须提供 --token-file")
            token = existing_token
        else:
            token = ask_secret("Sub2API s2ut_ 只读凭据", existing_token)
        if not TOKEN_RE.fullmatch(token):
            raise ConfigError("凭据必须匹配 s2ut_ 加 43 位安全字符")

        ca_source = args.ca_file.expanduser() if args.ca_file else None
        if ca_source is None and existing_env.get("OFFICE_UPSTREAM_CA_FILE"):
            candidate = Path(existing_env["OFFICE_UPSTREAM_CA_FILE"]).expanduser()
            if candidate.exists():
                ca_source = candidate
        if ca_source is None and not args.non_interactive:
            value = input("Sub2API CA bundle 路径（回车使用本机默认 CA）: ").strip()
            if value:
                ca_source = Path(value).expanduser().resolve()
        if ca_source is None:
            ca_source = default_ca_file()
        if ca_source is None:
            raise ConfigError("找不到 CA bundle，请使用 --ca-file 提供 PEM CA 文件")
        regular_file(ca_source, "CA bundle", modes=(0o400, 0o440, 0o600, 0o640, 0o644))
        if b"BEGIN CERTIFICATE" not in ca_source.read_bytes():
            raise ConfigError("CA bundle 不包含 PEM CERTIFICATE")

        admin_username = args.admin_username or existing_env.get("OFFICE_ADMIN_USERNAME", "admin")
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", admin_username):
            raise ConfigError("管理员用户名只能包含字母、数字、下划线、点和连字符")
        existing_hash = None
        if password_hash_path.exists():
            try:
                existing_hash = read_secret_file(password_hash_path, "现有管理员密码哈希")
            except ConfigError:
                existing_hash = None
        if args.admin_password_file:
            password = read_secret_file(args.admin_password_file.expanduser(), "管理员密码文件")
            password_hash = generate_password_hash(password)
        elif args.non_interactive:
            if not existing_hash:
                raise ConfigError("--non-interactive 必须提供 --admin-password-file（首次配置）")
            password_hash = existing_hash
        else:
            password = getpass.getpass("办公室管理员密码（不会显示）: ")
            confirm = getpass.getpass("再次输入办公室管理员密码: ")
            if password != confirm:
                raise ConfigError("两次管理员密码不一致")
            password_hash = generate_password_hash(password)

        office_admin_secret = existing_env.get("OFFICE_ADMIN_SECRET") or secrets.token_urlsafe(32)
        if len(office_admin_secret) < 24:
            office_admin_secret = secrets.token_urlsafe(32)
        consumer_volume = existing_env.get("STAR_OFFICE_CONSUMER_VOLUME", "star-office-ui-consumer-secret")
        admin_volume = existing_env.get("STAR_OFFICE_ADMIN_VOLUME", "star-office-ui-admin-secret")
        trust_volume = existing_env.get("STAR_OFFICE_TRUST_VOLUME", "star-office-ui-upstream-trust")

        atomic_write(token_path, token + "\n", 0o600)
        copy_private(ca_source, ca_path, 0o644)
        atomic_write(password_hash_path, password_hash + "\n", 0o600)

        values = {
            "OFFICE_ENABLED": "1",
            "OFFICE_RELEASE_ID": existing_env.get("OFFICE_RELEASE_ID", "quickstart"),
            "OFFICE_USER_IDS": ",".join(user_ids),
            "OFFICE_SUB2API_BASE_URL": base_url,
            "OFFICE_INSTALLATION_ID": installation_id,
            "OFFICE_CREDENTIAL_EXPIRES_AT": expiry,
            "OFFICE_ALLOW_HTTP": "1" if urlsplit(base_url).scheme == "http" else "0",
            "OFFICE_CONSUMER_FILE": str(token_path),
            "OFFICE_UPSTREAM_CA_FILE": str(ca_path),
            "OFFICE_ADMIN_USERNAME": admin_username,
            "OFFICE_ADMIN_SECRET": office_admin_secret,
            "OFFICE_ADMIN_ALLOW_HTTP": "1" if args.allow_http_admin or existing_env.get("OFFICE_ADMIN_ALLOW_HTTP") == "1" else "0",
            "STAR_OFFICE_CONSUMER_VOLUME": consumer_volume,
            "STAR_OFFICE_ADMIN_VOLUME": admin_volume,
            "STAR_OFFICE_TRUST_VOLUME": trust_volume,
            "OFFICE_ADMIN_PASSWORD_HASH_FILE": str(password_hash_path),
        }
        update_env(env_path, values)
        print(f"Sub2API 联动配置已写入：{install_dir}")
        print(f"  地址：{base_url}")
        print(f"  插件安装 ID：{installation_id}")
        print(f"  用户范围：{','.join(user_ids)}")
        print(f"  凭据文件：{token_path}（0600）")
        print(f"  CA 文件：{ca_path}")
        print(f"  凭据到期：{expiry}")
        if values["OFFICE_ADMIN_ALLOW_HTTP"] == "1":
            print("  管理入口：HTTP 已显式启用，仅适合受控内网；生产请改用 HTTPS。")
        return 0
    except (ConfigError, OSError, UnicodeError) as exc:
        fail(str(exc))


if __name__ == "__main__":
    raise SystemExit(main())

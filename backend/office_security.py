"""Independent signed opaque admin sessions, CSRF and DB-backed login budget.

Office does not use Flask's legacy asset drawer authentication or SECRET_KEY.
The deployment supplies OFFICE_ADMIN_PASSWORD_HASH and OFFICE_ADMIN_SECRET;
there is no fallback credential, default password or generated production secret.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from urllib.parse import urlsplit

from itsdangerous import BadSignature, URLSafeSerializer
from werkzeug.security import check_password_hash

try:
    from .security_utils import is_strong_secret
except ImportError:
    from security_utils import is_strong_secret

COOKIE_NAME = "office_admin_session"
COOKIE_PATH = "/"
PREAUTH_TTL = 1800
ADMIN_TTL = 12 * 3600


def strong_password_hash(value):
    if not isinstance(value, str) or len(value) > 512:
        return False
    try:
        method, salt, digest = value.split("$")
        if len(salt) < 16 or not re.fullmatch(r"[A-Za-z0-9]+", salt) or not re.fullmatch(r"[0-9a-f]+", digest):
            return False
        if method.startswith("scrypt:"):
            algorithm, n, r, p = method.split(":")
            n, r, p = int(n), int(r), int(p)
            return (algorithm == "scrypt" and 32768 <= n <= 131072 and n & (n - 1) == 0
                    and 8 <= r <= 16 and 1 <= p <= 4 and n * r * p <= 2097152 and len(digest) == 128)
        if method.startswith("pbkdf2:sha256:"):
            iterations = int(method.split(":")[-1])
            return 600000 <= iterations <= 2000000 and len(digest) == 64
    except (ValueError, TypeError):
        pass
    return False


class OfficeSecurity:
    def __init__(self, store, username, password_hash, secret):
        self.store, self.username, self.password_hash = store, username, password_hash
        self.enabled = (isinstance(username, str) and bool(username) and len(username) <= 80
                        and isinstance(secret, str) and is_strong_secret(secret)
                        and strong_password_hash(password_hash))
        self.secret = secret.encode("utf-8") if self.enabled else b""
        self.signer = URLSafeSerializer(secret, salt="office-admin-v1", signer_kwargs={"digest_method": hashlib.sha256}) if self.enabled else None

    def decode_cookie(self, value):
        if not self.enabled or not isinstance(value, str) or len(value) > 256:
            return None
        try:
            token = self.signer.loads(value)
        except BadSignature:
            return None
        return token if isinstance(token, str) and re.fullmatch(r"[A-Za-z0-9_-]{43}", token) else None

    @staticmethod
    def digest(token):
        return hashlib.sha256(token.encode("ascii")).hexdigest()

    def lookup(self, cookie):
        token = self.decode_cookie(cookie)
        record = self.store.session(self.digest(token)) if token else None
        return token, record

    def csrf(self, token):
        return hmac.new(self.secret, ("csrf:" + token).encode("ascii"), hashlib.sha256).hexdigest()

    def new_session(self, authenticated=False, old_token=None):
        token = secrets.token_urlsafe(32)
        ttl = ADMIN_TTL if authenticated else PREAUTH_TTL
        self.store.create_session(self.digest(token), authenticated, ttl,
                                  self.digest(old_token) if old_token else None)
        return token

    def set_cookie(self, response, token, authenticated=False):
        response.set_cookie(COOKIE_NAME, self.signer.dumps(token), max_age=ADMIN_TTL if authenticated else PREAUTH_TTL,
                            secure=True, httponly=True, samesite="Lax", path=COOKIE_PATH)
        return response

    def csrf_valid(self, token, candidate):
        return (isinstance(candidate, str) and len(candidate) == 64 and bool(token)
                and hmac.compare_digest(candidate, self.csrf(token)))

    @staticmethod
    def same_origin(request):
        expected = request.host_url.rstrip("/")
        origin = request.headers.get("Origin")
        if origin is not None:
            return origin == expected
        # Some same-origin clients omit Origin. A verified Referer is acceptable.
        referer = request.headers.get("Referer")
        if not referer:
            return False
        try:
            url = urlsplit(referer)
            return url.scheme + "://" + url.netloc == expected and url.username is None and url.password is None
        except ValueError:
            return False

    def verify_password(self, username, password):
        if not isinstance(password, str) or len(password) > 1024 or not isinstance(username, str) or len(username) > 80:
            return False
        # Always run the configured hash even for a wrong username.
        try:
            valid = check_password_hash(self.password_hash, password)
        except (ValueError, TypeError):
            return False
        return valid and hmac.compare_digest(username.encode("utf-8"), self.username.encode("utf-8"))

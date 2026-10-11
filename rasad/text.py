"""Language-aware normalization for Persian / Arabic / English (no heavy deps)."""
import hashlib
import re
import unicodedata
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

AR_TO_FA = str.maketrans({"ي": "ی", "ى": "ی", "ك": "ک", "ۀ": "ه", "ة": "ه", "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ؤ": "و", "ئ": "ی"})
DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
DIACRITICS = re.compile(r"[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]")
ZW = re.compile(r"[\u200c\u200d\u200e\u200f\ufeff]")
TOKEN = re.compile(r"[\w\u0600-\u06FF]+", re.UNICODE)
FA_ONLY = set("پچژگ")
FA_HINTS = {"است", "این", "که", "را", "می", "های", "شد", "برای", "با", "از"}
AR_HINTS = {"في", "من", "على", "إلى", "التي", "الذي", "عن", "مع", "أن", "قال"}

STOP = set("""
و در به از که این را با است برای آن یک تا بر شد می ها های شده کرد هم خود او ما شود نیز یا اما پس اگر بود باید
وی آنها کند کنند دارد گفت گفته پیش پس روز سال اینکه چه همه بین هر دیگر ای خواهد بوده کرده
في من على إلى عن مع أن التي الذي هذا هذه ذلك كان قد لا ما و أو ثم بعد قبل حتى كل بين عند قال إن
the a an of to in and for on with at by from is are was were be been has have had it its as that this
these those or but not no will would can could said says after over new into about than more up out his her their
""".split())


def normalize(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKC", s)
    s = DIACRITICS.sub("", s)
    s = ZW.sub(" ", s)
    s = s.translate(AR_TO_FA).translate(DIGITS)
    return re.sub(r"\s+", " ", s).strip().lower()


def detect_lang(s: str) -> str:
    if not s:
        return "other"
    arabic_script = sum(1 for ch in s if "\u0600" <= ch <= "\u06FF")
    latin = sum(1 for ch in s if ch.isascii() and ch.isalpha())
    if arabic_script > latin:
        if any(ch in FA_ONLY for ch in s):
            return "fa"
        words = set(TOKEN.findall(s))
        return "fa" if len(words & FA_HINTS) >= len(words & AR_HINTS) and words & FA_HINTS else "ar"
    return "en" if latin else "other"


def tokens(s: str):
    return [t for t in TOKEN.findall(normalize(s)) if t not in STOP and len(t) > 1 and not t.isdigit()]


def shingles(s: str, k: int = 5):
    s = re.sub(r"\s+", " ", normalize(s))
    return {s[i:i + k] for i in range(max(1, len(s) - k + 1))}


def canonical_url(u: str) -> str:
    try:
        p = urlparse(u.strip())
        qs = [(k, v) for k, v in parse_qsl(p.query) if not k.lower().startswith(("utm_", "at_", "fbclid", "gclid", "ocid"))]
        return urlunparse((p.scheme.lower(), p.netloc.lower().removeprefix("www."), p.path.rstrip("/"), "", urlencode(qs), ""))
    except Exception:
        return u


def sha(s: str, n: int = 16) -> str:
    return hashlib.sha256(s.encode("utf-8", "ignore")).hexdigest()[:n]


def strip_html(s: str) -> str:
    s = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", s or "", flags=re.S | re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    import html
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def sentences(s: str):
    parts = re.split(r"(?<=[\.\!\?؟!])\s+|\n+", s or "")
    return [p.strip() for p in parts if len(p.strip()) > 25]

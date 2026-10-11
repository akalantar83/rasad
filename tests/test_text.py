from rasad.text import normalize, detect_lang, canonical_url, tokens, shingles


def test_arabic_letters_normalized_to_persian():
    assert normalize("كيف يمكن") == normalize("کیف یمکن")
    assert "ك" not in normalize("كتاب")


def test_digits_and_zwnj():
    assert normalize("۱۲۳") == "123"
    assert normalize("می\u200cشود") == "می شود"


def test_detect_lang():
    assert detect_lang("ایران و آمریکا درباره تحریم‌ها گفتگو می‌کنند") == "fa"
    assert detect_lang("قالت وزارة الخارجية إن المحادثات ستستأنف") == "ar"
    assert detect_lang("Oil prices rose after the strait was closed") == "en"


def test_canonical_url_strips_tracking():
    a = canonical_url("https://Example.com/a/b?utm_source=x&id=5&fbclid=1")
    assert "utm_source" not in a and "fbclid" not in a and "id=5" in a


def test_tokens_and_shingles():
    t = tokens("The oil price in the Strait of Hormuz")
    assert "the" not in t and "hormuz" in t
    assert len(shingles("abcdefg", 5)) == 3

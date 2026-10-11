from rasad.taxonomy import find_entities, classify, has_denial


def test_multilingual_entity_linking_same_id():
    fa = find_entities("نفتکش‌ها در تنگه هرمز متوقف شدند")
    ar = find_entities("توقف ناقلات النفط في مضيق هرمز")
    en = find_entities("Tankers halted in the Strait of Hormuz")
    assert set(fa) & set(ar) & set(en), (fa, ar, en)


def test_us_acronym_case_sensitive():
    assert "US" in find_entities("The US imposed new sanctions")
    assert "US" not in find_entities("let us talk about it")


def test_classify_sanctions_and_energy():
    r = classify("New US sanctions target Iranian oil exports and crude tankers")
    assert r["category"] in {"sanctions", "energy"}


def test_denial_detection():
    assert has_denial("وزارت خارجه این خبر را تکذیب کرد")
    assert not has_denial("وزیر از توافق جدید خبر داد")

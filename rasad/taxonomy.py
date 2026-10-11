"""Topic taxonomy, urgency/sentiment lexicons and a multilingual gazetteer (fa/ar/en).

Gazetteer IDs are language-independent, which lets the clusterer link stories across languages
even without embeddings or translation.
"""
import re
from functools import lru_cache

from .text import normalize

# ---- Topics (category color = semantic palette from the Asana reference design) ----
TOPICS = {
    "geopolitics": {"fa": "ژئوپلیتیک و دیپلماسی", "color": "#5E9FE8", "kw": [
        "دیپلمات", "مذاکره", "وزیر خارجه", "سفیر", "توافق", "شورای امنیت", "نشست", "دیدار", "روابط",
        "دبلوماس", "مفاوضات", "وزير الخارجية", "سفير", "اتفاق", "مجلس الامن", "قمة",
        "diplomat", "talks", "foreign minister", "ambassador", "summit", "agreement", "security council", "treaty", "election", "president"]},
    "sanctions": {"fa": "تحریم‌ها", "color": "#E0A84E", "kw": [
        "تحریم", "اوفک", "لیست سیاه", "fatf", "مسدود", "عقوبات", "عقوبة", "حظر",
        "sanction", "ofac", "blacklist", "embargo", "export control", "asset freeze", "designat"]},
    "energy": {"fa": "انرژی", "color": "#A98BE0", "kw": [
        "نفت", "گاز", "اوپک", "پالایشگاه", "بنزین", "برق", "انرژی", "ال ان جی", "میعانات",
        "النفط", "الغاز", "اوبك", "مصفاه", "الطاقه", "الكهرباء",
        "oil", "crude", "gas", "opec", "refiner", "lng", "energy", "brent", "power grid", "barrel", "pipeline"]},
    "society": {"fa": "جامعه و سیاست داخلی", "color": "#E07FA2", "kw": [
        "مجلس", "دولت", "اعتراض", "زنان", "آموزش", "بهداشت", "دادگاه", "حقوق بشر", "انتخابات",
        "البرلمان", "احتجاج", "حقوق الانسان", "محكمه", "انتخابات",
        "protest", "parliament", "court", "human rights", "health", "education", "nobel", "refugee"]},
    "logistics": {"fa": "حمل‌ونقل و لجستیک", "color": "#4FB9C9", "kw": [
        "کشتی", "بندر", "کانتینر", "کشتیرانی", "تنگه", "ترانزیت", "حمل", "راه آهن", "نفتکش", "کریدور", "گمرک",
        "سفينه", "ميناء", "حاويات", "الشحن", "مضيق", "ناقله", "الملاحه",
        "shipping", "port", "container", "vessel", "tanker", "freight", "strait", "logistics", "cargo", "carrier", "rail", "trucking", "suez", "maritime", "supply chain"]},
    "conflict": {"fa": "درگیری و امنیت", "color": "#E97366", "kw": [
        "حمله", "انفجار", "کشته", "موشک", "پهپاد", "جنگ", "نظامی", "آتش بس", "تروریست", "درگیری", "حوثی",
        "هجوم", "انفجار", "قتلى", "مقتل", "صاروخ", "مسيره", "الحرب", "عسكري", "وقف اطلاق النار", "اشتباكات",
        "attack", "strike", "killed", "missile", "drone", "war", "military", "ceasefire", "troops", "explosion", "airstrike", "militant"]},
    "markets": {"fa": "بازار، تجارت و اقتصاد", "color": "#72BC8F", "kw": [
        "بورس", "دلار", "تورم", "بانک مرکزی", "صادرات", "واردات", "تجارت", "قیمت", "ارز", "طلا", "اقتصاد", "تعرفه",
        "البورصه", "الدولار", "التضخم", "البنك المركزي", "الصادرات", "التجاره", "الاقتصاد", "رسوم جمركيه",
        "stock", "market", "inflation", "central bank", "export", "import", "trade", "tariff", "economy", "gdp", "currency", "bond", "fed", "price"]},
}

URGENCY = {
    "flash": ["فوری", "خبر فوری", "عاجل", "breaking", "urgent", "just in"],
    "high": ["کشته", "انفجار", "حمله", "قتلى", "انفجار", "هجوم", "killed", "explosion", "attack", "emergency", "evacuat", "تخلیه", "اضطراری"],
}
NEG = ["کشته", "حمله", "بحران", "سقوط", "کاهش", "تحریم", "انفجار", "اعتراض", "تهدید", "محکوم", "قتلى", "هجوم", "ازمه", "تراجع", "عقوبات", "تهديد",
       "killed", "attack", "crisis", "fall", "drop", "sanction", "threat", "condemn", "war", "tumble", "plunge", "fear"]
POS = ["توافق", "افزایش", "رشد", "صلح", "آتش بس", "همکاری", "اتفاق", "نمو", "سلام", "تعاون", "ارتفاع",
       "agreement", "growth", "rise", "peace", "ceasefire", "cooperat", "deal", "record high", "recover", "award", "wins"]
DENIAL = ["تکذیب", "رد کرد", "نفی", "نفى", "ينفي", "deny", "denied", "denies", "refute", "false claim", "شایعه"]

# ---- Gazetteer: id -> (type, fa, en, ar, lat, lon, aliases...) ----
G = [
 # countries
 ("IR","GPE","ایران","Iran","إيران",32.4,53.7,["iranian","tehran","تهران","طهران","ایرانی","الإيراني"]),
 ("US","GPE","آمریکا","United States","الولايات المتحدة",39.8,-98.6,["u.s.","usa","america","american","washington","ایالات متحده","واشنگتن","امريكا","أمريكي","واشنطن","کاخ سفید","white house","البيت الأبيض"]),
 ("SA","GPE","عربستان","Saudi Arabia","السعودية",23.9,45.1,["saudi","riyadh","ریاض","الرياض","سعودی","عربستان سعودی"]),
 ("AE","GPE","امارات","UAE","الإمارات",23.4,53.8,["emirates","dubai","abu dhabi","دبی","ابوظبی","دبي","أبوظبي","الاماراتي"]),
 ("IQ","GPE","عراق","Iraq","العراق",33.2,43.7,["iraqi","baghdad","بغداد","عراقی"]),
 ("SY","GPE","سوریه","Syria","سوريا",34.8,38.9,["syrian","damascus","دمشق","سوری"]),
 ("LB","GPE","لبنان","Lebanon","لبنان",33.9,35.9,["lebanese","beirut","بیروت","بيروت"]),
 ("IL","GPE","اسرائیل","Israel","إسرائيل",31.0,34.9,["israeli","tel aviv","تل آویو","اسرائیلی","الإسرائيلي"]),
 ("PS","GPE","فلسطین","Palestine","فلسطين",31.9,35.2,["gaza","west bank","غزه","کرانه باختری","غزة","الضفة الغربية","palestinian"]),
 ("YE","GPE","یمن","Yemen","اليمن",15.6,48.5,["yemeni","sanaa","aden","صنعا","عدن","صنعاء"]),
 ("QA","GPE","قطر","Qatar","قطر",25.3,51.2,["doha","دوحه","الدوحة"]),
 ("OM","GPE","عمان","Oman","سلطنة عمان",21.5,55.9,["muscat","مسقط"]),
 ("KW","GPE","کویت","Kuwait","الكويت",29.3,47.5,[]),
 ("BH","GPE","بحرین","Bahrain","البحرين",26.0,50.6,[]),
 ("JO","GPE","اردن","Jordan","الأردن",30.6,36.2,["amman","امان"]),
 ("EG","GPE","مصر","Egypt","مصر",26.8,30.8,["egyptian","cairo","قاهره","القاهرة"]),
 ("TR","GPE","ترکیه","Turkey","تركيا",39.0,35.2,["turkish","türkiye","ankara","istanbul","آنکارا","استانبول","أنقرة"]),
 ("AF","GPE","افغانستان","Afghanistan","أفغانستان",33.9,67.7,["afghan","kabul","کابل","طالبان","taliban"]),
 ("PK","GPE","پاکستان","Pakistan","باكستان",30.4,69.3,["pakistani","islamabad","اسلام آباد"]),
 ("IN","GPE","هند","India","الهند",20.6,78.9,["indian","new delhi","دهلی"]),
 ("CN","GPE","چین","China","الصين",35.9,104.2,["chinese","beijing","پکن","بكين"]),
 ("RU","GPE","روسیه","Russia","روسيا",61.5,105.3,["russian","moscow","kremlin","مسکو","کرملین","موسكو","الكرملين"]),
 ("UA","GPE","اوکراین","Ukraine","أوكرانيا",48.4,31.2,["ukrainian","kyiv","kiev","کی یف","کییف","كييف"]),
 ("GB","GPE","بریتانیا","United Kingdom","بريطانيا",55.4,-3.4,["uk","britain","british","london","انگلیس","لندن","المملكة المتحدة"]),
 ("FR","GPE","فرانسه","France","فرنسا",46.2,2.2,["french","paris","پاریس","باريس"]),
 ("DE","GPE","آلمان","Germany","ألمانيا",51.2,10.4,["german","berlin","برلین","برلين"]),
 ("IT","GPE","ایتالیا","Italy","إيطاليا",41.9,12.6,["italian","rome"]),
 ("ES","GPE","اسپانیا","Spain","إسبانيا",40.5,-3.7,["spanish","madrid"]),
 ("JP","GPE","ژاپن","Japan","اليابان",36.2,138.3,["japanese","tokyo","توکیو"]),
 ("KR","GPE","کره جنوبی","South Korea","كوريا الجنوبية",35.9,127.8,["seoul","سئول"]),
 ("KP","GPE","کره شمالی","North Korea","كوريا الشمالية",40.3,127.5,["pyongyang","پیونگ یانگ"]),
 ("AZ","GPE","آذربایجان","Azerbaijan","أذربيجان",40.1,47.6,["baku","باکو"]),
 ("AM","GPE","ارمنستان","Armenia","أرمينيا",40.1,45.0,["yerevan","ایروان"]),
 ("TM","GPE","ترکمنستان","Turkmenistan","تركمانستان",38.9,59.6,[]),
 ("KZ","GPE","قزاقستان","Kazakhstan","كازاخستان",48.0,66.9,[]),
 ("ET","GPE","اتیوپی","Ethiopia","إثيوبيا",9.1,40.5,["ethiopian","addis ababa"]),
 ("ER","GPE","اریتره","Eritrea","إريتريا",15.2,39.8,["eritrean"]),
 ("SD","GPE","سودان","Sudan","السودان",12.9,30.2,["sudanese","khartoum","خارطوم","الخرطوم"]),
 ("LY","GPE","لیبی","Libya","ليبيا",26.3,17.2,["libyan","tripoli"]),
 ("MA","GPE","مراکش","Morocco","المغرب",31.8,-7.1,["moroccan","rabat"]),
 ("DZ","GPE","الجزایر","Algeria","الجزائر",28.0,1.7,["algerian"]),
 ("TN","GPE","تونس","Tunisia","تونس",33.9,9.5,[]),
 ("NG","GPE","نیجریه","Nigeria","نيجيريا",9.1,8.7,["nigerian"]),
 ("ZA","GPE","آفریقای جنوبی","South Africa","جنوب أفريقيا",-30.6,22.9,[]),
 ("BR","GPE","برزیل","Brazil","البرازيل",-14.2,-51.9,["brazilian"]),
 ("VE","GPE","ونزوئلا","Venezuela","فنزويلا",6.4,-66.6,["venezuelan","caracas"]),
 ("MX","GPE","مکزیک","Mexico","المكسيك",23.6,-102.6,["mexican"]),
 ("CA","GPE","کانادا","Canada","كندا",56.1,-106.3,["canadian","ottawa"]),
 ("AU","GPE","استرالیا","Australia","أستراليا",-25.3,133.8,["australian"]),
 ("SG","GPE","سنگاپور","Singapore","سنغافورة",1.35,103.8,[]),
 ("MY","GPE","مالزی","Malaysia","ماليزيا",4.2,101.9,[]),
 ("ID","GPE","اندونزی","Indonesia","إندونيسيا",-0.8,113.9,[]),
 ("TW","GPE","تایوان","Taiwan","تايوان",23.7,121.0,["taipei"]),
 ("PL","GPE","لهستان","Poland","بولندا",51.9,19.1,["polish","warsaw"]),
 ("NL","GPE","هلند","Netherlands","هولندا",52.1,5.3,["dutch","rotterdam","the hague","لاهه","روتردام"]),
 ("BY","GPE","بلاروس","Belarus","بيلاروسيا",53.7,27.9,[]),
 ("GE","GPE","گرجستان","Georgia","جورجيا",42.3,43.4,["tbilisi"]),
 ("SO","GPE","سومالی","Somalia","الصومال",5.2,46.2,["somali"]),
 ("DJ","GPE","جیبوتی","Djibouti","جيبوتي",11.8,42.6,[]),
 # chokepoints / ports / places
 ("LOC:HORMUZ","LOC","تنگه هرمز","Strait of Hormuz","مضيق هرمز",26.57,56.25,["hormuz","هرمز"]),
 ("LOC:REDSEA","LOC","دریای سرخ","Red Sea","البحر الأحمر",20.0,38.5,["دریای احمر"]),
 ("LOC:BABELMANDEB","LOC","باب‌المندب","Bab el-Mandeb","باب المندب",12.6,43.3,["bab al-mandab","باب المندب"]),
 ("LOC:SUEZ","LOC","کانال سوئز","Suez Canal","قناة السويس",30.6,32.3,["suez","سوئز","السويس"]),
 ("LOC:PERSIANGULF","LOC","خلیج فارس","Persian Gulf","الخليج",26.9,51.5,["gulf","خلیج"]),
 ("LOC:CASPIAN","LOC","دریای خزر","Caspian Sea","بحر قزوين",41.7,50.6,["caspian","خزر"]),
 ("LOC:BLACKSEA","LOC","دریای سیاه","Black Sea","البحر الأسود",43.2,34.0,["black sea"]),
 ("LOC:PANAMA","LOC","کانال پاناما","Panama Canal","قناة بنما",9.1,-79.7,["panama"]),
 ("LOC:MALACCA","LOC","تنگه مالاکا","Strait of Malacca","مضيق ملقا",2.5,101.4,["malacca"]),
 ("PORT:BANDARABBAS","PORT","بندرعباس","Bandar Abbas","بندر عباس",27.18,56.27,["بندر عباس","shahid rajaee","شهید رجایی"]),
 ("PORT:CHABAHAR","PORT","چابهار","Chabahar","تشابهار",25.29,60.64,[]),
 ("PORT:JEBELALI","PORT","جبل علی","Jebel Ali","جبل علي",25.01,55.06,[]),
 ("PORT:SHANGHAI","PORT","شانگهای","Shanghai","شنغهاي",31.23,121.47,[]),
 ("PORT:ROTTERDAM","PORT","روتردام","Rotterdam port","ميناء روتردام",51.95,4.14,["port of rotterdam"]),
 # organizations
 ("ORG:UN","ORG","سازمان ملل","United Nations","الأمم المتحدة",40.75,-73.97,["un ","u.n.","guterres","گوترش","غوتيريش","سازمان ملل متحد"]),
 ("ORG:IAEA","ORG","آژانس بین‌المللی انرژی اتمی","IAEA","الوكالة الدولية للطاقة الذرية",48.23,16.42,["grossi","گروسی","غروسي","آژانس اتمی"]),
 ("ORG:OPEC","ORG","اوپک","OPEC","أوبك",48.21,16.37,["opec+","اوپک پلاس","أوبك+"]),
 ("ORG:NATO","ORG","ناتو","NATO","الناتو",50.88,4.42,["حلف شمال الأطلسي"]),
 ("ORG:EU","ORG","اتحادیه اروپا","European Union","الاتحاد الأوروبي",50.84,4.38,["eu ","brussels","بروکسل","بروكسل","european commission"]),
 ("ORG:ICC","ORG","دیوان کیفری بین‌المللی","International Criminal Court","المحكمة الجنائية الدولية",52.1,4.28,["icc"]),
 ("ORG:ICJ","ORG","دیوان بین‌المللی دادگستری","International Court of Justice","محكمة العدل الدولية",52.09,4.29,["icj"]),
 ("ORG:OFAC","ORG","اوفک (وزارت خزانه‌داری آمریکا)","OFAC / US Treasury","وزارة الخزانة الأمريكية",38.9,-77.03,["treasury","خزانه داری","الخزانة"]),
 ("ORG:FATF","ORG","FATF","FATF","مجموعة العمل المالي",48.86,2.29,["اف ای تی اف"]),
 ("ORG:IMF","ORG","صندوق بین‌المللی پول","IMF","صندوق النقد الدولي",38.9,-77.04,["international monetary fund"]),
 ("ORG:WORLDBANK","ORG","بانک جهانی","World Bank","البنك الدولي",38.9,-77.04,[]),
 ("ORG:HOUTHI","ORG","حوثی‌ها (انصارالله)","Houthis","الحوثيون",15.35,44.2,["houthi","حوثی","انصارالله","الحوثي","أنصار الله"]),
 ("ORG:HAMAS","ORG","حماس","Hamas","حماس",31.5,34.47,[]),
 ("ORG:HEZBOLLAH","ORG","حزب‌الله","Hezbollah","حزب الله",33.85,35.5,["hizbollah","حزب الله"]),
 ("ORG:IRGC","ORG","سپاه پاسداران","IRGC","الحرس الثوري",35.7,51.4,["revolutionary guard","سپاه","الحرس الثوري"]),
 ("ORG:FED","ORG","فدرال رزرو","Federal Reserve","الاحتياطي الفيدرالي",38.89,-77.05,["the fed","powell","پاول"]),
 ("ORG:IMO","ORG","سازمان بین‌المللی دریانوردی","IMO","المنظمة البحرية الدولية",51.49,-0.12,["international maritime organization"]),
 ("ORG:IEA","ORG","آژانس بین‌المللی انرژی","IEA","وكالة الطاقة الدولية",48.85,2.3,["international energy agency"]),
]
ENTITY = {e[0]: {"id": e[0], "type": e[1], "name_fa": e[2], "name_en": e[3], "name_ar": e[4], "lat": e[5], "lon": e[6],
                 "iso": e[0] if len(e[0]) == 2 else None} for e in G}


def _is_ar(s):
    return any("\u0600" <= ch <= "\u06FF" for ch in s)


@lru_cache(maxsize=1)
def _patterns():
    pats = []
    for e in G:
        names = {e[2], e[3], e[4], *e[7]}
        for n in names:
            nn = normalize(n).strip()
            if len(nn) < 2:
                continue
            if _is_ar(nn):
                if nn.startswith("ال"):
                    core = re.escape(nn)
                    rx = rf"(?<![\w\u0600-\u06FF])(?:[وبلف])?{core}(?![\w\u0600-\u06FF])"
                else:
                    rx = rf"(?<![\w\u0600-\u06FF])(?:[وبلف]|ال|و?ال)?{re.escape(nn)}(?:ی|ها|های|ي|ية)?(?![\w\u0600-\u06FF])"
            else:
                rx = rf"(?<![a-z0-9]){re.escape(nn.strip())}(?:s|n|ns)?(?![a-z0-9])"
            pats.append((e[0], n, re.compile(rx)))
    return pats


def find_entities(text: str):
    t = normalize(text)
    found = {}
    for eid, surface, rx in _patterns():
        if eid in found:
            continue
        if rx.search(t):
            found[eid] = surface
    # case-sensitive acronyms that collide with common words after lower-casing
    if "US" not in found and re.search(r"(?<![A-Za-z])U\.?S\.?(?![A-Za-z])", text or ""):
        found["US"] = "US"
    if "ORG:UN" not in found and re.search(r"(?<![A-Za-z])UN(?![A-Za-z])", text or ""):
        found["ORG:UN"] = "UN"
    if "ORG:EU" not in found and re.search(r"(?<![A-Za-z])EU(?![A-Za-z])", text or ""):
        found["ORG:EU"] = "EU"
    return found


def kw_hits(text_norm: str, kws):
    return sum(1 for k in kws if normalize(k) in text_norm)


def classify(text: str):
    t = normalize(text)
    scores = {k: kw_hits(t, v["kw"]) for k, v in TOPICS.items()}
    total = sum(scores.values())
    topics = sorted([(k, s / total) for k, s in scores.items() if s > 0], key=lambda x: -x[1]) if total else []
    urgency = "normal"
    if kw_hits(t, URGENCY["flash"]):
        urgency = "flash"
    elif kw_hits(t, URGENCY["high"]) >= 1:
        urgency = "high"
    neg, pos = kw_hits(t, NEG), kw_hits(t, POS)
    sentiment = 0.0 if neg + pos == 0 else round((pos - neg) / (pos + neg), 2)
    category = topics[0][0] if topics else "geopolitics"
    return {"topics": [{"label": k, "p": round(p, 2)} for k, p in topics[:3]], "urgency": urgency,
            "sentiment": sentiment, "category": category}


def has_denial(text: str) -> bool:
    t = normalize(text)
    return any(normalize(d) in t for d in DENIAL)

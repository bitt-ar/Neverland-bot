# تقرير مراجعة Neverland CLI — DevOps Audit Report

> **التاريخ:** 2026-09-20
> **المراجع:** مراجعة سطر بسطر (Line-by-Line) من منظور DevOps
> **الهدف:** ضمان أن التثبيت على ويندوز وجميع توزيعات لينيكس يعمل بدون أي مشاكل للمستخدم النهائي

---

## 1. نطاق المراجعة

| الملف | الأسطر | الوظيفة |
|---|---|---|
| `cli/neverland.py` | 921 سطر | منطق الـ CLI بالكامل (config / start / stop / status / logs / domain / uninstall) |
| `cli/__main__.py` | 5 أسطر | Entry point لـ `python -m cli` |
| `cli/__init__.py` | 8 أسطر | Metadata |
| `scripts/install.ps1` | 167 سطر | مثبّت ويندوز (PowerShell) |
| `scripts/install.sh` | 461 سطر | مثبّت لينيكس/macOS (Bash) |

**المنهجية:** قراءة كاملة للكود، تتبع مسارات التنفيذ (flow tracing) لكل سيناريو مستخدم، محاكاة التعبيرات الحرجة فعليًا على ويندوز (Windows PowerShell 5.1 + Python 3.11.7)، ومطابقة الافتراضات مع `requirements.txt` و `pyproject.toml` و `dashboard/package.json` و `core/database.py`.

---

## 2. الملخص التنفيذي

التصميم العام **جيد**: عزل ملفات dev/prod في profiles، منطق `resolve_active_mode` للكشف التلقائي، fallback متعدد الطبقات لـ pip على لينيكس، ودعم واسع للتوزيعات. لكن توجد **حالتان CRITICAL ستُفشلان التثبيت فعليًا** عند المستخدمين، بالإضافة إلى مشاكل HIGH في إدارة العمليات (daemon/orphan) وفي مسار الإنتاج (prod build).

| # | الخطورة | المكوّن | الخلاصة |
|---|---|---|---|
| 1 | **CRITICAL** | install.ps1 | تعبير تقسيم الوسائط معطوب → فشل اكتشاف Python + فشل إنشاء الـ venv **مضمون** في مسار winget (تم إثباته تجريبيًا) |
| 2 | **CRITICAL** | neverland.py (487, 492) | `subprocess.run(["npm", ...])` بدون `cmd /c` على ويندوز → `FileNotFoundError` → انهيار CLI في أول `start` بوضع prod |
| 3 | **HIGH** | neverland.py (474, 505) | وضع `-d` ليس daemon حقيقيًا — إغلاق الطرفية يقتل الخدمات (SIGHUP / Console Close) |
| 4 | **HIGH** | neverland.py (550–565) | `kill_process_tree` على لينيكس لا يقتل أبناء npm → `next-server` يتيم ويحتل المنفذ |
| 5 | **HIGH** | install.sh (188–230) | لا إعادة تحقق من إصدار Python بعد تثبيته → RHEL8/CentOS/Amazon2 (Python 3.6!) وUbuntu 20.04 (3.10) → فشل غامض لاحقًا |
| 6 | **HIGH** | neverland.py (490–492) | بناء prod يتم مرة واحدة فقط → تغيير `NEXT_PUBLIC_APP_URL` لاحقًا لا يُعاد بناؤه → OAuth redirect يبقى قديمًا |
| 7 | **HIGH** | install.sh (398–424) | بعد التثبيت، أمر `neverland` غير متاح في الطرفية الحالية ولا توجد رسالة تشرح ذلك |
| 8 | **HIGH** | كامل التدفق | لا يوجد تثبيت أو فحص لـ MongoDB → أول تشغيل يتجمد ~30 ثانية ثم ينفجر بخطأ ServerSelectionTimeout |

ثم 12 نتيجة MEDIUM/LOW مفصّلة أدناه.

---

## 3. النتائج التفصيلية

### [CRITICAL-1] install.ps1 — تعبير تقسيم وسائط Python معطوب

**الموقع:** الأسطر 48–62 (الاكتشاف)، السطر 100 (إنشاء venv)، الأسطر 67–69 (مسار winget)

```powershell
$ver = & $cmd.Split(' ')[0] $cmd.Split(' ')[1..($cmd.Split(' ').Length-1)] -c "..."
```

**المشكلة:** عندما يكون المرشح كلمة واحدة (`"python"` أو `"py"`) فإن `[1..(Length-1)]` يصبح `[1..0]` أي نطاقًا تنازليًا `@(1, 0)`: العنصر `[1]` خارج النطاق فيعود `$null` والعنصر `[0]` يعيد اسم الأمر نفسه. النتيجة أن Python يستقبل وسيطًا فارغًا + اسمه كوسيط ثانٍ فيعاملهما كملف سكربت.

**الدليل التجريبي (على هذا الجهاز، Python 3.11.7 موجود على PATH):**

```
DETECT_VER=[]          ← الاكتشاف فشل رغم وجود Python 3.11!
python.exe: can't open file 'E:\code\neverland-main\python': [Errno 2] No such file or directory
EXITCODE=2             ← إنشاء الـ venv فشل، ولم يُنشأ أي venv
```

**السيناريوهات المتأثرة:**

| جهاز المستخدم | ماذا يحدث |
|---|---|
| بدون Python إطلاقًا (الأشيع) | winget يثبّت 3.11 ← `$PythonExe = "python"` ← السطر 100 بنفس التعبير المعطوب ← **"Failed to create virtual environment" ← فشل مضمون 100%** |
| Python 3.13 أو 3.14 فقط | المرشحان `py -3.12`/`py -3.11` يفشلان (لا توجد `py -3.13` في القائمة!) و`py`/`python` معطوبان ← winget يثبّت 3.11 ← نفس الفشل أعلاه |
| بدون winget (ويندوز قديم/سيرفر) | رسالة "ثبّت Python وفعّل Add to PATH" ← حتى بعد تثبيته يدويًا يظل الاكتشاف فاشلًا (مرشح `python` معطوب) ← **المستخدم عالق للأبد** |
| عنده Python 3.11 أو 3.12 عبر py launcher | ✅ يعمل فقط عبر المرشحين ثنائيي الكلمة |

**الإصلاح المقترح:**

```powershell
$PythonCandidates = @("python", "python3", "py -3.13", "py -3.12", "py -3.11", "py")
foreach ($cmd in $PythonCandidates) {
    $parts = $cmd -split '\s+'
    $exe = $parts[0]
    $exeArgs = @($parts | Select-Object -Skip 1)   # مصفوفة فارغة آمنة لكلمة واحدة
    try {
        $ver = & $exe @exeArgs -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
        # ... نفس منطق المقارنة
    } catch {}
}
```

وبعد تثبيت winget: تحقق فعليًا بدل الوثوق (`& py -3.11 --version`) واستخدم `py -3.11` كقيمة لـ `$PythonExe` بدل `"python"`.

---

### [CRITICAL-2] neverland.py — npm/pnpm عبر subprocess.run بدون cmd /c على ويندوز

**الموقع:** السطر 487 (`npm install`) والسطر 492 (`npm run build`)

```python
subprocess.run([runner, "install"], cwd=str(DASHBOARD_DIR), check=False)      # 487
subprocess.run([runner, "run", "build"], cwd=str(DASHBOARD_DIR), env=env, check=False)  # 492
```

**المشكلة:** على ويندوز، `npm` و`pnpm` ملفات `.cmd` وليست `.exe`، و`CreateProcess` لا يشغّلها مباشرة → `FileNotFoundError: [WinError 2]`. الكاتب انتبه لهذه المشكلة عند تشغيل الداشبورد (السطران 500–501 يغلفان بـ `cmd /c`) لكن **نسي الأمرين 487 و492**.

**السيناريو المتفجر (شائع جدًا):** مستخدم ويندوز يختار prod:
1. `neverland start` ← البوت يشتغل ← `.next` غير موجود ← السطر 492 ← **انهيار بـ traceback**
2. الانهيار يحدث **قبل** `save_pids` (سطر 512) ← البوت يبقى شغالًا **يتيمًا غير مُتتبَّع**
3. `neverland stop` لاحقًا يقول "No running Neverland processes detected"
4. إعادة `start` ← لا كشف لتعارض ← **نسخة بوت ثانية** تتصارع على نفس التوكن

كذلك نفس الانهيار في السطر 487 لمن فقد `node_modules` (إلغاء تثبيت جزئي، استنساخ جديد بدون مثبّت).

**الإصلاح المقترح (دالة موحدة):**

```python
def _node_cmd(runner: str, *args: str) -> list[str]:
    cmd = [runner, *args]
    if platform.system() == "Windows":
        cmd = ["cmd", "/c"] + cmd
    return cmd

subprocess.run(_node_cmd(runner, "install"), cwd=str(DASHBOARD_DIR), check=False)
subprocess.run(_node_cmd(runner, "run", "build"), cwd=str(DASHBOARD_DIR), env=env, check=False)
```

---

### [HIGH-1] وضع daemon `-d` وهمي — الخدمات تموت بإغلاق الطرفية

**الموقع:** السطران 474 و505 في `neverland.py`

```python
bot_proc = subprocess.Popen(bot_cmd, cwd=..., env=env, stdout=bot_log, stderr=bot_log)      # 474
dash_proc = subprocess.Popen(dash_cmd, cwd=..., env=env, stdout=dash_log, stderr=dash_log)  # 505
```

- **لينيكس/macOS:** الأبناء يرثون الـ session والـ controlling terminal. إغلاق الطرفية يرسل `SIGHUP` ← موت البوت والداشبورد رغم أن المستخدم استخدم `start -d` متوقعًا البقاء.
- **ويندوز:** الأبناء مرتبطون بالكونسول ← إغلاق النافذة يرسل `CTRL_CLOSE` للجميع.

**الإصلاح:**

```python
kwargs = {}
if is_daemon:
    if platform.system() == "Windows":
        flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
        kwargs["creationflags"] = flags
    else:
        kwargs["start_new_session"] = True   # setsid → محصّن ضد SIGHUP
bot_proc = subprocess.Popen(bot_cmd, cwd=..., env=env, stdout=bot_log, stderr=bot_log, **kwargs)
```

---

### [HIGH-2] kill_process_tree على لينيكس يترك أيتام

**الموقع:** الأسطر 550–565

`Popen([runner, "run", "start"])` على لينيكس يشغّل npm الذي يلف `sh -c "next start"` الذي يولّد `next-server`. القتل الحالي:

```python
os.kill(pid, signal.SIGTERM)   # يقتل npm فقط!
```

النتيجة: `next-server` يبقى حيًا ← المنفذ 3000 محجوز ← كل `neverland start` لاحق يفشل بـ `EADDRINUSE` والمستخدم لا يفهم لماذا. (على ويندوز لا مشكلة: `taskkill /T /F` يقتل الشجرة كاملة.)

**الإصلاح:** اربط كل عملية بمجموعة خاصة وقت الإنشاء (`start_new_session=True` حتى في الوضع الأمامي) ثم:

```python
try:
    os.killpg(os.getpgid(pid), signal.SIGTERM)
    time.sleep(0.5)
    if is_process_running(pid):
        os.killpg(os.getpgid(pid), signal.SIGKILL)
except (ProcessLookupError, PermissionError):
    pass
```

---

### [HIGH-3] install.sh — لا تحقق من إصدار Python بعد التثبيت الآلي

**الموقع:** الأسطر 188–230

الحلقة الأولى تفحص 3.11+ بصرامة (صحيح)، لكن عند الفشل تُثبّت `python3` من مدير الحزم **وتثق بأنه 3.11+ بدون قياس**:

| التوزيعة | `python3` الفعلي | النتيجة |
|---|---|---|
| RHEL 8 / CentOS Stream 8 | **3.6** | venv بـ 3.6 ← pip قديم ← discord.py الحديثة ترفض ← فشل غامض عميق |
| Amazon Linux 2 | **3.6** | نفس ما سبق |
| Ubuntu 20.04 LTS (لا يزال منتشرًا) | **3.10** | venv يعمل لكن يخالف `requires-python = ">=3.11"` وأجزاء من المنظومة قد تنكسر |

**الإصلاح:** بعد كل فرع تثبيت أعد الفحص:

```bash
VER=$("$PYTHON_BIN" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null || echo "0.0")
MAJOR=${VER%%.*}; MINOR=${VER#*.}
if [ "$MAJOR" -lt 3 ] || [ "$MINOR" -lt 11 ]; then
    echo -e "${C_RED}Installed Python is $VER but Neverland requires >= 3.11."
    echo -e "On RHEL/Fedora try: sudo dnf install python3.12   (or enable the python3.12 module)"
    echo -e "On Ubuntu 20.04 use the deadsnakes PPA.${C_RESET}"
    exit 1
fi
```

---

### [HIGH-4] إعادة بناء prod لا تحدث أبدًا — NEXT_PUBLIC_APP_URL يتجمد

**الموقع:** السطر 490

```python
if mode == "prod" and not (DASHBOARD_DIR / ".next").exists():
```

متغيرات `NEXT_PUBLIC_*` تُدمج داخل حزمة JS وقت البناء. المشكلة: بعد أول بناء، أي تعديل لاحق للدومين/المنفذ عبر `neverland config` **لن يُعاد بناؤه** ← الداشبورد يخدم روابط OAuth قديمة ← فشل تسجيل الدخول بصمت. لا يوجد أي أمر يدوي للبناء أيضًا.

**الإصلاح المقترح:** قارن بصمة الإعدادات وقت البناء واحفظها:

```python
build_stamp = DASHBOARD_DIR / ".next" / ".neverland-build-stamp"
stamp_src = "|".join(f"{k}={env_vars.get(k,'')}" for k in ("NEXT_PUBLIC_APP_URL", "PORT", "HOSTNAME"))
needs_build = mode == "prod" and (not (DASHBOARD_DIR / ".next").exists() or not build_stamp.exists() or build_stamp.read_text() != stamp_src)
if needs_build:
    subprocess.run(...)
    build_stamp.write_text(stamp_src)
```

أو أضف أمرًا صريحًا `neverland build` ووثّقه.

---

### [HIGH-5] install.sh — أمر `neverland` غير متاح في الطرفية الحالية

**الموقع:** الأسطر 398–424

`export PATH="$BIN_DIR:$PATH"` (سطر 422) يؤثر على عملية السكربت فقط. المستخدم الذي شغّل `curl ... | bash` يكتب بعدها `neverland` فيحصل على **command not found** — ولا توجد أي رسالة تشرح أنه يجب `source ~/.bashrc` أو فتح طرفية جديدة. كذلك مستخدم fish لا يشمله الإطلاق على `.bashrc/.zshrc/.profile` إطلاقًا.

**الإصلاح:** أضف في نهاية التثبيت:

```bash
case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *)
        echo -e "${C_YELLOW}NOTE: 'neverland' will be available after reloading your shell:${C_RESET}"
        echo -e "  ${C_BOLD}source ~/.bashrc${C_RESET}   (or open a new terminal)"
        ;;
esac
```

---

### [HIGH-6] لا يوجد MongoDB: لا تثبيت، لا فحص اتصال، وتجمد 30 ثانية

**المواقع:** installers (غياب كامل) + `core/database.py` سطر 20 (أول `create_index` يلامس الخادم فعليًا)

المعالج يقبل `mongodb://localhost:27017` كافتراضي حتى لو لا MongoDB على الجهاز. أول `neverland start` ← البوت يتجمد ~30 ثانية (serverSelectionTimeoutMS الافتراضي) ← `ServerSelectionTimeoutError` ← "Discord Bot stopped unexpectedly (exit code 1)" ← ثم `cmd_stop` يقتل الداشبورد أيضًا. المستخدم الجديد لا يميز: هل التوكن خاطئ؟ هل الشبكة مقطوعة؟

**الإصلاح المقترح:** فحص استباقي في `cmd_start` (قبل الإطلاق):

```python
def check_mongodb(uri: str) -> tuple[bool, str]:
    try:
        from pymongo import MongoClient
        client = MongoClient(uri, serverSelectionTimeoutMS=3000)
        client.admin.command("ping")
        client.close()
        return True, ""
    except Exception as e:
        return False, str(e)
```

مع رسالة واضحة: "MongoDB غير قابل للوصول — شغّل `docker compose up -d mongo` أو ثبّت MongoDB محليًا أو راجع URI". وفحص مماثل في المثبّتين بعد الـ wizard.

---

### [MEDIUM-1] أمر `domain` يتجاهل منفذ .env دائمًا

**المواقع:** السطر 903 (`--port` بـ `default=3000`) + السطر 696 (`port = args.port or int(...)`)

لأن `args.port` يبدأ دائمًا بقيمة 3000 (truthy) فلا يُقرأ `PORT` من `.env` أبدًا. مستخدم ضبط `PORT=4000` وشغّل `neverland domain nginx` يحصل على proxy يشير إلى **3000** ← 404/رفض اتصال بعد تطبيق الإعداد.

**الإصلاح:** `p_domain.add_argument("--port", type=int, default=None, ...)` — سطر واحد.

---

### [MEDIUM-2] `neverland logs -f` يُتجاهل المتابعة بصمت عند target=all

**الموقع:** السطر 671 — `if follow and len(log_files) == 1:`

`neverland logs -f` (الاستخدام الأشيع، target=all) يطبع 50 سطرًا وينتهي **بدون متابعة ولا تحذير**. إما تتبع الملفين بالتناوب أو رسالة: "استخدم `--bot` أو `--dashboard` مع `-f`".

---

### [MEDIUM-3] أسرار بلا صلاحيات مقيدة + توسيع سطح التعرض

**المواقع:** `write_env_file` (سطر 189) و`activate_profile` (سطر 234)

- على لينيكس تُكتب `.env` و`.env.local` و`.neverland/profiles/*.env` بصلاحيات umask الافتراضية (644 غالبًا) رغم أنها تحوي `TOKEN` و`DISCORD_CLIENT_SECRET` و`DASHBOARD_SESSION_SECRET` و`MONGODB_URI` (ببيانات دخول Atlas).
- توزيع `TOKEN` (توكن البوت) إلى `dashboard/.env.local` يضاعف مواضع تسريب التوكن.

**الإصلاح:**

```python
import stat
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as f:
    ...
# ويندوز: فكّر في icacls أو اتركها (ACL المستخدم الوحيد غالبًا)
```

وتقييم إزالة `TOKEN` من dashboard_data إن لم يستهلكها الداشبورد فعليًا.

---

### [MEDIUM-4] تسريب بادئة الأسرار في سطر الإدخال

**الموقع:** السطر 199 — `{default[:6]}...`

عرض أول 6 أحرف من التوكن/السر في التريمنال (تظهر في لقطات الشاشة وsession recordings). بادئات توكنات ديسكورد معلومة البنية؛ الأفضل عرض `••••` فقط أو طول القيمة.

---

### [MEDIUM-5] لا تحقق من صحة المنافذ

**الموقع:** الأسطر 316–318

`PORT` و`CONTROL_PLANE_PORT` يُقبلان كما هما: "abc" أو "99999" أو منفذ مستخدم. النتيجة خطأ غامض لاحقًا في Next/uvicorn. **الإصلاح:** تحقق `1 <= int(v) <= 65535` مع إعادة الطلب، ورسالة تحذير إن كان المنفذ مشغولًا (`socket.bind` تجريبي).

---

### [MEDIUM-6] uninstall على ويندوز: حذف ذاتي جزئي + رسالة نجاح كاذبة

**الموقع:** الأسطر 800–845

1. الـ CLI يعمل أصلاً من `.venv\Scripts\python.exe` (عبر الشيم) ← `shutil.rmtree(.venv)` لا يستطيع حذف exe قيد التشغيل ← مع `ignore_errors=True` يُحذف جزئيًا **ويُطبع "[OK] Removed .venv"**.
2. السطر 800 `input(...)` بلا معالجة `EOFError/KeyboardInterrupt` ← traceback بدل رسالة لطيفة (على عكس `prompt_input`).
3. لا يُزال مدخل `~/.neverland/bin` من User PATH ← بقايا.
4. النص يعد بحذف `node_modules (optional)` لكن لا يوجد flag ولا حذف فعلي.

---

### [MEDIUM-7] وحدات systemd المولدة تشغّل كل شيء كـ root

**الموقع:** الأسطر 749 و765 — `User=root`

ممارسة خاطئة أمنيًا لمنصة تواجه الإنترنت (داشبورد + بوت). **الإصلاح:** `User=neverland` مع `WorkingDirectory` قابلة للقراءة، أو على الأقل طباعة تحذير وتوصية بمستخدم مخصص.

---

### [MEDIUM-8] install.ps1 — فجوات متعددة

1. **عدم فحص نتيجة winget/git:** إن فشل `winget install` (لا شبكة) يكمل السكربت ليفشل لاحقًا برسالة "Failed to create virtual environment" مضللة. افحص `$LASTEXITCODE` بعد كل أمر خارجي.
2. **شيم بترميز ASCII** (سطر 137): مسار تثبيت/اسم مستخدم بحروف عربية أو غير لاتينية ← الشيم يفسد ولا يعمل `neverland` إطلاقًا. استخدم `-Encoding Default` أو تحقق من ASCII في `$InstallDir` وحذّر.
3. **`SetEnvironmentVariable("Path", ..., "User")`** (سطر 142): يكتب `REG_SZ` بدل `REG_EXPAND_SZ` ← قد يكسر مدخلات PATH لدى المستخدم تعتمد على `%VAR%`. الحل الأنظف: `[Microsoft.Win32.Registry]` مع `RegistryValueKind.ExpandString`.
4. **غياب npm/pnpm بعد تخطي التثبيت:** لا رسالة، والفشل يتأخر لأول `start`.
5. لا فحص لإصدار Node (Next 15 يتطلب ≥ 18.18) — npm سيتجاوز EBADENGINE بصمت.

### [MEDIUM-9] أمر `start` الداخلي يقترح prod افتراضيًا

**الموقع:** السطر 429 — `default="2"`

مستخدم جديد يشغّل `neverland start` قبل `config` يُوجَّه افتراضيًا إلى prod (يتطلب Client ID/Secret لم يجهزوهما)، بينما `cmd_config` (سطر 291) يقترح dev. وحّد الافتراض على dev.

### [MEDIUM-10] فحص "already running" يغطي البوت فقط

**الموقع:** السطر 446 — إن كانت pids.json تحوي dashboard حيًا فقط (مثلًا بعد `--dashboard-only`) فسيبدأ start عمليات جديدة ← تعارض منفذ 3000 ← "Dashboard stopped unexpectedly" مربك. افحص أيًّا من العمليتين.

### [MEDIUM-11] ألوان ANSI على conhost القديم

`neverland.cmd` يفتح cmd التقليدي على ويندوز 10 ← أكواد `\033[...` تُطبع كرموز مشوهة. إصلاح سطر واحد أعلى `main()`: `os.system("")` على ويندوز يفعّل VT processing في Win10+ (أو `colorama.just_fix_windows_console()`).

### [MEDIUM-12] الغياب عند both-flags في الوضع الأمامي

`start --bot-only --dashboard-only` معًا ← عمليتان `None` ← حلقة `while True: sleep(1)` صامتة بلا خروج. تحقق مبكر وارفض الأعلام معًا.

---

### نتائج منخفضة الخطورة (LOW / Nits)

| # | الموقع | الملاحظة |
|---|---|---|
| L1 | سطر 858 | `--version` مكتوبة يدويًا "1.0.0" بدل القراءة من `cli/__init__.__version__` ← انجراف إصدارات |
| L2 | `get_state/save_state/get_pids/save_pids` | لا كتابة ذرية ولا قفل — تشغيل CLI من طرفيتين قد يفسد state.json (الكود يتحمل الفساد ببساطة ويمسحه) |
| L3 | سطر 396 | `if pid <= 0` ينهار بـ TypeError لو كانت قيمة pids.json نصية (يدوي/تالف) — تحقق `isinstance(pid, int)` |
| L4 | سطر 400 | `shell=True` مع f-string لـ tasklist — لا خطر عملي حاليًا لكن الأنظف list-args بلا shell |
| L5 | سطر 668 | `all_lines[-lines:]` مع `-n 0` يطبع الملف كاملًا، ومع قيمة سالبة يطبع البداية — تحقق من النطاق |
| L6 | سطر 516 | `started_at` بلا منطقة زمنية |
| L7 | PID reuse / zombies | `is_process_running` قد يرهن بـ PID معاد تدويره (ويندوز) أو zombie (لينيكس) — مقبول لـ CLI لكن يذكر |
| L8 | requirements.txt | معظم الاعتماديات بلا تثبيت إصدارات (`motor`, `aiohttp`, `pydantic`...) ← تثبيت غدًا قد يختلف عن اليوم؛ أضف constraints أو pin |
| L9 | installers | لا فحص مساحة قرص ولا RAM — بناء Next.js على VPS بـ 512MB سيُقتل بـ OOM بلا رسالة مفهومة |
| L10 | pyproject.toml سطر 30 | `neverland = "cli.neverland:main"` كسكربت pip يكسر افتراض `BASE_DIR = cli.parent` (سيشير لـ site-packages). المثبتات لا تستخدمه، لكن وجوده يدعو لكسر مستقبلي — إما حذفه أو جعل BASE_DIR يقرأ `NEVERLAND_HOME` env |
| L11 | install.sh سطر 415 | كتابة `export PATH` في `.bashrc` و`.profile` معًا ← تكرار عند توريث أحدهما للآخر (غير ضار) |
| L12 | installers | التشغيل التلقائي النهائي (`cli start` أمامي) يجعل "المثبّت" لا يعود للمحث حتى Ctrl+C — والمستخدم قد يظن أن التثبيت علِق. الأفضل: طباعة تعليمات بدل التشغيل التلقائي، أو `-d` |

---

## 4. محاكاة رحلة المستخدم النهائي (E2E)

| السيناريو | النتيجة الحالية |
|---|---|
| ويندوز نظيف بدون Python + `irm \| iex` | ❌ **فشل مضمون** في إنشاء venv (CRITICAL-1) |
| ويندوز + Python 3.13/3.14 فقط | ❌ winget يعيد تثبيت 3.11 ثم فشل venv (CRITICAL-1) |
| ويندوز + Python 3.11/3.12 موجودان | ✅ تثبيت ناجح، dev يعمل؛ **prod ينهار عند أول build** (CRITICAL-2) |
| Ubuntu 22.04/24.04 أو Debian 12 | ✅ التثبيت والتشغيل يعملان |
| RHEL 8 / Amazon Linux 2 | ⚠️ يكمل بـ Python 3.6 ثم فشل pip غامض (HIGH-3) |
| أي لينيكس بعد `curl \| bash` مباشرة | ⚠️ `neverland` غير موجود في الطرفية الحالية (HIGH-5) |
| `start -d` ثم إغلاق الطرفية (أي منصة) | ❌ الخدمات تموت (HIGH-1) |
| `stop` على لينيكس ثم `start` | ⚠️ احتمال EADDRINUSE بسبب next-server اليتيم (HIGH-2) |
| تغيير الدومين بعد أول تشغيل prod | ❌ OAuth يبقى مشيرًا للرابط القديم (HIGH-4) |
| أول تشغيل بلا MongoDB | ❌ تجمد 30ث ثم انهيار بلا تشخيص (HIGH-6) |

---

## 5. نقاط القوة (للإنصاف)

- فصل dev/prod في profiles مع مزامنة `.env` و`.env.local` — تصميم نظيف ويمنع تلويث وضع بآخر.
- `resolve_active_mode` (سطر 108) منطق ذكي: مرشح صريح ← state ← كشف من الملفات الموجودة.
- install.sh: سلم pip رباعي الطبقات (ensurepip ← curl get-pip ← wget ← urllib) ومعالجة `--without-pip` — من أفضل ما رأيت في مثبتات هاوية المستخدمين.
- كشف TTY الصحيح: `[ -t 0 ]` مع fallback إلى `/dev/tty` — يعمل حتى مع `curl | bash`.
- ويندوز: `taskkill /T /F` و`cmd /c` لتشغيل الداشبورد صحيحان.
- تنظيف venv التالف قبل إعادة الإنشاء في المثبتين.
- توليد مفاتيح التشفير محليًا (`secrets.token_hex` / Fernet) وعدم إعادة توليدها عند إعادة الإعداد.

---

## 6. خارطة الإصلاح المقترحة (بالأولوية)

1. **الآن (تكسر التثبيت):** CRITICAL-1 (install.ps1 slicing + إضافة `py -3.13` + تحقق بعد winget) وCRITICAL-2 (wrap node commands بـ `cmd /c`).
2. **قبل أول دفعة مستخدمين:** HIGH-1 (daemon flags)، HIGH-2 (killpg)، HIGH-3 (تحقق إصدار Python بعد التثبيت)، HIGH-6 (فحص MongoDB)، رسالة PATH بعد التثبيت (HIGH-5)، rebuild-stamp للـ prod (HIGH-4).
3. **قريبًا:** MEDIUM-1..5 (domain port، logs -f، صلاحيات 600، إخفاء الأسرار، تحقق منافذ) + MEDIUM-8 (فحوصات install.ps1).
4. **متابعة:** MEDIUM-6..12 وقائمة LOW (خاصة تثبيت إصدارات requirements وتراجع root في systemd).

**اختبار موصى به بعد الإصلاح (حسم نهائي):**
- جهاز/VM ويندوز نظيف بلا Python → `irm | iex` كامل.
- Ubuntu 24.04 وRHEL 9 عبر `curl | bash` كامل.
- `config → start -d → إغلاق الطرفية → status` يجب أن يُظهر RUNNING.
- `stop → status → start` مرتان متتاليتان على لينيكس بلا EADDRINUSE.
- `config` بتغيير PORT ثم `domain nginx` → يجب أن يشير proxy للمنفذ الجديد.

---

*انتهى التقرير — أُجريت المحاكاات التجريبية للنتائج CRITICAL-1 على بيئة ويندوز حقيقية (Windows PowerShell 5.1، Python 3.11.7) بتاريخ 2026-09-20.*

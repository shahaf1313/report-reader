# הדוח השבועי

אפליקציית רשת (PWA) לקריאת סיכום שבועי של הכלכלה ושוק ההון. הדוחות נכתבים אוטומטית פעם בשבוע על ידי משימה מתוזמנת של Claude, נשמרים כקבצי Markdown בתיקייה `reports/`, ומתפרסמים ב־GitHub Pages. באייפון מוסיפים את האתר למסך הבית, והוא נפתח כמו אפליקציה.

## איך זה עובד

```
Claude Desktop (שישי 07:00)
  -> reports/2026-09-25.md
  -> git push
  -> GitHub Actions: בדיקות, בניית reports/index.json, פרסום ל־Pages
  -> האפליקציה בטלפון טוענת את האינדקס ומציגה את הדוח החדש
```

## מה יש באפליקציה

- כרטיס ראשי לדוח האחרון, עם הכותרת, הסיכום ונתוני השוק העיקריים
- גרף "מצב הרוח בשווקים" לאורך עד 26 השבועות האחרונים
- ארכיון לפי חודשים, עם חיפוש לפי מילה, תגית או תאריך, וסימון של דוחות שלא נקראו
- עמוד דוח עם פס התקדמות, שינוי גודל טקסט, שיתוף, תיבת תחזיות ומעבר לדוח הקודם והבא
- עבודה בלי רשת: שמונת הדוחות האחרונים נשמרים במכשיר
- מצב כהה אוטומטי, תמיכה מלאה בימין לשמאל, ושורות באנגלית מוצגות משמאל לימין

## מבנה

```
index.html, manifest.webmanifest, sw.js   מעטפת האפליקציה
app/                                      קוד ועיצוב
vendor/                                   marked + DOMPurify (בלי CDN, כדי שיעבוד בלי רשת)
icons/                                    נוצרים ב־scripts/make_icons.py
reports/                                  הדוחות
samples/                                  דוחות לדוגמה עם נתונים מומצאים, לפיתוח בלבד
scripts/build_index.py                    בונה את reports/index.json
scripts/serve.py                          שרת תצוגה מקומי
tests/                                    בדיקות
docs/                                     מדריכים
```

## מדריכים

- [הקמה והתקנה באייפון](docs/setup.md)
- [פורמט הדוח](docs/report-format.md)
- [המשימה המתוזמנת והפרומפט שלה](docs/scheduled-task.md)

## פיתוח מקומי

```
pip install pyyaml
python scripts/serve.py --samples      # תצוגה עם הדוחות לדוגמה
python -m unittest discover tests      # בדיקות סקריפט הבנייה
```

בדיקות הדפדפן (כשהשרת רץ עם `--samples`):

- `http://localhost:8000/tests/lib.test.html` - בדיקות יחידה לתאריכים, חיפוש, ניתוב וסינון HTML
- `http://localhost:8000/tests/layout.test.html` - אין גלילה לרוחב ברוחבי טלפון שונים, וכל מסך מוצג
- `http://localhost:8000/tests/phone.html` - תצוגה ברוחב אייפון

ב־Windows אפשר להריץ אותן בלי לפתוח דפדפן:

```
./scripts/headless.ps1 -Url http://localhost:8000/tests/lib.test.html -Dom
```

# POP Invoice — Offline Invoicing App

Ye ek **fully offline PWA** hai jo aapke Plaster of Paris workshop ke prompt ke hisaab se banayi gayi hai.

## Kyun PWA, native APK nahi?

Native Android APK (Kotlin/Java + Gradle) build karne ke liye Android SDK/toolchain chahiye hota hai jo is dev environment mein available nahi hai. Isliye ye app **PWA** (Progressive Web App) ke tor pe banayi hai — jab phone pe "Add to Home Screen" karoge to:

- Bilkul normal app jaisa icon aur full-screen window milegi
- 100% offline chalegi (koi internet kabhi nahi chahiye — jsPDF library bhi locally bundled hai)
- Sara data phone ke andar IndexedDB me save hota hai (koi cloud/account nahi)

Agar future me **real .apk file** chahiye ho, to yehi code (bina kisi change ke) Android Studio me ek simple WebView wrapper project me daal ke APK bana sakte ho — main wo bhi bana sakta hoon agar chaho.

## Phone pe install kaise karein

1. Ye poora folder (`index.html`, `app.js`, `manifest.json`, `sw.js`, `icon.svg`, `jspdf.umd.min.js`) kisi bhi free static hosting pe daal do — sabse aasan: **GitHub Pages** ya **Netlify Drop** (netlify.com/drop pe folder drag-drop karo, 10 second me live link mil jayega).
2. Wo link phone ke Chrome me kholo.
3. Chrome menu (⋮) → **"Add to Home screen"** dabao.
4. Ab home screen pe icon aa jayega — usay tap karke app khulegi, bilkul native app jaisi.
5. Ek dafa khul jaye to internet band karke bhi chalti rahegi.

(Agar hosting nahi karna, to `index.html` ko seedha phone me kholke bhi use kar sakte ho — sirf "Add to Home Screen" wala step available nahi hoga.)

## Features jo is prompt ke mutabiq bane hain

- **Home**: 4 bade buttons — Create Invoice, Daily Sales, Invoice History, Settings + aaj ki sales ka quick summary
- **Create Invoice**: Auto invoice number (INV-000001...), Walk-in Customer / Cash Sale quick buttons, 4 categories (Tiles, Plaster Bags, Design, Others), unlimited item rows, auto calculation, discount, paid/remaining, Cash/Credit toggle
- **Invoice History**: Search + date filter, tap karke invoice reopen, print ya PDF share
- **Daily Sales**: Har category ka aaj ka qty + amount, aur total — har naye invoice pe auto update
- **Settings**: Company name, phone, address, invoice prefix, currency
- Professional Blue theme, rounded cards, large buttons — one-handed dusty-workshop use ke liye optimize

## 80mm Thermal Printer se print karna

Invoice History ya newly-saved invoice ke view screen me **"Print (80mm Receipt)"** button hai — ye ab narrow 80mm receipt format (monospace, dashed lines, cut-friendly) me print karta hai, wide table wala format nahi.

Bluetooth thermal printer (jo zyada tar POS printers workshop me use hote hain) se print karne ke 2 tarike:

**Option A — RawBT app (sabse aasan, zyada tar printers ke saath chalta hai)**
1. Play Store se **RawBT Print Service** install karo (free) aur apna Bluetooth thermal printer usme pair/select karo.
2. RawBT ko system default print service bana do (RawBT app khol ke "Set as default" option).
3. Hamari app me invoice khol ke **Print (80mm Receipt)** dabao → Android print dialog khulega → printer list me **RawBT** select karo → Print.
4. RawBT automatically 80mm receipt ko printer pe bhej dega.

**Option B — Printer ka apna official app agar RawBT support na kare**
Zyada tar 80mm Bluetooth printers (Xprinter, Goojprt, etc.) apna print service app dete hain jo bhi same tarah Android print dialog me printer option ke tor pe show hota hai — wahi select kar lena, same steps.

> Note: agar printer 58mm wala hai (chhota wala), bata dena — main receipt width 58mm pe adjust kar dunga (`@page` aur column width sirf ek jagah change karni hoti hai).

## Udhar / Baqaya Tracking (Customer Ledger)

Home screen pe ab **"Customer Ledger"** card hai. Ye kaise kaam karta hai:

- Jab bhi invoice pe koi **naam** (jaise "Adnan", "Ahmed") likh ke save karoge — chahe Cash ho ya Credit — system uska ek record bana leta hai jisme uska **baqi baqaya (balance)** save hota hai.
- "Walk-in Customer" aur "Cash Sale" is tracking se bahar hain (kyunke wo generic naam hain, alag-alag logon ke liye use hote hain) — sirf real naam wale customers track hote hain.
- **Agli baar** jab usi naam se invoice banaoge, Customer Name likhte hi upar ek warning aa jayegi:
  > ⚠️ Ahmed ka pehle se Rs. 4,000 baqaya hai
- Summary me automatically **"Previous Due"** aur **"Total Payable"** (naya + purana) dikhega, aur jo bhi Paid Amount doge usse **"Balance After"** calculate hoga — yehi naya balance customer ke record me save ho jata hai.
- Agar customer sirf paisa dene aaya ho (naya saman na liya ho), Customer Ledger me uska naam tap karo → **"Receive Payment"** se sirf payment record kar do, invoice banane ki zarurat nahi.
- Customer Ledger screen har customer ka current balance aur poori transaction history dikhati hai (kab kitna liya, kab kitna diya).

Adnan/Ahmed wala example is se exactly is tarah kaam karega jaisa tumne bataya tha.

## Excel workflow ke saath

Shaam ko **Invoice History** screen se sab invoices dekh ke Excel me manually transfer kar sakte ho — jaisa aapne plan kiya tha (App = daily invoicing, Excel = accounting/records).

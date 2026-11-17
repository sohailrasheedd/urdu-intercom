/* =====================================================
   ترتیبات  (CONFIG)  —  صرف اسی فائل کو تبدیل کریں
   ===================================================== */

// 0) سپر ایڈمن (مکمل اختیارات، ایڈمن کی اسکرین کنٹرول، افراد کا انتظام)
const SUPERADMIN_ID       = "superadmin";

// 1) ایڈمن آئی ڈی (نیچے والی منزل - ماسٹر اسکرین)
const ADMIN_ID            = "admin";

// 2) فائر بیس کی ترتیبات — Firebase Console سے کاپی کر کے یہاں پیسٹ کریں
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyB6u8Y2_Uac9LAJdDvxEBguBcGO9xWdlKs",
  authDomain:        "intercom-8a920.firebaseapp.com",
  databaseURL:       "https://intercom-8a920-default-rtdb.firebaseio.com",
  projectId:         "intercom-8a920",
  storageBucket:     "intercom-8a920.firebasestorage.app",
  messagingSenderId: "123259857640",
  appId:             "1:123259857640:web:175546062ca39311b9375d",
  measurementId:     "G-LKGZRX11EM"
};

// 2.1) ویب پش نوٹیفکیشن کے لیے VAPID Key (FCM Web Push Certificate Key Pair)
// Firebase Console -> Project Settings -> Cloud Messaging -> Web Push certificates se copy kar ke yahan dalein
const FCM_VAPID_KEY = "BBYD7-78AbfBfUWBieW67avuozUOi5BoUnMpdY0A4n8LLJvkCIjXC3o2ImHhhqNSFGEToWJ-mYP6YT7b5tazstk";


// 3) چار افراد کی تفصیلات اور الگ لاگ ان (سپر ایڈمن کی ترتیبات کے مطابق)
// ہر فرد اپنی آئی ڈی اور پاس ورڈ سے لاگ ان ہوگا اور صرف اپنے پیغامات دیکھے گا
const PEOPLE = [
  { id: "sohail",    name: "سہیل",       icon: "", color: "#1e88e5", loginId: "sohail",    password: "1234" },
  { id: "abrar",     name: "ابرار",       icon: "", color: "#43a047", loginId: "abrar",     password: "1234" },
  { id: "ahmedraza", name: "احمد رضا",   icon: "", color: "#fb8c00", loginId: "ahmedraza", password: "1234" },
  { id: "bapu",      name: "باپو",        icon: "", color: "#e53935", loginId: "bapu",      password: "1234" }
];

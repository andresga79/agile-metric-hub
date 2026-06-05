import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import es from "@/i18n/locales/es.json";
import en from "@/i18n/locales/en.json";

const savedLang = typeof window !== "undefined" ? localStorage.getItem("lang") : null;
const browserLang = typeof navigator !== "undefined" ? navigator.language : "es";
const detected = savedLang || (browserLang.startsWith("es") ? "es" : "en");

i18n.use(initReactI18next).init({
  resources: { es: { translation: es }, en: { translation: en } },
  lng: detected,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export function setLanguage(lang: "es" | "en") {
  i18n.changeLanguage(lang);
  localStorage.setItem("lang", lang);
  document.documentElement.lang = lang;
}

export default i18n;

/** @type {import('tailwindcss').Config} */
// slate 팔레트를 CSS 변수로 매핑하여 .light 클래스에서 전체 톤을 한 번에 반전시킨다.
// (bg-slate-900/90 같은 투명도 수식어도 <alpha-value>로 그대로 동작)
const slateVar = (shade) => `rgb(var(--slate-${shade}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        slate: {
          50: slateVar(50),
          100: slateVar(100),
          200: slateVar(200),
          300: slateVar(300),
          400: slateVar(400),
          500: slateVar(500),
          600: slateVar(600),
          700: slateVar(700),
          800: slateVar(800),
          900: slateVar(900),
          950: slateVar(950),
        },
      },
      fontFamily: {
        sans: ['"Pretendard"', '"Malgun Gothic"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};

import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        login: {
          bg: "hsl(var(--login-bg))",
          input: {
            bg: "hsl(var(--login-input-bg))",
            border: "hsl(var(--login-input-border))",
          },
        },
        dashboard: {
          sidebar: "hsl(var(--dashboard-sidebar))",
          "sidebar-foreground": "hsl(var(--dashboard-sidebar-foreground))",
          surface: "hsl(var(--dashboard-surface))",
        },

        status: {
          open: {
            DEFAULT: "hsl(var(--status-open))",
            foreground: "hsl(var(--status-open-foreground))",
          },
          success: {
            DEFAULT: "hsl(var(--status-success))",
            foreground: "hsl(var(--status-success-foreground))",
          },
          "in-progress": {
            DEFAULT: "hsl(var(--status-in-progress))",
            foreground: "hsl(var(--status-in-progress-foreground))",
          },
          done: {
            DEFAULT: "hsl(var(--status-done))",
            foreground: "hsl(var(--status-done-foreground))",
          },
          new: {
            DEFAULT: "hsl(var(--status-new))",
            foreground: "hsl(var(--status-new-foreground))",
          },
        },

        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
          6: "hsl(var(--chart-6))",
          7: "hsl(var(--chart-7))",
          8: "hsl(var(--chart-8))",
          success: "hsl(var(--chart-success))",
          warning: "hsl(var(--chart-warning))",
          danger: "hsl(var(--chart-danger))",
          info: "hsl(var(--chart-info))",
          neutral: "hsl(var(--chart-neutral))",
          grid: "hsl(var(--chart-grid))",
          axis: "hsl(var(--chart-axis))",
        },

        // Bloco de notas do agente (papel pautado)
        notepad: {
          paper: "hsl(var(--notepad-paper))",
          rule: "hsl(var(--notepad-rule))",
          margin: "hsl(var(--notepad-margin))",
        },

        // shadcn sidebar semantic tokens (mapped to dashboard identity)
        sidebar: "hsl(var(--sidebar))",
        "sidebar-foreground": "hsl(var(--sidebar-foreground))",
        "sidebar-accent": "hsl(var(--sidebar-accent))",
        "sidebar-accent-foreground": "hsl(var(--sidebar-accent-foreground))",
        "sidebar-border": "hsl(var(--sidebar-border))",
        "sidebar-ring": "hsl(var(--sidebar-ring))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;

#!/usr/bin/env python3
"""sCalp desktop panel — кнопки реально вызывают скрипты.

Запуск:
  python3 панель.py
  # или двойной клик / из терминала
"""
from __future__ import annotations

import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import messagebox, ttk

ROOT = Path(__file__).resolve().parent
START = ROOT / 'ЗАПУСК.sh'
STOP = ROOT / 'СТОП.sh'
OPEN = ROOT / 'open.sh'


def run_script(args: list[str], title: str) -> None:
    def worker() -> None:
        try:
            r = subprocess.run(
                args,
                cwd=str(ROOT),
                capture_output=True,
                text=True,
                timeout=60,
            )
            out = ((r.stdout or '') + (r.stderr or '')).strip() or '(ok)'
            root.after(0, lambda: messagebox.showinfo(title, out[-1500:]))
        except Exception as e:
            root.after(0, lambda: messagebox.showerror(title, str(e)))

    threading.Thread(target=worker, daemon=True).start()


root = tk.Tk()
root.title('sCalp — панель')
root.minsize(360, 420)
root.configure(bg='#0a0e14')

style = ttk.Style()
try:
    style.theme_use('clam')
except tk.TclError:
    pass

frm = ttk.Frame(root, padding=16)
frm.pack(fill='both', expand=True)

ttk.Label(frm, text='sCalp', font=('IBM Plex Sans', 18, 'bold')).pack(anchor='w')
ttk.Label(frm, text='Кнопки запускают скрипты из папки проекта').pack(anchor='w', pady=(0, 12))

btns = [
    ('▶  ЗАПУСК сервера + браузер', [str(START)], 'Запуск'),
    ('■  СТОП сервера', [str(STOP)], 'Стоп'),
    ('Терминал', [str(OPEN), 'terminal'], 'Терминал'),
    ('Документация', [str(OPEN), 'docs'], 'Docs'),
    ('TradingView', [str(OPEN), 'tv'], 'TV'),
    ('Hub / панель', [str(OPEN), 'hub'], 'Hub'),
    ('Агенты (docs)', [str(OPEN), 'agents'], 'Agents'),
    ('API (docs)', [str(OPEN), 'api'], 'API'),
]

for label, args, title in btns:
    b = ttk.Button(frm, text=label, command=lambda a=args, t=title: run_script(a, t))
    b.pack(fill='x', pady=4)

ttk.Label(frm, text=str(ROOT), foreground='#8b9bb0').pack(anchor='w', pady=(16, 0))

if not START.exists():
    messagebox.showerror('sCalp', f'Не найден {START}')
    sys.exit(1)

root.mainloop()

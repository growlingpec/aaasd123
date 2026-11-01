# Интерактивный терминал облачного компьютера: bash в псевдотерминале. Запускается cloud.js как
# `python3 -c <этот файл> <колонки> <строки>` внутри контейнера. Вход (stdin) — кадры: 1 байт типа + 4 байта длины
# + данные; тип 0 — нажатые клавиши, тип 1 — новый размер окна (2+2 байта). Выход (stdout) — вывод терминала как есть.
import os, pty, sys, select, struct, fcntl, termios, signal

cols, rows = (int(x) for x in sys.argv[1:3])
pid, fd = pty.fork()
if pid == 0:
    os.chdir(os.environ.get('HOME') or '/')
    os.environ['TERM'] = 'xterm-256color'
    os.execvp('bash', ['bash', '-l'])

def resize(c, r):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', r, c, 0, 0))

def write_all(f, data):
    while data:
        try:
            data = data[os.write(f, data):]
        except InterruptedError:
            continue

resize(cols, rows)
inp, out, buf = sys.stdin.fileno(), sys.stdout.fileno(), b''
try:
    while True:
        try:
            ready, _, _ = select.select([fd, inp], [], [])
        except InterruptedError:
            continue
        if fd in ready:
            try:
                data = os.read(fd, 65536)
            except OSError:  # bash завершился
                break
            if not data:
                break
            write_all(out, data)
        if inp in ready:
            data = os.read(inp, 65536)
            if not data:  # окно терминала закрыто
                break
            buf += data
            while len(buf) >= 5:
                kind, size = buf[0], struct.unpack('>I', buf[1:5])[0]
                if len(buf) < 5 + size:
                    break
                body, buf = buf[5:5 + size], buf[5 + size:]
                if kind == 0:
                    write_all(fd, body)
                elif kind == 1 and size == 4:
                    resize(*struct.unpack('>HH', body))
finally:
    try:
        os.kill(pid, signal.SIGHUP)
    except ProcessLookupError:
        pass

"""Count lines, words and characters of a UTF-8 text file, like wc."""

import argparse
import sys


def count_text(text: str) -> tuple[int, int, int]:
    """Return (lines, words, chars) for text."""
    return (text.count("\n"), len(text.split()), len(text))


def build_parser() -> argparse.ArgumentParser:
    """Return the argument parser for contar.py."""
    parser = argparse.ArgumentParser(
        prog="contar.py",
        description="Cuenta líneas, palabras y caracteres de un fichero UTF-8.",
    )
    parser.add_argument("-l", "--lines", action="store_true",
                        help="muestra el número de líneas")
    parser.add_argument("-w", "--words", action="store_true",
                        help="muestra el número de palabras")
    parser.add_argument("-c", "--chars", action="store_true",
                        help="muestra el número de caracteres")
    parser.add_argument("path", help="fichero de texto UTF-8")
    return parser


def format_counts(counts: tuple[int, int, int], path: str,
                  show_lines: bool, show_words: bool, show_chars: bool) -> str:
    """Return the output line, e.g. '2 4 20 f.txt'."""
    values = []
    if show_lines:
        values.append(counts[0])
    if show_words:
        values.append(counts[1])
    if show_chars:
        values.append(counts[2])
    values.append(path)
    return " ".join(str(v) for v in values)


def main(argv: list[str] | None = None) -> int:
    """Run the CLI. argv excludes the program name. Return the exit code."""
    args = build_parser().parse_args(argv)
    if not (args.lines or args.words or args.chars):
        args.lines = args.words = args.chars = True
    try:
        with open(args.path, encoding="utf-8", newline="") as f:
            text = f.read()
    except FileNotFoundError:
        print(f"contar.py: error: no existe el fichero: {args.path}",
              file=sys.stderr)
        return 1
    except UnicodeDecodeError:
        print(f"contar.py: error: el fichero no es UTF-8 válido: {args.path}",
              file=sys.stderr)
        return 1
    except OSError:
        print(f"contar.py: error: no se puede leer el fichero: {args.path}",
              file=sys.stderr)
        return 1
    print(format_counts(count_text(text), args.path,
                        args.lines, args.words, args.chars))
    return 0


if __name__ == "__main__":
    sys.exit(main())

import contextlib
import io
import pathlib
import subprocess
import sys
import tempfile
import unittest

from contar import format_counts, main


class MainTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = str(pathlib.Path(tmp.name) / "f.txt")
        with open(self.path, "w", encoding="utf-8", newline="") as f:
            f.write("hola mundo\nañade ñu\n")

    def run_main(self, argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = main(argv)
        return code, out.getvalue()

    def test_no_options_shows_all(self):
        code, out = self.run_main([self.path])
        self.assertEqual(code, 0)
        self.assertEqual(out, f"2 4 20 {self.path}\n")

    def test_lines_only(self):
        code, out = self.run_main(["-l", self.path])
        self.assertEqual(code, 0)
        self.assertEqual(out, f"2 {self.path}\n")

    def test_words_only(self):
        code, out = self.run_main(["-w", self.path])
        self.assertEqual(code, 0)
        self.assertEqual(out, f"4 {self.path}\n")

    def test_chars_only(self):
        code, out = self.run_main(["-c", self.path])
        self.assertEqual(code, 0)
        self.assertEqual(out, f"20 {self.path}\n")

    def test_order_is_fixed(self):
        code, out = self.run_main(["-c", "-l", self.path])
        self.assertEqual(code, 0)
        self.assertEqual(out, f"2 20 {self.path}\n")

    def test_combined_flags(self):
        code, out = self.run_main(["-lw", self.path])
        self.assertEqual(code, 0)
        self.assertEqual(out, f"2 4 {self.path}\n")

    def test_long_options(self):
        code, out = self.run_main(["--words", "--chars", self.path])
        self.assertEqual(code, 0)
        self.assertEqual(out, f"4 20 {self.path}\n")

    def test_format_counts(self):
        self.assertEqual(
            format_counts((1, 2, 3), "x.txt", True, False, True),
            "1 3 x.txt",
        )

    def test_script_runs_as_program(self):
        root = pathlib.Path(__file__).resolve().parent.parent
        result = subprocess.run(
            [sys.executable, "contar.py", "-l", self.path],
            cwd=root, capture_output=True, text=True, encoding="utf-8",
        )
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, f"2 {self.path}\n")


class ErrorTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = tmp.name
        self.root = pathlib.Path(__file__).resolve().parent.parent

    def run_main(self, argv):
        out = io.StringIO()
        err = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = main(argv)
        return code, out.getvalue(), err.getvalue()

    def test_missing_file(self):
        path = str(pathlib.Path(self.dir) / "no_existe.txt")
        code, out, err = self.run_main([path])
        self.assertEqual(code, 1)
        self.assertEqual(out, "")
        self.assertEqual(err, f"contar.py: error: no existe el fichero: {path}\n")

    def test_invalid_utf8(self):
        path = str(pathlib.Path(self.dir) / "mal.txt")
        with open(path, "wb") as f:
            f.write(b"hola \xff\xfe\n")
        code, out, err = self.run_main([path])
        self.assertEqual(code, 1)
        self.assertEqual(out, "")
        self.assertEqual(
            err, f"contar.py: error: el fichero no es UTF-8 válido: {path}\n")

    def test_directory(self):
        code, out, err = self.run_main([self.dir])
        self.assertEqual(code, 1)
        self.assertEqual(out, "")
        self.assertEqual(
            err, f"contar.py: error: no se puede leer el fichero: {self.dir}\n")

    def test_missing_file_as_program(self):
        path = str(pathlib.Path(self.dir) / "no_existe.txt")
        result = subprocess.run(
            [sys.executable, "contar.py", path],
            cwd=self.root, capture_output=True, text=True, encoding="utf-8",
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertNotIn("Traceback", result.stderr)

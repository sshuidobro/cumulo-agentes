import unittest

from contar import count_text


class CountTextTests(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(count_text(""), (0, 0, 0))

    def test_two_lines(self):
        self.assertEqual(count_text("hola mundo\nadiós\n"), (2, 3, 17))

    def test_no_trailing_newline(self):
        self.assertEqual(count_text("a b"), (0, 2, 3))

    def test_multiple_spaces_and_tabs(self):
        self.assertEqual(count_text("  uno\t\tdos  \n"), (1, 2, 13))

    def test_non_ascii_counts_code_points(self):
        self.assertEqual(count_text("ñandú\n"), (1, 1, 6))

    def test_crlf_keeps_carriage_return(self):
        self.assertEqual(count_text("a\r\nb\r\n"), (2, 2, 6))
